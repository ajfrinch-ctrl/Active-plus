/**
 * Admin ERP modules — wires the extended admin tabs on top of the base
 * admin.html wiring. Everything reads/writes the layered data store and logs
 * activity, and every stat is computed live (nothing hard-coded).
 */

import {
  db, analytics, examSummary, classPerformance, leaderboard, exportBackup, importBackup,
  parseMcqPaste, parseMcqCsv, toCSV, downloadText, logActivity, activityLogs,
  todayBn, parseDate, newId, CLASS_OPTIONS, ALL_CLASSES, dueFees, checkSubmission, submissionsFor,
  admissionTrend, collectionTrend, dueTrend, subjectPerformance, passRate,
  PERMISSIONS, DEFAULT_PERMISSIONS, getDbStatus
} from './data.js';
import { mountCrud } from './crud.js';
import { escapeHtml, renderTable, statGrid, showToast, openModal, closeModal, getAuthMode, requireOnline } from './app.js';
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
  mountAnalytics();
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
      <div class="card"><h3>ঝুলন্ত অ্যাসাইনমেন্ট</h3><p>${bn(db.assignments.list().length)}</p></div>
      <div class="card"><h3>সাম্প্রতিক অ্যাডমিন কার্যক্রম</h3><p>${activityLogs().slice(0, 3).map((l) => escapeHtml(l.action)).join(' · ') || '—'}</p></div>
    </div>`;

  checkConnectionStatus().then((connected) => {
    const el = document.getElementById('db-status');
    if (!el) return;
    const mode = getAuthMode();
    el.className = `alert ${connected || mode === 'local' ? 'alert-success' : 'alert-error'}`;
    el.textContent = mode === 'local'
      ? `ডেটাবেস: লোকাল মোড (সংযুক্ত) · শেষ সিঙ্ক: ${todayBn()}`
      : connected ? `ডেটাবেস: সংযুক্ত · শেষ সিঙ্ক: ${todayBn()}` : 'ডেটাবেস: বিচ্ছিন্ন (অফলাইন)';
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
      { name: 'deadline', label: 'ডেডলাইন (দিন-মাস-বছর)' },
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
      { key: 'date', label: 'জমার তারিখ', render: (r) => escapeHtml(r.date || '—') },
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
      <div class="li-sub">${escapeHtml(n.type)} · ${escapeHtml(n.target)} · ${escapeHtml(n.date)}</div></div>
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

  // Accessible bar charts: each bar is labelled and the chart carries a summary.
  const barChart = (host, rows, { labelKey, valueKey, format }) => {
    const el = document.getElementById(host);
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div class="empty-state">যথেষ্ট ডেটা নেই।</div>'; return; }
    const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
    const summary = rows.map((r) => `${r[labelKey]}: ${format(r[valueKey])}`).join(', ');
    el.innerHTML = `<div class="mini-chart" role="img" aria-label="${escapeHtml(summary)}">${
      rows.map((r) => {
        const v = Number(r[valueKey]) || 0;
        const pct = Math.round(v / max * 100);
        return `<div class="bar" style="height:${Math.max(pct, 4)}%" title="${escapeHtml(String(r[labelKey]))}: ${escapeHtml(format(v))}"></div>`;
      }).join('')}</div>
      <div class="chart-legend">${rows.map((r) => `<span>${escapeHtml(String(r[labelKey]))} · ${escapeHtml(format(r[valueKey]))}</span>`).join('')}</div>`;
  };

  barChart('chart-admissions', admissionTrend(), { labelKey: 'month', valueKey: 'count', format: (v) => `${bn(v)} জন` });
  barChart('chart-collection', collectionTrend(), { labelKey: 'month', valueKey: 'amount', format: (v) => `৳${bn(v)}` });
  barChart('chart-due', dueTrend(), { labelKey: 'month', valueKey: 'amount', format: (v) => `৳${bn(v)}` });

  const pr = passRate();
  const prEl = document.getElementById('chart-passrate');
  if (prEl) {
    prEl.innerHTML = pr
      ? `<div class="stat-grid">
          <div class="stat"><span class="stat-value">${bn(pr.passPercent)}%</span><span class="stat-label">পাস</span></div>
          <div class="stat"><span class="stat-value">${bn(pr.failPercent)}%</span><span class="stat-label">ফেল</span></div>
          <div class="stat"><span class="stat-value">${bn(pr.total)}</span><span class="stat-label">মোট ফলাফল</span></div>
        </div>
        <div class="progress-bar" role="img" aria-label="পাস ${bn(pr.passPercent)} শতাংশ, পাস মার্ক ${bn(pr.passMark)}">
          <div class="progress-fill" style="width:${pr.passPercent}%"></div></div>
        <p class="meta">পাস মার্ক: ${bn(pr.passMark)}%</p>`
      : '<div class="empty-state">এখনো কোনো ফলাফল নেই।</div>';
  }

  const subjects = subjectPerformance();
  const subEl = document.getElementById('subject-perf');
  if (subEl) {
    subEl.innerHTML = subjects.length
      ? subjects.map((s) => `<div class="form-group"><label>${escapeHtml(s.subject)} — ${bn(s.avg)}% (${bn(s.count)} ফলাফল)</label>
          <div class="progress-bar"><div class="progress-fill" style="width:${s.avg}%"></div></div></div>`).join('')
      : '<div class="empty-state">এখনো কোনো ফলাফল নেই।</div>';
  }
}

/* ---------------- Reports ---------------- */
function mountReports(session) {
  const sel = document.getElementById('report-type');
  const classSel = document.getElementById('report-class');
  const passMark = Number(db.settings.get().passMark) || 40;
  const pct = (r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100);
  const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;
  const classNameOf = (row) => row.className
    || (row.studentId ? db.students.find(row.studentId)?.className : null)
    || null;
  const payRows = (payments) => payments.map((p) => {
    const st = db.students.find(p.studentId);
    return { studentId: p.studentId, name: st?.name || '—', className: st?.className || '—', month: p.month, amount: taka(p.amount), date: p.date, method: p.method || '—', reference: p.reference || '—', _amount: Number(p.amount) || 0 };
  });

  const reports = {
    students: {
      label: 'শিক্ষার্থী তালিকা', classScoped: true, cols: CLASS_REPORT_COLUMNS,
      rows: () => classReportRows(db.students.list()).rows,
      summary: (rows) => [{ label: 'মোট শিক্ষার্থী', value: bn(rows.length) }]
    },
    teachers: {
      label: 'শিক্ষক তালিকা', classScoped: false,
      cols: [{ key: 'name', label: 'নাম' }, { key: 'subject', label: 'বিষয়' }, { key: 'phone', label: 'মোবাইল' }],
      rows: () => db.teachers.list(),
      summary: (rows) => [{ label: 'মোট শিক্ষক', value: bn(rows.length) }]
    },
    classes: {
      label: 'ক্লাস রিপোর্ট', classScoped: true,
      cols: [{ key: 'className', label: 'ক্লাস' }, { key: 'students', label: 'শিক্ষার্থী' }, { key: 'batches', label: 'ব্যাচ' }],
      rows: () => CLASS_OPTIONS.map((c) => ({
        className: c,
        students: db.students.list().filter((s) => s.className === c).length,
        batches: db.batches.list().filter((b) => String(b.className || b.name).includes(c)).length
      })).filter((r) => r.students || r.batches),
      summary: (rows) => [{ label: 'মোট ক্লাস', value: bn(rows.length) }]
    },
    batches: {
      label: 'ব্যাচ রিপোর্ট', classScoped: false,
      cols: [{ key: 'name', label: 'ব্যাচ' }, { key: 'className', label: 'ক্লাস' }, { key: 'teacher', label: 'শিক্ষক' }, { key: 'students', label: 'শিক্ষার্থী' }],
      rows: () => db.batches.list(),
      summary: (rows) => [{ label: 'মোট ব্যাচ', value: bn(rows.length) }]
    },
    exams: {
      label: 'পরীক্ষা রিপোর্ট', classScoped: true,
      cols: [{ key: 'title', label: 'শিরোনাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'subject', label: 'বিষয়' }, { key: 'startDate', label: 'তারিখ' }],
      rows: () => db.exams.list(),
      summary: (rows) => [{ label: 'মোট পরীক্ষা', value: bn(rows.length) }]
    },
    results: {
      label: 'ফলাফল রিপোর্ট', classScoped: true,
      cols: [{ key: 'studentName', label: 'শিক্ষার্থী' }, { key: 'className', label: 'ক্লাস' }, { key: 'examId', label: 'পরীক্ষা' }, { key: 'score', label: 'প্রাপ্ত' }, { key: 'total', label: 'পূর্ণ' }],
      rows: () => db.examResults.list().map((r) => ({ ...r, className: db.students.find(r.studentId)?.className || '—' })),
      summary: (rows) => {
        const pcts = rows.map(pct);
        return [
          { label: 'মোট ফলাফল', value: bn(rows.length) },
          { label: 'গড় ফলাফল', value: pcts.length ? `${bn(Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length))}%` : '—' }
        ];
      }
    },
    merit: {
      label: 'মেধা তালিকা', classScoped: true,
      cols: [{ key: 'position', label: 'অবস্থান' }, { key: 'studentName', label: 'শিক্ষার্থী' }, { key: 'className', label: 'ক্লাস' }, { key: 'percent', label: 'শতাংশ' }],
      rows: () => leaderboard().slice(0, 50).map((r) => ({ position: r.position, studentName: r.studentName, className: db.students.find(r.studentId)?.className || '—', percent: `${r.pct}%` })),
      summary: (rows) => [{ label: 'মোট শিক্ষার্থী', value: bn(rows.length) }]
    },
    performance: {
      label: 'একাডেমিক পারফরম্যান্স', classScoped: true,
      cols: [{ key: 'exam', label: 'পরীক্ষা' }, { key: 'className', label: 'ক্লাস' }, { key: 'participants', label: 'অংশগ্রহণ' }, { key: 'avg', label: 'গড়' }, { key: 'pass', label: 'পাস' }, { key: 'fail', label: 'ফেল' }],
      rows: () => db.exams.list().map((e) => {
        const rows = db.examResults.list().filter((r) => r.examId === e.id);
        const pcts = rows.map(pct);
        return {
          exam: e.title, className: e.className, participants: rows.length,
          avg: pcts.length ? `${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%` : '—',
          pass: pcts.filter((v) => v >= passMark).length,
          fail: pcts.filter((v) => v < passMark).length
        };
      }),
      summary: (rows) => [{ label: 'মোট পরীক্ষা', value: bn(rows.length) }]
    },
    assignments: {
      label: 'অ্যাসাইনমেন্ট রিপোর্ট', classScoped: true,
      cols: [{ key: 'title', label: 'শিরোনাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'dueDate', label: 'শেষ তারিখ' }, { key: 'submitted', label: 'জমা' }, { key: 'checked', label: 'চেক' }],
      rows: () => db.assignments.list().map((a) => {
        const subs = db.submissions.list().filter((s) => s.assignmentId === a.id);
        return { ...a, submitted: subs.length, checked: subs.filter((s) => s.status === 'চেক হয়েছে').length };
      }),
      summary: (rows) => [{ label: 'মোট অ্যাসাইনমেন্ট', value: bn(rows.length) }]
    },
    materials: {
      label: 'ম্যাটেরিয়াল রিপোর্ট', classScoped: true,
      cols: [{ key: 'title', label: 'শিরোনাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'subject', label: 'বিষয়' }],
      rows: () => db.materials.list(),
      summary: (rows) => [{ label: 'মোট ম্যাটেরিয়াল', value: bn(rows.length) }]
    },
    daily: {
      label: 'দৈনিক আদায়', classScoped: true,
      cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'শ্রেণি' }, { key: 'amount', label: 'পরিমাণ' }, { key: 'method', label: 'মাধ্যম' }],
      rows: () => payRows(db.payments.list().filter((p) => p.date === todayBn())),
      summary: (rows) => [{ label: 'মোট আদায়', value: taka(rows.reduce((s, r) => s + (r._amount || 0), 0)) }]
    },
    monthly: {
      label: 'মাসিক আদায়', classScoped: true,
      cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'শ্রেণি' }, { key: 'amount', label: 'পরিমাণ' }, { key: 'date', label: 'তারিখ' }],
      rows: () => {
        const now = new Date();
        return payRows(db.payments.list().filter((p) => {
          const d = parseDate(p.date);
          return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }));
      },
      summary: (rows) => [{ label: 'মোট আদায়', value: taka(rows.reduce((s, r) => s + (r._amount || 0), 0)) }]
    },
    due: {
      label: 'বকেয়া তালিকা', classScoped: true,
      cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'শ্রেণি' }, { key: 'month', label: 'মাস' }, { key: 'amount', label: 'পরিমাণ' }],
      rows: () => dueFees().map((f) => ({ studentId: f.studentId, name: f.student?.name || '—', className: f.student?.className || '—', month: f.month, amount: taka(f.amount), _amount: Number(f.amount) || 0 })),
      summary: (rows) => [{ label: 'মোট বকেয়া', value: taka(rows.reduce((s, r) => s + (r._amount || 0), 0)) }]
    },
    payments: {
      label: 'পেমেন্ট ইতিহাস', classScoped: true,
      cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'শ্রেণি' }, { key: 'amount', label: 'পরিমাণ' }, { key: 'date', label: 'তারিখ' }, { key: 'method', label: 'মাধ্যম' }, { key: 'reference', label: 'রেফারেন্স' }],
      rows: () => payRows(db.payments.list()),
      summary: (rows) => [{ label: 'মোট আদায়', value: taka(rows.reduce((s, r) => s + (r._amount || 0), 0)) }]
    },
    ledger: {
      label: 'শিক্ষার্থী লেজার', classScoped: true,
      cols: [{ key: 'studentId', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'paid', label: 'পরিশোধিত' }, { key: 'due', label: 'বকেয়া' }],
      rows: () => db.students.list().map((st) => ({
        studentId: st.id, name: st.name, className: st.className,
        paid: taka(db.payments.list().filter((p) => p.studentId === st.id).reduce((sum, p) => sum + Number(p.amount || 0), 0)),
        due: taka(dueFees().filter((d) => d.studentId === st.id).reduce((sum, d) => sum + Number(d.amount || 0), 0))
      })),
      summary: () => []
    },
    discounts: {
      label: 'ছাড় রিপোর্ট', classScoped: true,
      cols: [{ key: 'id', label: 'আইডি' }, { key: 'name', label: 'নাম' }, { key: 'className', label: 'ক্লাস' }, { key: 'discount', label: 'ছাড়' }],
      rows: () => db.students.list().filter((s) => Number(s.discount) > 0).map((s) => ({ id: s.id, name: s.name, className: s.className, discount: taka(s.discount) })),
      summary: (rows) => [{ label: 'ছাড়প্রাপ্ত শিক্ষার্থী', value: bn(rows.length) }]
    },
    activity: {
      label: 'অ্যাক্টিভিটি লগ', classScoped: false,
      cols: [{ key: 'date', label: 'তারিখ' }, { key: 'user', label: 'ব্যবহারকারী' }, { key: 'role', label: 'রোল' }, { key: 'action', label: 'কাজ' }, { key: 'target', label: 'টার্গেট' }],
      rows: () => activityLogs(),
      summary: (rows) => [{ label: 'মোট কার্যক্রম', value: bn(rows.length) }]
    }
  };

  sel.innerHTML = Object.entries(reports).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  classSel.innerHTML = `<option value="${ALL_CLASSES}">সব ক্লাস</option>`
    + CLASS_OPTIONS.map((c) => `<option>${c}</option>`).join('');

  const filteredRows = () => {
    const r = reports[sel.value];
    const cls = classSel.value || ALL_CLASSES;
    let rows = r.rows();
    if (r.classScoped && cls !== ALL_CLASSES) rows = rows.filter((row) => classNameOf(row) === cls);
    return { r, cls, rows };
  };

  const render = () => {
    const { r, rows } = filteredRows();
    renderTable('#report-table', r.cols, rows);
  };

  // No data is shown before Generate — entering the Reports panel shows only a
  // hint. Selecting a different type/class clears any previously generated data.
  const showPlaceholder = () => {
    const table = document.getElementById('report-table');
    if (table) {
      table.innerHTML = '<thead><tr></tr></thead><tbody><tr><td colspan="8"><div class="empty-state">রিপোর্ট Generate করলে তথ্য এখানে দেখাবে।</div></td></tr></tbody>';
    }
  };
  sel.addEventListener('change', showPlaceholder);
  classSel.addEventListener('change', showPlaceholder);

  document.getElementById('report-csv').addEventListener('click', () => {
    const { r, cls, rows } = filteredRows();
    downloadText(`${sel.value}-report.csv`, toCSV(r.cols, rows), 'text/csv');
  });

  /**
   * Build the document canvases for the selected report + class. Class-scoped
   * reports are split into one section per class ("সব ক্লাস" → every class in
   * its own section; a specific class → just that class).
   */
  const buildDocument = async (r, cls, rows) => {
    const settings = db.settings.get();
    const canvases = [];
    if (r.classScoped) {
      const classes = (cls && cls !== ALL_CLASSES)
        ? [cls]
        : (CLASS_OPTIONS.filter((c) => rows.some((row) => classNameOf(row) === c)) || []);
      const sections = classes.length ? classes : [ALL_CLASSES];
      for (const c of sections) {
        const sectionRows = c === ALL_CLASSES ? rows : rows.filter((row) => classNameOf(row) === c);
        canvases.push(...await renderReportCanvases({
          settings, title: r.label,
          subtitle: sections.length === 1 ? `শ্রেণি: ${c === ALL_CLASSES ? 'সব' : c}` : `শ্রেণি: ${c}`,
          columns: r.cols, rows: sectionRows, summary: r.summary(sectionRows)
        }));
      }
    } else {
      canvases.push(...await renderReportCanvases({
        settings, title: r.label, subtitle: `তারিখ: ${todayBn()}`,
        columns: r.cols, rows, summary: r.summary(rows)
      }));
    }
    return canvases;
  };

  // Generate → Preview → Download PDF (never a direct download). Only after
  // Generate is the on-screen table populated, alongside the preview popup.
  document.getElementById('report-generate').addEventListener('click', async () => {
    const { r, cls, rows } = filteredRows();
    render(); // show the filtered data on screen
    try {
      const canvases = await buildDocument(r, cls, rows);
      const clsLabel = (cls && cls !== ALL_CLASSES) ? classFileLabel(cls) : 'All-Classes';
      await previewDocument({
        title: r.label,
        meta: `শ্রেণি: ${cls === ALL_CLASSES ? 'সব' : cls} · ${todayBn()}`,
        filename: `${sel.value}-report-${clsLabel}.pdf`,
        canvases,
        shareable: false
      });
      logActivity({ user: session.name, role: session.role, action: 'generated report', target: `${r.label} · ${cls}` });
    } catch (e) {
      showToast('রিপোর্ট তৈরি করা যায়নি।', 'error');
    }
  });

  showPlaceholder();
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
