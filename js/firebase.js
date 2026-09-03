/**
 * Firebase integration for Active Plus Coaching Management System.
 *
 * This is an ES module: every public helper is exported, which is what the
 * pages `import`. The app also runs without Firebase — when the config below
 * still holds placeholder values (or the SDK cannot be fetched) the module
 * reports `local` mode and `js/auth.js` handles sign-in from the browser.
 */

// REPLACE THESE with your actual Firebase project settings.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const FIREBASE_SDK_VERSION = '10.12.2';
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

let app = null;
let database = null;
let auth = null;
let isInitialized = false;
let isConnected = false;
/** 'firebase' when the real SDK is live, otherwise 'local'. */
let mode = 'local';

function hasWindow() {
  return typeof window !== 'undefined';
}

/** True only when every required field has been replaced with a real value. */
function isFirebaseConfigured(config = firebaseConfig) {
  if (!config || typeof config !== 'object') return false;
  return REQUIRED_CONFIG_KEYS.every((key) => {
    const value = config[key];
    return typeof value === 'string' && value.length > 0 && !value.includes('YOUR_');
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(existing); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Prepares Firebase when it is configured. Never throws in local mode: the
 * caller can keep rendering the UI and let the local auth provider sign in.
 * @returns {Promise<object|null>} the Firebase app, or null in local mode.
 */
async function initFirebase() {
  if (isInitialized) return app;

  if (!isFirebaseConfigured()) {
    mode = 'local';
    isInitialized = true;
    console.info('[Active Plus] Firebase config not set — running in local (offline) mode.');
    return null;
  }

  try {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    if (typeof window.firebase === 'undefined') {
      await loadScript(`${base}/firebase-app-compat.js`);
      await loadScript(`${base}/firebase-auth-compat.js`);
      await loadScript(`${base}/firebase-database-compat.js`);
    }
    if (typeof window.firebase === 'undefined') throw new Error('Firebase SDK not loaded');

    app = window.firebase.initializeApp(firebaseConfig);
    database = window.firebase.database(app);
    auth = window.firebase.auth(app);
    mode = 'firebase';
    isInitialized = true;
    setupConnectivityMonitoring();
    console.info('[Active Plus] Firebase initialized:', { projectId: firebaseConfig.projectId });
    return app;
  } catch (error) {
    // Fall back instead of breaking the login screen.
    mode = 'local';
    isInitialized = true;
    app = null;
    database = null;
    auth = null;
    console.warn('[Active Plus] Firebase unavailable, using local mode:', error.message);
    return null;
  }
}

function getAuthMode() { return mode; }

function setupConnectivityMonitoring() {
  if (!database) return;
  const ref = database.ref('.info/connected');
  ref.on('value', (snap) => {
    isConnected = snap.val() === true;
    if (hasWindow()) {
      window.dispatchEvent(new CustomEvent('firebase-connection-changed', { detail: { connected: isConnected } }));
    }
  });
}

function getDatabase() { return database; }
function getAuth() { return auth; }

/**
 * Resolves with the RTDB connection state. In local mode it resolves `false`
 * immediately rather than waiting forever on a socket that does not exist.
 */
function checkConnectionStatus() {
  return new Promise((resolve) => {
    if (!database) { isConnected = false; resolve(false); return; }
    const timeout = setTimeout(() => resolve(isConnected), 5000);
    database.ref('.info/connected').once('value', (snapshot) => {
      clearTimeout(timeout);
      isConnected = snapshot.val() === true;
      resolve(isConnected);
    });
  });
}

/** Boolean, and correct when Firebase was never initialised. */
function isAuthenticated() { return Boolean(auth && auth.currentUser); }
function getCurrentUser() { return auth ? auth.currentUser : null; }

async function signInWithEmailAndPassword(email, password) {
  if (!auth) await initFirebase();
  if (!auth) throw new Error('Firebase authentication is not configured');
  return auth.signInWithEmailAndPassword(email, password);
}

async function signOut() {
  if (auth) { try { await auth.signOut(); } catch (e) { /* ignore */ } }
  if (hasWindow()) {
    try {
      localStorage.removeItem('activeplus_user');
      localStorage.removeItem('activeplus_role');
      localStorage.removeItem('activeplus_studentId');
      localStorage.removeItem('activeplus_session');
    } catch (e) { /* storage may be blocked */ }
  }
  return true;
}

async function sendPasswordResetEmail(email) {
  if (!auth) throw new Error('Auth not initialized');
  return auth.sendPasswordResetEmail(email);
}

/* ------------------------------------------------------------------ */
/* Named references used by the dashboards                             */
/* ------------------------------------------------------------------ */
const dbRefs = {
  students: 'students',
  teachers: 'teachers',
  classes: 'classes',
  routine: 'routine',
  attendance: 'attendance',
  fees: 'fees',
  results: 'results',
  notices: 'notices',
  activityLogs: 'activityLogs'
};

function ref(path) {
  const db = getDatabase();
  if (!db) return null;
  return db.ref(path);
}

/* ------------------------------------------------------------------ */
/* Student ID helpers                                                  */
/* ------------------------------------------------------------------ */
function generateStudentId(year, className, roll) {
  const yearStr = String(year).padStart(4, '0').substring(0, 4);
  const classStr = String(className).padStart(2, '0');
  const rollStr = String(roll).padStart(3, '0');
  return `${yearStr}-${classStr}-${rollStr}`;
}

function parseStudentId(studentId) {
  const parts = String(studentId || '').split('-');
  return { year: parts[0] || '', className: parts[1] || '', roll: parts[2] || '' };
}

function validateStudentId(studentId) {
  return typeof studentId === 'string' && /^\d{4}-\d{1,2}-\d{1,3}$/.test(studentId);
}

/* ------------------------------------------------------------------ */
/* Local storage helpers                                               */
/* ------------------------------------------------------------------ */
function storage() {
  return hasWindow() ? window.localStorage : null;
}

function saveUserSession(session) {
  try { storage()?.setItem('activeplus_user', JSON.stringify(session)); return true; } catch (e) { return false; }
}
function loadUserSession() {
  try { return JSON.parse(storage()?.getItem('activeplus_user') || 'null'); } catch (e) { return null; }
}
function clearUserSession() {
  try { storage()?.removeItem('activeplus_user'); } catch (e) { /* ignore */ }
}
function setUserRole(role) {
  try { storage()?.setItem('activeplus_role', role); return true; } catch (e) { return false; }
}
function getUserRole() {
  try { return storage()?.getItem('activeplus_role'); } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
/* Activity log (best effort)                                          */
/* ------------------------------------------------------------------ */
function addActivityLog(action, module = 'system') {
  const db = getDatabase();
  if (!db) return Promise.resolve(null);
  const user = getCurrentUser();
  const uid = user?.uid || 'anonymous';
  const role = getUserRole() || 'student';
  return db.ref(dbRefs.activityLogs)
    .push({ userId: uid, userRole: role, action, module, timestamp: new Date().toISOString() })
    .catch(() => null);
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
function toastContainer() {
  if (!hasWindow() || !document.body) return null;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = toastContainer();
  if (!container) return null;
  const allowed = ['success', 'error', 'warning', 'info'];
  const toast = document.createElement('div');
  toast.className = `toast ${allowed.includes(type) ? type : 'info'}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
  return toast;
}

if (hasWindow()) window.showToast = showToast;

export {
  firebaseConfig,
  dbRefs,
  initFirebase,
  isFirebaseConfigured,
  getAuthMode,
  getDatabase,
  getAuth,
  ref,
  checkConnectionStatus,
  isAuthenticated,
  getCurrentUser,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  generateStudentId,
  parseStudentId,
  validateStudentId,
  saveUserSession,
  loadUserSession,
  clearUserSession,
  setUserRole,
  getUserRole,
  addActivityLog,
  showToast
};
