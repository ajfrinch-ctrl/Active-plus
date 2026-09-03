import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/* ------------------------------------------------------------------ */
/* Minimal browser stubs so the ES modules evaluate in Node            */
/* ------------------------------------------------------------------ */
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear()
  };
}

const redirects = [];
function installWindow(localStorage) {
  const window = {
    localStorage,
    location: {
      pathname: '/index.html',
      search: '',
      href: '',
      replace: (url) => redirects.push(['replace', url]),
      assign: (url) => redirects.push(['assign', url])
    },
    addEventListener() {},
    dispatchEvent() {},
    firebase: undefined
  };
  globalThis.window = window;
  globalThis.localStorage = localStorage;
  // Document without a body: helpers that need the real DOM bail out early.
  globalThis.document = {
    body: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, appendChild() {}, textContent: '', style: {}
    }),
    addEventListener() {}
  };
  return window;
}

/* ------------------------------------------------------------------ */
/* Module-level exports                                                */
/* ------------------------------------------------------------------ */
test('js/firebase.js exposes the named exports the pages import', async () => {
  installWindow(makeLocalStorage());
  const fb = await import('../js/firebase.js');
  for (const name of [
    'initFirebase', 'isFirebaseConfigured', 'getAuthMode', 'checkConnectionStatus',
    'isAuthenticated', 'signInWithEmailAndPassword', 'signOut',
    'showToast', 'generateStudentId', 'validateStudentId',
    'setUserRole', 'getUserRole', 'addActivityLog'
  ]) {
    assert.equal(typeof fb[name], 'function', `missing export: ${name}`);
  }
  assert.equal(typeof fb.firebaseConfig, 'object', 'firebaseConfig export');
  assert.equal(typeof fb.dbRefs, 'object', 'dbRefs export');
});

test('without a real config the app boots into local mode, never throwing', async () => {
  installWindow(makeLocalStorage());
  const fb = await import('../js/firebase.js');
  assert.equal(fb.isFirebaseConfigured(), false);
  const app = await fb.initFirebase();
  assert.equal(app, null);
  assert.equal(fb.getAuthMode(), 'local');
  const connected = await fb.checkConnectionStatus();
  assert.equal(connected, false);
  assert.equal(fb.isAuthenticated(), false);
});

test('local sign-in: valid, wrong password, and role mismatch', async () => {
  installWindow(makeLocalStorage());
  await import('../js/firebase.js');
  // Fresh module instance per scenario (mirrors a fresh browser page load).
  const auth = await import('../js/auth.js?suite=signin');

  const session = await auth.signIn('2026-09-001', 'Student@123', 'student');
  assert.equal(session.role, 'student');
  assert.equal(auth.currentSession()?.role, 'student');

  await assert.rejects(
    () => auth.signIn('2026-09-001', 'nope', 'student'),
    (err) => err.code === 'wrong-password'
  );

  await assert.rejects(
    () => auth.signIn('2026-09-001', 'Student@123', 'admin'),
    (err) => err.code === 'role-mismatch'
  );
});

test('requireRole guards: guest redirected, right role passes, wrong role bounced home', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  await import('../js/firebase.js');
  const auth = await import('../js/auth.js?suite=guard');

  // Guest on student.html -> redirected to the login page with ?next.
  redirects.length = 0;
  window.location.pathname = '/student.html';
  assert.equal(auth.requireRole(['student']), null);
  assert.match(redirects.at(-1)[1], /index\.html\?next=student\.html/);

  // Signed-in student is allowed.
  await auth.signIn('2026-09-001', 'Student@123', 'student');
  const session = auth.requireRole(['student']);
  assert.equal(session.role, 'student');

  // A student on admin.html is sent to their own home (with session handoff).
  redirects.length = 0;
  assert.equal(auth.requireRole(['admin']), null);
  assert.match(redirects.at(-1)[1], /^student\.html(#s=.*)?$/);
});

/* ------------------------------------------------------------------ */
/* Static DOM structure (the regressions we fixed)                     */
/* ------------------------------------------------------------------ */
test('index.html: login UI nests correctly (button no longer swallows the page)', () => {
  const dom = new JSDOM(read('index.html'));
  const { document } = dom.window;
  const btn = document.getElementById('login-btn');
  assert.equal(btn.tagName, 'BUTTON');
  assert.equal(btn.getAttribute('type'), 'submit');
  assert.equal(btn.children.length, 0, 'login button must only contain its label');

  const container = document.querySelector('.auth-shell');
  assert.ok(container.contains(btn), 'login button inside .auth-shell');
  assert.ok(container.contains(document.querySelector('.role-options')), 'role options inside .auth-shell');
  assert.ok(container.contains(document.getElementById('status-bar')), 'status bar inside .auth-shell');
  const card = document.querySelector('.login-card');
  assert.ok(card.contains(document.getElementById('status-bar')), 'status bar inside login-card');

  const radios = document.querySelectorAll('input[name="role"]');
  assert.equal(radios.length, 3, 'three role radios');
  assert.ok(document.querySelector('form#login-form'), 'login form present');
});

test('dashboard pages share the mobile app shell', () => {
  for (const page of ['student.html', 'teacher.html', 'admin.html']) {
    const dom = new JSDOM(read(page));
    const { document } = dom.window;
    assert.ok(document.querySelector('.app-header'), `${page} has header`);
    assert.ok(document.querySelector('.top-tab-bar[role="tablist"]'), `${page} has tablist`);
    assert.ok(document.getElementById('logout-btn'), `${page} has logout`);
    const buttons = document.querySelectorAll('.top-tab-bar button[data-tab]');
    const panels = document.querySelectorAll('.tab-panel');
    assert.ok(buttons.length >= 3, `${page} has several tabs`);
    for (const button of buttons) {
      assert.ok(
        [...panels].some((panel) => panel.id === `tab-${button.dataset.tab}`),
        `${page}: every tab button has a panel (${button.dataset.tab})`
      );
    }
    // Tables are wrapped so the page itself never scrolls sideways.
    document.querySelectorAll('table.table').forEach((table) => {
      assert.equal(table.parentElement.classList.contains('table-wrap'), true, `${page}: table wrapped`);
    });
  }
});

test('every page links the viewport + stylesheet (mobile friendly)', () => {
  for (const page of ['index.html', 'student.html', 'teacher.html', 'admin.html']) {
    const dom = new JSDOM(read(page));
    const { document } = dom.window;
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    assert.match(viewport, /width=device-width/);
    assert.match(viewport, /viewport-fit=cover/);
    assert.ok(document.querySelector('link[rel="stylesheet"][href="css/style.css"]'), `${page} links style.css`);
    assert.ok(document.querySelector('link[rel="manifest"]'), `${page} links manifest`);
  }
});
