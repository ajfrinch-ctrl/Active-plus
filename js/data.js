/**
 * Persistent data layer for Active Plus.
 *
 * All collections live under one versioned key in the layered store, so edits
 * survive reloads wherever storage is allowed — and still work for the current
 * page load when it is blocked.
 *
 * Collections: settings, students, teachers, batches, notices, routine,
 * attendance, results, fees (per student), payments, suggestions, exams,
 * examResults.
 */

import { readJSON, writeJSON } from './store.js';

const DATA_KEY = 'activeplus_data';
const DATA_VERSION = 6; // ERP: classes, subjects, materials, assignments, notifications, activity logs

export const CLASS_OPTIONS = ['অষ্টম', 'নবম', 'দশম', 'একাদশ', 'দ্বাদশ'];
export const CLASS_TO_NUMBER = { 'অষ্টম': 8, 'নবম': 9, 'দশম': 10, 'একাদশ': 11, 'দ্বাদশ': 12 };
export const ALL_CLASSES = 'সব';

const MONTH_AGO = 'আগস্ট ২০২৬';
const MONTH_NOW = 'সেপ্টেম্বর ২০২';

const SEED = {
  settings: {
    orgName: 'Active Plus Coaching',
    address: '২য় তলা, মদিনা প্লাজা, মিরপুর-১০, ঢাকা',
    mobile: '০১৭০০-০০০০০০',
    email: 'info@activeplus.edu',
    website: 'activeplus.edu',
    academicYear: '২০৬',
    monthlyFee: 1200,
    admissionFee: 500,
    defaultExamDuration: 30,
    passMark: 40,
    negativeMarking: 0,
    leaderboardEnabled: true,
    autoPublishResult: false,
    notificationsEnabled: true
  },
  students: [
    { id: '2026-09-001', name: 'আরিয়ান হাসান', className: 'নবম', roll: '০১', phone: '০১৭১১-০০০০১', school: 'মিরপুর বেঙ্গল উচ্চ বিদ্যালয়', status: 'সক্রিয়' },
    { id: '2026-09-002', name: 'সুমাইয়া ইসলাম', className: 'নবম', roll: '০২', phone: '০১৭১১-০০০০২', school: 'ভিকারুননিসা নূন স্কুল অ্যান্ড কলেজ', status: 'সক্রিয়' },
    { id: '2026-10-014', name: 'নাফিস ইকবাল', className: 'দশম', roll: '১৪', phone: '০১৭১১-০০০০১৪', school: 'মতিঝিল সরকারি বালক উচ্চ বিদ্যালয়', status: 'বকেয়া' },
    { id: '2026-08-007', name: 'তাসনিম জাহান', className: 'অষ্টম', roll: '০৭', phone: '০১৭১১-০০০০৭', school: 'লালমাটিয়া বালিকা বিদ্যালয়', status: 'সক্রিয়' }
  ],
  teachers: [
    { name: 'রাহেলা আক্তার', subject: 'পদার্থবিজ্ঞান', phone: '০১৮১১-১১১১১১', classes: 6 },
    { name: 'কামরুল ইসলাম', subject: 'গণিত', phone: '০১১১-২২২২২২', classes: 8 },
    { name: 'নুসরাত জাহান', subject: 'রসায়ন', phone: '০১১১-৩৩৩৩৩৩', classes: 5 },
    { name: 'সাদিয়া রহমান', subject: 'ইংরেজি', phone: '০১১১-৪৪৪৪৪', classes: 4 }
  ],
  batches: [
    { name: 'নবম (বিজ্ঞান)', students: 42, teacher: 'রাহেলা আক্তার', time: 'সকাল ৮টা' },
    { name: 'দশম (বিজ্ঞান)', students: 38, teacher: 'কামরুল ইসলাম', time: 'সকাল ৯টা' },
    { name: 'অষ্টম', students: 30, teacher: 'সাদিয়া রহমান', time: 'বিকাল ৪টা' }
  ],
  notices: [
    { id: 'n-1', title: 'অর্ধবার্ষিক পরীক্ষার রুটিন প্রকাশ', date: '২০২৬-০৯-০১', audience: 'সবাই', className: ALL_CLASSES },
    { id: 'n-2', title: 'সেপ্টেম্বর মাসের বেতন পরিশোধের শেষ তারিখ ১০ সেপ্টেম্বর', date: '০২৬-০৮-২৮', audience: 'অভিভাবক', className: ALL_CLASSES },
    { id: 'n-3', title: 'নবম শ্রেণির পদার্থবিজ্ঞান ক্লাস শনিবার সকাল ৮টায়', date: '২০২৬-০৮-২৫', audience: 'শিক্ষার্থী', className: 'নবম' }
  ],
  routine: [
    { id: 'rt-1', day: 'শনিবার', subject: 'গণিত', teacher: 'রাহেলা আক্তার', time: '০৮:০০ – ০৯:০০', room: 'কক্ষ ২০১' },
    { id: 'rt-2', day: 'রবিবার', subject: 'পদার্থবিজ্ঞান', teacher: 'কামরুল ইসলাম', time: '০৯:০০ – ১০:০০', room: 'কক্ষ ১০৫' },
    { id: 'rt-3', day: 'সোমবার', subject: 'রসায়ন', teacher: 'নুসরাত জাহান', time: '০৮:০০ – ০৯:০০', room: 'ল্যাব ১' },
    { id: 'rt-4', day: 'মঙ্গলবার', subject: 'ইংরেজি', teacher: 'সাদিয়া রহমান', time: '১০:০০ – ১১:০০', room: 'কক্ষ ৩০২' },
    { id: 'rt-5', day: 'বুধবার', subject: 'জীববিজ্ঞান', teacher: 'তানভীর আহমেদ', time: '০৯:০০ – ১০:০০', room: 'ল্যাব ২' }
  ],
  attendance: [
    { date: '০২৬-০৯-০১', subject: 'গণিত', status: 'উপস্থিত' },
    { date: '২০২৬-০৯-০২', subject: 'পদার্থবিজ্ঞান', status: 'উপস্থিত' },
    { date: '২০২৬-০৯-০৩', subject: 'রসায়ন', status: 'অনুপস্থিত' },
    { date: '২০২৬-০৯-০৪', subject: 'ইংরেজি', status: 'উপস্থিত' }
  ],
  results: [
    { exam: 'প্রথম সাময়িক', subject: 'গণিত', marks: 82, grade: 'A-' },
    { exam: 'প্রথম সাময়িক', subject: 'পদার্থবিজ্ঞান', marks: 74, grade: 'B' },
    { exam: 'প্রথম সাময়িক', subject: 'রসায়ন', marks: 91, grade: 'A' },
    { exam: 'প্রথম সাময়িক', subject: 'ইংরেজি', marks: 68, grade: 'B-' }
  ],
  /* Per-student monthly fees. status: পরিশোধিত | বকেয়া */
  fees: [
    { id: 'fee-001-ago', studentId: '2026-09-001', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৮-০৫' },
    { id: 'fee-001-now', studentId: '2026-09-001', month: MONTH_NOW, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৯-০২' },
    { id: 'fee-002-ago', studentId: '2026-09-002', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৮-০৬' },
    { id: 'fee-002-now', studentId: '2026-09-002', month: MONTH_NOW, amount: 1200, status: 'বকেয়া', date: '—' },
    { id: 'fee-014-ago', studentId: '2026-10-014', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৮-১০' },
    { id: 'fee-014-now', studentId: '2026-10-014', month: MONTH_NOW, amount: 1200, status: 'বকেয়া', date: '—' },
    { id: 'fee-007-ago', studentId: '2026-08-007', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৮-০৪' },
    { id: 'fee-007-now', studentId: '2026-08-007', month: MONTH_NOW, amount: 1200, status: 'পরিশোধিত', date: '০২৬-০৯-০১' }
  ],
  payments: [
    { id: 'pay-1', studentId: '2026-09-001', month: MONTH_AGO, amount: 1200, date: '২০২৬-০৮-০৫', receivedBy: 'সিস্টেম' }
  ],
  suggestions: [
    {
      id: 'sug-1', title: 'পদার্থবিজ্ঞান সাজেশন — অর্ধবার্ষিক ২০২৬', className: 'নবম', subject: 'পদার্থবিজ্ঞান',
      author: 'রাহেলা আক্তার', date: '২০২৬-০৯-০১',
      content: '১) গতি ও বেগের সংজ্ঞা ও একক ভালোভাবে মুখস্থ কর। ২) নিউটনের সূত্রগুলো উদাহরণসহ ব্যাখ্যা করতে পারতে হবে। ৩) কাজ, শক্তি ও ক্ষমতার গাণিতিক অনুশীলন কর। ৪) বোর্ডের ২০২৫ সালের প্রশ্নপত্র সমাধান কর।'
    }
  ],
  exams: [
    {
      id: 'exam-1', title: 'গণিত MCQ মডেল টেস্ট-১', className: 'নবম', subject: 'গণিত',
      author: 'কামরুল ইসলাম', date: '২০২৬-০৯-০২',
      questions: [
        { q: '৫ + ৩ × ২ = ?', options: ['১০', '১১', '১৬', ''], answer: 1 },
        { q: 'একটি ত্রিভুজের তিন কোণের সমষ্টি কত?', options: ['৯০°', '১৮০°', '২৭০°', '৩৬০°'], answer: 1 },
        { q: 'x + 2 = 7 হলে x = ?', options: ['৫', '৭', '৯', '২'], answer: 0 }
      ]
    }
  ],
  examResults: [],
  classes: [
    { id: 'c-8', name: 'অষ্টম', active: true },
    { id: 'c-9', name: 'নবম', active: true },
    { id: 'c-10', name: 'দশম', active: true }
  ],
  subjects: [
    { id: 'sub-1', name: 'গণিত', className: 'নবম', teacher: 'কামরুল ইসলাম' },
    { id: 'sub-2', name: 'পদার্থবিজ্ঞান', className: 'নবম', teacher: 'রাহেলা আক্তার' },
    { id: 'sub-3', name: 'রসায়ন', className: 'নবম', teacher: 'নুসরাত জাহান' },
    { id: 'sub-4', name: 'ইংরেজি', className: 'নবম', teacher: 'সাদিয়া রহমান' }
  ],
  materials: [
    { id: 'mat-1', title: 'গণিত নোট — অধ্যায় ১', subject: 'গণিত', className: 'নবম', type: 'নোট', chapter: '১', description: 'স্বাভাবিক সংখ্যা ও ভগ্নাংশ', date: '২০২৬-০৯-০১', by: 'কামরুল ইসলাম', published: true }
  ],
  assignments: [
    { id: 'asg-1', title: 'গণিত হোমওয়ার্ক-১', subject: 'গণিত', className: 'নবম', teacher: 'কামরুল ইসলাম', deadline: '২০২৬-০৯-১০', marks: 20, description: 'অধ্যায় ১ এর অনুশীলনী' }
  ],
  submissions: [
    { id: 'subm-1', assignmentId: 'asg-1', studentId: '2026-09-001', status: 'জমা হয়েছে', date: '২০২৬-০-০৩', feedback: '' }
  ],
  notifications: [
    { id: 'ntf-1', type: 'সাধারণ', title: 'সিস্টেম চালু হয়েছে', target: 'সবাই', date: '২০৬-০-০১', read: false }
  ],
  activityLogs: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function load() {
  const existing = readJSON(DATA_KEY, null);
  if (existing && existing.version === DATA_VERSION && existing.collections) return existing;
  const fresh = { version: DATA_VERSION, seededAt: new Date().toISOString(), collections: clone(SEED) };
  writeJSON(DATA_KEY, fresh);
  return fresh;
}

function save(store) {
  writeJSON(DATA_KEY, store);
}

function makeCollection(name, { keyField = null } = {}) {
  return {
    list() {
      return load().collections[name] || [];
    },
    add(item) {
      const store = load();
      const list = store.collections[name] || (store.collections[name] = []);
      list.push(clone(item));
      save(store);
      return item;
    },
    update(matcher, patch) {
      const store = load();
      const list = store.collections[name] || [];
      const target = typeof matcher === 'function'
        ? list.find(matcher)
        : list.find((row) => row[keyField] === matcher);
      if (!target) return null;
      Object.assign(target, clone(patch));
      save(store);
      return target;
    },
    remove(matcher) {
      const store = load();
      const list = store.collections[name] || [];
      const index = typeof matcher === 'function'
        ? list.findIndex(matcher)
        : list.findIndex((row) => row[keyField] === matcher);
      if (index === -1) return false;
      list.splice(index, 1);
      save(store);
      return true;
    },
    find(matcher) {
      const list = this.list();
      return typeof matcher === 'function'
        ? list.find(matcher) || null
        : list.find((row) => row[keyField] === matcher) || null;
    }
  };
}

export const db = {
  students: makeCollection('students', { keyField: 'id' }),
  teachers: makeCollection('teachers', { keyField: 'name' }),
  batches: makeCollection('batches', { keyField: 'name' }),
  notices: makeCollection('notices', { keyField: 'id' }),
  routine: makeCollection('routine'),
  attendance: makeCollection('attendance'),
  results: makeCollection('results'),
  fees: makeCollection('fees', { keyField: 'id' }),
  payments: makeCollection('payments', { keyField: 'id' }),
  suggestions: makeCollection('suggestions', { keyField: 'id' }),
  exams: makeCollection('exams', { keyField: 'id' }),
  examResults: makeCollection('examResults', { keyField: 'id' }),
  classes: makeCollection('classes', { keyField: 'id' }),
  subjects: makeCollection('subjects', { keyField: 'id' }),
  materials: makeCollection('materials', { keyField: 'id' }),
  assignments: makeCollection('assignments', { keyField: 'id' }),
  submissions: makeCollection('submissions', { keyField: 'id' }),
  notifications: makeCollection('notifications', { keyField: 'id' }),
  activityLogs: makeCollection('activityLogs', { keyField: 'id' }),

  settings: {
    get() {
      return { ...clone(SEED.settings), ...load().collections.settings };
    },
    update(patch) {
      const store = load();
      store.collections.settings = { ...(store.collections.settings || {}), ...clone(patch) };
      save(store);
      return this.get();
    }
  },

  reset() {
    const fresh = { version: DATA_VERSION, seededAt: new Date().toISOString(), collections: clone(SEED) };
    save(fresh);
    return fresh;
  },

  version: DATA_VERSION
};

/* ------------------------------------------------------------------ */
/* Domain helpers                                                      */
/* ------------------------------------------------------------------ */

export function todayBn() {
  const iso = new Date().toISOString().slice(0, 10);
  return iso.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Students filtered by class ('সব' = everyone). */
export function studentsOfClass(className) {
  const all = db.students.list();
  return className && className !== ALL_CLASSES ? all.filter((s) => s.className === className) : all;
}

/** Due (বকেয়া) fee rows joined with their student, optionally by class. */
export function dueFees(className = ALL_CLASSES) {
  const students = studentsOfClass(className);
  const ids = new Set(students.map((s) => s.id));
  return db.fees.list()
    .filter((fee) => fee.status === 'বকেয়া' && ids.has(fee.studentId))
    .map((fee) => ({ ...fee, student: students.find((s) => s.id === fee.studentId) || null }));
}

/**
 * Marks a fee as paid, records the payment, clears the student's বকেয়া status
 * when nothing is due anymore, and sends a personal notice to the student.
 */
export function receivePayment(feeId, receivedBy) {
  const fee = db.fees.find(feeId);
  if (!fee || fee.status !== 'বকেয়া') return null;
  const student = db.students.find(fee.studentId);
  const date = todayBn();

  db.fees.update(feeId, { status: 'পরিশোধিত', date });
  const payment = {
    id: newId('pay'), studentId: fee.studentId, month: fee.month,
    amount: fee.amount, date, receivedBy: receivedBy || 'অ্যাডমিন'
  };
  db.payments.add(payment);

  if (student) {
    const stillDue = db.fees.list().some((f) => f.studentId === student.id && f.status === 'বকেয়া');
    if (!stillDue) db.students.update(student.id, { status: 'সক্রিয়' });
    db.notices.add({
      id: newId('n'),
      title: `পেমেন্ট গৃহীত: ${fee.month} — ৳${fee.amount}`,
      audience: 'শিক্ষার্থী',
      className: student.className,
      forStudent: student.id,
      date
    });
  }
  return { fee, student, payment };
}

/** Notices visible to one student: global + own class + personal (private). */
export function noticesFor(student) {
  const list = db.notices.list();
  if (!student) return list.filter((n) => !n.forStudent && n.audience === 'সবাই');
  return list.filter((n) => {
    if (n.forStudent) return n.forStudent === student.id; // personal → only that student
    return n.audience === 'সবাই'
      || !n.className || n.className === ALL_CLASSES
      || n.className === student.className;
  });
}

/** Score a submitted answer map {questionIndex: optionIndex} against an exam. */
export function scoreExam(exam, answers) {
  const total = exam.questions.length;
  let score = 0;
  exam.questions.forEach((question, index) => {
    if (Number(answers[index]) === question.answer) score += 1;
  });
  return { score, total };
}

export function examResultFor(examId, studentId) {
  return db.examResults.find((r) => r.examId === examId && r.studentId === studentId);
}

export function suggestionsFor(className) {
  return db.suggestions.list().filter((s) => !s.className || s.className === ALL_CLASSES || s.className === className);
}

export function examsFor(className) {
  return db.exams.list().filter((e) => !e.className || e.className === ALL_CLASSES || e.className === className);
}
/* ------------------------------------------------------------------ */
/* ERP helpers: activity log, analytics, leaderboard, backup,          */
/* MCQ paste parsing, CSV export, global search                        */
/* ------------------------------------------------------------------ */

export function logActivity({ user = 'system', role = 'system', action, target = '' }) {
  db.activityLogs.add({
    id: newId('log'), user, role, action, target,
    timestamp: new Date().toISOString(), date: todayBn()
  });
}

export function activityLogs() {
  return [...db.activityLogs.list()].reverse();
}

/** Exam result summary: attempts, avg/highest/lowest, pass rate. */
export function examSummary(examId) {
  const exam = db.exams.find(examId);
  const results = db.examResults.list().filter((r) => r.examId === examId);
  if (!exam || !results.length) return null;
  const passMarkPct = (db.settings.get().passMark || 40);
  const scores = results.map((r) => r.score / r.total * 100);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const pass = scores.filter((p) => p >= passMarkPct).length;
  return {
    exam, attempts: results.length,
    avg, highest: Math.round(Math.max(...scores)), lowest: Math.round(Math.min(...scores)),
    passRate: Math.round((pass / results.length) * 100),
    failRate: 100 - Math.round((pass / results.length) * 100)
  };
}

/** Class performance from exam results, joined via student class. */
export function classPerformance() {
  const byClass = {};
  db.examResults.list().forEach((r) => {
    const student = db.students.find(r.studentId);
    const cls = student?.className || 'অজানা';
    (byClass[cls] = byClass[cls] || (byClass[cls] = { name: cls, total: 0, count: 0 }));
    byClass[cls].total += r.score / r.total * 100;
    byClass[cls].count += 1;
  });
  return Object.values(byClass).map((c) => ({ name: c.name, avg: Math.round(c.total / c.count) }));
}

export function leaderboard(examId = null) {
  let results = db.examResults.list();
  if (examId) results = results.filter((r) => r.examId === examId);
  const rows = results.map((r) => {
    const student = db.students.find(r.studentId);
    return { ...r, pct: Math.round(r.score / r.total * 100), className: student?.className || '—' };
  }).sort((a, b) => b.pct - a.pct);
  return rows.map((r, i) => ({ position: i + 1, ...r }));
}

/** Dashboard analytics rollup, all computed live from stored data. */
export function analytics() {
  const students = db.students.list();
  const fees = db.fees.list();
  const payments = db.payments.list();
  const due = dueFees();
  const today = todayBn();
  const dueTotal = due.reduce((s, d) => s + Number(d.amount || 0), 0);
  return {
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === 'সক্রিয়').length,
    inactiveStudents: students.filter((s) => s.status !== 'সক্রিয়').length,
    totalTeachers: db.teachers.list().length,
    activeBatches: db.batches.list().length,
    totalSubjects: db.subjects.list().length,
    upcomingExams: db.exams.list().length,
    pendingAssignments: db.assignments.list().filter((a) => !a.checked).length,
    publishedResults: db.examResults.list().length,
    todayCollection: payments.filter((p) => p.date === today).reduce((s, p) => s + Number(p.amount || 0), 0),
    monthlyCollection: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    totalDue: dueTotal,
    totalClasses: db.classes.list().filter((c) => c.active).length
  };
}

/** Backup export as a JSON string. */
export function exportBackup() {
  return JSON.stringify({ app: 'active-plus', version: DATA_VERSION, exportedAt: new Date().toISOString(), collections: load().collections }, null, 2);
}

/** Import/restore from a JSON backup string. Validates before applying. */
export function importBackup(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'অবৈধ JSON ফাইল।' }; }
  if (!parsed || parsed.app !== 'active-plus' || !parsed.collections) return { ok: false, error: 'এটি Active Plus ব্যাকআপ নয়।' };
  const known = ['settings', 'students', 'teachers', 'batches', 'notices', 'routine', 'attendance', 'results', 'fees', 'payments', 'suggestions', 'exams', 'examResults', 'classes', 'subjects', 'materials', 'assignments', 'submissions', 'notifications', 'activityLogs'];
  const collections = {};
  for (const key of known) if (Array.isArray(parsed.collections[key]) || (key === 'settings' && parsed.collections[key])) collections[key] = parsed.collections[key];
  const store = load();
  store.collections = { ...store.collections, ...clone(collections) };
  save(store);
  return { ok: true, restored: Object.keys(collections).length };
}

/** Parse pasted MCQ blocks:  Question / A. B. C. D. / Correct. */
export function parseMcqPaste(text) {
  const blocks = String(text).trim().split(/\n\s*\n/);
  const questions = [];
  const errors = [];
  blocks.forEach((block, bi) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const q = lines[0].replace(/^Q(uestion)?[:.)]?\s*/i, '');
    const opts = [];
    let answer = -1;
    for (const line of lines.slice(1)) {
      const om = line.match(/^([A-Da-d১-৪])[:.)]?\s*(.+)$/);
      const am = line.match(/^(?:সঠিক|Correct|Answer)[:.)]?\s*([A-Da-d১-৪])\b/i);
      if (am) { answer = 'abcdABCD১২৩৪'.indexOf(am[1]) % 4; }
      else if (om) opts.push(om[2]);
    }
    if (!q || opts.length < 2) { errors.push(`ব্লক ${bi + 1}: প্রশ্ন/অপশন অসম্পূর্ণ।`); return; }
    if (answer < 0) answer = 0;
    const key = 'abcdABCD১২৩৪'.indexOf; void key;
    questions.push({ q, options: opts.slice(0, 4), answer });
  });
  const dupes = [];
  const seen = new Set();
  const clean = questions.filter((q) => {
    const k = q.q.trim();
    if (seen.has(k)) { dupes.push(k); return false; }
    seen.add(k); return true;
  });
  return { questions: clean, errors, duplicates: dupes };
}

/** Export rows as CSV (for Excel/print workflows). */
export function toCSV(columns, rows) {
  const head = columns.map((c) => `"${String(c.label).replace(/"/g, '""')}"`).join(',');
  const body = rows.map((row) => columns.map((c) => {
    const value = c.render ? String(row[c.key] ?? '') : String(row[c.key] ?? '');
    return `"${value.replace(/"/g, '""')}"`;
  }).join(','));
  return [head, ...body].join('\n');
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Fast global search across key entities. */
export function globalSearch(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { students: [], teachers: [], exams: [], payments: [], notices: [] };
  const has = (v) => String(v || '').toLowerCase().includes(q);
  return {
    students: db.students.list().filter((s) => has(s.id) || has(s.name) || has(s.phone) || has(s.className)),
    teachers: db.teachers.list().filter((t) => has(t.name) || has(t.subject)),
    exams: db.exams.list().filter((e) => has(e.title) || has(e.subject)),
    payments: db.payments.list().filter((p) => has(p.studentId) || has(p.month)),
    notices: db.notices.list().filter((n) => has(n.title))
  };
}
