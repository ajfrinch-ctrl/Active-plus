/**
 * Reproduces the failure reported from the live preview: an embedded frame
 * where localStorage throws on every access. The app must still let a demo
 * account sign in AND carry the session across the redirect to the dashboard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function blockedLocalStorage() {
  const boom = () => { throw new DOMException('storage disabled', 'SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom };
}

function makeWindow({ pathname = '/index.html', hash = '' } = {}) {
  const redirects = [];
  const historyCalls = [];
  const win = {
    localStorage: blockedLocalStorage(),
    location: {
      pathname,
      hash,
      search: '',
      href: '',
      replace: (url) => redirects.push(['replace', url]),
      assign: (url) => redirects.push(['assign', url])
    },
    history: { replaceState: (...args) => historyCalls.push(args) },
    addEventListener() {},
    dispatchEvent() {},
    firebase: undefined
  };
  globalThis.window = win;
  globalThis.localStorage = win.localStorage;
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
  return { redirects, historyCalls };
}

test('login + redirect work even when localStorage is completely blocked', async () => {
  const { _clearMemoryStore } = await import('../js/store.js');

  /* ---- Page load 1: the login page ---- */
  makeWindow({ pathname: '/index.html' });
  _clearMemoryStore(); // a real browser starts each page load with a fresh realm
  const auth1 = await import('../js/auth.js?load=1');
  await import('../js/firebase.js');

  const session = await auth1.signIn('2026-09-001', 'Student@123', 'student');
  assert.equal(session.role, 'student', 'sign-in resolves in memory');

  const target = auth1.handoffUrl('student.html', session);
  assert.match(target, /^student\.html#s=.+/, 'handoff URL carries the token');

  /* ---- Page load 2: the dashboard after the redirect ---- */
  const hash = `#${target.split('#')[1]}`;
  const { redirects } = makeWindow({ pathname: '/student.html', hash });
  _clearMemoryStore();
  const auth2 = await import('../js/auth.js?load=2');

  const adopted = auth2.requireRole(['student']);
  assert.ok(adopted, 'dashboard finds the session without localStorage');
  assert.equal(adopted.role, 'student');
  assert.equal(adopted.name, session.name);
  assert.equal(redirects.length, 0, 'no login-loop redirect happened');
  assert.equal(auth2.currentSession()?.uid, session.uid, 'session readable after adoption');

  /* ---- Tampered token must be rejected ---- */
  const { redirects: redirects2 } = makeWindow({ pathname: '/student.html', hash: '#s=AAAA.tampered' });
  _clearMemoryStore();
  const auth3 = await import('../js/auth.js?load=3');
  assert.equal(auth3.requireRole(['student']), null);
  assert.match(redirects2.at(-1)[1], /index\.html\?next=student\.html/);
});
