/**
 * The demo institute — sample records for the test suite (and for anyone who
 * deliberately wants a populated look at the app).
 *
 * `js/data.js` seeds an EMPTY store: a real coaching centre opens to its own
 * settings, class list and subject list and nothing else. Everything below is
 * therefore fake — four students, four teachers, a month of fees, an open MCQ
 * exam — and **no page imports this file**. The test suite loads it explicitly
 * through `tests/helpers/demo.mjs` (`loadDemoData()` for the records,
 * `loadDemo()` when a sign-in is needed too).
 *
 * Dates are derived from today on purpose: a hard-coded deadline rots within
 * days and turns every "pending" assignment into "overdue".
 */

import { db, BN_MONTHS, ALL_CLASSES, toBnDigits } from './data.js';

/* ------------------------------------------------------------------ */
/* Today-relative dates                                                */
/* ------------------------------------------------------------------ */

function seedDay(date) {
  return toBnDigits(date.toISOString().slice(0, 10));
}

/** A Bengali ISO date `offsetDays` away from today. */
function daysFromNow(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return seedDay(d);
}

/** A day in a month relative to this one, clamped so it never lands in the future. */
function monthDay(monthOffset, day) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  if (d.getTime() > now.getTime()) d.setTime(now.getTime());
  return seedDay(d);
}

/** 'সেপ্টেম্বর ২০২৬' for a month relative to this one. */
function monthLabel(monthOffset = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
  return `${BN_MONTHS[d.getUTCMonth()]} ${toBnDigits(d.getUTCFullYear())}`;
}

const MONTH_AGO = monthLabel(-1);
const MONTH_NOW = monthLabel(0);

/* ------------------------------------------------------------------ */
/* The records                                                         */
/* ------------------------------------------------------------------ */

export const DEMO = {
  students: [
    { id: '2026-09-001', name: 'আরিয়ান হাসান', className: 'নবম', section: 'A', batch: 'A', roll: '০১', phone: '০১৭১১-০০০০০১', school: 'মিরপুর বেঙ্গল উচ্চ বিদ্যালয়', status: 'সক্রিয়', guardian: 'করিম হাসান', guardianPhone: '০১৮১১-০০০০০১', admissionDate: '২০২৬-০১-০৫', photo: '' },
    { id: '2026-09-002', name: 'সুমাইয়া ইসলাম', className: 'নবম', section: 'A', batch: 'A', roll: '০২', phone: '০১৭১১-০০০০০২', school: 'ভিকারুননিসা নূন স্কুল অ্যান্ড কলেজ', status: 'সক্রিয়', guardian: 'জাহিদ ইসলাম', guardianPhone: '০১৮১১-০০০০০২', admissionDate: '২০২৬-০১-০৫', photo: '' },
    { id: '2026-10-014', name: 'নাফিস ইকবাল', className: 'দশম', section: 'B', batch: 'B', roll: '১৪', phone: '০১৭১১-০০০০১৪', school: 'মতিঝিল সরকারি বালক উচ্চ বিদ্যালয়', status: 'বকেয়া', guardian: 'ইকবাল হোসেন', guardianPhone: '০১৮১১-০০০০১৪', admissionDate: '২০২৬-০১-০৮', photo: '' },
    { id: '2026-08-007', name: 'তাসনিম জাহান', className: 'অষ্টম', section: 'A', batch: 'A', roll: '০৭', phone: '০১৭১১-০০০০০৭', school: 'লালমাটিয়া বালিকা বিদ্যালয়', status: 'সক্রিয়', guardian: 'জাহান আলম', guardianPhone: '০১৮১১-০০০০০৭', admissionDate: '২০২৬-০১-১০', photo: '' }
  ],
  teachers: [
    { id: 'রাহেলা১১', name: 'রাহেলা আক্তার', subject: 'পদার্থবিজ্ঞান', phone: '০১৮১১-১১১১১১', classes: 6 },
    { id: 'কামরুল২২', name: 'কামরুল ইসলাম', subject: 'গণিত', phone: '০১১১-২২২২২২', classes: 8 },
    { id: 'নুসরাত৩৩', name: 'নুসরাত জাহান', subject: 'রসায়ন', phone: '০১১১-৩৩৩৩৩৩', classes: 5 },
    { id: 'সাদিয়া৪৪', name: 'সাদিয়া রহমান', subject: 'ইংরেজি', phone: '০১১১-৪৪৪৪৪', classes: 4 }
  ],
  /* The demo subjects are the seeded ones *plus* who teaches them, because the
     teacher portal is only interesting when somebody owns a class. */
  subjectTeachers: {
    'গণিত': 'কামরুল ইসলাম',
    'পদার্থবিজ্ঞান': 'রাহেলা আক্তার',
    'রসায়ন': 'নুসরাত জাহান',
    'ইংরেজি': 'সাদিয়া রহমান'
  },
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
    { id: 'fee-001-ago', studentId: '2026-09-001', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: monthDay(-1, 5) },
    { id: 'fee-001-now', studentId: '2026-09-001', month: MONTH_NOW, amount: 1200, status: 'পরিশোধিত', date: monthDay(0, 2) },
    { id: 'fee-002-ago', studentId: '2026-09-002', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: monthDay(-1, 6) },
    { id: 'fee-002-now', studentId: '2026-09-002', month: MONTH_NOW, amount: 1200, status: 'বকেয়া', date: '—' },
    { id: 'fee-014-ago', studentId: '2026-10-014', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: monthDay(-1, 10) },
    { id: 'fee-014-now', studentId: '2026-10-014', month: MONTH_NOW, amount: 1200, status: 'বকেয়া', date: '—' },
    { id: 'fee-007-ago', studentId: '2026-08-007', month: MONTH_AGO, amount: 1200, status: 'পরিশোধিত', date: monthDay(-1, 4) },
    { id: 'fee-007-now', studentId: '2026-08-007', month: MONTH_NOW, amount: 1200, status: 'পরিশোধিত', date: monthDay(0, 1) }
  ],
  payments: [
    { id: 'pay-1', studentId: '2026-09-001', month: MONTH_AGO, amount: 1200, date: monthDay(0, 1), receivedBy: 'সিস্টেম' }
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
      author: 'কামরুল ইসলাম', date: daysFromNow(0), time: '১৭:০০',
      duration: 30, startDate: daysFromNow(-2), endDate: daysFromNow(5),
      questions: [
        { q: '৫ + ৩ × ২ = ?', options: ['১০', '১১', '১৬', ''], answer: 1 },
        { q: 'একটি ত্রিভুজের তিন কোণের সমষ্টি কত?', options: ['৯০°', '১৮০°', '২৭০°', '৩৬০°'], answer: 1 },
        { q: 'x + 2 = 7 হলে x = ?', options: ['৫', '৭', '৯', '২'], answer: 0 }
      ]
    }
  ],
  materials: [
    { id: 'mat-1', title: 'গণিত নোট — অধ্যায় ১', subject: 'গণিত', className: 'নবম', type: 'নোট', chapter: '১', description: 'স্বাভাবিক সংখ্যা ও ভগ্নাংশ', date: '২০২৬-০৯-০১', by: 'কামরুল ইসলাম', published: true }
  ],
  assignments: [
    { id: 'asg-1', title: 'গণিত হোমওয়ার্ক-১', subject: 'গণিত', className: 'নবম', teacher: 'কামরুল ইসলাম', deadline: daysFromNow(5), marks: 20, description: 'অধ্যায় ১ এর অনুশীলনী' }
  ],
  submissions: [
    { id: 'subm-1', assignmentId: 'asg-1', studentId: '2026-09-001', status: 'জমা হয়েছে', date: daysFromNow(-2), feedback: '' }
  ],
  notifications: [
    { id: 'ntf-1', type: 'সাধারণ', title: 'সিস্টেম চালু হয়েছে', target: 'সবাই', date: '২০২৬-০৯-০১', createdAt: new Date().toISOString(), read: false }
  ],
  tips: [
    { id: 'tip-1', text: 'প্রতিদিন কমপক্ষে ৩০ মিনিট গণিত অনুশীলন কর।', active: true, by: 'কামরুল ইসলাম', date: '২০২৬-০৯-০১' }
  ],
  banners: [
    { id: 'ban-1', title: 'গ্র্যান্ড মডেল টেস্ট ২০২৬', desc: 'সব ক্লাসের জন্য বৃহৎ মডেল টেস্ট — নিবন্ধন চলছে।', cta: 'নোটিশ দেখুন', active: true, date: '২০২৬-০৯-০১' }
  ]
};

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Empty the store, then write every demo record. `db.reset()` is the same
 * clearing the admin's danger-zone button uses, so the fixture always starts
 * from a known state instead of stacking on top of whatever was there.
 */
export function loadDemoData() {
  db.reset();
  for (const [name, rows] of Object.entries(DEMO)) {
    if (name !== 'subjectTeachers') rows.forEach((row) => db[name].add(row));
  }
  // The seeded subjects gain their demo teacher, so "my subjects" means
  // something on the teacher portal.
  Object.entries(DEMO.subjectTeachers).forEach(([subject, teacher]) => {
    db.subjects.update((row) => row.name === subject, { teacher });
  });
  return db;
}

