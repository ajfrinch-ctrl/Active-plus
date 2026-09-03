/**
 * Firebase Configuration for Active Plus Coaching Management System
 * GitHub Pages compatible - replace placeholders with actual Firebase project config
 */

// REPLACE THESE with your actual Firebase project settings
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let app = null;
let database = null;
let auth = null;
let isInitialized = false;
let isConnected = false;

function initFirebase() {
  if (isInitialized && app) return app;
  try {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
    app = firebase.initializeApp(firebaseConfig);
    database = firebase.database(app);
    auth = firebase.auth(app);
    isInitialized = true;
    setupConnectivityMonitoring();
    console.log('Firebase initialized:', { projectId: firebaseConfig.projectId });
    return app;
  } catch (error) {
    console.error('Firebase init error:', error);
    throw error;
  }
}

function setupConnectivityMonitoring() {
  const ref = database.ref('.info/connected');
  ref.on('value', (snap) => {
    isConnected = snap.val() === true;
    const event = new CustomEvent('firebase-connection-changed', { detail: { connected: isConnected } });
    window.dispatchEvent(event);
  });
}

function getDatabase() { if (!database) initFirebase(); return database; }
function getAuth() { if (!auth) initFirebase(); return auth; }

function checkConnectionStatus() {
  return new Promise((resolve) => {
    const ref = getDatabase().ref('.info/connected');
    ref.once('value', (snapshot) => {
      isConnected = snapshot.val() === true;
      resolve(isConnected);
    });
  });
}

function isAuthenticated() { return auth?.currentUser !== null; }
function getCurrentUser() { return auth?.currentUser; }

async function signInWithEmailAndPassword(email, password) {
  if (!auth) await initFirebase();
  return auth.signInWithEmailAndPassword(email, password);
}
async function signOut() {
  if (auth) await auth.signOut();
  localStorage.removeItem('activeplus_user');
  localStorage.removeItem('activeplus_role');
  localStorage.removeItem('activeplus_studentId');
  return true;
}
async function sendPasswordResetEmail(email) {
  if (!auth) throw new Error('Auth not initialized');
  return auth.sendPasswordResetEmail(email);
}

// Student ID helpers
function generateStudentId(year, className, roll) {
  const yearStr = String(year).padStart(4, '0').substring(0, 4);
  const classStr = String(className).padStart(2, '0');
  const rollStr = String(roll).padStart(3, '0');
  return `${yearStr}-${classStr}-${rollStr}`;
}
function parseStudentId(studentId) {
  const parts = studentId.split('-'); return { year: parts[0], className: parts[1], roll: parts[2] };
}
function validateStudentId(studentId) {
  return studentId && /^\d{4}-\d{1,2}-\d{1,3}$/.test(studentId);
}

// Local storage helpers
function saveUserSession(session) { try { localStorage.setItem('activeplus_user', JSON.stringify(session)); return true; } catch(e) { return false; } }
function loadUserSession() { try { return JSON.parse(localStorage.getItem('activeplus_user') || 'null'); } catch(e) { return null; } }
function setUserRole(role) { try { localStorage.setItem('activeplus_role', role); return true; } catch(e) { return false; } }
function getUserRole() { try { return localStorage.getItem('activeplus_role'); } catch(e) { return null; } }

// Activity log
function addActivityLog(action, module = 'system') {
  if (!isAuthenticated()) return;
  const user = getCurrentUser();
  const uid = user?.uid || 'anonymous';
  const role = getUserRole() || 'student';
  const timestamp = new Date().toISOString();
  const db = getDatabase();
  if (!db) return;
  db.ref('activityLogs').push({ userId: uid, userRole: role, action, module, timestamp })
    .catch(() => {});
}

// Toast
function showToast(message, type = 'info') {
  const colors = { success: 'var(--success)', error: 'var(--warning)', info: '#4a5568' };
  const toast = document.createElement('div');
  toast.style.position = 'fixed'; toast.style.bottom = '2rem'; toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)'; toast.style.background = colors[type] || colors.info;
  toast.style.color = 'white'; toast.style.padding = '0.75rem 1.25rem';
  toast.style.borderRadius = '8px'; toast.style.zIndex = '9999'; toast.style.fontSize = '0.875rem';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('show'); }, 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
window.showToast = showToast;