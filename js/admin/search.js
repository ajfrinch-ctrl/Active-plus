/**
 * Admin Panel v2 — global search (গ্লোবাল সার্চ).
 *
 * One search box in the top bar reaches everything an admin looks for:
 * students (name / id / phone / guardian), teachers, batches, and the panel
 * sections themselves (Bengali or English label). Picking a result jumps to
 * the right section; picking a student also pre-fills the student list's own
 * filter so the row is isolated and highlighted.
 */
import { escapeHtml } from '../app.js';
import { db } from '../data.js';
import { visibleSections } from './registry.js';

const norm = (s) => String(s ?? '').toLowerCase();

export function mountGlobalSearch({ session, tabs }) {
  const input = document.getElementById('admin-global-search');
  const results = document.getElementById('admin-search-results');
  if (!input || !results) return null;

  const role = session?.role || 'admin';
  const close = () => {
    results.hidden = true;
    results.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  /* Section matching is word-based, not just substring: the owner asks for
     "স্টুডেন্ট এপ ম্যানেজমেন্ট" while the section is labelled শিক্ষার্থীর অ্যাপ,
     so a section matches when the whole phrase — or every word of it — is
     found in its label, English name, key or `alias` spellings. */
  const sectionHaystack = (s) => norm([s.label, s.en, s.key, ...(s.alias || [])].join(' '));
  const findSections = (q) => visibleSections(role).filter((s) => {
    const hay = sectionHaystack(s);
    return hay.includes(q) || q.split(/\s+/).every((word) => hay.includes(word));
  }).slice(0, 4);

  const findStudents = (q) => db.students.list().filter((s) =>
    [s.name, s.id, s.phone, s.guardian, s.school].some((v) => norm(v).includes(q))
  ).slice(0, 6);

  const findTeachers = (q) => db.teachers.list().filter((t) =>
    norm(t.name).includes(q) || norm(t.phone).includes(q)
  ).slice(0, 4);

  const findBatches = (q) => db.batches.list().filter((b) =>
    norm(b.name).includes(q) || norm(b.teacher).includes(q) || norm(b.className).includes(q)
  ).slice(0, 4);

  const groupHtml = (heading, items) => items.length ? `
    <div class="gs-group">
      <div class="gs-h">${escapeHtml(heading)}</div>
      ${items.join('')}
    </div>` : '';

  const render = () => {
    const q = norm(input.value).trim();
    if (!q) { close(); return; }

    const sections = findSections(q).map((s) => `
      <button type="button" class="gs-item" data-goto="${s.key}">
        <span class="gs-ico" aria-hidden="true">${s.icon}</span>
        <span class="gs-main">${escapeHtml(s.label)}</span>
        <small class="gs-sub">${escapeHtml(s.en)}</small>
      </button>`);

    const students = findStudents(q).map((s) => `
      <button type="button" class="gs-item" data-student="${escapeHtml(s.id)}">
        <span class="gs-ico" aria-hidden="true">👨‍🎓</span>
        <span class="gs-main">${escapeHtml(s.name)}</span>
        <small class="gs-sub">${escapeHtml(s.id)} · ${escapeHtml(s.className || '—')}</small>
      </button>`);

    const teachers = findTeachers(q).map((t) => `
      <button type="button" class="gs-item" data-goto="teachers">
        <span class="gs-ico" aria-hidden="true">👨‍🏫</span>
        <span class="gs-main">${escapeHtml(t.name)}</span>
        <small class="gs-sub">শিক্ষক · ${escapeHtml(t.phone || '')}</small>
      </button>`);

    const batches = findBatches(q).map((b) => `
      <button type="button" class="gs-item" data-goto="batches">
        <span class="gs-ico" aria-hidden="true">📚</span>
        <span class="gs-main">${escapeHtml(b.name)}</span>
        <small class="gs-sub">${escapeHtml(b.className || '')} · ${escapeHtml(b.teacher || '')}</small>
      </button>`);

    if (!(sections.length || students.length || teachers.length || batches.length)) {
      results.innerHTML = `<div class="gs-empty">কিছু পাওয়া যায়নি — “${escapeHtml(input.value.trim())}”</div>`;
      open();
      return;
    }

    results.innerHTML =
      groupHtml('শিক্ষার্থী · Students', students) +
      groupHtml('শিক্ষক · Teachers', teachers) +
      groupHtml('ব্যাচ · Batches', batches) +
      groupHtml('প্যানেল · Sections', sections);
    open();
  };

  /** Jump to a student: open the list, apply the filter, flash the row. */
  const gotoStudent = (id) => {
    tabs?.activate?.('students');
    const student = db.students.find(id);
    const search = document.getElementById('student-search');
    if (student && search) {
      search.value = student.name || id;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      // The list repaints on a debounce, so a fixed delay could look for the
      // row before it exists — wait for it to show up instead.
      let tries = 0;
      const flashRow = () => {
        const row = document.querySelector(`[data-profile-student="${id}"]`)?.closest('tr');
        if (row) {
          row.classList.add('row-flash');
          row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          setTimeout(() => row.classList.remove('row-flash'), 2200);
          return;
        }
        if (tries++ < 20) setTimeout(flashRow, 50);
      };
      flashRow();
    }
  };

  const choose = (item) => {
    if (!item) return;
    const studentId = item.dataset.student;
    const section = item.dataset.goto;
    close();
    input.value = '';
    if (studentId) { gotoStudent(studentId); return; }
    if (section) tabs?.activate?.(section);
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { close(); input.blur(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results.querySelector('.gs-item'));
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...results.querySelectorAll('.gs-item')];
      if (!items.length) return;
      event.preventDefault();
      const idx = items.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? items[Math.min(idx + 1, items.length - 1)]
        : items[Math.max(idx - 1, 0)];
      next.focus();
    }
  });
  results.addEventListener('click', (event) => {
    choose(event.target.closest('.gs-item'));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.admin-search')) close();
  });

  return { close };
}
