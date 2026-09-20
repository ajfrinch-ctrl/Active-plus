/**
 * Admin Panel v2 — global search (গ্লোবাল সার্চ).
 *
 * One search box in the top bar reaches everything an admin looks for:
 * students (name / id / phone / guardian), teachers, batches, and the panel
 * sections themselves (Bengali or English label). Results use a two-line,
 * responsive layout so a long name or phone number cannot crush the dropdown
 * on a small screen. Picking a person or batch also reveals that record in its
 * own section instead of only opening a generic page.
 */
import { escapeHtml } from '../app.js';
import { ALL_CLASSES, db } from '../data.js';
import { visibleSections } from './registry.js';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bn = (value) => String(value).replace(/\d/g, (digit) => BN_DIGITS[digit]);

/** Normalise whitespace, Unicode variants and Bengali digits for forgiving search. */
const norm = (value) => {
  const raw = String(value ?? '');
  const unicode = typeof raw.normalize === 'function' ? raw.normalize('NFKC') : raw;
  return unicode
    .replace(/[০-৯]/g, (digit) => String(BN_DIGITS.indexOf(digit)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const queryWords = (query) => norm(query).split(' ').filter(Boolean);
const compact = (value) => norm(value).replace(/[^a-z0-9\u0980-\u09ff]+/g, '');

/**
 * Match every query word against the record as a whole. This lets a search
 * such as “আরিয়ান নবম” match a name and class living in separate fields.
 * A compact comparison also makes phone/ID punctuation optional, so typing
 * 01711000001 still finds a stored number displayed as ০১৭১১-০০০০০১.
 * Exact and prefix matches sort before loose word matches.
 */
function rankedMatches(rows, valuesFor, query, limit) {
  const q = norm(query);
  const qCompact = compact(q);
  const words = queryWords(q);
  const ranked = rows.map((row, index) => {
    const values = valuesFor(row).map(norm).filter(Boolean);
    const compactValues = values.map(compact);
    const haystack = values.join(' ');
    const wordMatch = words.every((word) => haystack.includes(word));
    const compactMatch = qCompact.length >= 2 && compactValues.some((value) => value.includes(qCompact));
    if (!wordMatch && !compactMatch) return null;

    let score = 4;
    if (values.some((value) => value === q) || compactValues.some((value) => value === qCompact)) score = 0;
    else if (values.some((value) => value.startsWith(q)) || compactValues.some((value) => value.startsWith(qCompact))) score = 1;
    else if (values.some((value) => value.includes(q)) || compactValues.some((value) => value.includes(qCompact))) score = 2;
    else if (haystack.includes(q)) score = 3;
    return { row, index, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.index - b.index);

  return {
    total: ranked.length,
    items: ranked.slice(0, limit).map((entry) => entry.row)
  };
}

const regexEscape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Highlight visible query words without ever inserting unescaped record data. */
function highlighted(value, query) {
  const source = String(value ?? '');
  const terms = [...new Set(String(query ?? '').trim().split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(source);

  let matcher;
  try {
    matcher = new RegExp(terms.map(regexEscape).join('|'), 'giu');
  } catch {
    return escapeHtml(source);
  }

  let html = '';
  let cursor = 0;
  source.replace(matcher, (match, offset) => {
    html += escapeHtml(source.slice(cursor, offset));
    html += `<mark class="gs-mark">${escapeHtml(match)}</mark>`;
    cursor = offset + match.length;
    return match;
  });
  html += escapeHtml(source.slice(cursor));
  return html;
}

const metaLine = (...parts) => parts.filter((part) => String(part ?? '').trim()).join(' · ') || '—';

export function mountGlobalSearch({ session, tabs }) {
  const input = document.getElementById('admin-global-search');
  const results = document.getElementById('admin-search-results');
  if (!input || !results) return null;

  const root = input.closest('.admin-search');
  const clearButton = document.getElementById('admin-search-clear');
  const dismissButton = document.getElementById('admin-search-dismiss');
  const liveStatus = document.getElementById('admin-search-status');
  const role = session?.role || 'admin';

  const announce = (message) => {
    if (liveStatus) liveStatus.textContent = message;
  };

  const syncClearButton = () => {
    if (clearButton) clearButton.hidden = !input.value;
  };

  const closePopup = () => {
    results.hidden = true;
    results.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
  };

  const collapse = ({ blur = false } = {}) => {
    closePopup();
    root?.classList.remove('is-active');
    if (blur) input.blur();
  };

  const open = () => {
    root?.classList.add('is-active');
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const clearQuery = ({ keepFocus = true } = {}) => {
    input.value = '';
    syncClearButton();
    closePopup();
    announce('সার্চ মুছে ফেলা হয়েছে');
    if (keepFocus) input.focus();
  };

  const findSections = (query) => rankedMatches(
    visibleSections(role),
    (section) => [section.label, section.en, section.key, ...(section.alias || [])],
    query,
    5
  );

  const findStudents = (query) => rankedMatches(
    db.students.list(),
    (student) => [
      student.name, student.id, student.phone, student.guardian,
      student.school, student.roll, student.className, student.section
    ],
    query,
    6
  );

  const findTeachers = (query) => rankedMatches(
    db.teachers.list(),
    (teacher) => [teacher.name, teacher.id, teacher.phone, teacher.subject],
    query,
    4
  );

  const findBatches = (query) => rankedMatches(
    db.batches.list(),
    (batch) => [batch.name, batch.teacher, batch.className, batch.schedule],
    query,
    4
  );

  const resultItem = ({ attributes, icon, title, meta, label }) => `
    <button type="button" class="gs-item" role="option" ${attributes} aria-label="${escapeHtml(label)}">
      <span class="gs-ico" aria-hidden="true">${icon}</span>
      <span class="gs-copy">
        <span class="gs-main">${title}</span>
        <small class="gs-sub">${escapeHtml(meta)}</small>
      </span>
      <span class="gs-go" aria-hidden="true">›</span>
    </button>`;

  const groupHtml = (id, heading, match, items) => items.length ? `
    <div class="gs-group" role="group" aria-labelledby="gs-heading-${id}">
      <div class="gs-h" id="gs-heading-${id}">
        <span>${escapeHtml(heading)}</span>
        <span class="gs-count">${bn(match.total)}</span>
      </div>
      ${items.join('')}
    </div>` : '';

  const render = () => {
    const rawQuery = input.value.trim();
    const query = norm(rawQuery);
    syncClearButton();
    root?.classList.add('is-active');
    if (!query) {
      closePopup();
      announce('');
      return;
    }

    const sectionMatches = findSections(query);
    const studentMatches = findStudents(query);
    const teacherMatches = findTeachers(query);
    const batchMatches = findBatches(query);

    const sections = sectionMatches.items.map((section) => resultItem({
      attributes: `data-goto="${escapeHtml(section.key)}"`,
      icon: section.icon,
      title: highlighted(section.label, rawQuery),
      meta: section.en,
      label: `${section.label}, ${section.en}, প্যানেল`
    }));

    const students = studentMatches.items.map((student) => resultItem({
      attributes: `data-student="${escapeHtml(student.id)}"`,
      icon: '👨‍🎓',
      title: highlighted(student.name, rawQuery),
      meta: metaLine(student.id, student.className, student.phone),
      label: `${student.name}, শিক্ষার্থী, ${metaLine(student.id, student.className)}`
    }));

    const teachers = teacherMatches.items.map((teacher) => resultItem({
      attributes: `data-goto="teachers" data-record="${escapeHtml(teacher.name)}"`,
      icon: '👨‍🏫',
      title: highlighted(teacher.name, rawQuery),
      meta: metaLine(teacher.subject, teacher.phone),
      label: `${teacher.name}, শিক্ষক, ${metaLine(teacher.subject, teacher.phone)}`
    }));

    const batches = batchMatches.items.map((batch) => resultItem({
      attributes: `data-goto="batches" data-record="${escapeHtml(batch.name)}"`,
      icon: '📚',
      title: highlighted(batch.name, rawQuery),
      meta: metaLine(batch.className, batch.teacher),
      label: `${batch.name}, ব্যাচ, ${metaLine(batch.className, batch.teacher)}`
    }));

    const matches = [studentMatches, teacherMatches, batchMatches, sectionMatches];
    const total = matches.reduce((sum, match) => sum + match.total, 0);
    const shown = matches.reduce((sum, match) => sum + match.items.length, 0);

    if (!total) {
      results.innerHTML = `
        <div class="gs-empty">
          <span class="gs-empty-ico" aria-hidden="true">⌕</span>
          <strong>কোনো ফল পাওয়া যায়নি</strong>
          <span>“${escapeHtml(rawQuery)}” এর বানান বদলে বা কম শব্দে খুঁজুন।</span>
          <button type="button" class="gs-clear-action" data-clear-search>সার্চ মুছুন</button>
        </div>`;
      announce(`${rawQuery} লিখে কোনো ফল পাওয়া যায়নি`);
      open();
      return;
    }

    const summary = total > shown
      ? `মোট ${bn(total)}টি · প্রথম ${bn(shown)}টি দেখানো হচ্ছে`
      : `${bn(total)}টি ফলাফল`;
    results.innerHTML = `
      <div class="gs-summary">
        <span>${summary}</span>
        <span class="gs-key-hint" aria-hidden="true">↑↓ বাছুন · Enter খুলুন</span>
      </div>
      ${groupHtml('students', 'শিক্ষার্থী · Students', studentMatches, students)}
      ${groupHtml('teachers', 'শিক্ষক · Teachers', teacherMatches, teachers)}
      ${groupHtml('batches', 'ব্যাচ · Batches', batchMatches, batches)}
      ${groupHtml('sections', 'প্যানেল · Sections', sectionMatches, sections)}`;
    announce(`${rawQuery} লিখে ${bn(total)}টি ফলাফল পাওয়া গেছে`);
    open();
  };

  const eventFor = (element, type) => new element.ownerDocument.defaultView.Event(type, { bubbles: true });

  const flashRow = (row) => {
    if (!row) return false;
    row.classList.add('row-flash');
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setTimeout(() => row.classList.remove('row-flash'), 2200);
    return true;
  };

  /** Jump to a student, reset a stale class filter, isolate and flash the row. */
  const gotoStudent = (id) => {
    tabs?.activate?.('students');
    const student = db.students.find(id);
    const search = document.getElementById('student-search');
    const classFilter = document.getElementById('class-filter');
    if (!student || !search) return;

    if (classFilter && classFilter.value !== ALL_CLASSES) {
      classFilter.value = ALL_CLASSES;
      classFilter.dispatchEvent(eventFor(classFilter, 'change'));
    }
    // IDs are unique; names are not. Searching by id guarantees one row.
    search.value = id;
    search.dispatchEvent(eventFor(search, 'input'));

    let tries = 0;
    const findAndFlash = () => {
      const trigger = [...document.querySelectorAll('[data-profile-student]')]
        .find((element) => element.dataset.profileStudent === id);
      if (flashRow(trigger?.closest('tr'))) return;
      if (tries++ < 24) setTimeout(findAndFlash, 50);
    };
    // The local student filter repaints after a 160 ms debounce. Waiting here
    // avoids flashing an old all-students row that is about to be replaced.
    setTimeout(findAndFlash, 190);
  };

  /** A teacher/batch result should reveal the record, not just its section. */
  const gotoRecord = (section, label) => {
    tabs?.activate?.(section);
    const panel = document.getElementById(`tab-${section}`);
    if (!panel || !label) return;

    const localSearch = panel.querySelector('[data-crud-search]');
    if (localSearch) {
      localSearch.value = label;
      localSearch.dispatchEvent(eventFor(localSearch, 'input'));
    }

    const delay = localSearch ? 240 : 0;
    setTimeout(() => {
      const row = [...panel.querySelectorAll('tbody tr')]
        .find((candidate) => norm(candidate.textContent).includes(norm(label)));
      flashRow(row);
    }, delay);
  };

  const choose = (item) => {
    if (!item) return;
    const studentId = item.dataset.student;
    const section = item.dataset.goto;
    const record = item.dataset.record;
    input.value = '';
    syncClearButton();
    collapse();
    if (studentId) {
      gotoStudent(studentId);
      return;
    }
    if (section && record) {
      gotoRecord(section, record);
      return;
    }
    if (section) tabs?.activate?.(section);
  };

  const focusResult = (direction, from = document.activeElement) => {
    const items = [...results.querySelectorAll('.gs-item')];
    if (!items.length) return false;
    const current = items.indexOf(from);
    let nextIndex;
    if (direction === 'first') nextIndex = 0;
    else if (direction === 'last') nextIndex = items.length - 1;
    else if (direction === 'next') nextIndex = current < 0 ? 0 : Math.min(current + 1, items.length - 1);
    else nextIndex = current < 0 ? items.length - 1 : Math.max(current - 1, 0);
    items[nextIndex]?.focus();
    return true;
  };

  input.addEventListener('input', render);
  input.addEventListener('search', render); // native clear button in browsers that expose one
  input.addEventListener('focus', () => {
    root?.classList.add('is-active');
    if (input.value.trim()) render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      collapse({ blur: true });
      return;
    }
    if (event.key === 'Enter') {
      const first = results.querySelector('.gs-item');
      if (!first) return;
      event.preventDefault();
      choose(first);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.hidden && input.value.trim()) render();
      const moved = focusResult(event.key === 'ArrowDown' ? 'first' : 'last', input);
      if (moved) event.preventDefault();
    }
  });

  results.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopup();
      input.focus();
      return;
    }
    const directions = {
      ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last'
    };
    const direction = directions[event.key];
    if (direction && focusResult(direction, event.target)) event.preventDefault();
  });

  results.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-search]')) {
      clearQuery();
      return;
    }
    choose(event.target.closest('.gs-item'));
  });

  clearButton?.addEventListener('click', () => clearQuery());
  dismissButton?.addEventListener('click', () => collapse({ blur: true }));

  document.addEventListener('click', (event) => {
    if (!root?.contains(event.target)) collapse();
  });

  // Keyboard users can Tab away without a click; do not leave a popup floating.
  root?.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement)) collapse();
    }, 0);
  });

  window.addEventListener('admin:data-changed', () => {
    if (!results.hidden && input.value.trim()) render();
  });

  syncClearButton();
  return { close: collapse, render };
}
