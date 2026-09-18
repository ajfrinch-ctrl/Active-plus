/**
 * Admin ERP modules — wires the extended admin tabs on top of the base
 * admin.html wiring. Everything reads/writes the layered data store and logs
 * activity, and every stat is computed live (nothing hard-coded).
 */

import {
  db, analytics, examSummary, leaderboard, exportBackup, importBackup,
  parseMcqPaste, parseMcqCsv, toCSV, downloadText, logActivity, activityLogs,
  todayBn, newId, CLASS_OPTIONS, ALL_CLASSES, dueFees, checkSubmission, submissionsFor,
  bnMonthLabel, isThisMonth,
  PERMISSIONS, DEFAULT_PERMISSIONS, getDbStatus,
  formatBnDate
} from './data.js';
import { mountCrud } from './crud.js';
import { escapeHtml, renderTable, showToast, openModal, closeModal, getAuthMode, requireOnline } from './app.js';
import { checkConnectionStatus } from './firebase.js';
import { listUsers, updateProfile, changePassword } from './auth.js';
import { previewDocument } from './preview.js';
import { renderReportCanvases, classReportRows, CLASS_REPORT_COLUMNS, classFileLabel } from './docs.js';

const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

// Spec 51: never report a saved record that could not be saved. Module scope so
// every mount* function below shares it.
const onlineFor = (action) => requireOnline(action, getDbStatus);

export function mountExtraAdmin(session) {
  mountDashboard(session);
  mountClasses(session);
  mountSubjects(session);
  mountMaterials(session);
  mountAssignments(session);
  mountRoutine(session);
  mountSubmissions(session);
  mountTips(session);
  mountBanners(session);
  mountQuestionBank(session);
  mountResults(session);
  mountNotifications(session);
  // No analytics/chart dashboard: the report centre is the only place numbers
  // are summarised, and it exports documents instead of drawing graphs.
  mountReports(session);
  mountUsers(session);
  mountActivity();
  mountBackup(session, onlineFor);
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
    <div class="section"><div class="alert alert-info" id="db-status" role="status">ডেটাবেস: যাচাই হচ্ছে…</div></div>
    <div class="section card-grid">
      <div class="card"><h3>আজকের ক্লাস</h3><p>${db.routine.list().slice(0, 3).map((r) => `${escapeHtml(r.subject)} ${escapeHtml(r.time)}`).join(' · ') || '—'}</p></div>
      <div class="card"><h3>আসন্ন পরীক্ষা</h3><p>${db.exams.list().slice(0, 3).map((e) => escapeHtml(e.title)).join(' · ') || '—'}</p></div>
      <div class="card"><h3>সাম্প্রতিক ভর্তি</h3><p>${recent(db.students.list(), 3).map((s) => escapeHtml(s.name)).join(' · ') || '—'}</p></div>
      <div class="card"><h3>সাম্প্রতিক পেমেন্ট</h3><p>${recent(db.payments.list(), 3).map((p) => `৳${bn(p.amount)}`).join(' · ') || '—'}</p></div>
      <div class="card"><h3>ঝুলন্ত অ্যাসাইনমেন্ট</h3><p>${bn(analytics().pendingAssignments)}</p></div>
      <div class="card"><h3>সাম্প্রতিক অ্যাডমিন কার্যক্রম</h3><p>${activityLogs().slice(0, 3).map((l) => escapeHtml(l.action)).join(' · ') || '—'}</p></div>
    </div>`;

  checkConnectionStatus().then((connected) => {
    const el = document.getElementById('db-status');
    if (!el) return;
    const mode = getAuthMode();
    el.className = `alert ${connected || mode === 'local' ? 'alert-success' : 'alert-error'}`;
    const synced = formatBnDate(todayBn());
    el.textContent = mode === 'local'
      ? `ডেটাবেস: লোকাল মোড (সংযুক্ত) · শেষ সিঙ্ক: ${synced}`
      : connected ? `ডেটাবেস: সংযুক্ত · শেষ সিঙ্ক: ${synced}` : 'ডেটাবেস: বিচ্ছিন্ন (অফলাইন)';
  }).catch(() => {
    // A rejected probe must not become an unhandled rejection (and must not
    // leave the status card claiming a connection it never verified).
    const el = document.getElementById('db-status');
    if (el) { el.className = 'alert alert-error'; el.textContent = 'ডেটাবেস: সংযোগ যাচাই করা যায়নি'; }
  });
  logActivity({ user: session.name, role: session.role, action: 'viewed dashboard' });
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
      { name: 'link', label: 'ফাইল লিংক (পিডিএফ/ডক)' },
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

/* ---------------- Submitted assignments: review + mark checked ---------------- */
function mountSubmissions(session) {
  const host = document.getElementById('submissions-crud');
  if (!host) return;

  // Static shell; renderTable fills it 25 rows at a time (spec 62), so a centre
  // with thousands of submissions never builds every row in one pass.
  host.innerHTML = `<div class="table-wrap"><table class="table" id="submissions-table">
    <thead><tr></tr></thead><tbody></tbody></table></div>`;

  const render = () => {
    renderTable('#submissions-table', [
      { key: 'studentName', label: 'শিক্ষার্থী', render: (r) => escapeHtml(r.studentName || r.studentId) },
      { key: 'assignmentId', label: 'অ্যাসাইনমেন্ট', render: (r) => escapeHtml(db.assignments.find(r.assignmentId)?.title || r.assignmentId) },
      { key: 'date', label: 'জমার তারিখ', render: (r) => escapeHtml(formatBnDate(r.date) || '—') },
      { key: 'status', label: 'অবস্থা', render: (r) => escapeHtml(r.status) },
      { key: '_a', label: '', render: (r) => r.status === 'চেক হয়েছে'
        ? `<span class="badge success">✓ ${escapeHtml(r.feedback || '')}</span>`
        : `<button type="button" class="btn btn-small" data-check="${escapeHtml(r.id)}">চেক করুন</button>` }
    ], db.submissions.list(), 'এখনো কোনো কাজ জমা পড়েনি।');
  };

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-check]');
    if (!btn) return;
    if (!onlineFor('কাজ চেক করা')) return;
    const feedback = window.prompt('শিক্ষকের মন্তব্য (ঐচ্ছিক):') || '';
    checkSubmission(btn.dataset.check, feedback);
    logActivity({ user: session.name, role: session.role, action: 'checked submission', target: btn.dataset.check });
    render();
    showToast('কাজ চেক হিসেবে চিহ্নিত হয়েছে।', 'success');
  });

  render();
  window.__renderSubmissions = render;
}

/* ---------------- Teacher tips & banners (student home feed) ---------------- */
function mountTips(session) {
  mountCrud({
    container: 'tips-crud', collection: 'tips', keyField: 'id', singular: '\u099F\u09BF\u09AA', idPrefix: 'tip',
    searchKeys: ['text'], session,
    columns: [
      { key: 'text', label: '\u099F\u09BF\u09AA' },
      { key: 'active', label: '\u0985\u09AC\u09B8\u09CD\u09A5\u09BE', render: (r) => `<span class="badge ${r.active ? 'success' : 'warning'}">${r.active ? '\u09A8\u09BE\u09B0\u09C0\u09AD' : '\u0985\u09A8\u09BF\u09B7\u09CD\u0995\u09CD\u09B0\u09BF\u09AF\u09BC'}</span>` },
      { key: 'date', label: '\u09A4\u09BE\u09B0\u09BF\u0996' }
    ],
    fields: [
      { name: 'text', label: '\u099F\u09BF\u09AA', type: 'textarea', required: true },
      { name: 'active', label: '\u09A8\u09BE\u09B0\u09C0\u09AD', type: 'select', options: ['yes', 'no'] }
    ],
    validate: (rec) => {
      rec.active = rec.active === 'yes' || rec.active === true;
      rec.date = todayBn(); rec.by = session.name;
      return rec.text ? null : '\u099F\u09BF\u09AA \u09B2\u09BF\u0996\u09C1\u09A8\u0964';
    }
  });
}

function mountBanners(session) {
  mountCrud({
    container: 'banners-crud', collection: 'banners', keyField: 'id', singular: '\u09AC\u09CD\u09AF\u09BE\u09A8\u09BE\u09B0', idPrefix: 'ban',
    searchKeys: ['title', 'desc'], session,
    columns: [
      { key: 'title', label: '\u09B6\u09BF\u09B0\u09CB\u09A8\u09BE\u09AE' },
      { key: 'cta', label: '\u09AC\u09BE\u099F\u09A8' },
      { key: 'active', label: '\u0985\u09AC\u09B8\u09CD\u09A5\u09BE', render: (r) => `<span class="badge ${r.active ? 'success' : 'warning'}">${r.active ? '\u09A8\u09BE\u09B0\u09C0\u09AD' : '\u0985\u09A8\u09BF\u09B7\u09CD\u0995\u09CD\u09B0\u09BF\u09AF\u09BC'}</span>` }
    ],
    fields: [
      { name: 'title', label: '\u09B6\u09BF\u09B0\u09CB\u09A8\u09BE\u09AE', required: true },
      { name: 'desc', label: '\u09AC\u09BF\u09AC\u09B0\u09A3', type: 'textarea' },
      { name: 'image', label: '\u099B\u09AC\u09BF\u09B0 \u09B2\u09BF\u0982\u0995 (\u0990\u099A\u09CD\u099B\u09BF\u0995)' },
      { name: 'cta', label: '\u09AC\u09BE\u099F\u09A8 \u099F\u09C7\u0995\u09B8\u099F' },
      { name: 'active', label: '\u09A8\u09BE\u09B0\u09C0\u09AD', type: 'select', options: ['yes', 'no'] }
    ],
    validate: (rec) => {
      rec.active = rec.active === 'yes' || rec.active === true;
      rec.date = todayBn(); rec.by = session.name;
      return rec.title ? null : '\u09B6\u09BF\u09B0\u09CB\u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964';
    }
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
      // Shared parser — identical validation to the teacher question bank.
      const { questions, invalidRows, duplicates } = parseMcqCsv(String(reader.result));
      staged = questions;
      renderPreview();
      if (invalidRows.length) showToast(`অবৈধ সারি: ${bn(invalidRows.join(', '))}`, 'error');
      if (duplicates.length) showToast(`${bn(duplicates.length)}টি ডুপ্লিকেট প্রশ্ন বাদ দেওয়া হয়েছে।`, 'warning');
      if (!questions.length) showToast('কোনো বৈধ প্রশ্ন পাওয়া যায়নি।', 'error');
    };
    reader.readAsText(file);
  });

  document.getElementById('qb-import').addEventListener('click', () => {
    if (!onlineFor('প্রশ্ন ইমপোর্ট')) return;
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
      if (!onlineFor('প্রশ্ন প্রতিস্থাপন')) return;
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
  const passMark = Number(db.settings.get().passMark) || 40;
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
      { key: 'pass', label: 'ফলাফল', render: (r) => `<span class="badge ${r.pct >= passMark ? 'success' : 'error'}">${r.pct >= passMark ? 'পাশ' : 'ফেল'}</span>` }
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
  // Preview-first: the result report is reviewed in the shared modal, then PDF.
  document.getElementById('res-preview').addEventListener('click', async () => {
    const exam = db.exams.find(sel.value);
    const rows = leaderboard(sel.value);
    const s = examSummary(sel.value);
    try {
      const canvases = await renderReportCanvases({
        settings: db.settings.get(),
        title: 'ফলাফল রিপোর্ট',
        subtitle: exam?.title || '',
        columns: [
          { key: 'position', label: 'ক্রম' }, { key: 'studentName', label: 'শিক্ষার্থী' },
          { key: 'studentId', label: 'আইডি' }, { key: 'score', label: 'প্রাপ্ত' },
          { key: 'pct', label: '%' }, { key: 'pass', label: 'ফলাফল' }
        ],
        rows: rows.map((r) => ({ ...r, pass: r.pct >= passMark ? 'পাশ' : 'ফেল' })),
        summary: s ? [
          { label: 'পরীক্ষার্থী', value: bn(s.attempts) },
          { label: 'গড়', value: `${bn(s.avg)}%` },
          { label: 'সর্বোচ্চ', value: `${bn(s.highest)}%` },
          { label: 'পাশের হার', value: `${bn(s.passRate)}%` }
        ] : []
      });
      await previewDocument({ title: 'ফলাফল রিপোর্ট', meta: exam?.title || '', filename: `results-${sel.value}-report.pdf`, canvases, shareable: false });
    } catch (e) {
      showToast('রিপোর্ট তৈরি করা যায়নি।', 'error');
    }
  });
  render();
}

/* ---------------- Notifications ---------------- */
function mountNotifications(session) {
  const list = document.getElementById('notif-list');
  const render = () => {
    // Newest 50 only; this collection grows for the life of the centre (spec 62).
    const all = db.notifications.list();
    const rows = all.slice(0, 50);
    const html = rows.map((n) => `
      <div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(n.title)}</div>
      <div class="li-sub">${escapeHtml(n.type)} · ${escapeHtml(n.target)} · ${escapeHtml(formatBnDate(n.date))}</div></div>
      <span class="badge ${n.read ? 'success' : 'warning'}">${n.read ? 'পঠিত' : 'অপঠিত'}</span></div>`).join('');
    list.innerHTML = (html
      + (all.length > rows.length
        ? `<p class="meta">সর্বশেষ ${bn(rows.length)}টি দেখানো হচ্ছে — মোট ${bn(all.length)}টি।</p>` : ''))
      || '<div class="empty-state">কোনো নোটিফিকেশন নেই।</div>';
  };
  document.getElementById('notif-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!onlineFor('নোটিফিকেশন পাঠানো')) return;
    const d = new FormData(e.target);
    db.notifications.add({ id: newId('ntf'), type: String(d.get('type')), title: String(d.get('title')), target: String(d.get('target')), date: todayBn(), createdAt: new Date().toISOString(), read: false });
    logActivity({ user: session.name, role: session.role, action: 'sent notification', target: String(d.get('title')) });
    e.target.reset(); render(); showToast('নোটিফিকেশন পাঠানো হয়েছে।', 'success');
  });
  render();
}

/* ---------------- Reports ---------------- */
/**
 * Report centre — three groups, eight documents, nothing else.
 *
 *   Finance Reports   Collection · Due / Outstanding · Student-wise Finance · Payment History
 *   Student Reports   Student List · Class-wise List · Active / Inactive List
 *   Notice Reports    Notice History
 *
 * Everything the panel used to pile up here is gone on purpose: the duplicate
 * due/finance/ledger variants, exam, result, merit, performance, assignment,
 * material, routine, batch, teacher, discount and activity reports, plus the
 * whole analytics + chart dashboard. The owner asked for a phone-sized screen
 * where one tap on an icon card yields one branded PDF or Excel file — and
 * never the browser print dialog.
 *
 * Rows are computed when a card is tapped, so money taken a minute ago is
 * already inside the next download. The document itself flows through the
 * shared preview (js/preview.js), which offers the PDF and the Excel (CSV)
 * download side by side.
 */
function mountReports(session) {
  const host = document.getElementById('report-groups');
  const classSel = document.getElementById('report-class');
  if (!host || !classSel) return;

  const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;
  const total = (rows, key = '_amount') => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

  /** The class filter: 'সব' accepts every row, a class name only its own. */
  const wanted = (cls) => (className) => !cls || cls === ALL_CLASSES || className === cls;
  const classNameOf = (row) => row.className
    || (row.studentId ? db.students.find(row.studentId)?.className : null)
    || null;
  const studentsIn = (cls) => db.students.list().filter((s) => wanted(cls)(s.className));
  const paymentsIn = (cls) => db.payments.list()
    .map((p) => ({ ...p, student: db.students.find(p.studentId) || null }))
    .filter((p) => wanted(cls)(p.student?.className));
  const duesIn = (cls) => dueFees().filter((f) => wanted(cls)(f.student?.className));
  const monthKey = (bnDate) => String(bnDate || '').slice(0, 7);

  /** Newest first; a missing or hand-written date sorts last, never first. */
  const dateKey = (v) => (/^[০-৯]{4}-[০-৯]{2}(-[০-৯]{2})?$/.test(String(v || '').trim()) ? String(v).trim() : '');
  const byDateDesc = (a, b) => dateKey(b.date).localeCompare(dateKey(a.date));
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

  /**
   * The eight reports. `rows(cls)` and `summary(rows, cls)` are called when a
   * card is tapped, so both always describe the data as it is right now.
   * `byClass` splits the document into one section per class and `file` is the
   * download slug both the PDF and the Excel file are named after.
   */
  const REPORTS = {
    /* ---- Finance Reports ---- */
    collection: {
      icon: '📥', label: 'Collection', bn: 'আদায় রিপোর্ট', file: 'collection',
      cols: [
        { key: 'month', label: 'মাস' },
        { key: 'transactions', label: 'লেনদেন' },
        { key: 'students', label: 'শিক্ষার্থী' },
        { key: 'collected', label: 'আদায়' }
      ],
      rows: (cls) => {
        const byMonth = new Map();
        for (const p of paymentsIn(cls)) {
          const key = monthKey(p.date) || 'তারিখ নেই';
          const row = byMonth.get(key) || { key, _count: 0, _students: new Set(), _amount: 0 };
          row._count += 1;
          row._students.add(p.studentId);
          row._amount += Number(p.amount) || 0;
          byMonth.set(key, row);
        }
        return [...byMonth.values()]
          .sort((a, b) => b.key.localeCompare(a.key))
          .map((r) => ({
            month: r.key === 'তারিখ নেই' ? r.key : bnMonthLabel(r.key),
            transactions: bn(r._count),
            students: bn(r._students.size),
            collected: taka(r._amount),
            _amount: r._amount
          }));
      },
      summary: (rows, cls) => {
        const all = paymentsIn(cls);
        return [
          { label: 'মোট আদায়', value: taka(all.reduce((s, p) => s + (Number(p.amount) || 0), 0)) },
          { label: 'মোট লেনদেন', value: bn(all.length) },
          { label: 'এই মাসের আদায়', value: taka(all.filter((p) => isThisMonth(p.date)).reduce((s, p) => s + (Number(p.amount) || 0), 0)) }
        ];
      }
    },
    due: {
      icon: '⚠️', label: 'Due / Outstanding', bn: 'বকেয়া তালিকা', byClass: true, file: 'due-outstanding',
      cols: [
        { key: 'studentId', label: 'আইডি' },
        { key: 'name', label: 'নাম' },
        { key: 'className', label: 'শ্রেণি' },
        { key: 'month', label: 'বকেয়া মাস' },
        { key: 'due', label: 'বকেয়া' }
      ],
      rows: (cls) => duesIn(cls).map((f) => ({
        studentId: f.studentId,
        name: f.student?.name || '—',
        className: f.student?.className || '—',
        month: f.month || '—',
        due: taka(f.remaining ?? f.amount),
        _amount: Number(f.remaining ?? f.amount) || 0
      })).sort(byName),
      summary: (rows) => [
        { label: 'মোট বকেয়া', value: taka(total(rows)) },
        { label: 'বকেয়া শিক্ষার্থী', value: bn(new Set(rows.map((r) => r.studentId)).size) },
        { label: 'বকেয়া মাস', value: bn(rows.length) }
      ]
    },
    studentFinance: {
      icon: '🧮', label: 'Student-wise Finance', bn: 'শিক্ষার্থীভিত্তিক ফিন্যান্স', byClass: true, file: 'student-wise-finance',
      cols: [
        { key: 'studentId', label: 'আইডি' },
        { key: 'name', label: 'নাম' },
        { key: 'className', label: 'শ্রেণি' },
        { key: 'billed', label: 'মোট ফি' },
        { key: 'paid', label: 'পরিশোধিত' },
        { key: 'due', label: 'বকেয়া' }
      ],
      rows: (cls) => {
        const dues = duesIn(cls);
        return studentsIn(cls).map((st) => {
          const billed = db.fees.list()
            .filter((f) => f.studentId === st.id)
            .reduce((s, f) => s + (Number(f.amount) || 0), 0);
          const paid = db.payments.list()
            .filter((p) => p.studentId === st.id)
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const due = dues
            .filter((d) => d.studentId === st.id)
            .reduce((s, d) => s + (Number(d.remaining ?? d.amount) || 0), 0);
          return {
            studentId: st.id, name: st.name, className: st.className || '—',
            billed: taka(billed), paid: taka(paid), due: due > 0 ? taka(due) : 'নেই',
            _billed: billed, _paid: paid, _due: due
          };
        }).sort(byName);
      },
      summary: (rows) => [
        { label: 'শিক্ষার্থী', value: bn(rows.length) },
        { label: 'মোট ফি', value: taka(total(rows, '_billed')) },
        { label: 'মোট আদায়', value: taka(total(rows, '_paid')) },
        { label: 'মোট বকেয়া', value: taka(total(rows, '_due')) }
      ]
    },
    paymentHistory: {
      icon: '🧾', label: 'Payment History', bn: 'পেমেন্ট ইতিহাস', byClass: true, file: 'payment-history',
      cols: [
        { key: 'date', label: 'তারিখ' },
        { key: 'receiptNo', label: 'রিসিট' },
        { key: 'studentId', label: 'আইডি' },
        { key: 'name', label: 'নাম' },
        { key: 'className', label: 'শ্রেণি' },
        { key: 'month', label: 'ফি মাস' },
        { key: 'amount', label: 'পরিমাণ' },
        { key: 'method', label: 'মাধ্যম' },
        { key: 'reference', label: 'রেফারেন্স' }
      ],
      rows: (cls) => paymentsIn(cls).map((p) => ({
        date: formatBnDate(p.date) || '—',
        receiptNo: p.receiptNo || p.id || '—',
        studentId: p.studentId,
        name: p.student?.name || '—',
        className: p.student?.className || '—',
        month: p.month || '—',
        amount: taka(p.amount),
        method: p.method || '—',
        reference: p.reference || '—',
        _amount: Number(p.amount) || 0
      })).sort(byDateDesc),
      summary: (rows) => [
        { label: 'মোট আদায়', value: taka(total(rows)) },
        { label: 'মোট লেনদেন', value: bn(rows.length) }
      ]
    },

    /* ---- Student Reports ---- */
    students: {
      icon: '📋', label: 'Student List', bn: 'শিক্ষার্থী তালিকা', byClass: true, file: 'student-list',
      cols: CLASS_REPORT_COLUMNS,
      rows: (cls) => classReportRows(studentsIn(cls)).rows,
      summary: (rows) => [{ label: 'মোট শিক্ষার্থী', value: bn(rows.length) }]
    },
    classwise: {
      icon: '🏫', label: 'Class-wise List', bn: 'ক্লাসভিত্তিক তালিকা', file: 'class-wise-list',
      cols: [
        { key: 'className', label: 'শ্রেণি' },
        { key: 'students', label: 'মোট শিক্ষার্থী' },
        { key: 'active', label: 'সক্রিয়' },
        { key: 'inactive', label: 'নিষ্ক্রিয়' }
      ],
      rows: (cls) => CLASS_OPTIONS
        .filter((c) => wanted(cls)(c))
        .map((c) => {
          const list = db.students.list().filter((s) => s.className === c);
          return {
            className: c,
            students: bn(list.length),
            active: bn(list.filter((s) => s.status === 'সক্রিয়').length),
            inactive: bn(list.filter((s) => s.status !== 'সক্রিয়').length),
            _students: list.length
          };
        })
        // An empty class is noise in the all-class view, but a class picked on
        // purpose must still print — with its zeroes.
        .filter((r) => r._students > 0 || (cls && cls !== ALL_CLASSES)),
      summary: (rows) => [
        { label: 'মোট ক্লাস', value: bn(rows.length) },
        { label: 'মোট শিক্ষার্থী', value: bn(total(rows, '_students')) }
      ]
    },
    activeInactive: {
      icon: '🔄', label: 'Active / Inactive', bn: 'সক্রিয়–নিষ্ক্রিয় তালিকা', byClass: true, file: 'active-inactive',
      cols: [
        { key: 'studentId', label: 'আইডি' },
        { key: 'name', label: 'নাম' },
        { key: 'className', label: 'শ্রেণি' },
        { key: 'phone', label: 'মোবাইল' },
        { key: 'admissionDate', label: 'ভর্তির তারিখ' },
        { key: 'status', label: 'অবস্থা' }
      ],
      // Inactive first: those are the students the owner has to call back.
      rows: (cls) => studentsIn(cls).map((s) => ({
        studentId: s.id,
        name: s.name,
        className: s.className || '—',
        phone: s.phone || s.guardianPhone || '—',
        admissionDate: s.admissionDate || '—',
        status: s.status === 'সক্রিয়' ? 'সক্রিয়' : 'নিষ্ক্রিয়',
        _active: s.status === 'সক্রিয়'
      })).sort((a, b) => Number(a._active) - Number(b._active) || byName(a, b)),
      summary: (rows) => [
        { label: 'সক্রিয় শিক্ষার্থী', value: bn(rows.filter((r) => r._active).length) },
        { label: 'নিষ্ক্রিয় শিক্ষার্থী', value: bn(rows.filter((r) => !r._active).length) },
        { label: 'মোট শিক্ষার্থী', value: bn(rows.length) }
      ]
    },

    /* ---- Notice Reports ---- */
    noticeHistory: {
      icon: '📢', label: 'Notice History', bn: 'নোটিশ ইতিহাস', file: 'notice-history',
      cols: [
        { key: 'date', label: 'তারিখ' },
        { key: 'title', label: 'শিরোনাম' },
        { key: 'className', label: 'ক্লাস' },
        { key: 'audience', label: 'কাদের জন্য' }
      ],
      rows: (cls) => db.notices.list()
        // A notice for every class stays visible while one class is selected.
        .filter((n) => wanted(cls)(n.className) || n.className === ALL_CLASSES)
        .map((n) => ({
          date: formatBnDate(n.date) || '—',
          title: n.title || '—',
          className: n.className === ALL_CLASSES ? 'সব ক্লাস' : (n.className || '—'),
          // Payment receipts are personal notices — say so instead of hiding it.
          audience: n.forStudent ? `${n.audience || 'শিক্ষার্থী'} (ব্যক্তিগত)` : (n.audience || '—'),
          _personal: Boolean(n.forStudent)
        }))
        .sort(byDateDesc),
      summary: (rows) => [
        { label: 'মোট নোটিশ', value: bn(rows.length) },
        { label: 'সবাইকে পাঠানো', value: bn(rows.filter((r) => !r._personal).length) }
      ]
    }
  };

  /* Three icon groups, rendered as mobile-first cards (2 across on a phone,
     4 across from 640px up). */
  const GROUPS = [
    { key: 'finance', icon: '💰', title: 'Finance Reports', bn: 'ফিন্যান্স রিপোর্ট', items: ['collection', 'due', 'studentFinance', 'paymentHistory'] },
    { key: 'student', icon: '👨‍🎓', title: 'Student Reports', bn: 'শিক্ষার্থী রিপোর্ট', items: ['students', 'classwise', 'activeInactive'] },
    { key: 'notice', icon: '📢', title: 'Notice Reports', bn: 'নোটিশ রিপোর্ট', items: ['noticeHistory'] }
  ];

  classSel.innerHTML = `<option value="${ALL_CLASSES}">সব ক্লাস</option>`
    + CLASS_OPTIONS.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  host.innerHTML = GROUPS.map((g) => `
    <section class="report-group" aria-labelledby="report-group-${g.key}">
      <h3 class="report-group-title" id="report-group-${g.key}">
        <span class="ico" aria-hidden="true">${g.icon}</span>
        <span class="rg-text"><strong>${escapeHtml(g.title)}</strong><small>${escapeHtml(g.bn)}</small></span>
      </h3>
      <div class="report-grid">
        ${g.items.map((key) => {
          const r = REPORTS[key];
          return `<button type="button" class="report-card" data-report="${key}" title="${escapeHtml(`${r.label} — ${r.bn}`)}">
            <span class="ico" aria-hidden="true">${r.icon}</span>
            <span class="rc-label">${escapeHtml(r.label)}</span>
            <span class="rc-bn">${escapeHtml(r.bn)}</span>
          </button>`;
        }).join('')}
      </div>
    </section>`).join('');

  /**
   * Build the branded A4 pages for one report. Row-level reports are split into
   * one section per class ("সব ক্লাস" → a section for every class that has rows);
   * the aggregate reports (Collection, Class-wise List, Notice History) stay a
   * single table because their rows are not one-per-student.
   */
  const buildDocument = async (r, cls, rows) => {
    const settings = db.settings.get();
    const title = `${r.label} — ${r.bn}`;
    const subtitleFor = (c) => `শ্রেণি: ${c === ALL_CLASSES ? 'সব' : c} · ${formatBnDate(todayBn())}`;
    const canvases = [];
    if (r.byClass) {
      const classes = (cls && cls !== ALL_CLASSES)
        ? [cls]
        : CLASS_OPTIONS.filter((c) => rows.some((row) => classNameOf(row) === c));
      for (const c of (classes.length ? classes : [ALL_CLASSES])) {
        const sectionRows = c === ALL_CLASSES ? rows : rows.filter((row) => classNameOf(row) === c);
        canvases.push(...await renderReportCanvases({
          settings, title, subtitle: subtitleFor(c),
          columns: r.cols, rows: sectionRows, summary: r.summary(sectionRows, c)
        }));
      }
    } else {
      canvases.push(...await renderReportCanvases({
        settings, title, subtitle: subtitleFor(cls || ALL_CLASSES),
        columns: r.cols, rows, summary: r.summary(rows, cls)
      }));
    }
    return canvases;
  };

  // One tap → preview → PDF or Excel. The card stays disabled while the pages
  // are being drawn so a slow phone cannot queue the same document twice.
  host.addEventListener('click', async (event) => {
    const card = event.target.closest('[data-report]');
    if (!card) return;
    const key = card.dataset.report;
    const r = REPORTS[key];
    if (!r || card.getAttribute('aria-busy') === 'true') return;

    const cls = classSel.value || ALL_CLASSES;
    const base = `${r.file}-report-${classFileLabel(cls)}`;
    card.setAttribute('aria-busy', 'true');
    card.disabled = true;
    try {
      const rows = r.rows(cls);
      const canvases = await buildDocument(r, cls, rows);
      await previewDocument({
        title: `${r.label} — ${r.bn}`,
        meta: `শ্রেণি: ${cls === ALL_CLASSES ? 'সব' : cls} · ${formatBnDate(todayBn())} · ${bn(rows.length)} সারি`,
        filename: `${base}.pdf`,
        canvases,
        excel: { filename: `${base}.csv`, csv: toCSV(r.cols, rows) },
        shareable: false
      });
      logActivity({ user: session.name, role: session.role, action: 'generated report', target: `${r.label} · ${cls}` });
    } catch (e) {
      console.error('[Active Plus] report failed:', (e && e.stack) || e);
      showToast('রিপোর্ট তৈরি করা যায়নি।', 'error');
    } finally {
      card.setAttribute('aria-busy', 'false');
      card.disabled = false;
    }
  });
}

/* ---------------- Users & permissions ---------------- */
function mountUsers(session) {
  document.getElementById('users-list').innerHTML = listUsers().map((u) => `
    <div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(u.name)}</div><div class="li-sub">${escapeHtml(u.username)}</div></div>
    <span class="badge accent">${escapeHtml(u.role)}</span></div>`).join('');
  // The full, independently configurable permission set (spec 46).
  const settings = db.settings.get();
  const matrix = settings.permissions || { ...DEFAULT_PERMISSIONS };
  document.getElementById('perm-matrix').innerHTML = ['admin', 'teacher'].map((role) => `
    <div class="card"><h3>${role === 'admin' ? 'অ্যাডমিন' : 'শিক্ষক'}</h3>
      <p class="meta">${role === 'admin' ? 'অ্যাডমিন সর্বদা সব অনুমতি রাখেন।' : 'শিক্ষক যা পারবেন তা এখানে নির্ধারণ করুন — অনুমতি ডেটা-লেয়ারেও প্রয়োগ হয়।'}</p>
      ${PERMISSIONS.map((p) => `
      <label class="role-option" style="margin:.25rem 0"><input type="checkbox" data-role="${role}" data-perm="${p}" ${
        role === 'admin' ? 'checked disabled' : ((matrix[role] || []).includes(p) ? 'checked' : '')
      }><span>${escapeHtml(p)}</span></label>`).join('')}</div>`).join('');
  document.getElementById('perm-save').addEventListener('click', () => {
    if (!onlineFor('অনুমতি সংরক্ষণ')) return;
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
function mountBackup(session, onlineFor) {
  const who = { user: session?.name || 'admin', role: session?.role || 'admin' };
  document.getElementById('backup-export').addEventListener('click', () => {
    downloadText(`active-plus-backup-${Date.now()}.json`, exportBackup(), 'application/json');
    logActivity({ ...who, action: 'exported backup' });
    showToast('ব্যাকআপ ডাউনলোড হয়েছে।', 'success');
  });
  document.getElementById('backup-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!onlineFor('ব্যাকআপ রিস্টোর')) { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      // Never a silent overwrite: the admin confirms before anything is replaced.
      if (!window.confirm('বর্তমান ডেটা এই ব্যাকআপ দিয়ে প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?')) return;
      const result = importBackup(String(reader.result));
      if (result.ok) {
        logActivity({ ...who, action: 'restored backup', target: `${result.restored} collections` });
        showToast(`রিস্টোর সফল (${bn(result.restored)} কালেকশন)।`, 'success');
      } else {
        showToast(result.error, 'error');
      }
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
