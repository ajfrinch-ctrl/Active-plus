/**
 * Admin ERP modules — wires the extended admin tabs on top of the base
 * admin.html wiring. Everything reads/writes the layered data store and logs
 * activity, and every stat is computed live (nothing hard-coded).
 */

import {
  db, analytics, examSummary, classPerformance, leaderboard, exportBackup, importBackup,
  parseMcqPaste, toCSV, downloadText, globalSearch, logActivity, activityLogs,
  todayBn, newId, CLASS_OPTIONS, ALL_CLASSES, dueFees
} from './data.js';
import { mountCrud } from './crud.js';
import { escapeHtml, renderTable, statGrid, showToast, openModal, closeModal } from './app.js';
import { listUsers, updateProfile, changePassword } from './auth.js';

const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

export function mountExtraAdmin(session) {
  mountDashboard(session);
  mountGlobalSearch();
  mountClasses(session);
  mountSubjects(session);
  mountMaterials(session);
  mountAssignments(session);
  mountRoutine(session);
  mountQuestionBank(session);
  mountResults(session);
  mountNotifications(session);
  mountAnalytics();
  mountReports();
  mountUsers(session);
  mountActivity();
  mountBackup();
  mountProfile();
}

/* ---------------- Dashboard: quick actions + live sections ---------------- */
function mountDashboard(session) {
  const host = document.getElementById('overview-extra');
  const quick = document.getElementById('quick-actions');
  if (quick) {
    quick.innerHTML = [
      ['students', 'শিক্ষার্থী'], ['teachers', 'শিক্ষক'], ['exam', 'পরীক্ষা'], ['dues', 'পেমেন্ট'],
      ['notices', 'নোটিশ'], ['reports', 'রিপোর্ট'], ['backup', 'ব্যাকআপ'], ['settings', 'সেটিংস']
    ].map(([tab, label]) => `<button type="button" class="btn btn-small" data-quick="${tab}">${label}</button>`).join('');
    quick.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick]');
      if (!btn) return;
      const tabBtn = document.querySelector(`.top-tab-bar button[data-tab="${btn.dataset.quick}"]`);
      if (tabBtn) tabBtn.click();
    });
  }
  if (!host) return;
  const a = analytics();
  const recent = (arr, n) => [...arr].slice(-n).reverse();
  host.innerHTML = `
    <div class="section card-grid">
      <div class="card"><h3>আজকের ক্লাস</h3><p>${db.routine.list().slice(0, 3).map((r) => `${escapeHtml(r.subject)} ${escapeHtml(r.time)}`).join(' · ') || '—'}</p></div>
      <div class="card"><h3>আসন্ন পরীক্ষা</h3><p>${db.exams.list().slice(0, 3).map((e) => escapeHtml(e.title)).join(' · ') || '—'}</p></div>
      <div class="card"><h3>সাম্প্রতিক ভর্তি</h3><p>${recent(db.students.list(), 3).map((s) => escapeHtml(s.name)).join(' · ') || '—'}</p></div>
      <div class="card"><h3>সাম্প্রতিক পেমেন্ট</h3><p>${recent(db.payments.list(), 3).map((p) => `৳${bn(p.amount)}`).join(' · ') || '—'}</p></div>
      <div class="card"><h3>ঝুলন্ত অ্যাসাইনমেন্ট</h3><p>${bn(db.assignments.list().length)}</p></div>
      <div class="card"><h3>সাম্প্রতিক অ্যাডমিন কার্যক্রম</h3><p>${activityLogs().slice(0, 3).map((l) => escapeHtml(l.action)).join(' · ') || '—'}</p></div>
    </div>`;
  logActivity({ user: session.name, role: session.role, action: 'viewed dashboard' });
}

/* ---------------- Global search ---------------- */
function mountGlobalSearch() {
  const input = document.getElementById('global-search');
  const out = document.getElementById('global-results');
  if (!input || !out) return;
  input.addEventListener('input', () => {
    const r = globalSearch(input.value);
    const total = Object.values(r).reduce((s, arr) => s + arr.length, 0);
    if (!input.value.trim()) { out.innerHTML = ''; return; }
    out.innerHTML = total
      ? `<div class="card">
          ${r.students.map((s) => `<p>🎓 ${escapeHtml(s.name)} (${escapeHtml(s.id)})</p>`).join('')}
          ${r.teachers.map((t) => `<p>🧑🏫 ${escapeHtml(t.name)}</p>`).join('')}
          ${r.exams.map((e) => `<p>📝 ${escapeHtml(e.title)}</p>`).join('')}
          ${r.notices.map((n) => `<p>📣 ${escapeHtml(n.title)}</p>`).join('')}
        </div>`
      : '<div class="card"><p>কিছু পাওয়া যায়নি।</p></div>';
  });
}

/* ---------------- Simple CRUD modules ---------------- */
function mountClasses(session) {
  mountCrud({
    container: 'classes-crud', collection: 'classes', keyField: 'id', singular: 'ক্লাস', idPrefix: 'c',
    searchKeys: ['name'], searchPlaceholder: 'ক্লাস খুঁজুন…', session,
    columns: [
      { key: 'name', label: 'ক্লাস' },
      { key: 'active', label: 'অবস্থা', render: (r) => `<span class="badge ${r.active ? 'success' : 'warning'}">${r.active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</span>` },
      { key: 'count', label: 'শিক্ষার্থী', render: (r) => bn(db.students.list().filter((s) => s.className === r.name).length) }
    ],
    fields: [
      { name: 'name', label: 'ক্লাসের নাম', required: true },
      { name: 'active', label: 'সক্রিয়?', type: 'select', options: ['true', 'false'] }
    ],
    buildRecord: (f) => f,
    validate: (rec) => { rec.active = rec.active === 'true'; return null; }
  });
}

function mountSubjects(session) {
  mountCrud({
    container: 'subjects-crud', collection: 'subjects', keyField: 'id', singular: 'বিষয়', idPrefix: 'sub',
    searchKeys: ['name', 'className'], session,
    columns: [
      { key: 'name', label: 'বিষয়' }, { key: 'className', label: 'ক্লাস' }, { key: 'teacher', label: 'শিক্ষক' }
    ],
    fields: [
      { name: 'name', label: 'বিষয়ের নাম', required: true },
      { name: 'className', label: 'ক্লাস', type: 'select', options: CLASS_OPTIONS },
      { name: 'teacher', label: 'শিক্ষক' }
    ]
  });
}

function mountMaterials(session) {
  mountCrud({
    container: 'materials-crud', collection: 'materials', keyField: 'id', singular: 'স্টাডি ম্যাটেরিয়াল', idPrefix: 'mat',
    searchKeys: ['title', 'subject'], session,
    columns: [
      { key: 'title', label: 'শিরোনাম' }, { key: 'subject', label: 'বিষয়' }, { key: 'className', label: 'ক্লাস' },
      { key: 'published', label: 'অবস্থা', render: (r) => `<span class="badge ${r.published ? 'success' : 'warning'}">${r.published ? 'প্রকাশিত' : 'খসড়া'}</span>` }
    ],
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'subject', label: 'বিষয়', required: true },
      { name: 'className', label: 'ক্লাস', type: 'select', options: CLASS_OPTIONS },
      { name: 'type', label: 'ধরন', type: 'select', options: ['নোট', 'সাজেশন', 'প্রশ্নপত্র', 'মডেল টেস্ট', 'পিডিএফ'] },
      { name: 'chapter', label: 'অধ্যায়' },
      { name: 'description', label: 'বিবরণ', type: 'textarea' }
    ],
    validate: (rec) => { rec.published = true; rec.date = todayBn(); rec.by = session.name; return null; }
  });
}

function mountAssignments(session) {
  mountCrud({
    container: 'assignments-crud', collection: 'assignments', keyField: 'id', singular: 'অ্যাসাইনমেন্ট', idPrefix: 'asg',
    searchKeys: ['title', 'subject'], session,
    columns: [
      { key: 'title', label: 'শিরোনাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'deadline', label: 'ডেডলাইন' },
      { key: 'submitted', label: 'জমা', render: (r) => bn(db.submissions.list().filter((s) => s.assignmentId === r.id).length) }
    ],
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'subject', label: 'বিষয়', required: true },
      { name: 'className', label: 'ক্লাস', type: 'select', options: CLASS_OPTIONS },
      { name: 'deadline', label: 'ডেডলাইন' },
      { name: 'marks', label: 'নম্বর', type: 'number' },
      { name: 'description', label: 'বিবরণ', type: 'textarea' }
    ],
    validate: (rec) => { rec.teacher = session.name; return null; }
  });
}

function mountRoutine(session) {
  mountCrud({
    container: 'routine-crud', collection: 'routine', keyField: 'id', singular: 'রুটিন', idPrefix: 'rt',
    searchKeys: ['subject', 'day'], session,
    columns: [
      { key: 'day', label: 'দিন' }, { key: 'time', label: 'সময়' }, { key: 'subject', label: 'বিষয়' },
      { key: 'teacher', label: 'শিক্ষক' }, { key: 'room', label: 'কক্ষ' }
    ],
    fields: [
      { name: 'day', label: 'দিন', type: 'select', options: ['শনিবার', 'রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার'] },
      { name: 'time', label: 'সময়', required: true },
      { name: 'subject', label: 'বিষয়', required: true },
      { name: 'teacher', label: 'শিক্ষক' },
      { name: 'room', label: 'কক্ষ' }
    ]
  });
}

/* ---------------- Question Bank (paste + CSV import) ---------------- */
function mountQuestionBank(session) {
  const examSel = document.getElementById('qb-exam');
  if (!examSel) return;
  examSel.innerHTML = db.exams.list().map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title)}</option>`).join('') || '<option value="">কোনো পরীক্ষা নেই</option>';

  let staged = [];
  const renderList = () => {
    const exam = db.exams.find(examSel.value);
    document.getElementById('qb-list').innerHTML = exam
      ? exam.questions.map((q, i) => `<div class="list-item"><div class="li-main"><div class="li-title">${i + 1}. ${escapeHtml(q.q)}</div><div class="li-sub">উত্তর: ${escapeHtml(q.options[q.answer])}</div></div>
        <button type="button" class="btn btn-small btn-error" data-delq="${i}">মুছুন</button></div>`).join('') || '<div class="empty-state">কোনো প্রশ্ন নেই।</div>'
      : '';
  };
  const renderPreview = () => {
    document.getElementById('qb-preview').innerHTML = staged.length
      ? `<div class="alert alert-info">${bn(staged.length)}টি প্রশ্ন প্রস্তুত।</div>` +
        staged.map((q) => `<div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(q.q)}</div></div></div>`).join('')
      : '';
  };

  document.getElementById('qb-parse').addEventListener('click', () => {
    const { questions, errors, duplicates } = parseMcqPaste(document.getElementById('qb-paste').value);
    staged = questions;
    renderPreview();
    if (errors.length) showToast(`${bn(errors.length)}টি ব্লক বাদ পড়েছে।`, 'warning');
    if (duplicates.length) showToast('ডুপ্লিকেট প্রশ্ন বাদ দেওয়া হয়েছে।', 'warning');
    if (!questions.length) showToast('কোনো বৈধ প্রশ্ন পাওয়া যায়নি।', 'error');
  });

  document.getElementById('qb-template').addEventListener('click', () => {
    downloadText('mcq-template.csv', 'Question,OptionA,OptionB,OptionC,OptionD,Correct\n"5+3=?","8","11","16","10","B"', 'text/csv');
  });

  document.getElementById('qb-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split('\n').map((l) => l.trim()).filter(Boolean);
      const rows = lines.slice(1);
      staged = [];
      const errors = [];
      rows.forEach((line, i) => {
        const cells = line.match(/("([^"]*)"|[^,]+)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')) || [];
        const [q, a, b, c, d, correct] = cells;
        const ansMap = { A: 0, B: 1, C: 2, D: 3 };
        if (!q || !a || !b || !c || !d || !(correct in ansMap)) { errors.push(i + 2); return; }
        staged.push({ q, options: [a, b, c, d], answer: ansMap[correct] });
      });
      renderPreview();
      if (errors.length) showToast(`অবৈধ সারি: ${errors.join(', ')}`, 'error');
    };
    reader.readAsText(file);
  });

  document.getElementById('qb-import').addEventListener('click', () => {
    const exam = db.exams.find(examSel.value);
    if (!exam) { showToast('আগে একটি পরীক্ষা তৈরি করুন।', 'error'); return; }
    if (!staged.length) { showToast('আগে প্রশ্ন parse/import করুন।', 'error'); return; }
    const existing = new Set(exam.questions.map((q) => q.q.trim()));
    const fresh = staged.filter((q) => !existing.has(q.q.trim()));
    db.exams.update(exam.id, { questions: [...exam.questions, ...fresh] });
    logActivity({ user: session.name, role: session.role, action: 'imported questions', target: `${exam.title} (+${bn(fresh.length)})` });
    showToast(`${bn(fresh.length)}টি প্রশ্ন যোগ হয়েছে।`, 'success');
    staged = [];
    renderPreview(); renderList();
  });

  document.getElementById('qb-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delq]');
    if (!btn) return;
    const exam = db.exams.find(examSel.value);
    const idx = Number(btn.dataset.delq);
    if (window.confirm('প্রশ্নটি মুছবেন?')) {
      const questions = exam.questions.filter((_, i) => i !== idx);
      db.exams.update(exam.id, { questions });
      renderList();
    }
  });

  examSel.addEventListener('change', renderList);
  renderList();
}

/* ---------------- Results + leaderboard ---------------- */
function mountResults(session) {
  const sel = document.getElementById('res-exam');
  if (!sel) return;
  sel.innerHTML = db.exams.list().map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.title)}</option>`).join('');
  const render = () => {
    const exam = db.exams.find(sel.value);
    const rows = leaderboard(sel.value);
    renderTable('#res-table', [
      { key: 'position', label: 'ক্রম' },
      { key: 'studentName', label: 'শিক্ষার্থী' },
      { key: 'studentId', label: 'আইডি' },
      { key: 'score', label: 'প্রাপ্ত' },
      { key: 'pct', label: '%' },
      { key: 'pass', label: 'ফলাফল', render: (r) => `<span class="badge ${r.pct >= (db.settings.get().passMark || 40) ? 'success' : 'error'}">${r.pct >= (db.settings.get().passMark || 40) ? 'পাশ' : 'ফেল'}</span>` }
    ], rows);
    const s = examSummary(sel.value);
    document.getElementById('res-analytics').innerHTML = s
      ? `গড় ${bn(s.avg)}% · সর্বোচ্চ ${bn(s.highest)}% · সর্বনিন্ম ${bn(s.lowest)}% · পাশ ${bn(s.passRate)}% · পরীক্ষার্থী ${bn(s.attempts)}`
      : 'এখনো কোনো ফলাফল নেই।';
  };
  sel.addEventListener('change', render);
  document.getElementById('res-export').addEventListener('click', () => {
    downloadText('results.csv', toCSV([
      { key: 'position', label: 'ক্রম' }, { key: 'studentName', label: 'নাম' }, { key: 'score', label: 'প্রাপ্ত' }, { key: 'pct', label: '%' }
    ], leaderboard(sel.value)), 'text/csv');
    showToast('রিপোর্ট ডাউনলোড হয়েছে।', 'success');
  });
  document.getElementById('res-print').addEventListener('click', () => window.print());
  render();
}

/* ---------------- Notifications ---------------- */
function mountNotifications(session) {
  const list = document.getElementById('notif-list');
  const render = () => {
    list.innerHTML = db.notifications.list().map((n) => `
      <div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(n.title)}</div>
      <div class="li-sub">${escapeHtml(n.type)} · ${escapeHtml(n.target)} · ${escapeHtml(n.date)}</div></div>
      <span class="badge ${n.read ? 'success' : 'warning'}">${n.read ? 'পঠিত' : 'অপঠিত'}</span></div>`).join('') || '<div class="empty-state">কোনো নোটিফিকেশন নেই।</div>';
  };
  document.getElementById('notif-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    db.notifications.add({ id: newId('ntf'), type: String(d.get('type')), title: String(d.get('title')), target: String(d.get('target')), date: todayBn(), read: false });
    logActivity({ user: session.name, role: session.role, action: 'sent notification', target: String(d.get('title')) });
    e.target.reset(); render(); showToast('নোটিফিকেশন পাঠানো হয়েছে।', 'success');
  });
  render();
}

/* ---------------- Analytics ---------------- */
function mountAnalytics() {
  const a = analytics();
  statGrid('#analytics-cards', [
    { label: 'মোট শিক্ষার্থী', value: bn(a.totalStudents), tone: 'accent' },
    { label: 'সক্রিয়', value: bn(a.activeStudents), tone: 'success' },
    { label: 'নিষ্ক্রিয়', value: bn(a.inactiveStudents), tone: 'warning' },
    { label: 'শিক্ষক', value: bn(a.totalTeachers) },
    { label: 'মোট বকেয়া', value: `৳${bn(a.totalDue)}`, tone: 'warning' },
    { label: 'মাসিক সংগ্রহ', value: `৳${bn(a.monthlyCollection)}`, tone: 'success' }
  ]);
  const perf = classPerformance();
  document.getElementById('class-perf').innerHTML = perf.length
    ? perf.map((c) => `<div class="form-group"><label>${escapeHtml(c.name)} — ${bn(c.avg)}%</label>
        <div class="progress-bar"><div class="progress-fill" style="width:${c.avg}%"></div></div></div>`).join('')
    : '<div class="empty-state">যথেষ্ট ডেটা নেই।</div>';
}

/* ---------------- Reports ---------------- */
function mountReports() {
  const sel = document.getElementById('report-type');
  const reports = {
    students: { label: 'শিক্ষার্থী', cols: [{ key: 'id', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'ক্লাস' }], rows: () => db.students.list() },
    teachers: { label: 'শিক্ষক', cols: [{ key: 'name', label: 'নাম' }, { key: 'subject', label: 'বিষয়' }], rows: () => db.teachers.list() },
    due: { label: 'বকেয়া', cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'month', label: 'মাস' }, { key: 'amount', label: 'পরিমাণ' }], rows: () => dueFees() },
    payments: { label: 'পেমেন্ট', cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'amount', label: 'পরিমাণ' }, { key: 'date', label: 'তারিখ' }], rows: () => db.payments.list() },
    exams: { label: 'পরীক্ষা', cols: [{ key: 'title', label: 'শিরোনাম' }, { key: 'className', label: 'ক্লাস' }], rows: () => db.exams.list() }
  };
  sel.innerHTML = Object.entries(reports).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const render = () => {
    const r = reports[sel.value];
    renderTable('#report-table', r.cols, r.rows());
  };
  sel.addEventListener('change', render);
  document.getElementById('report-csv').addEventListener('click', () => {
    const r = reports[sel.value];
    downloadText(`${sel.value}-report.csv`, toCSV(r.cols, r.rows()), 'text/csv');
  });
  document.getElementById('report-print').addEventListener('click', () => window.print());
  render();
}

/* ---------------- Users & permissions ---------------- */
function mountUsers(session) {
  document.getElementById('users-list').innerHTML = listUsers().map((u) => `
    <div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(u.name)}</div><div class="li-sub">${escapeHtml(u.username)}</div></div>
    <span class="badge accent">${escapeHtml(u.role)}</span></div>`).join('');
  const perms = ['viewStudents', 'manageExams', 'manageFees', 'publishResults', 'manageUsers', 'backup'];
  const settings = db.settings.get();
  const matrix = settings.permissions || { admin: perms, teacher: ['viewStudents', 'manageExams'] };
  document.getElementById('perm-matrix').innerHTML = ['admin', 'teacher'].map((role) => `
    <div class="card"><h3>${role}</h3>${perms.map((p) => `
      <label class="role-option" style="margin:.25rem 0"><input type="checkbox" data-role="${role}" data-perm="${p}" ${(matrix[role] || []).includes(p) ? 'checked' : ''}><span>${p}</span></label>`).join('')}</div>`).join('');
  document.getElementById('perm-save').addEventListener('click', () => {
    const updated = {};
    document.querySelectorAll('#perm-matrix input[type="checkbox"]').forEach((cb) => {
      (updated[cb.dataset.role] = updated[cb.dataset.role] || []).push(...(cb.checked ? [cb.dataset.perm] : []));
    });
    db.settings.update({ permissions: updated });
    logActivity({ user: session.name, role: session.role, action: 'updated permissions' });
    showToast('অনুমতি সংরক্ষিত হয়েছে।', 'success');
  });
}

/* ---------------- Activity log ---------------- */
function mountActivity() {
  const input = document.getElementById('activity-filter');
  const render = () => {
    const term = (input?.value || '').toLowerCase();
    const rows = activityLogs().filter((l) => !term || JSON.stringify(l).toLowerCase().includes(term));
    renderTable('#activity-table', [
      { key: 'date', label: 'তারিখ' }, { key: 'user', label: 'ব্যবহারকারী' }, { key: 'role', label: 'রোল' },
      { key: 'action', label: 'কাজ' }, { key: 'target', label: 'টার্গেট' }
    ], rows.slice(0, 50));
  };
  input?.addEventListener('input', render);
  render();
}

/* ---------------- Backup & restore ---------------- */
function mountBackup() {
  document.getElementById('backup-export').addEventListener('click', () => {
    downloadText(`active-plus-backup-${Date.now()}.json`, exportBackup(), 'application/json');
    logActivity({ user: 'admin', role: 'admin', action: 'exported backup' });
    showToast('ব্যাকআপ ডাউনলোড হয়েছে।', 'success');
  });
  document.getElementById('backup-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (!window.confirm('বর্তমান ডেটা এই ব্যাকআপ দিয়ে প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?')) return;
      const result = importBackup(String(reader.result));
      if (result.ok) { logActivity({ user: 'admin', role: 'admin', action: 'restored backup' }); showToast(`রিস্টোর সফল (${bn(result.restored)} কালেকশন)।`, 'success'); }
      else showToast(result.error, 'error');
    };
    reader.readAsText(file);
  });
}

/* ---------------- Profile ---------------- */
function mountProfile() {
  const pf = document.getElementById('profile-form');
  if (pf) pf.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(pf);
    updateProfile({ name: String(d.get('name') || '').trim() || undefined, detail: String(d.get('detail') || '') });
    showToast('প্রোফাইল আপডেট হয়েছে।', 'success');
  });
  const pw = document.getElementById('password-form');
  if (pw) pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(pw);
    try {
      await changePassword(String(d.get('current')), String(d.get('next')));
      pw.reset(); showToast('পাসওয়ার্ড পরিবর্তন হয়েছে।', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
}
