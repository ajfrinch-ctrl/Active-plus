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
import { isFirebaseConfigured, ref as fbRef } from './firebase.js';

const DATA_KEY = 'activeplus_data';
export const DATA_VERSION = 7; // student home: tips, banners, study activity, daily challenge

export const CLASS_OPTIONS = ['অষ্টম', 'নবম', 'দশম', 'একাদশ', 'দ্বাদশ'];
export const CLASS_TO_NUMBER = { 'অষ্টম': 8, 'নবম': 9, 'দশম': 10, 'একাদশ': 11, 'দ্বাদশ': 12 };
export const ALL_CLASSES = 'সব';

const MONTH_AGO = 'আগস্ট ২০২৬';
const MONTH_NOW = 'সেপ্টেম্বর ২০২৬';

const SEED = {
  settings: {
    orgName: 'Active Plus Coaching',
    address: '২য় তলা, মদিনা প্লাজা, মিরপুর-১০, ঢাকা',
    mobile: '০১৭০০-০০০০০০',
    email: 'info@activeplus.edu',
    website: 'activeplus.edu',
    academicYear: '২০২৬',
    monthlyFee: 1200,
    admissionFee: 500,
    defaultExamDuration: 30,
    passMark: 40,
    dailyChallengeTarget: 10,
    homeFeatures: ['questionbank', 'progress', 'achievements', 'certificates', 'downloads',
      'query', 'streak', 'profile', 'settings', 'help'],
    studentEditableFields: ['phone'],
    negativeMarking: 0,
    leaderboardEnabled: true,
    autoPublishResult: false,
    notificationsEnabled: true,
    homeCards: {
      progress: true, nextClass: true, exam: true, challenge: true, materials: true,
      assignments: true, performance: true, achievements: true, fee: true,
      banners: true, tip: true, notices: true, leaderboard: true
    }
  },
  students: [
    { id: '2026-09-001', name: 'আরিয়ান হাসান', className: 'নবম', section: 'A', batch: 'A', roll: '০১', phone: '০১৭১১-০০০০০১', school: 'মিরপুর বেঙ্গল উচ্চ বিদ্যালয়', status: 'সক্রিয়', guardian: 'করিম হাসান', guardianPhone: '০১৮১১-০০০০০১', admissionDate: '২০২৬-০১-০৫', photo: '' },
    { id: '2026-09-002', name: 'সুমাইয়া ইসলাম', className: 'নবম', section: 'A', batch: 'A', roll: '০২', phone: '০১৭১১-০০০০০২', school: 'ভিকারুননিসা নূন স্কুল অ্যান্ড কলেজ', status: 'সক্রিয়', guardian: 'জাহিদ ইসলাম', guardianPhone: '০১৮১১-০০০০০২', admissionDate: '২০২৬-০১-০৫', photo: '' },
    { id: '2026-10-014', name: 'নাফিস ইকবাল', className: 'দশম', section: 'B', batch: 'B', roll: '১৪', phone: '০১৭১১-০০০০১৪', school: 'মতিঝিল সরকারি বালক উচ্চ বিদ্যালয়', status: 'বকেয়া', guardian: 'ইকবাল হোসেন', guardianPhone: '০১৮১১-০০০০১৪', admissionDate: '২০২৬-০১-০৮', photo: '' },
    { id: '2026-08-007', name: 'তাসনিম জাহান', className: 'অষ্টম', section: 'A', batch: 'A', roll: '০৭', phone: '০১৭১১-০০০০০৭', school: 'লালমাটিয়া বালিকা বিদ্যালয়', status: 'সক্রিয়', guardian: 'জাহান আলম', guardianPhone: '০১৮১১-০০০০০৭', admissionDate: '২০২৬-০১-১০', photo: '' }
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
    { id: 'n-2', title: 'সেপ্টেম্বর মাসের বেতন পরিশোধের শেষ তারিখ ১০ সেপ্টেম্বর', date: '২০২৬-০৮-২৮', audience: 'অভিভাবক', className: ALL_CLASSES },
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
    { date: '২০২৬-০৯-০১', subject: 'গণিত', status: 'উপস্থিত' },
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
    { id: 'fee-007-now', studentId: '2026-08-007', month: MONTH_NOW, amount: 1200, status: 'পরিশোধিত', date: '২০২৬-০৯-০১' }
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
      author: 'কামরুল ইসলাম', date: '২০২৬-০৯-০২', time: '১৭:০০',
      duration: 30, startDate: '২০২৬-০৯-০১', endDate: '২০২৬-০৯-৩০',
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
    { id: 'subm-1', assignmentId: 'asg-1', studentId: '2026-09-001', status: 'জমা হয়েছে', date: '২০২৬-০৯-০৩', feedback: '' }
  ],
  notifications: [
    { id: 'ntf-1', type: 'সাধারণ', title: 'সিস্টেম চালু হয়েছে', target: 'সবাই', date: '২০২৬-০৯-০১', createdAt: new Date().toISOString(), read: false }
  ],
  activityLogs: [],
  tips: [
    { id: 'tip-1', text: 'প্রতিদিন কমপক্ষে ৩০ মিনিট গণিত অনুশীলন কর।', active: true, by: 'কামরুল ইসলাম', date: '২০২৬-০৯-০১' }
  ],
  banners: [
    { id: 'ban-1', title: 'গ্র্যান্ড মডেল টেস্ট ২০২৬', desc: 'সব ক্লাসের জন্য বৃহৎ মডেল টেস্ট — নিবন্ধন চলছে।', cta: 'নোটিশ দেখুন', active: true, date: '২০২৬-০৯-০১' }
  ],
  materialProgress: [],
  studyActivity: [],
  challenge: []
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

let applyingRemote = false;
let remoteTransport = null; // injectable (tests / alternate backends)

/* Sync bookkeeping — surfaced by getDbStatus(), never credentials. */
const syncState = { lastSync: null, pending: 0, error: null };

/** Test/host hook: replace the remote transport. */
export function _setRemoteTransport(fn) { remoteTransport = fn; }

/**
 * Database status for the dashboard: connected / disconnected, last sync time,
 * pending writes and whether the last mirror attempt failed. No keys, no
 * config values — nothing sensitive is ever exposed.
 */
export function getDbStatus() {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const configured = !!remoteTransport || isFirebaseConfigured();
  return {
    configured,
    connected: online && configured && !syncState.error,
    online,
    mode: configured ? 'firebase' : 'local',
    lastSync: syncState.lastSync,
    pending: syncState.pending,
    error: syncState.error ? 'sync-failed' : null
  };
}

/** Mirror the single store to Firebase when it is configured (never a 2nd DB). */
function pushRemote(store) {
  if (applyingRemote) return;
  const transport = remoteTransport || (isFirebaseConfigured()
    ? (payload) => { const r = fbRef('activeplus/data'); return r?.set ? r.set(payload).catch(() => null) : null; }
    : null);
  if (!transport) return;
  syncState.pending += 1;
  try {
    const result = transport(store);
    const done = () => { syncState.pending = Math.max(0, syncState.pending - 1); syncState.lastSync = new Date().toISOString(); syncState.error = null; };
    if (result && typeof result.then === 'function') result.then(done, () => { syncState.error = 'sync-failed'; syncState.pending = Math.max(0, syncState.pending - 1); });
    else done();
  } catch (e) {
    // Offline or blocked — the local copy still works; report it honestly.
    syncState.error = 'sync-failed';
    syncState.pending = Math.max(0, syncState.pending - 1);
  }
}

function save(store) {
  writeJSON(DATA_KEY, store);
  pushRemote(store);
}

/**
 * Live updates when Firebase is the backend. Returns an unsubscribe function,
 * or null in local mode (nothing to subscribe to).
 */
export function subscribeRemote(onSnapshot) {
  if (!isFirebaseConfigured()) return null;
  const r = fbRef('activeplus/data');
  if (!r || typeof r.on !== 'function') return null;
  const handler = (snap) => {
    const value = typeof snap?.val === 'function' ? snap.val() : snap;
    if (!value || !value.collections) return;
    applyingRemote = true;
    writeJSON(DATA_KEY, value);
    applyingRemote = false;
    if (onSnapshot) onSnapshot(value);
  };
  r.on('value', handler);
  return () => (typeof r.off === 'function' ? r.off('value', handler) : undefined);
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
  routine: makeCollection('routine', { keyField: 'id' }),
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
  tips: makeCollection('tips', { keyField: 'id' }),
  banners: makeCollection('banners', { keyField: 'id' }),
  materialProgress: makeCollection('materialProgress', { keyField: 'id' }),
  studyActivity: makeCollection('studyActivity', { keyField: 'date' }),
  challenge: makeCollection('challenge', { keyField: 'date' }),

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
      // No \b here: Bengali digits are not \w, so a word boundary never matches
      // after them and the answer line would be silently ignored.
      const am = line.match(/^(?:সঠিক|Correct|Answer)[:.)]?\s*([A-Da-d১-৪])(?![A-Da-d১-৪])/i);
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
/**
 * Parse an MCQ spreadsheet export (CSV) into question objects.
 *
 * Shared by the admin and teacher question banks so both behave identically.
 * Returns valid rows plus the 1-based line numbers that were rejected, so the
 * UI can show an invalid-row report before anything is imported.
 */
export function parseMcqCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const questions = [];
  const invalidRows = [];
  const ansMap = { A: 0, B: 1, C: 2, D: 3 };
  // skip a header row when present
  const body = /^[A-Za-z]/.test(lines[0] || '') && /question|প্রশ্ন/i.test(lines[0] || '') ? lines.slice(1) : lines;
  const offset = lines.length - body.length;
  body.forEach((line, i) => {
    const cells = (line.match(/("([^"]*)"|[^,]+)(,|$)/g) || [])
      .map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim());
    const [q, a, b, c, d, correct] = cells;
    const key = String(correct || '').trim().toUpperCase();
    if (!q || !a || !b || !c || !d || !(key in ansMap)) { invalidRows.push(i + offset + 1); return; }
    questions.push({ q, options: [a, b, c, d], answer: ansMap[key] });
  });
  const seen = new Set();
  const duplicates = [];
  const clean = questions.filter((item) => {
    const k = item.q.trim();
    if (seen.has(k)) { duplicates.push(k); return false; }
    seen.add(k);
    return true;
  });
  return { questions: clean, invalidRows, duplicates };
}

/**
 * Serialise rows to CSV.
 *
 * Columns whose value only exists through render() (counts, pass/fail, badges)
 * must still export — an earlier version read row[key] on both branches, so
 * every computed column came out blank in the downloaded file. render() returns
 * HTML, so tags and entities are reduced to plain text first.
 */
export function toCSV(columns, rows) {
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const plain = (html) => String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => {
    const value = typeof c.render === 'function' ? plain(c.render(row)) : (row[c.key] ?? '');
    return cell(value);
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
/**
 * Global search — results are scoped to what the caller may see (spec 58).
 *
 * admin    → everything
 * teacher  → only their own classes; never fees/payments
 * student  → only their own record, their class notices and shared material
 *
 * Passing no session behaves like the most restricted role, so a missing
 * session can never widen the result set.
 */
export function globalSearch(query, session = null) {
  const q = String(query || '').trim().toLowerCase();
  const empty = { students: [], teachers: [], exams: [], payments: [], notices: [], materials: [] };
  if (!q) return empty;
  const has = (v) => String(v || '').toLowerCase().includes(q);
  const role = session?.role || 'student';

  if (role === 'admin') {
    return {
      students: db.students.list().filter((s) => has(s.id) || has(s.name) || has(s.phone) || has(s.className)),
      teachers: db.teachers.list().filter((t) => has(t.name) || has(t.subject)),
      exams: db.exams.list().filter((e) => has(e.title) || has(e.subject)),
      payments: can('admin', 'viewFinance') ? db.payments.list().filter((p) => has(p.studentId) || has(p.month)) : [],
      notices: db.notices.list().filter((n) => has(n.title)),
      materials: db.materials.list().filter((m) => has(m.title) || has(m.subject))
    };
  }

  if (role === 'teacher') {
    const mine = teacherProfile(session.name).classNames;
    return {
      students: teacherStudents(session.name).filter((s) => has(s.id) || has(s.name) || has(s.roll)),
      teachers: [],
      exams: db.exams.list().filter((e) => mine.includes(e.className) && (has(e.title) || has(e.subject))),
      payments: [], // teachers never see finance
      notices: db.notices.list().filter((n) => (n.className === ALL_CLASSES || mine.includes(n.className)) && has(n.title)),
      materials: db.materials.list().filter((m) => mine.includes(m.className) && (has(m.title) || has(m.subject)))
    };
  }

  // Student (or unknown role): own record and own class only.
  const me = db.students.find(session?.username) || db.students.find(session?.uid);
  const myClass = me?.className;
  return {
    students: me && (has(me.id) || has(me.name)) ? [me] : [],
    teachers: [],
    exams: db.exams.list().filter((e) => e.className === myClass && has(e.title)),
    payments: [],
    notices: me ? noticesFor(me).filter((n) => has(n.title)) : [],
    materials: db.materials.list().filter((m) => m.className === myClass && has(m.title))
  };
}
/* ------------------------------------------------------------------ */
/* Student Home helpers — all computed live from stored data           */
/* ------------------------------------------------------------------ */
export const DAY_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

export function greetingByHour(hour = new Date().getHours()) {
  if (hour < 12) return 'শুভ সকাল';
  if (hour < 17) return 'শুভ দুপুর';
  return 'শুভ সন্ধ্যা';
}

export function recordStudyActivity(kind = 'mcq', count = 1, materialId = null) {
  const date = todayBn();
  const entry = db.studyActivity.find(date) || { date, mcqs: 0, views: 0 };
  if (kind === 'mcq') entry.mcqs += count; else entry.views += count;
  if (materialId) entry.lastMaterial = materialId;
  if (db.studyActivity.find(date)) db.studyActivity.update(date, entry); else db.studyActivity.add(entry);
  return entry;
}

/** The material the student opened most recently (for "Continue Learning"). */
export function lastAccessedMaterial() {
  const row = [...db.studyActivity.list()].reverse().find((a) => a.lastMaterial);
  if (!row) return null;
  return db.materials.find(row.lastMaterial);
}

/** Consecutive-day study streak ending today or yesterday (never inflated). */
export function studyStreak() {
  const dates = new Set(db.studyActivity.list().map((a) => a.date));
  const iso = new Date();
  // If no activity today, streak counts up to yesterday.
  if (!dates.has(todayBn())) iso.setDate(iso.getDate() - 1);
  let streak = 0;
  for (;;) {
    const d = iso.toISOString().slice(0, 10).replace(/\d/g, (x) => '০১২৩৪৫৬৭৮৯'[x]);
    if (!dates.has(d)) break;
    streak += 1;
    iso.setDate(iso.getDate() - 1);
  }
  const week = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10).replace(/\d/g, (x) => '০১২৩৪৫৬৭৮৯'[x]);
    week.push({ day: DAY_BN[d.getDay()].slice(0, 1), done: dates.has(key) });
  }
  return { streak, week };
}

/** Today's tasks & completion, from routine + assignments + challenge. */
export function todayProgress(student) {
  const today = DAY_BN[new Date().getDay()];
  const classes = db.routine.list().filter((r) => r.day === today && (!student || true));
  const dueAssignments = db.assignments.list().filter((a) => a.className === student?.className);
  const submitted = db.submissions.list().filter((s) => s.studentId === student?.id).map((s) => s.assignmentId);
  const challenge = db.challenge.find(todayBn());
  const total = classes.length + dueAssignments.length + 1; // +1 daily challenge
  const done =
    classes.length + // counting scheduled classes as today's plan
    dueAssignments.filter((a) => submitted.includes(a.id)).length +
    (challenge && challenge.done >= challenge.target ? 1 : 0);
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return { done, total, pct, classes: classes.length, assignments: dueAssignments.length };
}

/** Next scheduled class: today if any remain, else tomorrow, else null. */
export function nextClass() {
  const now = new Date();
  const todays = db.routine.list().filter((r) => r.day === DAY_BN[now.getDay()]);
  if (todays.length) return { when: 'আজ', item: todays[0] };
  // Scan the coming week for the next day that actually has a class.
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const hits = db.routine.list().filter((r) => r.day === DAY_BN[d.getDay()]);
    if (hits.length) return { when: i === 1 ? 'আগামীকাল' : DAY_BN[d.getDay()], item: hits[0] };
  }
  return null;
}

export function upcomingExam(className) {
  return examsFor(className)[0] || null;
}

/** Daily challenge state (10 MCQs/day), progress stored per date. */
export function challengeState() {
  const date = todayBn();
  const target = Number(db.settings.get().dailyChallengeTarget) || 10;
  const entry = db.challenge.find(date) || { date, done: 0, target };
  return { ...entry, target }; // target always reflects the current admin setting
}
export function addChallengeProgress(n = 1) {
  const entry = challengeState();
  entry.done = Math.min(entry.target, entry.done + n);
  if (db.challenge.find(entry.date)) db.challenge.update(entry.date, { done: entry.done });
  else db.challenge.add(entry);
  return entry;
}

/** Performance summary from this student's exam results. */
export function performanceFor(student) {
  const results = db.examResults.list().filter((r) => r.studentId === student?.id);
  if (!results.length) return null;
  const pcts = results.map((r) => Math.round(r.score / r.total * 100));
  const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  const best = Math.max(...pcts);
  const rank = leaderboard().find((r) => r.studentId === student?.id)?.position || '—';
  return { avg, best, tests: results.length, rank, series: pcts.slice(-6) };
}

export function feeStatusFor(student) {
  const fees = db.fees.list().filter((f) => f.studentId === student?.id);
  const total = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
  const paid = fees.filter((f) => f.status === 'পরিশোধিত').reduce((s, f) => s + Number(f.amount || 0), 0);
  const due = total - paid;
  const nextDue = fees.find((f) => f.status === 'বকেয়া');
  return { total, paid, due, nextDue };
}

/** Only badges the student has actually earned. */
export function achievementsFor(student) {
  const perf = performanceFor(student);
  const { streak } = studyStreak();
  const mcqs = db.studyActivity.list().reduce((s, a) => s + a.mcqs, 0);
  const badges = [];
  if (streak >= 7) badges.push({ icon: '🔥', name: `${streak} দিন স্ট্রিক` });
  if (mcqs >= 100) badges.push({ icon: '🎯', name: '১০০ MCQ সম্পন্ন' });
  if (completedMaterialIds(student).length >= 10) badges.push({ icon: '📚', name: '১০ ম্যাটেরিয়াল সম্পন্ন' });
  if (perf && perf.best >= 90) badges.push({ icon: '🏆', name: '৯০%+ স্কোর' });
  if (perf && perf.best === 100) badges.push({ icon: '⭐', name: 'পারফেক্ট স্কোর' });
  if (perf && perf.rank === 1) badges.push({ icon: '🥇', name: 'টপার' });
  return badges;
}

/**
 * Incoming alerts for the admin (spec 43): activity-log entries newer than the
 * last time the admin looked. `since` is a millisecond timestamp.
 */
export function adminAlerts(since = 0) {
  // logActivity() stamps entries with `timestamp`.
  return activityLogs().filter((l) => new Date(l.timestamp || l.at || 0).getTime() > since);
}

/** Unread notifications addressed to teachers (spec 57). */
export function teacherUnreadCount() {
  return db.notifications.list().filter((n) => !n.read && (n.target === 'শিক্ষক' || n.target === 'সবাই')).length;
}

/** Mark every teacher-directed notification as read. */
export function markTeacherNotificationsRead() {
  db.notifications.list()
    .filter((n) => !n.read && (n.target === 'শিক্ষক' || n.target === 'সবাই'))
    .forEach((n) => db.notifications.update(n.id, { read: true }));
}

export function unreadNotifications(student) {
  return db.notifications.list().filter((n) => !n.read && (n.target === 'সবাই' || n.target === 'শিক্ষার্থী')).length
    + noticesFor(student).filter((n) => n.forStudent === student?.id && !n.read).length;
}

export function latestTip() {
  return db.tips.list().filter((t) => t.active).slice(-1)[0] || null;
}
export function activeBanners() {
  return db.banners.list().filter((b) => b.active);
}

/* ---------------- Home: exam window + assignment status ---------------- */

/**
 * Bengali digits to ASCII digits, so a time written as ০৮:০০ can be compared
 * with a clock value. Comparing them raw is always true — U+09E6 outranks the
 * ASCII digits — which made every finished class look upcoming.
 */
function bnDigitsToAscii(text) {
  return String(text || '').replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09E6));
}

function bnToIso(text) {
  const ascii = bnDigitsToAscii(text);
  const m = ascii.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Is an exam open right now? Drives View Exam vs Start Exam (never both). */
export function examWindow(exam) {
  if (!exam) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = bnToIso(exam.startDate);
  const end = bnToIso(exam.endDate);
  if (start && today < start) return { state: 'upcoming', label: exam.date || '', canStart: false };
  if (end && today > end) return { state: 'closed', label: 'সময় শেষ', canStart: false };
  return { state: 'active', label: exam.date || 'চলমান', canStart: true };
}

/** Pending / submitted / checked / overdue + human due label. */
export function assignmentStatus(assignment, student) {
  const sub = db.submissions.list().find((s) => s.assignmentId === assignment.id && s.studentId === student?.id);
  const due = bnToIso(assignment.deadline);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = due ? Math.round((due - today) / 86400000) : null;
  if (sub) return { status: sub.status === 'চেক হয়েছে' ? 'checked' : 'submitted', daysLeft, sub };
  if (daysLeft !== null && daysLeft < 0) return { status: 'overdue', daysLeft, sub: null };
  return { status: 'pending', daysLeft, sub: null };
}

export function dueLabel(assignment) {
  const { status, daysLeft } = assignmentStatus(assignment, arguments[1]);
  if (status === 'submitted' || status === 'checked') return assignment.deadline;
  if (daysLeft === null) return assignment.deadline;
  if (daysLeft < 0) return 'সময় পার হয়েছে';
  if (daysLeft === 0) return 'আজই জমা দিন';
  if (daysLeft === 1) return 'আগামীকাল শেষ';
  return `${daysLeft} দিন বাকি`;
}

/** Newest notifications/announcements for the home preview strip. */
export function latestNotifications(student, limit = 2) {
  const all = [
    ...db.notifications.list().filter((n) => n.target === 'সবাই' || n.target === 'শিক্ষার্থী')
      .map((n) => ({ id: n.id, title: n.title, body: n.type || 'নোটিফিকেশন', date: n.date, createdAt: n.createdAt, read: !!n.read })),
    ...noticesFor(student).filter((n) => n.forStudent === student?.id)
      .map((n) => ({ id: n.id, title: n.title, body: n.type || 'ঘোষণা', date: n.date, read: !!n.read }))
  ];
  return all.slice(-limit).reverse();
}

/* ---------------- Assignment submission flow ---------------- */

/** Student submits (or resubmits) an assignment. Returns the stored row. */
export function submitAssignment(assignment, student, note = '') {
  if (!assignment || !student) return null;
  const existing = db.submissions.list()
    .find((s) => s.assignmentId === assignment.id && s.studentId === student.id);
  const payload = {
    assignmentId: assignment.id, studentId: student.id, studentName: student.name,
    status: 'জমা হয়েছে', date: todayBn(), feedback: '', note: String(note || '')
  };
  if (existing) { db.submissions.update(existing.id, payload); return db.submissions.find(existing.id); }
  const row = { id: newId('subm'), ...payload };
  db.submissions.add(row);
  return row;
}

/** Teacher/admin marks a submission checked, optionally with feedback. */
export function checkSubmission(submissionId, feedback = '', marks = null) {
  const row = db.submissions.find(submissionId);
  if (!row) return null;
  const patch = { status: 'চেক হয়েছে', feedback: String(feedback || ''), checkedDate: todayBn() };
  if (marks !== null && marks !== undefined && marks !== '' && Number.isFinite(Number(marks))) {
    patch.marks = Number(marks);
  }
  db.submissions.update(submissionId, patch);
  return db.submissions.find(submissionId);
}

/** Submissions for a class (teachers/admins reviewing work). */
export function submissionsFor(className) {
  const ids = db.assignments.list().filter((a) => a.className === className).map((a) => a.id);
  return db.submissions.list().filter((s) => ids.includes(s.assignmentId));
}

/* ---------------- Material completion (drives Continue Learning progress) ---------------- */

/** Marks a material finished for one student (idempotent). */
export function markMaterialComplete(materialId, student) {
  if (!materialId || !student?.id) return null;
  const id = `${student.id}:${materialId}`;
  const existing = db.materialProgress.find(id);
  if (existing) return existing;
  const row = { id, studentId: student.id, materialId, date: todayBn() };
  db.materialProgress.add(row);
  return row;
}

export function completedMaterialIds(student) {
  return db.materialProgress.list().filter((r) => r.studentId === student?.id).map((r) => r.materialId);
}

/** Honest progress: completed materials out of the materials assigned to this class. */
export function materialProgressFor(student, className) {
  const total = db.materials.list().filter((m) => !m.className || m.className === className).length;
  const done = completedMaterialIds(student).filter((id) =>
    db.materials.list().some((m) => m.id === id && (!m.className || m.className === className))).length;
  return { done, total, pct: total ? Math.min(100, Math.round((done / total) * 100)) : 0 };
}

/* ---------------- Relative time for notification previews ---------------- */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toBnNum = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/** "এইমাত্র / ৫ মিনিট আগে / ৩ ঘণ্টা আগে / ২ দিন আগে", else the stored date. */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return 'এইমাত্র';
  if (mins < 60) return `${toBnNum(mins)} মিনিট আগে`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${toBnNum(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${toBnNum(days)} দিন আগে`;
  return '';
}

/* ---------------- Which secondary features students see (spec 6/39) ---------------- */
export function homeFeatures() {
  const stored = db.settings.get().homeFeatures;
  return Array.isArray(stored) ? stored : SEED.settings.homeFeatures;
}
export function setHomeFeatures(list) {
  const next = Array.isArray(list) ? [...new Set(list)] : SEED.settings.homeFeatures;
  db.settings.update({ homeFeatures: next });
  return next;
}

/* ================================================================== */
/* Role permissions — enforced here, not just hidden in the UI          */
/* ================================================================== */

/** Every independently configurable permission (spec 46). */
export const PERMISSIONS = [
  'viewStudents', 'addStudents', 'editStudents', 'deleteStudents',
  'viewTeachers', 'addTeachers', 'editTeachers',
  'manageClasses', 'manageBatches', 'manageSubjects',
  'manageExams', 'manageQuestions', 'publishResults',
  'manageMaterials', 'manageAssignments', 'manageRoutine',
  'viewFinance', 'managePayments', 'viewReports',
  'manageNotices', 'manageNotifications',
  'manageUsers', 'manageSettings', 'backup'
];

/** What each role may do unless an admin narrows it. */
export const DEFAULT_PERMISSIONS = {
  admin: [...PERMISSIONS],
  teacher: [
    'viewStudents', 'manageExams', 'manageQuestions', 'publishResults',
    'manageMaterials', 'manageAssignments', 'manageNotices'
  ],
  student: []
};

/**
 * Permission check. Admins hold everything; teachers follow the matrix the
 * admin configured; students hold no management permission at all.
 */
export function can(role, permission) {
  if (!role || !permission) return false;
  if (role === 'admin') return true;
  const matrix = db.settings.get().permissions || {};
  const list = Array.isArray(matrix[role]) ? matrix[role] : DEFAULT_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

/** Throw unless the session may perform the action — used by every mutator. */
export function assertCan(session, permission, action = permission) {
  if (can(session?.role, permission)) return true;
  const err = new Error(`এই কাজের অনুমতি নেই: ${action}`);
  err.code = 'FORBIDDEN';
  throw err;
}

/** A teacher may only ever touch classes actually assigned to them. */
export function teacherCanAccessClass(session, className) {
  if (session?.role === 'admin') return true;
  if (session?.role !== 'teacher') return false;
  return teacherProfile(session.name).classNames.includes(className);
}

/* ================================================================== */
/* Teacher dashboard — everything derived from the teacher's own rows   */
/* ================================================================== */

/** Class names a batch name refers to, e.g. "নবম (বিজ্ঞান)" → নবম. */
export function classesInBatch(batchName = '') {
  return CLASS_OPTIONS.filter((c) => String(batchName).includes(c));
}

/** The teacher record plus the classes/batches/routine assigned to them. */
export function teacherProfile(name) {
  const record = db.teachers.find(name) || { name };
  const batches = db.batches.list().filter((b) => b.teacher === name);
  const classNames = [...new Set(batches.flatMap((b) => classesInBatch(b.name)))];
  const routine = db.routine.list().filter((r) => r.teacher === name);
  routine.forEach((slot) => classesInBatch(slot.subject).forEach((c) => {
    if (!classNames.includes(c)) classNames.push(c);
  }));
  return { ...record, name, batches, classNames, routine };
}

/** Students in the classes this teacher is assigned to — nothing else. */
export function teacherStudents(name) {
  const { classNames } = teacherProfile(name);
  return db.students.list().filter((s) => classNames.includes(s.className));
}

/** Routine slots for a teacher on a given day (defaults to today). */
export function teacherDayClasses(name, day = DAY_BN[new Date().getDay()]) {
  return db.routine.list()
    .filter((r) => r.teacher === name && r.day === day)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/** Assignments set for this teacher's classes that still need checking. */
export function teacherPendingAssignments(name) {
  const { classNames } = teacherProfile(name);
  return db.assignments.list().filter((a) => classNames.includes(a.className) && !a.checked);
}

/** Exams for this teacher's classes that are open or upcoming. */
export function teacherExams(name) {
  const { classNames } = teacherProfile(name);
  return db.exams.list().filter((e) => classNames.includes(e.className));
}

/** Results for this teacher's exams that have not been published yet. */
export function teacherPendingResults(name) {
  const ids = new Set(teacherExams(name).map((e) => e.id));
  return db.examResults.list().filter((r) => ids.has(r.examId) && !r.published);
}

/** Materials this teacher may publish to (their own classes only). */
export function teacherMaterials(name) {
  const { classNames } = teacherProfile(name);
  return db.materials.list().filter((m) => classNames.includes(m.className));
}

/** Hero numbers for "Today's Teaching" — all computed, never hard-coded. */
export function todayTeaching(name) {
  const classes = teacherDayClasses(name);
  const students = teacherStudents(name);
  return {
    classes: classes.length,
    students: students.length,
    assignments: teacherPendingAssignments(name).length,
    exams: teacherExams(name).length,
    results: teacherPendingResults(name).length
  };
}

/** Next class today for this teacher, or null when the day is finished. */
export function teacherNextClass(name) {
  const slots = teacherDayClasses(name);
  if (!slots.length) return null;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const upcoming = slots.find((slot) => {
    const start = bnDigitsToAscii(String(slot.time || '').split(/[–-]/)[0].trim().replace('.', ':'));
    return start >= hhmm;
  });
  return upcoming || null;
}

/** Aggregate performance across this teacher's own students. */
export function teacherPerformance(name) {
  const ids = new Set(teacherStudents(name).map((s) => s.id));
  const results = db.examResults.list().filter((r) => ids.has(r.studentId));
  if (!results.length) return null;
  const pcts = results.map((r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100));
  const passMark = Number(db.settings.get().passMark) || 40;
  const passed = pcts.filter((p) => p >= passMark).length;
  const total = pcts.length;
  const assignments = db.assignments.list().filter((a) => ids.size && teacherProfile(name).classNames.includes(a.className));
  const submissions = db.submissions.list().filter((s) => ids.has(s.studentId));
  return {
    avg: Math.round(pcts.reduce((a, b) => a + b, 0) / total),
    best: Math.max(...pcts),
    lowest: Math.min(...pcts),
    passRate: Math.round(passed / total * 100),
    failRate: 100 - Math.round(passed / total * 100),
    tests: total,
    assignmentCompletion: assignments.length ? Math.round(submissions.length / assignments.length * 100) : 0,
    examParticipation: ids.size ? Math.round(new Set(results.map((r) => r.studentId)).size / ids.size * 100) : 0
  };
}

/** Admissions grouped by month, oldest first — the student growth trend. */
export function admissionTrend(limit = 6) {
  const byMonth = {};
  db.students.list().forEach((st) => {
    const key = String(st.admissionDate || '').slice(0, 7);
    if (key) byMonth[key] = (byMonth[key] || 0) + 1;
  });
  return Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([month, count]) => ({ month, count }));
}

/** Fee collection grouped by month, oldest first. */
export function collectionTrend(limit = 6) {
  const byMonth = {};
  db.payments.list().forEach((p) => {
    const key = String(p.date || '').slice(0, 7);
    if (key) byMonth[key] = (byMonth[key] || 0) + Number(p.amount || 0);
  });
  return Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([month, amount]) => ({ month, amount }));
}

/** Outstanding dues grouped by month. */
export function dueTrend(limit = 6) {
  const byMonth = {};
  dueFees().forEach((d) => {
    const key = String(d.month || 'অজানা');
    byMonth[key] = (byMonth[key] || 0) + Number(d.amount || 0);
  });
  return Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([month, amount]) => ({ month, amount }));
}

/** Average exam percentage per subject, from real results. */
export function subjectPerformance() {
  const bySubject = {};
  db.examResults.list().forEach((r) => {
    const exam = db.exams.find(r.examId);
    const subject = exam?.subject || 'অজানা';
    (bySubject[subject] = bySubject[subject] || { subject, total: 0, count: 0 });
    bySubject[subject].total += (Number(r.score) || 0) / (Number(r.total) || 1) * 100;
    bySubject[subject].count += 1;
  });
  return Object.values(bySubject)
    .map((s) => ({ subject: s.subject, avg: Math.round(s.total / s.count), count: s.count }))
    .sort((a, b) => b.avg - a.avg);
}

/** Overall pass/fail split against the configured pass mark. */
export function passRate() {
  const results = db.examResults.list();
  if (!results.length) return null;
  const mark = Number(db.settings.get().passMark) || 40;
  const pcts = results.map((r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100));
  const passed = pcts.filter((p) => p >= mark).length;
  return {
    total: pcts.length,
    passed,
    failed: pcts.length - passed,
    passPercent: Math.round(passed / pcts.length * 100),
    failPercent: 100 - Math.round(passed / pcts.length * 100),
    passMark: mark
  };
}

/* ================================================================== */
/* Admin dashboard                                                     */
/* ================================================================== */

/** Recent, human-readable activity drawn from real records. */
export function recentActivity(limit = 6) {
  const items = [];
  db.students.list().forEach((s) => items.push({
    icon: '🎓', text: `নতুন শিক্ষার্থী ভর্তি: ${s.name}`, meta: `${s.className} · ${s.admissionDate || ''}`,
    at: s.admissionDate || ''
  }));
  db.payments.list().forEach((p) => items.push({
    icon: '💰', text: `পেমেন্ট গ্রহণ: ${p.studentId || ''}`, meta: `${p.amount || 0} টাকা · ${p.date || ''}`,
    at: p.date || ''
  }));
  db.exams.list().forEach((e) => items.push({
    icon: '📝', text: `পরীক্ষা তৈরি: ${e.title}`, meta: `${e.className || ''} · ${e.startDate || ''}`,
    at: e.startDate || ''
  }));
  db.activityLogs.list().forEach((l) => items.push({
    icon: '🧾', text: `${l.user || 'system'} — ${l.action || ''}`, meta: l.target || '', at: l.date || ''
  }));
  return items
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

/* ---------------- Home card visibility (admin controlled) ---------------- */
export function homeCards() {
  const defaults = SEED.settings.homeCards;
  const stored = (db.settings.get().homeCards) || {};
  return { ...defaults, ...stored };
}
export function setHomeCards(patch) {
  const next = { ...homeCards(), ...patch };
  db.settings.update({ homeCards: next });
  return next;
}

