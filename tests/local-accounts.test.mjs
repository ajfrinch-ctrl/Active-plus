/**
 * Sign-ins the centre opens itself.
 *
 * The app ships with ONE account — the admin an installer is handed — and an
 * empty store, and local mode has no sign-up screen. So "give a teacher or a
 * student a way in" has to be a feature, not a fixture: `createLocalAccount()`
 * is the rule book, and Admin → ইউজার ও অনুমতি → লোকাল অ্যাকাউন্ট is the form.
 * The sample records that used to come with the app live in js/demo-data.js,
 * which no page may import — the last test here keeps that true.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { _clearMemoryStore } from '../js/store.js';
import { loadDemoData } from '../js/demo-data.js';
import { bootPortal, read, ROOT } from './helpers/portal.mjs';

const ADMIN = { username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin' };

/* A window without jsdom: enough for the auth module, which only needs storage. */
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k)
  };
}

function installWindow() {
  const localStorage = makeLocalStorage();
  globalThis.window = {
    localStorage,
    location: { pathname: '/admin.html', search: '', hash: '', href: '', replace: () => {} },
    history: { replaceState() {} },
    addEventListener() {},
    dispatchEvent() {},
    firebase: undefined
  };
  globalThis.localStorage = localStorage;
  globalThis.document = {
    body: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, textContent: '', style: {} }),
    addEventListener() {}
  };
  return localStorage;
}

const click = (doc, sel) => doc.querySelector(sel).dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
const submit = (dom, el) => el.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

/* ------------------------------------------------------------------ */
/* What the app itself ships with                                       */
/* ------------------------------------------------------------------ */

test('the installer is handed one account: the admin — no demo teacher, no demo student', async () => {
  installWindow();
  _clearMemoryStore();
  const { DEMO_ACCOUNTS } = await import('../js/auth.js?accounts=ships');
  assert.equal(DEMO_ACCOUNTS.length, 1, `exactly one bootstrap account, got ${DEMO_ACCOUNTS.length}`);
  assert.equal(DEMO_ACCOUNTS[0].role, 'admin', 'and it belongs to the institute');
  assert.equal(DEMO_ACCOUNTS.some((a) => a.role === 'student' || a.role === 'teacher'), false,
    'no sample person can sign into a real install');
});

test('resetting the data never logs anybody out of existence', async () => {
  installWindow();
  _clearMemoryStore();
  loadDemoData();
  const auth = await import('../js/auth.js?accounts=reset');
  await auth.seedUsers({ force: true });
  await auth.createLocalAccount({ username: 'sir@activeplus.edu', password: 'Teach@123', role: 'teacher', name: 'রফিকুল ইসলাম' });
  const { db } = await import('../js/data.js?accounts=reset');
  const before = auth.listUsers().map((u) => u.username).sort();

  db.reset(); // the admin's danger-zone button
  assert.equal(db.students.list().length, 0, 'the records are gone');
  assert.deepEqual(auth.listUsers().map((u) => u.username).sort(), before, 'the sign-ins are not');

  // and the account that was opened for a teacher still works afterwards
  const session = await auth.signIn('sir@activeplus.edu', 'Teach@123');
  assert.equal(session.role, 'teacher', 'a reset must not break a login');
});

/* ------------------------------------------------------------------ */
/* createLocalAccount: the rules an unusable account must never be saved */
/* ------------------------------------------------------------------ */

test('an admin opens a teacher account, and that account signs in', async () => {
  const storage = installWindow();
  _clearMemoryStore();
  loadDemoData();
  const auth = await import('../js/auth.js?accounts=create');
  await auth.seedUsers({ force: true });

  const created = await auth.createLocalAccount({
    username: '  Sir@ActivePlus.edu ', password: 'Teach@123', role: 'teacher', name: 'রাহেলা আক্তার', detail: 'পদার্থবিজ্ঞান · নবম'
  });
  assert.equal(created.persisted, true, 'the write reached storage, and says so');
  assert.equal(created.username, 'sir@activeplus.edu', 'usernames are trimmed and lower-cased');
  assert.equal(created.role, 'teacher');
  assert.match(created.uid, /^local-teacher-\d+$/, 'a local uid, distinct from a Firebase uid');

  const found = auth.listUsers().find((u) => u.username === 'sir@activeplus.edu');
  assert.ok(found, 'the account is in the local user store');
  assert.equal(found.name, 'রাহেলা আক্তার');
  assert.equal(found.passwordHash === undefined, false, 'a hash is stored');
  assert.equal(String(storage.getItem('activeplus_users')).includes('Teach@123'), false,
    'the password itself is never written to storage');

  const session = await auth.signIn('sir@activeplus.edu', 'Teach@123');
  assert.equal(session.role, 'teacher', 'the role is read from the account, not guessed');
  assert.equal(auth.listUsers().length, 2, 'admin + this teacher');
});

test('accounts that could never sign in are refused — and refused without writing', async () => {
  installWindow();
  _clearMemoryStore();
  const auth = await import('../js/auth.js?accounts=refuse');
  await auth.seedUsers({ force: true });

  const cases = [
    [{ username: '   ', password: 'Teach@123', role: 'teacher' }, 'no-username', 'an empty username'],
    [{ username: 'a@b.c', password: 'Teach@123', role: 'parent' }, 'bad-role', 'a role the app has no portal for'],
    [{ username: 'a@b.c', password: '12345', role: 'teacher' }, 'weak-password', 'a password too short to keep'],
    [{ username: 'sadia@example.com', password: 'Teach@123', role: 'student' }, 'bad-student-id', 'a student whose username is not an admission ID'],
    [{ username: 'admin@activeplus.edu', password: 'Teach@123', role: 'teacher' }, 'username-taken', 'a username that is already a person']
  ];
  for (const [input, code, why] of cases) {
    await assert.rejects(() => auth.createLocalAccount(input), (error) => error?.code === code, why);
  }
  assert.equal(auth.listUsers().length, 1, 'not one of the rejected attempts was saved');
  assert.equal(auth.listUsers()[0].role, 'admin', 'the institute is still the only account');

  // the same input fixed is accepted — the refusal was about the field, not the user
  const ok = await auth.createLocalAccount({ username: '2026-09-042', password: 'Teach@123', role: 'student', name: 'সাদিয়া আক্তার' });
  assert.equal(ok.username, '2026-09-042', 'a student ID in the right shape opens fine');
});

test('a blocked storage is admitted, never pretended away', async () => {
  const boom = () => { throw new DOMException('storage disabled', 'SecurityError'); };
  globalThis.window = {
    localStorage: { getItem: boom, setItem: boom, removeItem: boom },
    location: { pathname: '/admin.html', search: '', hash: '', href: '', replace: () => {} },
    history: { replaceState() {} },
    addEventListener() {},
    dispatchEvent() {},
    firebase: undefined
  };
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.document = {
    body: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, textContent: '', style: {} }),
    addEventListener() {}
  };
  _clearMemoryStore();
  const auth = await import('../js/auth.js?accounts=blocked');

  const created = await auth.createLocalAccount({ username: 'sir@activeplus.edu', password: 'Teach@123', role: 'teacher' });
  assert.equal(created.persisted, false, 'the API admits the write never landed in storage');
  const session = await auth.signIn('sir@activeplus.edu', 'Teach@123');
  assert.equal(session.role, 'teacher', 'the account still works for this page load');
});

/* ------------------------------------------------------------------ */
/* The form in the admin panel                                         */
/* ------------------------------------------------------------------ */

test('Admin → ইউজার ও অনুমতি: the account form opens a sign-in the portal can use', async () => {
  const dom = await bootPortal('admin.html', { ...ADMIN, nonce: 'accounts' });
  const doc = dom.window.document;

  // The section lives on the users tab, next to the permission matrix.
  click(doc, '#admin-side-nav [data-side-tab="users"]');
  const form = doc.getElementById('account-form');
  assert.ok(form && !doc.getElementById('tab-users').hidden, 'the users tab exposes the account form');

  const field = (name) => form.querySelector(`#account-${name}`);
  field('username').value = '2026-09-042';
  field('role').value = 'student';
  field('name').value = 'সাদিয়া আক্তার';
  field('detail').value = 'নবম · রোল ৪২';
  field('password').value = 'Student@123';
  submit(dom, form);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const auth = await import('../js/auth.js');
  assert.ok(auth.listUsers().some((u) => u.username === '2026-09-042'), 'the account was created');
  assert.match(doc.getElementById('users-list').textContent, /সাদিয়া আক্তার/, 'and appears in the list straight away');
  assert.match(doc.getElementById('account-list').textContent, /সাদিয়া আক্তার/,
    'in the Settings copy of the same list too');
  const session = await auth.signIn('2026-09-042', 'Student@123');
  assert.equal(session.role, 'student', 'the new account signs into its own portal');

  // The form is a form: it clears itself after a success…
  assert.equal(field('username').value, '', 'the fields are reset after saving');

  // …and explains itself instead of failing silently.
  field('username').value = 'sadia@example.com';
  field('role').value = 'student';
  field('password').value = 'Student@123';
  submit(dom, form);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const toast = doc.querySelector('.toast.error');
  assert.ok(toast, 'a rejected attempt says so on screen');
  assert.match(toast.textContent, /আইডি/, 'in Bengali, naming the field that is wrong');
  assert.equal(auth.listUsers().filter((u) => u.username === 'sadia@example.com').length, 0,
    'and nothing half-made was saved');
});

test('no page loads the demo fixture — js/demo-data.js is test-only', () => {
  // A comment may POINT at the fixture ("the sample rows live there"); an
  // import puts it on a real user's screen. Only the second one is a bug.
  const IMPORTS_FIXTURE = /(?:from|import)\s*\(?\s*['"][^'"]*demo-data\.js['"]/;
  const offenders = [];
  const check = (rel) => {
    if (rel === 'js/demo-data.js') return;
    if (IMPORTS_FIXTURE.test(read(rel))) offenders.push(rel);
  };
  const walk = (dir) => {
    for (const entry of readdirSync(`${ROOT}/${dir}`, { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) check(rel);
    }
  };
  walk('js');
  // the pages themselves, at the root of the app
  for (const entry of readdirSync(ROOT)) {
    if (entry.endsWith('.html')) check(entry);
  }
  assert.deepEqual(offenders, [], `${offenders.join(', ')} must not import the demo fixture`);
});
