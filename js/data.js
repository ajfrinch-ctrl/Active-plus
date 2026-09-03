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
const DATA_VERSION = 5; // per-student fees, payments, suggestions, exams, class-targeted notices

export const CLASS_OPTIONS = ['অষ্টম', 'নবম', 'দশম', 'একাদশ', 'দ্বাদশ'];
export const CLASS_TO_NUMBER = { 'অষ্টম': 8, 'নবম': 9, 'দশম': 10, 'একাদশ': 11, 'দ্বাদশ': 12 };
export const ALL_CLASSES = 'সব';

const MONTH_AGO = 'আগস্ট ২০২৬';
const MONTH_NOW = 'সেপ্টেম্বর ২০২';

const SEED = {
  settings: {
    orgName: 'Active Plus Coaching',
    address: '২য় তলা, মদিনা প্লাজা, মিরপুর-১০, ঢাকা',
    monthlyFee: 1200
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
    { day: 'শনিবার', subject: 'গণিত', teacher: 'রাহেলা আক্তার', time: '০৮:০০ – ০৯:০০', room: 'কক্ষ ২০১' },
    { day: 'রবিবার', subject: 'পদার্থবিজ্ঞান', teacher: 'কামরুল ইসলাম', time: '০৯:০০ – ১০:০০', room: 'কক্ষ ১০৫' },
    { day: 'সোমবার', subject: 'রসায়ন', teacher: 'নুসরাত জাহান', time: '০৮:০০ – ০৯:০০', room: 'ল্যাব ১' },
    { day: 'মঙ্গলবার', subject: 'ইংরেজি', teacher: 'সাদিয়া রহমান', time: '১০:০০ – ১১:০০', room: 'কক্ষ ৩০২' },
    { day: 'বুধবার', subject: 'জীববিজ্ঞান', teacher: 'তানভীর আহমেদ', time: '০৯:০০ – ১০:০০', room: 'ল্যাব ২' }
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
  examResults: []
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
