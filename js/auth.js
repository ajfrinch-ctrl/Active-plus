/**
 * Authentication for Active Plus.
 *
 * Works in two modes:
 *   1. Firebase Auth — when js/firebase.js has a real project config.
 *   2. Local mode    — accounts kept in the browser, so the app is fully
 *                      usable on GitHub Pages / offline with no backend.
 *
 * The login page calls `signIn()`; the dashboards call `requireRole()`.
 */

import {
  getAuthMode,
  isAuthenticated as isFirebaseAuthenticated,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  validateStudentId,
  setUserRole as persistRole,
  addActivityLog,
  showToast
} from './firebase.js';

export const ROLES = ['student', 'teacher', 'admin'];

export const HOME_BY_ROLE = {
  student: 'student.html',
  teacher: 'teacher.html',
  admin: 'admin.html'
};

/** Accounts created on first run so the app can be signed into immediately. */
export const DEMO_ACCOUNTS = [
  {
    username: 'admin@activeplus.edu',
    password: 'Admin@123',
    role: 'admin',
    name: 'মাহমুদুল হাসান',
    label: 'Admin',
    detail: 'প্রতিষ্ঠান প্রধান'
  },
  {
    username: 'teacher@activeplus.edu',
    password: 'Teacher@123',
    role: 'teacher',
    name: 'রাহেলা আক্তার',
    label: 'Teacher',
    detail: 'পদার্থবিজ্ঞান'
  },
  {
    username: '2026-09-001',
    password: 'Student@123',
    role: 'student',
    name: 'আরিয়ান হাসান',
    label: 'Student',
    detail: 'নবম শ্রেণি · রোল ০১'
  }
];

const USERS_KEY = 'activeplus_users';
const SESSION_KEY = 'activeplus_session';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */
function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function removeKey(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Password hashing (SubtleCrypto with a portable fallback)            */
/* ------------------------------------------------------------------ */
function hasSubtleCrypto() {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.subtle.digest === 'function';
}

function fallbackHash(password, salt) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  const input = `${salt}::${password}`;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = ((h1 ^ code) * 0x01000193) >>> 0;
    h2 = ((h2 + code) * 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return `fnv-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function hashPassword(password, salt) {
  if (!hasSubtleCrypto()) return fallbackHash(password, salt);
  const data = new TextEncoder().encode(`${salt}::${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `sha256-${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function randomSalt() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `s${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Local user store                                                    */
/* ------------------------------------------------------------------ */
export async function seedUsers({ force = false } = {}) {
  const existing = readJSON(USERS_KEY, null);
  if (existing && Array.isArray(existing.users) && !force) return existing;

  const users = [];
  for (const account of DEMO_ACCOUNTS) {
    const salt = randomSalt();
    users.push({
      uid: `local-${account.role}-${users.length + 1}`,
      username: account.username,
      email: account.username.includes('@') ? account.username : null,
      name: account.name,
      role: account.role,
      detail: account.detail,
      salt,
      passwordHash: await hashPassword(account.password, salt),
      createdAt: new Date().toISOString(),
      provider: 'local'
    });
  }
  const store = { users, seededAt: new Date().toISOString(), version: 1 };
  writeJSON(USERS_KEY, store);
  return store;
}

export function listUsers() {
  return readJSON(USERS_KEY, { users: [] }).users || [];
}

function findUser(identifier) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return null;
  return listUsers().find((user) => {
    const username = String(user.username || '').toLowerCase();
    const email = String(user.email || '').toLowerCase();
    return username === id || (email && email === id);
  }) || null;
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */
export function currentSession() {
  const session = readJSON(SESSION_KEY, null);
  if (!session || !session.uid) return null;
  return session;
}

export function currentUser() {
  const session = currentSession();
  if (session) return session;
  // Firebase-managed session (page reload right after a Firebase sign-in).
  if (getAuthMode() === 'firebase' && isFirebaseAuthenticated()) {
    const user = window.firebase?.auth?.().currentUser;
    if (user) {
      return {
        uid: user.uid,
        name: user.displayName || user.email || 'User',
        email: user.email || null,
        username: user.email || '',
        role: readJSON(SESSION_KEY, null)?.role || window.localStorage.getItem('activeplus_role') || 'student',
        provider: 'firebase'
      };
    }
  }
  return null;
}

export function isLoggedIn() {
  return Boolean(currentSession());
}

export function homeFor(role) {
  return HOME_BY_ROLE[role] || 'index.html';
}

function saveSession(user) {
  const session = {
    uid: user.uid,
    username: user.username,
    email: user.email || null,
    name: user.name,
    role: user.role,
    detail: user.detail || '',
    provider: user.provider || 'local',
    loginTime: new Date().toISOString()
  };
  writeJSON(SESSION_KEY, session);
  persistRole(session.role);
  try { window.localStorage.setItem('activeplus_user', JSON.stringify(session)); } catch (e) { /* ignore */ }
  return session;
}

/* ------------------------------------------------------------------ */
/* Sign in / out                                                       */
/* ------------------------------------------------------------------ */
async function localSignIn(identifier, password, role) {
  await seedUsers();
  const user = findUser(identifier);
  if (!user) {
    throw new AuthError('user-not-found', 'এই আইডি বা ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি।');
  }
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    throw new AuthError('wrong-password', 'পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।');
  }
  if (role && user.role !== role) {
    const label = { student: 'শিক্ষার্থী', teacher: 'শিক্ষক', admin: 'অ্যাডমিন' }[user.role] || user.role;
    throw new AuthError('role-mismatch', `এই অ্যাকাউন্টটি একজন ${label}-এর। উপরে থেকে সঠিক ভূমিকা নির্বাচন করুন।`);
  }
  return saveSession({ ...user, provider: 'local' });
}

/**
 * @param {string} identifier email or student ID
 * @param {string} password
 * @param {'student'|'teacher'|'admin'} role role chosen on the login form
 * @returns {Promise<object>} the saved session
 */
export async function signIn(identifier, password, role) {
  const id = String(identifier || '').trim();
  const pass = String(password || '');

  if (!id || !pass) {
    throw new AuthError('missing-fields', 'ইউজারনেইম/স্টুডেন্ট আইডি এবং পাসওয়ার্ড দুটোই দিতে হবে।');
  }
  if (!ROLES.includes(role)) {
    throw new AuthError('missing-role', 'লগিন করার আগে একটি ভূমিকা (Student / Teacher / Admin) বেছে নিন।');
  }
  if (role === 'student' && id.includes('@') === false && !validateStudentId(id)) {
    // Not fatal — Firebase accounts may use plain usernames — but worth a hint.
    console.info('[Active Plus] Student ID does not match YYYY-C-RRR:', id);
  }

  if (getAuthMode() === 'firebase' && id.includes('@')) {
    try {
      const credential = await signInWithEmailAndPassword(id, pass);
      const session = saveSession({
        uid: credential.user.uid,
        username: credential.user.email,
        email: credential.user.email,
        name: credential.user.displayName || credential.user.email,
        role,
        provider: 'firebase'
      });
      addActivityLog('login', 'auth');
      return session;
    } catch (error) {
      throw new AuthError(error.code || 'auth-failed', friendlyFirebaseError(error));
    }
  }

  const session = await localSignIn(id, pass, role);
  addActivityLog('login', 'auth');
  return session;
}

function friendlyFirebaseError(error) {
  const map = {
    'auth/invalid-email': 'ইমেইল ঠিকানাটি সঠিক নয়।',
    'auth/user-not-found': 'এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি।',
    'auth/wrong-password': 'পাসওয়ার্ড সঠিক নয়।',
    'auth/invalid-credential': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।',
    'auth/too-many-requests': 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
    'auth/network-request-failed': 'নেটওয়ার্ক সমস্যা। ইন্টারনেট সংযোগ পরীক্ষা করুন।'
  };
  return map[error.code] || error.message || 'লগিন করা যায়নি।';
}

export async function signOut({ redirect = true } = {}) {
  const session = currentSession();
  addActivityLog('logout', 'auth');
  if (getAuthMode() === 'firebase') { try { await firebaseSignOut(); } catch (e) { /* ignore */ } }
  removeKey(SESSION_KEY);
  removeKey('activeplus_user');
  removeKey('activeplus_role');
  removeKey('activeplus_studentId');
  if (redirect && typeof window !== 'undefined') {
    window.location.href = 'index.html';
  }
  return session;
}

/* ------------------------------------------------------------------ */
/* Route guard for the dashboards                                      */
/* ------------------------------------------------------------------ */
/**
 * Makes sure the current page is only reachable by the given roles.
 * Returns the session, or null (after starting a redirect) when not allowed.
 */
export function requireRole(...roles) {
  const allowed = roles.flat().filter(Boolean);
  const session = currentSession();
  const here = (window.location.pathname.split('/').pop() || 'index.html');

  if (!session) {
    const next = encodeURIComponent(here);
    showToast('আগে লগিন করুন।', 'warning');
    window.location.replace(`index.html?next=${next}`);
    return null;
  }
  if (allowed.length && !allowed.includes(session.role)) {
    showToast('এই পেজটি দেখার অনুমতি আপনার নেই।', 'error');
    window.location.replace(homeFor(session.role));
    return null;
  }
  return session;
}

export function logoutButton(selector = '#logout-btn') {
  const button = document.querySelector(selector);
  if (!button) return null;
  button.addEventListener('click', async () => {
    button.disabled = true;
    await signOut({ redirect: true });
  });
  return button;
}
