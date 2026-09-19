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

import { readJSON, writeJSON, onStoreReset } from './store.js';
import { isFirebaseConfigured, ref as fbRef, showToast } from './firebase.js';

const DATA_KEY = 'activeplus_data';
export const DATA_VERSION = 8; // institution pad: logo, website, footerText + consistent branding

export const CLASS_OPTIONS = ['অষ্টম', 'নবম', 'দশম', 'একাদশ', 'দ্বাদশ'];
export const CLASS_TO_NUMBER = { 'অষ্টম': 8, 'নবম': 9, 'দশম': 10, 'একাদশ': 11, 'দ্বাদশ': 12 };
export const ALL_CLASSES = 'সব';

/* Seed dates are derived from today. Hard-coded Bengali dates go stale within
   days — a September deadline turns every "pending" assignment into "overdue"
   and closes the demo exam window — so the sample centre always looks alive. */
const SEED_DIGITS = '০১২৩৪৫৬৭৮৯';
export const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Students can read numbers in Bengali or English digits (Settings → সংখ্যা).
 * Only student-facing pages ever flip this switch — admin/teacher pages keep
 * the Bengali default because they never call setDigitMode().
 */
let DISPLAY_DIGIT_MODE = 'bn';
export function setDigitMode(mode) {
  DISPLAY_DIGIT_MODE = mode === 'en' ? 'en' : 'bn';
}
export function getDigitMode() {
  return DISPLAY_DIGIT_MODE;
}
export const toBnDigits = (value) =>
  DISPLAY_DIGIT_MODE === 'en' ? String(value) : String(value).replace(/\d/g, (d) => SEED_DIGITS[d]);

/** ১৬/০৯/২০২৬ → '16/09/2026' — everything below parses on plain digits. */
export const toAsciiDigits = (value) => String(value ?? '')
  .replace(/[০-৯]/g, (d) => String(SEED_DIGITS.indexOf(d)));

/** 2026-09-12 → ২০২৬-০৯-১২ (UTC based, exactly like todayBn()). */
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

const SEED = {
  settings: {
    orgName: 'Active Plus Coaching',
    orgLogo: null,
    address: '২য় তলা, মদিনা প্লাজা, মিরপুর-১০, ঢাকা',
    mobile: '০১৭০০-০০০০০০',
    email: 'info@activeplus.edu',
    website: 'activeplus.edu',
    footerText: 'শিক্ষাই শক্তি — Active Plus Coaching',
    academicYear: '২০২৬',
    monthlyFee: 1200,
    admissionFee: 500,
    defaultExamDuration: 30,
    passMark: 40,
    dailyChallengeTarget: 10,
    homeFeatures: ['progress', 'achievements', 'certificates', 'downloads',
      'streak', 'profile', 'settings', 'help'],
    studentEditableFields: ['phone'],
    negativeMarking: 0,
    leaderboardEnabled: true,
    autoPublishResult: false,
    notificationsEnabled: true,
    homeCards: {
      progress: true, nextClass: true, exam: true, challenge: false, materials: true,
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
    { id: 'রাহেলা১১', name: 'রাহেলা আক্তার', subject: 'পদার্থবিজ্ঞান', phone: '০১৮১১-১১১১১১', classes: 6 },
    { id: 'কামরুল২২', name: 'কামরুল ইসলাম', subject: 'গণিত', phone: '০১১১-২২২২২২', classes: 8 },
    { id: 'নুসরাত৩৩', name: 'নুসরাত জাহান', subject: 'রসায়ন', phone: '০১১১-৩৩৩৩৩৩', classes: 5 },
    { id: 'সাদিয়া৪৪', name: 'সাদিয়া রহমান', subject: 'ইংরেজি', phone: '০১১১-৪৪৪৪৪', classes: 4 }
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
    { id: 'asg-1', title: 'গণিত হোমওয়ার্ক-১', subject: 'গণিত', className: 'নবম', teacher: 'কামরুল ইসলাম', deadline: daysFromNow(5), marks: 20, description: 'অধ্যায় ১ এর অনুশীলনী' }
  ],
  submissions: [
    { id: 'subm-1', assignmentId: 'asg-1', studentId: '2026-09-001', status: 'জমা হয়েছে', date: daysFromNow(-2), feedback: '' }
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

/* One parsed copy of the store per page load: re-parsing 350 KB of JSON on
   every collection access made inserts quadratic (5 ms/record at 1 500 rows).
   Invalidated by our own remote snapshots and by writes from another tab. */
let storeCache = null;

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (!event || !event.key || event.key === DATA_KEY) storeCache = null;
  });
}

// The storage layer being reset (tests, or a host clearing the memory fallback)
// must drop our parsed copy with it.
onStoreReset(() => { storeCache = null; });

function load() {
  if (storeCache) return storeCache;
  const existing = readJSON(DATA_KEY, null);
  if (existing && existing.collections) {
    // A version bump must never cost the centre its data: carry it forward.
    storeCache = Number(existing.version) === DATA_VERSION ? existing : migrateStore(existing);
    if (storeCache !== existing) writeJSON(DATA_KEY, storeCache);
    return storeCache;
  }
  const fresh = { version: DATA_VERSION, seededAt: new Date().toISOString(), collections: clone(SEED) };
  writeJSON(DATA_KEY, fresh);
  storeCache = fresh;
  return fresh;
}

/**
 * Moves data from an older DATA_VERSION into the current shape instead of
 * wiping it: every stored collection is kept as-is, and only collections the
 * old version did not have are filled in from the seed.
 */
function migrateStore(old) {
  const collections = clone(SEED);
  for (const [key, value] of Object.entries(old.collections || {})) {
    if (value === null || value === undefined) continue;
    if (key === 'settings') collections.settings = { ...collections.settings, ...clone(value) };
    else collections[key] = clone(value);
  }
  return {
    version: DATA_VERSION,
    seededAt: old.seededAt || new Date().toISOString(),
    migratedFrom: old.version ?? null,
    collections
  };
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
    error: syncState.error ? 'sync-failed' : null,
    persisted: lastPersistOk // false = writes are memory-only for this page load
  };
}

/** Mirror the single store to Firebase when it is configured (never a 2nd DB). */
function pushRemote(store) {
  if (applyingRemote) return;
  const transport = remoteTransport || (isFirebaseConfigured()
    // No .catch(() => null) here: a rejected write must stay rejected so the
    // caller reports "sync failed" instead of claiming the mirror was updated.
    ? (payload) => { const r = fbRef('activeplus/data'); return r?.set ? r.set(payload) : null; }
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

let lastPersistOk = true;
let persistWarningShown = false;

/** Spec 51: a save that never reached storage must not look like a success. */
function notifyPersistFailure() {
  if (persistWarningShown) return;
  persistWarningShown = true;
  try {
    showToast('সংরক্ষণ ব্যর্থ: ব্রাউজারের স্টোরেজ বন্ধ বা জায়গা শেষ। এই পেজ বন্ধ করলে নতুন তথ্য হারিয়ে যাবে — এখনই ব্যাকআপ নামান।', 'error', 9000);
  } catch (e) { /* no DOM (tests): getDbStatus().persisted still tells the truth */ }
}

function save(store) {
  storeCache = store;
  lastPersistOk = writeJSON(DATA_KEY, store);
  if (!lastPersistOk) notifyPersistFailure();
  pushRemote(store);
  return lastPersistOk;
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
    storeCache = value && value.collections ? value : null;
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
    storeCache = fresh;
    save(fresh);
    return fresh;
  },

  version: DATA_VERSION
};

/* ------------------------------------------------------------------ */
/* Institution profile / Pad Settings                                  */
/* ------------------------------------------------------------------ */
/* Central Institution Profile — the single source of truth for every   */
/* official document and WhatsApp-shareable image. Admin configures     */
/* once in Settings → Institution Profile / Pad Settings:               */
/*   - Institution Name (required)                                      */
/*   - Institution Logo (stored locally as data URL, reused everywhere)  */
/*   - Address (required)                                               */
/*   - Mobile Number (required, BD)                                     */
/*   - Email (required)                                                 */
/*   - Website (optional)                                               */
/*   - Footer Text (optional)                                           */
/* Every PDF and WhatsApp image automatically uses this pad.            */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i;

/** Digits only — Bengali numerals are accepted wherever the app asks for one. */
export function mobileDigits(value) {
  return bnDigitsToAscii(String(value ?? '')).replace(/\D/g, '');
}

/** Bangladeshi mobile: 11 digits from 01, with or without the 880 country code. */
export function isValidMobile(value) {
  const digits = mobileDigits(value);
  if (!digits) return false;
  const local = digits.startsWith('880') ? `0${digits.slice(3)}` : digits;
  return local.length === 11 && local.startsWith('01');
}

export function isValidEmail(value) {
  const v = String(value ?? '').trim();
  if (!v) return false; // an email is required; blank is not a valid one
  return EMAIL_RE.test(v);
}

export function isValidWebsite(value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  if (/\s/.test(v)) return false;
  return WEBSITE_RE.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
}

export function isValidLogoDataUrl(value) {
  if (!value) return true;
  const s = String(value).trim();
  if (!s) return true;
  return s.startsWith('data:image/') && s.includes('base64,');
}

/**
 * The institution identity used by every letterhead, document and portal.
 * Always complete: the seed fills anything the admin has not written yet.
 * This is the single source of truth for Institution Pad/Letterhead.
 */
export function orgInfo() {
  const s = db.settings.get();
  const trim = (v) => String(v ?? '').trim();
  const mobile = trim(s.mobile);
  const email = trim(s.email);
  const website = trim(s.website);
  const footerText = trim(s.footerText);
  const orgLogo = s.orgLogo || null;
  const parts = [mobile, email, website].filter(Boolean);
  const contactParts = [mobile, email].filter(Boolean);
  return {
    name: trim(s.orgName) || 'Active Plus',
    orgName: trim(s.orgName) || 'Active Plus',
    address: trim(s.address),
    mobile,
    email,
    website,
    footerText,
    orgLogo,
    logo: orgLogo,
    academicYear: trim(s.academicYear),
    /* The letterhead contact line is the number people call plus the
       address they write to; the website stays a separate setting. */
    contactLine: contactParts.join(' · '),
    contactLinePipe: parts.join(' | '),
    contactLineDot: parts.join(' · ')
  };
}

/**
 * Validate and store the institution profile written in admin Settings.
 * Required: orgName, address, mobile, email
 * Optional: website, footerText, orgLogo
 */
export function saveOrgInfo(input = {}, { user = 'system', role = 'admin' } = {}) {
  const name = String(input.orgName ?? '').trim();
  const address = String(input.address ?? '').trim();
  const mobile = String(input.mobile ?? '').trim();
  const email = String(input.email ?? '').trim();
  const website = String(input.website ?? '').trim();
  const footerText = String(input.footerText ?? '').trim();
  const orgLogo = input.orgLogo !== undefined ? input.orgLogo : undefined;

  const errors = [];
  const fail = (field, message) => errors.push({ field, message });

  if (!name) fail('orgName', 'প্রতিষ্ঠানের নাম লিখুন।');
  if (!address) fail('address', 'প্রতিষ্ঠানের ঠিকানা লিখুন।');
  if (!mobile) fail('mobile', 'মোবাইল নম্বর লিখুন।');
  else if (!isValidMobile(mobile)) fail('mobile', 'সঠিক মোবাইল নম্বর দিন — ১১ সংখ্যা, ০১ দিয়ে শুরু (যেমন ০১৭০০-০০০০০০)।');
  if (!email) fail('email', 'ইমেইল ঠিকানা লিখুন।');
  else if (!EMAIL_RE.test(email)) fail('email', 'সঠিক ইমেইল ঠিকানা দিন (যেমন info@example.com)।');
  if (website && !isValidWebsite(website)) fail('website', 'সঠিক ওয়েবসাইট দিন (যেমন www.example.com)।');
  if (orgLogo !== undefined && orgLogo !== null && String(orgLogo).trim() !== '' && !isValidLogoDataUrl(orgLogo)) {
    fail('orgLogo', 'লোগো ছবিটি সঠিক ফরম্যাটে নয়। PNG/JPG আপলোড করুন।');
  }

  if (errors.length) return { ok: false, errors, org: orgInfo() };

  const patch = { orgName: name, address, mobile };
  if (input.email !== undefined) patch.email = email;
  if (input.website !== undefined) patch.website = website;
  if (input.footerText !== undefined) patch.footerText = footerText;
  if (orgLogo !== undefined) patch.orgLogo = orgLogo ? String(orgLogo).trim() : null;

  db.settings.update(patch);
  logActivity({ user, role, action: 'updated institute profile', target: name });
  return { ok: true, errors: [], org: orgInfo() };
}

export function saveOrgLogo(dataUrl, { user = 'system', role = 'admin' } = {}) {
  if (!dataUrl) {
    db.settings.update({ orgLogo: null });
    logActivity({ user, role, action: 'removed institute logo' });
    return { ok: true, errors: [], org: orgInfo() };
  }
  if (!isValidLogoDataUrl(dataUrl)) {
    return { ok: false, errors: [{ field: 'orgLogo', message: 'লোগো ছবিটি সঠিক ফরম্যাটে নয়।' }], org: orgInfo() };
  }
  if (String(dataUrl).length > 4_000_000) {
    return { ok: false, errors: [{ field: 'orgLogo', message: 'লোগো ফাইলটি খুব বড় — ২MB এর কম ছবি ব্যবহার করুন।' }], org: orgInfo() };
  }
  db.settings.update({ orgLogo: String(dataUrl) });
  logActivity({ user, role, action: 'updated institute logo' });
  return { ok: true, errors: [], org: orgInfo() };
}

/* ------------------------------------------------------------------ */
/* Domain helpers                                                      */
/* ------------------------------------------------------------------ */
/* Domain helpers                                                      */
/* ------------------------------------------------------------------ */

export function todayBn() {
  const iso = new Date().toISOString().slice(0, 10);
  return iso.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

/* ------------------------------------------------------------------ */
/* Dates: one Bengali long format everywhere                            */
/*                                                                     */
/* Every date the app *shows* is written ১৬ সেপ্টেম্বর ২০২৬            */
/* (formatBnDate). Records keep the canonical Bengali ISO date          */
/* ('২০২৬-০৯-১৬') they have always used, so sorting, exam windows and   */
/* month grouping keep working — and any date a person types (Bengali,  */
/* English, slash, dot or the long form itself) is normalised on save   */
/* with parseBnDateInput().                                            */
/* ------------------------------------------------------------------ */

/** What a date field expects: the same long Bengali form the app prints. */
export const BN_DATE_PLACEHOLDER = '১৬ সেপ্টেম্বর ২০২৬';

const MONTH_INDEX = (name) => {
  const key = String(name || '').toLowerCase().replace(/,$/, '');
  const bn = BN_MONTHS.indexOf(key);
  if (bn !== -1) return bn + 1;
  const en = EN_MONTHS.findIndex((month) => month === key || (key.length >= 3 && month.startsWith(key)));
  return en === -1 ? 0 : en + 1;
};

function dateParts(year, month, day) {
  if (!(year >= 1000 && year <= 9999)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (day !== null && !(day >= 1 && day <= 31)) return null;
  return { year, month, day };
}

/**
 * Everything the app could be handed → { year, month, day } (day: null for a
 * month-only label) or null when the text is not a date at all.
 */
export function parseDateParts(value) {
  const raw = toAsciiDigits(value).trim();
  if (!raw) return null;

  // 2026-09-16 · 2026/9/16 · 2026-09-16T10:30:00Z (timestamps sort first)
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (m) return dateParts(+m[1], +m[2], m[3] ? +m[3] : null);
  // 16-09-2026 · 16/09/2026 · 16.09.2026
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return dateParts(+m[3], +m[2], +m[1]);
  // 16 September 2026 · 16 সেপ্টেম্বর ২০২৬ · 16th Sep 2026
  m = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([^\s,]+),?\s+(\d{4})$/i);
  if (m) { const index = MONTH_INDEX(m[2]); return index ? dateParts(+m[3], index, +m[1]) : null; }
  // September 2026 · সেপ্টেম্বর ২০২৬ (month labels — used by fee months)
  m = raw.match(/^([^\s\d,]+),?\s+(\d{4})$/);
  if (m) { const index = MONTH_INDEX(m[1]); return index ? dateParts(+m[2], index, null) : null; }
  return null;
}

/**
 * Any supported date → '১৬ সেপ্টেম্বর ২০২৬'.
 *
 * Text that is not a date ('—', 'আজ', 'চলমান', a fee month label…) is returned
 * unchanged so a report never prints an empty cell where a value existed.
 */
export function formatBnDate(value, { fallback = '' } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parts = parseDateParts(raw);
  if (!parts) return raw;
  if (!parts.day) return `${BN_MONTHS[parts.month - 1]} ${toBnDigits(parts.year)}`;
  return `${toBnDigits(parts.day)} ${BN_MONTHS[parts.month - 1]} ${toBnDigits(parts.year)}`;
}

/**
 * A stored date that carries a time ('2026-09-18T09:12:00.000Z') →
 * '১৮ সেপ্টেম্বর ২০২৬ · ০৯:১২'. Same date format as everywhere else, with the
 * clock appended only when the value really has one.
 */
export function formatBnDateTime(value, { fallback = '' } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const date = formatBnDate(raw);
  if (!/\d{1,2}:\d{2}/.test(raw)) return date;
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return date;
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  return `${date} · ${toBnDigits(hh)}:${toBnDigits(mm)}`;
}

/**
 * A typed date (Bengali long form, English, ISO, slashes…) → the canonical
 * Bengali ISO date the store keeps, or '' when it cannot be understood.
 */
export function parseBnDateInput(value) {
  const parts = parseDateParts(value);
  if (!parts) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return toBnDigits(`${parts.year}-${pad(parts.month)}-${pad(parts.day || 1)}`);
}

/** True for values that look like a date to the store (used for display). */
export function looksLikeDate(value) {
  return Boolean(parseDateParts(value));
}

/**
 * A stored date as the plain `YYYY-MM-DD` a native <input type="date"> needs
 * (those inputs only speak ISO), or '' when it is not a date.
 */
export function toAsciiDate(value) {
  const parts = parseDateParts(value);
  if (!parts) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day || 1)}`;
}

/**
 * True when a date falls in the current month — in any format the app accepts
 * (Bengali ISO, plain ISO, the long Bengali form, or a 'সেপ্টেম্বর ২০২৬' label).
 */
export function isThisMonth(bnDate) {
  const parts = parseDateParts(bnDate);
  const today = parseDateParts(todayBn());
  if (!parts || !today) return false;
  return parts.year === today.year && parts.month === today.month;
}

/**
 * '২০২৬-০৯' or '২০২৬-০৯-১২' → 'সেপ্টেম্বর ২০২৬'.
 *
 * Anything that is not a recognisable Bengali ISO month is returned unchanged,
 * so a report grouping payments by month never prints "undefined" for a date
 * somebody typed by hand.
 */
export function bnMonthLabel(bnDate) {
  const value = String(bnDate || '').trim();
  const [year, month] = value.split('-');
  const index = Number(String(month || '').replace(/[০-৯]/g, (d) => String(SEED_DIGITS.indexOf(d))));
  if (!year || !BN_MONTHS[index - 1]) return value;
  return `${BN_MONTHS[index - 1]} ${year}`;
}

/** Exam percentage, guarded: a zero-question paper must not produce NaN/Infinity. */
export function resultPercent(result) {
  const total = Number(result?.total) || 0;
  if (total <= 0) return 0;
  return (Number(result?.score) || 0) / total * 100;
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Auto-generated IDs                                                  */
/* ------------------------------------------------------------------ */

/** Last two digits of the admission year, e.g. 2026 -> '26', 2099 -> '99'. */
export function nextStudentId({ year = new Date().getFullYear(), className } = {}) {
  const yearStr = String(Number(year) % 100).padStart(2, '0');
  const classNo = Number(CLASS_TO_NUMBER[className]) || Number(String(className).replace(/\D/g, '')) || 9;
  const classStr = String(classNo).padStart(2, '0');
  const prefix = `${yearStr}${classStr}`;
  let max = 0;
  for (const s of db.students.list()) {
    const m = String(s.id || '').match(new RegExp(`^${prefix}(\\d{3})$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Next sequential receipt number for a given day: `YYYYMMDD` + a 3-digit
 * serial that restarts at 001 each day (e.g. 20260905001, 20260905002).
 * Always unique — the serial is derived from payments already stored, and a
 * defensive loop skips any number that is somehow already taken, so two
 * payments recorded back-to-back can never collide.
 */
export function nextReceiptNo(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `${y}${m}${d}`;
  let max = 0;
  for (const p of db.payments.list()) {
    const match = String(p.receiptNo || '').match(new RegExp(`^${prefix}(\\d{3})$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  let serial = max + 1;
  let candidate = `${prefix}${String(serial).padStart(3, '0')}`;
  while (db.payments.list().some((p) => p.receiptNo === candidate)) {
    serial += 1;
    candidate = `${prefix}${String(serial).padStart(3, '0')}`;
  }
  return candidate;
}

/** Teacher ID: first word of the name + last two digits of the mobile. */
export function nextTeacherId({ name, phone } = {}) {  const first = String(name || '').trim().split(/\s+/)[0] || 'T';
  const digits = String(phone || '').replace(/[^\d\u09E6-\u09EF]/g, '');
  const lastTwo = digits.slice(-2) || '00';
  const base = `${first}${lastTwo}`;
  const taken = new Set(db.teachers.list().map((t) => String(t.id || '')));
  let candidate = base;
  let n = 1;
  while (taken.has(candidate)) { n += 1; candidate = `${base}${n}`; }
  return candidate;
}


/** Students filtered by class ('সব' = everyone). */
export function studentsOfClass(className) {
  const all = db.students.list();
  return className && className !== ALL_CLASSES ? all.filter((s) => s.className === className) : all;
}

/** Due (বকেয়া) fee rows joined with their student, optionally by class. */
/** What is still owed on a fee row: the amount minus anything already paid. */
export function dueRemaining(fee) {
  if (!fee) return 0;
  return Math.max(0, (Number(fee.amount) || 0) - (Number(fee.paid) || 0));
}

export function dueFees(className = ALL_CLASSES) {
  const students = studentsOfClass(className);
  const ids = new Set(students.map((s) => s.id));
  return db.fees.list()
    .filter((fee) => fee.status === 'বকেয়া' && dueRemaining(fee) > 0 && ids.has(fee.studentId))
    .map((fee) => ({
      ...fee,
      remaining: dueRemaining(fee),
      student: students.find((s) => s.id === fee.studentId) || null
    }));
}

/**
 * Collects money against a due fee and writes exactly one payment row.
 *
 * The amount is always checked against what is really owed: a smaller payment
 * is kept as a partial payment (the fee stays বকেয়া with a reduced balance),
 * a larger one is refused, and only money that clears the balance marks the fee
 * পরিশোধিত. Callers therefore cannot close a ৳1200 due by taking ৳50.
 * Returns null when there is nothing to collect or the amount is not acceptable.
 */
export function receivePayment(feeId, receivedBy, details = {}) {
  const fee = db.fees.find(feeId);
  if (!fee || fee.status === 'পরিশোধিত') return null;
  const remaining = dueRemaining(fee);
  if (remaining <= 0) return null;

  const given = details?.amount;
  const amount = given === undefined || given === null || given === ''
    ? remaining                                  // nothing specified → settle the due
    : Number(given);
  if (!Number.isFinite(amount) || amount <= 0 || amount > remaining + 1e-9) return null;

  const student = db.students.find(fee.studentId);
  const date = String(details?.date || '').trim() || todayBn();
  const paidTotal = (Number(fee.paid) || 0) + amount;
  const settled = paidTotal + 1e-9 >= (Number(fee.amount) || 0);

  const payment = {
    id: newId('pay'), studentId: fee.studentId, month: fee.month,
    amount, date, receivedBy: receivedBy || 'অ্যাডমিন'
  };
  if (details?.method) payment.method = String(details.method);
  if (details?.reference) payment.reference = String(details.reference);
  if (details?.remarks) payment.remarks = String(details.remarks);
  if (details?.receiptNo) payment.receiptNo = String(details.receiptNo);
  db.payments.add(payment);

  db.fees.update(feeId, settled
    ? { status: 'পরিশোধিত', date, paid: paidTotal }
    : { paid: paidTotal });

  if (student) {
    const stillDue = db.fees.list()
      .some((f) => f.studentId === student.id && f.status === 'বকেয়া' && dueRemaining(f) > 0);
    if (!stillDue && student.status !== 'সক্রিয়') db.students.update(student.id, { status: 'সক্রিয়' });
    db.notices.add({
      id: newId('n'),
      title: `পেমেন্ট গৃহীত: ${fee.month} — ৳${amount}${settled ? '' : ` (বাকি ৳${dueRemaining(db.fees.find(feeId))})`}`,
      audience: 'শিক্ষার্থী',
      className: student.className,
      forStudent: student.id, // personal: noticesFor() keeps it off shared boards
      date
    });
  }
  return { fee: db.fees.find(feeId), student, payment, settled, remaining: dueRemaining(db.fees.find(feeId)) };
}

/** 'সেপ্টেম্বর ২০২৬' → sortable key (year*12 + month index). Unknown sorts last. */
export function dueMonthKey(month) {
  const parts = String(month || '').trim().split(/\s+/);
  const idx = BN_MONTHS.indexOf(parts[0]);
  if (idx === -1) return Number.MAX_SAFE_INTEGER;
  const year = Number(String(parts[1] || '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
  return (Number.isFinite(year) && year > 0 ? year : 9999) * 12 + idx;
}

/**
 * Collects money against several of one student's due months at once — the
 * everyday "দুই মাসের ফি একসাথে দিল" case. The amount is applied oldest month
 * first through receivePayment(), so every settled month gets its own payment
 * row, notice and sequential receipt number, and a partial amount simply
 * leaves the newest months বকেয়া. Refuses (null) anything inconsistent:
 * another student's fee, an already-paid month, or more than the total owed.
 */
export function receiveStudentPayments(studentId, feeIds, amount, receivedBy, details = {}) {
  const ids = (Array.isArray(feeIds) ? feeIds : []).map(String).filter(Boolean);
  if (!studentId || !ids.length) return null;
  const fees = ids.map((id) => db.fees.find(id));
  if (fees.some((fee) => !fee || fee.studentId !== studentId || fee.status === 'পরিশোধিত' || dueRemaining(fee) <= 0)) {
    return null;
  }
  const ordered = fees.slice().sort((a, b) => dueMonthKey(a.month) - dueMonthKey(b.month));
  const owed = ordered.reduce((sum, fee) => sum + dueRemaining(fee), 0);
  const total = (amount === undefined || amount === null || amount === '') ? owed : Number(amount);
  if (!Number.isFinite(total) || total <= 0 || total > owed + 1e-9) return null;

  const results = [];
  let left = total;
  for (const fee of ordered) {
    if (left <= 1e-9) break;
    const take = Math.min(left, dueRemaining(fee));
    const res = receivePayment(fee.id, receivedBy, {
      ...details,
      amount: take,
      receiptNo: ids.length === 1 && details.receiptNo ? String(details.receiptNo) : nextReceiptNo()
    });
    if (!res) return null;
    results.push(res);
    left = Math.max(0, left - take);
  }
  return {
    student: db.students.find(studentId) || null,
    results,
    payments: results.map((r) => r.payment),
    total,
    settled: results.filter((r) => r.settled).length,
    remaining: left
  };
}

/**
 * Notices for a shared board (teacher/admin lists, "latest notice" cards).
 * A payment receipt is personal to one student (`forStudent`) and must never be
 * broadcast to a class or a teacher.
 */
export function sharedNotices() {
  return db.notices.list().filter((n) => !n.forStudent);
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
    const given = answers ? answers[index] : undefined;
    // Unanswered must mean zero marks: Number(null) === 0 used to award a point
    // whenever the correct option happened to be A.
    if (given === null || given === undefined || given === '') return;
    const chosen = Number(given);
    if (Number.isFinite(chosen) && chosen === Number(question.answer)) score += 1;
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
  const scores = results.map((r) => resultPercent(r));
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
    byClass[cls].total += resultPercent(r);
    byClass[cls].count += 1;
  });
  return Object.values(byClass).map((c) => ({ name: c.name, avg: Math.round(c.total / c.count) }));
}

export function leaderboard(examId = null) {
  let results = db.examResults.list();
  if (examId) results = results.filter((r) => r.examId === examId);
  const rows = results.map((r) => {
    const student = db.students.find(r.studentId);
    return { ...r, pct: Math.round(resultPercent(r)), className: student?.className || '—' };
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
  const dueTotal = due.reduce((s, d) => s + Number(d.remaining ?? d.amount) || 0, 0);
  return {
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === 'সক্রিয়').length,
    inactiveStudents: students.filter((s) => s.status !== 'সক্রিয়').length,
    totalTeachers: db.teachers.list().length,
    activeBatches: db.batches.list().length,
    totalSubjects: db.subjects.list().length,
    upcomingExams: db.exams.list().length,
    pendingAssignments: db.submissions.list().filter((s) => !submissionChecked(s)).length,
    publishedResults: db.examResults.list().length,
    todayCollection: payments.filter((p) => p.date === today).reduce((s, p) => s + Number(p.amount || 0), 0),
    // The dashboard labels this "মাসিক সংগ্রহ", so it counts this month only.
    monthlyCollection: payments.filter((p) => isThisMonth(p.date)).reduce((s, p) => s + Number(p.amount || 0), 0),
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
  // Restore every collection the file actually holds. A hard-coded whitelist
  // silently dropped tips, banners, materialProgress, studyActivity and
  // challenge — a "successful" restore that lost five collections.
  const collections = {};
  for (const [key, value] of Object.entries(parsed.collections || {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) || (value && typeof value === 'object')) collections[key] = value;
  }
  const store = load();
  store.collections = { ...store.collections, ...clone(collections) };
  save(store);
  return { ok: true, restored: Object.keys(collections).length };
}

/**
 * The paste template teachers copy. Every question is written the way a
 * Bangladeshi question paper reads, so a whole paper can be pasted in one go.
 */
export const MCQ_TEMPLATE = [
  '১. বাংলাদেশের রাজধানী কোনটি?',
  'A) ঢাকা',
  'B) চট্টগ্রাম',
  'C) খুলনা',
  'D) রাজশাহী',
  'উত্তর: A',
  '',
  '২. ৫ + ৩ × ২ = কত?',
  'ক) ১০',
  'খ) ১১',
  'গ) ১৬',
  'ঘ) ২০',
  'উত্তর: খ'
].join('\n');

/** One-line reminder printed under the paste box. */
export const MCQ_PASTE_RULES = 'প্রতিটি প্রশ্নের পর অপশন (ক/খ/গ/ঘ বা A/B/C/D) আর শেষে সঠিক উত্তর (যেমন “উত্তর: খ”)। যেভাবেই কপি হোক — এক লাইনে, বন্ধনীসহ, বোল্ড, খালি লাইন ছাড়া — সব চলবে।';

const BN_LETTERS = 'কখগঘ';

/** Which option (0-3) a marker letter/number stands for, or -1. */
function markerIndex(marker) {
  const ch = String(marker || '').trim();
  if (!ch) return -1;
  const bnLetter = BN_LETTERS.indexOf(ch);
  if (bnLetter !== -1) return bnLetter;
  // 'a/A' → 1st option … 'd/D' → 4th, and the same for ১/1 … ৪/4.
  const map = 'abcdABCD১২৩৪1234';
  const at = map.indexOf(ch);
  return at === -1 ? -1 : at % 4;
}

/* How a paper names the correct answer, said every way a teacher says it:
   'উত্তর: B', 'সঠিক উত্তর - খ', 'উত্তরঃ (গ)', 'সঠিক উত্তরটি হলো: খ',
   'উত্তর হবে: খ', 'The correct answer is B', 'Answer: d'. */
const ANSWER_WORDS = '(?:the\\s+)?(?:(?:সঠিক\\s*উত্তর|সঠিক|উত্তর)\\s*(?:টি|টা)?|Correct\\s*Answer|Correct|Answer|Ans)';
/* '… হলো/হবে/is' — the words that sit between the label and the letter. */
const ANSWER_LINK = '(?:\\s*(?:হলো|হলে|হল|হবে|হয়|হয়েছে|is|are|was|will\\s+be))?';
const ANSWER_SEP = "\\s*[:.)\\-–—ঃ।,]?\\s*";
const ANSWER_MARK = '([A-Da-dক-ঘ১-৪1-4])';
/* The line must END after the letter, so an option that happens to start with
   'A' is never mistaken for the answer, and a question like 'সঠিক উত্তর কোনটি?'
   is still a question. */
const ANSWER_LINE = new RegExp(`^${ANSWER_WORDS}${ANSWER_LINK}${ANSWER_SEP}[([{]?\\s*${ANSWER_MARK}\\s*[)\\]}]?\\s*[.।]?\\s*$`, 'i');
/* The same marker at the end of a longer line, where a separator is required
   so ordinary words are never read as an answer: '… (উত্তর: B)'. */
const ANSWER_TAIL = new RegExp(`[([]?\\s*(?:the\\s+)?(?:(?:সঠিক\\s*উত্তর|সঠিক|উত্তর)\\s*(?:টি|টা)?|Correct\\s*Answer|Correct|Answer|Ans)${ANSWER_LINK}\\s*[:.)\\-–—]\\s*${ANSWER_MARK}\\s*[)\\]]?\\s*$`, 'i');
/* 'A) x', 'A. x', '(ক) x', '[খ] x' — copy-paste brings every bracket style. */
const OPTION_LINE = /^[([{]?\s*([A-Da-dক-ঘ])\s*[)\]}.\u0964:\-]?\s+(.+)$/;
const NUMBERED_LINE = /^([০-৯\d]{1,2})\s*[).।:\-]?\s+(.+)$/;
const BN_DIGIT_MAP = '০১২৩৪৫৬৭৮৯';

/* 'ব্যাখ্যা: …' lines explain an answer; they are not the next question. */
const NOISE_LINE = /^(?:ব্যাখ্যা|বিশ্লেষণ|explanation|note|নোট|রেফারেন্স|reference|source|সূত্র)\s*[:.\-]/i;

/* Option markers inside one line. Papers are often pasted as
   '১. প্রশ্ন? (ক) ঢাকা (খ) চট্টগ্রাম (গ) খুলনা (ঘ) রাজশাহী' — one line, four
   options — which the per-line rules can never see. */
const INLINE_MARKER = /(?:^|\s)[([{]?\s*([A-Da-dক-ঘ])\s*[)\]}.\u0964:\-]\s*/g;

/** '**bold**', '#', stray bullets — copy-paste noise that is not the question. */
function cleanLine(line) {
  return String(line || '')
    .replace(/\*\*/g, '')               // bold markers from Word/Google Docs
    .replace(/^[\s•·◦‣]+/, '')
    .replace(/^#{1,6}\s*/, '')          // markdown headings
    .replace(/^\s*[-–—]\s+/, '')        // bullet dashes
    .replace(/[-–—_=*~.]{3,}$/, '')     // '----' / '====' separators between questions
    .replace(/[_\s]+$/, '')
    .trim();
}

const asciiNumber = (text) => Number(String(text).replace(/[০-৯]/g, (d) => String(BN_DIGIT_MAP.indexOf(d))));

/**
 * 'প্রশ্ন: ৫+৩=?' / 'প্রশ্ন ১. …' / 'Q1. …' / 'Question 2) …' → the question
 * itself. The prefix must be followed by a separator (or a number, then a
 * separator) so a question that merely starts with 'প্রশ্নপত্র' is untouched.
 */
function stripQuestionPrefix(text) {
  const raw = String(text || '');
  const stripped = raw
    .replace(/^\s*(?:প্রশ্ন|প্র|Question|Q)\s*(?:নং|no|No)?\s*[০-৯\d]+\s*[:.।)\-]?\s+/i, '')
    .replace(/^\s*(?:প্রশ্ন|প্র|Question|Q)\s*(?:নং|no|No)?\s*[:.।)\-]\s*/i, '')
    .replace(/^[০-৯\d]{1,2}\s*[).।:\-]\s*/, '')            // '১. প্রশ্ন' / '12) প্রশ্ন'
    .trim();
  return stripped || raw.trim();
}

/**
 * '১. প্রশ্ন? (ক) ঢাকা (খ) চট্টগ্রাম …' → { head: '১. প্রশ্ন?', options: [...] }.
 * Returns null when the line does not carry at least two option markers.
 */
function splitInlineOptions(line) {
  const text = String(line || '');
  INLINE_MARKER.lastIndex = 0;
  const marks = [];
  let m;
  while ((m = INLINE_MARKER.exec(text))) {
    marks.push({ start: m.index + (m[0].startsWith(' ') ? 1 : 0), end: INLINE_MARKER.lastIndex });
  }
  if (marks.length < 2) return null;
  const head = text.slice(0, marks[0].start).trim();
  const options = marks
    .map((mark, i) => text.slice(mark.end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim())
    .filter(Boolean);
  if (options.length < 2) return null;
  return { head, options };
}

/**
 * Parse a pasted MCQ paper.
 *
 * Understands what teachers actually copy: blank-line separated blocks, one
 * long stream with no blank lines, 'প্রশ্ন:'/'Q1.'/'১.' prefixes, bold markers,
 * A/B/C/D options, Bengali ক/খ/গ/ঘ options, bracketed markers ('(ক) ঢাকা'),
 * a whole question with its options on one line
 * ('১. প্রশ্ন? (ক) ঢাকা (খ) চট্টগ্রাম (গ) খুলনা (ঘ) রাজশাহী'), numbered options,
 * and answers written as 'সঠিক: B', 'উত্তর: ৩', 'Answer: d', 'উত্তরঃ (খ)' or
 * inline '(উত্তর: B)' at the end of the question or of the option line
 * ('D) ৬ উত্তর: খ'). Line separators ('----') between questions are ignored.
 *
 * @returns {{questions: Array<{q: string, options: string[], answer: number}>,
 *            errors: string[], duplicates: string[], ignored: string[]}}
 *            questions ready to save, incomplete blocks described in errors,
 *            repeated questions in duplicates, paper titles in ignored.
 */
export function parseMcqPaste(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const raw = [];
  const errors = [];
  const duplicates = [];
  const ignored = [];
  let current = null;
  let blockNo = 0;

  const finish = () => {
    if (!current) return;
    blockNo += 1;
    const question = current.q.trim();
    if (!question) return;
    // The title of a copied paper ('নবম শ্রেণি — গণিত') arrives as a block of
    // its own. Only the very first block can be one, and it is dropped with a
    // note instead of being reported as a broken question.
    if (blockNo === 1 && !current.options.length && current.answer < 0 && !question.includes('?')) {
      ignored.push(question);
    } else if (current.options.length < 2) {
      // Say which part is missing, in the words the teacher would use.
      errors.push(current.options.length
        ? `প্রশ্ন ${blockNo}: অসম্পূর্ণ — মাত্র ${toBnDigits(current.options.length)}টি অপশন পাওয়া গেছে (কমপক্ষে ২টি দরকার)।`
        : `প্রশ্ন ${blockNo}: অসম্পূর্ণ — কোনো অপশন পাওয়া যায়নি (ক/খ/গ/ঘ বা A/B/C/D দিয়ে ২–৪টি অপশন দিন)।`);
    } else {
      raw.push({
        q: question,
        options: current.options.slice(0, 4),
        answer: current.answer < 0 ? 0 : current.answer     // no answer line → first option
      });
    }
    current = null;
  };

  const start = (questionText) => { current = { q: questionText, options: [], answer: -1 }; };

  /** Adds the text of a plain line to the question being built. */
  const appendToQuestion = (text) => {
    if (current && (current.options.length || current.answer >= 0)) finish();
    if (!current) start(stripQuestionPrefix(text));
    else current.q = `${current.q} ${text}`.trim();
  };

  for (const line of lines) {
    const clean = cleanLine(line);
    if (!clean) { finish(); continue; }
    if (NOISE_LINE.test(clean)) continue;     // 'ব্যাখ্যা: …' explains, never asks

    const answerMatch = clean.match(ANSWER_LINE);
    if (answerMatch && current) {
      const index = markerIndex(answerMatch[1]);
      if (index !== -1) current.answer = index;
      continue;
    }

    // One line carrying the question and its options ('…? (ক) ঢাকা (খ) …'),
    // sometimes with the answer written at the end of the same line —
    // '১. ২+২=? (A) ৩ (B) ৪ (C) ৫ (D) ৬ (উত্তর: B)'. The answer is lifted off
    // first, otherwise its own letter looks like one more option marker.
    let lineAnswer = -1;
    let optionLine = clean;
    const tailMatch = clean.match(ANSWER_TAIL);
    if (tailMatch) {
      const index = markerIndex(tailMatch[1]);
      if (index !== -1) {
        lineAnswer = index;
        optionLine = clean.slice(0, tailMatch.index).trim();
      }
    }
    const inline = optionLine ? splitInlineOptions(optionLine) : null;
    if (inline) {
      if (inline.head) appendToQuestion(cleanLine(inline.head));
      if (!current) start('');
      inline.options.forEach((option) => current.options.push(cleanLine(option)));
      if (lineAnswer !== -1) current.answer = lineAnswer;
      continue;
    }

    const optionMatch = optionLine.match(OPTION_LINE);
    if (optionMatch && current) {
      current.options.push(cleanLine(optionMatch[2]));
      if (lineAnswer !== -1) current.answer = lineAnswer;
      continue;
    }

    const numbered = optionLine.match(NUMBERED_LINE);
    if (numbered) {
      const label = asciiNumber(numbered[1]);
      const text = cleanLine(numbered[2]);
      if (lineAnswer !== -1 && current) current.answer = lineAnswer;
      if (!current || !current.q.trim()) { start(stripQuestionPrefix(text)); continue; }
      // A numbered line that asks something is the next question; a numbered
      // line that just carries a value ('১) ১০') is the next option — the
      // option numbering always picks up where the last option left off.
      if (!text.includes('?') && label === current.options.length + 1) { current.options.push(text); continue; }
      finish();
      start(stripQuestionPrefix(text));
      continue;
    }

    // Plain text: continues a question that has no options yet, otherwise it
    // is the beginning of the next question (no blank line needed).
    appendToQuestion(lineAnswer === -1 ? clean : optionLine);
    // The answer belonged to this new line ('৫+৩=? (উত্তর: C)').
    if (lineAnswer !== -1 && current) current.answer = lineAnswer;

    // An inline answer on the question line — '৫+৩=? (উত্তর: B)'.
    const inlineAnswer = current.q.match(ANSWER_TAIL);
    if (inlineAnswer) {
      const index = markerIndex(inlineAnswer[1]);
      if (index !== -1) {
        current.answer = index;
        current.q = current.q.slice(0, inlineAnswer.index).trim();
      }
    }
  }
  finish();

  const seen = new Set();
  const questions = raw.filter((item) => {
    const key = item.q.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) { duplicates.push(key); return false; }
    seen.add(key);
    return true;
  });

  return { questions, errors, duplicates, ignored };
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

/**
 * Only badges the student has actually earned.
 *
 * Deliberately small (three clearly-earned badges, spec: "সরল করুন — কম ব্যাজ"):
 * a wall of badges nobody reaches motivates no one.
 */
export function achievementsFor(student) {
  const perf = performanceFor(student);
  const { streak } = studyStreak();
  const badges = [];
  if (streak >= 7) badges.push({ icon: '🔥', name: '৭ দিনের স্ট্রিক' });
  if (completedMaterialIds(student).length >= 10) badges.push({ icon: '📚', name: '১০ ম্যাটেরিয়াল সম্পন্ন' });
  if (perf && perf.best >= 90) badges.push({ icon: '🏆', name: '৯০%+ স্কোর' });
  return badges;
}

/**
 * Subject-wise average from the student's own results — the data behind the
 * progress graph ("+ বিষয়ভিত্তিক গ্রাফ" on the result summary).
 */
export function subjectPerformanceFor(student) {
  const rows = db.examResults.list().filter((r) => r.studentId === student?.id);
  const bySubject = new Map();
  rows.forEach((r) => {
    const exam = db.exams.find(r.examId);
    const subject = exam?.subject || 'অন্যান্য';
    const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
    const entry = bySubject.get(subject) || { subject, sum: 0, tests: 0 };
    entry.sum += pct;
    entry.tests += 1;
    bySubject.set(subject, entry);
  });
  return [...bySubject.values()]
    .map((s) => ({ subject: s.subject, tests: s.tests, avg: Math.round(s.sum / s.tests) }))
    .sort((a, b) => b.avg - a.avg);
}

/** Fee payments actually received from this student, newest first. */
export function paymentHistoryFor(student) {
  return db.payments.list().filter((p) => p.studentId === student?.id).slice().reverse();
}

/** Full marks of a paper — one mark per question (negative marking is a setting). */
export function examFullMarks(exam) {
  return Array.isArray(exam?.questions) ? exam.questions.length : 0;
}

/**
 * Everything worth telling the student, in one feed: notices, system
 * notifications and the events that get a bell elsewhere in the app — a new
 * exam, a published result, a pending assignment and a due fee.
 *
 * Ordered by what the student can still act on, most urgent first.
 */
export function notificationsFor(student, limit = 0) {
  if (!student) return [];
  const rows = [];
  const at = (kind, icon, title, body, date = '', createdAt = '') =>
    rows.push({ id: `${kind}-${rows.length}`, kind, icon, title, body, date, createdAt });

  const fee = feeStatusFor(student);
  if (fee.due > 0) at('fee', '💰', `ফি বকেয়া ৳${fee.due}`, fee.nextDue?.month ? `${fee.nextDue.month} মাসের ফি` : 'বকেয়া পরিশোধ করুন');

  db.assignments.list()
    .filter((a) => a.className === student.className)
    .forEach((a) => {
      const st = assignmentStatus(a, student);
      if (st.status === 'pending' || st.status === 'overdue') {
        at('assignment', '📋', `অ্যাসাইনমেন্ট: ${a.title}`, dueLabel(a, student), a.deadline);
      }
    });

  examsFor(student.className)
    .filter((e) => !examResultFor(e.id, student.id))
    .forEach((e) => {
      const win = examWindow(e);
      at('exam', '📝', `পরীক্ষা: ${e.title}`,
        `${e.subject} · ${formatBnDate(e.date)}${e.time ? ` · ${e.time}` : ''}${win?.state === 'active' ? ' · এখন দেওয়া যাবে' : ''}`, e.date);
    });

  db.examResults.list()
    .filter((r) => r.studentId === student.id)
    .forEach((r) => {
      const exam = db.exams.find(r.examId);
      at('result', '🏆', `ফলাফল প্রকাশিত — ${exam?.title || 'পরীক্ষা'}`, `${r.score}/${r.total}`, r.date);
    });

  noticesFor(student).forEach((n) => at('notice', '📢', n.title, n.audience || 'ঘোষণা', n.date, n.createdAt));
  db.notifications.list()
    .filter((n) => n.target === 'সবাই' || n.target === 'শিক্ষার্থী')
    .forEach((n) => at('system', '🔔', n.title, n.type || 'নোটিফিকেশন', n.date, n.createdAt));

  return limit > 0 ? rows.slice(0, limit) : rows;
}

/* ---------------- Offline exam queue ---------------- */

/**
 * Papers submitted while the device was offline. They are graded and stored
 * locally at once (so the student is never blocked), and wait here until the
 * network is back so the mirror can pick them up.
 */
export function pendingSyncResults() {
  return db.examResults.list().filter((r) => r.pendingSync);
}

/** Marks every queued paper as delivered. Returns how many were waiting. */
export function markResultsSynced() {
  const waiting = pendingSyncResults();
  waiting.forEach((r) => db.examResults.update(r.id, { pendingSync: false, syncedAt: new Date().toISOString() }));
  return waiting.length;
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

/**
 * Any stored/typed date → a local Date at midnight, or null.
 *
 * Goes through parseDateParts(), so a date typed the Bengali long way
 * ('১৬ সেপ্টেম্বর ২০২৬') opens and closes an exam window exactly like the
 * canonical '২০২৬-০৯-১৬' does.
 */
function bnToIso(text) {
  const parts = parseDateParts(text);
  if (!parts || !parts.day) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Is an exam open right now? Drives View Exam vs Start Exam (never both). */
export function examWindow(exam) {
  if (!exam) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = bnToIso(exam.startDate);
  const end = bnToIso(exam.endDate);
  // Labels are painted straight into lists, so they carry the one Bengali
  // date format the whole app prints.
  if (start && today < start) return { state: 'upcoming', label: `শুরু হবে ${formatBnDate(exam.startDate)}`, canStart: false };
  if (end && today > end) return { state: 'closed', label: 'সময় শেষ', canStart: false };
  return {
    state: 'active',
    label: end && String(exam.endDate).trim() ? `শেষ ${formatBnDate(exam.endDate)}` : 'চলমান',
    canStart: true
  };
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
  const deadline = formatBnDate(assignment.deadline);
  if (status === 'submitted' || status === 'checked') return deadline;
  if (daysLeft === null) return deadline;
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

/** A submission counts as reviewed once a teacher has marked it. */
function submissionChecked(submission) {
  return !!submission && (submission.checked === true || submission.status === 'চেক হয়েছে');
}

/** Teacher/admin marks a submission checked, optionally with feedback. */
export function checkSubmission(submissionId, feedback = '', marks = null) {
  const row = db.submissions.find(submissionId);
  if (!row) return null;
  // `checked` is what the teacher UI reads, `status` is what the student sees —
  // set both so a marked submission cannot keep offering the marking form.
  const patch = { status: 'চেক হয়েছে', checked: true, feedback: String(feedback || ''), checkedDate: todayBn() };
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
  const mine = db.assignments.list().filter((a) => classNames.includes(a.className));
  if (!mine.length) return [];
  const ids = new Set(mine.map((a) => a.id));
  // "Needs checking" = at least one submission the teacher has not marked yet.
  // (Assignments have no `checked` field of their own — filtering on it made
  // every assignment look permanently unreviewed.)
  const waiting = new Set(db.submissions.list()
    .filter((s) => ids.has(s.assignmentId) && !submissionChecked(s))
    .map((s) => s.assignmentId));
  return mine.filter((a) => waiting.has(a.id));
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
    icon: '🎓', text: `নতুন শিক্ষার্থী ভর্তি: ${s.name}`, meta: `${s.className} · ${formatBnDate(s.admissionDate)}`,
    at: s.admissionDate || ''
  }));
  db.payments.list().forEach((p) => items.push({
    icon: '💰', text: `পেমেন্ট গ্রহণ: ${p.studentId || ''}`, meta: `${p.amount || 0} টাকা · ${formatBnDate(p.date)}`,
    at: p.date || ''
  }));
  db.exams.list().forEach((e) => items.push({
    icon: '📝', text: `পরীক্ষা তৈরি: ${e.title}`, meta: `${e.className || ''} · ${formatBnDate(e.startDate)}`,
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

