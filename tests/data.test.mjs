/** CRUD + persistence for the admin data layer (js/data.js). */
import test from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k)
  };
}

const redirects = [];
function installWindow(localStorage) {
  globalThis.window = {
    localStorage,
    location: { pathname: '/admin.html', search: '', hash: '', href: '', replace: (u) => redirects.push(u) },
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
}

test('students: add with school/college, edit, delete — persisted across page loads', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();

  const { db } = await import('../js/data.js?page=1');
  const before = db.students.list().length;
  assert.ok(before >= 1, 'seeded students exist');
  assert.ok(db.students.list().every((s) => 'school' in s), 'seed rows carry the school/college field');

  // Admission with school/college name.
  db.students.add({
    id: '2026-09-009', name: 'পরীক্ষা শিক্ষার্থী', className: 'নবম', roll: '০৯',
    phone: '০১৭০০-০০০০৯', school: 'ঢাকা কলেজিয়েট স্কুল অ্যান্ড কলেজ', status: 'সক্রিয়'
  });
  assert.equal(db.students.list().length, before + 1);
  assert.equal(db.students.find('2026-09-009').school, 'ঢাকা কলেজিয়েট স্কুল অ্যান্ড কলেজ');

  // Edit.
  db.students.update('2026-09-009', { school: 'নটর ডেম কলেজ', status: 'বকেয়া' });
  const updated = db.students.find('2026-09-009');
  assert.equal(updated.school, 'নটর ডেম কলেজ');
  assert.equal(updated.status, 'বকেয়া');

  // A brand-new "page load" (fresh module + memory) must still see the edits.
  (await import('../js/store.js'))._clearMemoryStore();
  const { db: db2 } = await import('../js/data.js?page=2');
  assert.equal(db2.students.find('2026-09-009').school, 'নটর ডেম কলেজ', 'edit persisted');

  // Delete.
  assert.equal(db2.students.remove('2026-09-009'), true);
  assert.equal(db2.students.find('2026-09-009'), null);
  assert.equal(db2.students.list().length, before);
});

test('teachers + notices CRUD and settings update', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();

  const { db } = await import('../js/data.js?page=3');

  db.teachers.add({ name: 'তানভীর আহমেদ', subject: 'জীববিজ্ঞান', phone: '০১৯১১-৫৫৫৫৫', classes: 3 });
  assert.ok(db.teachers.find('তানভীর আহমেদ'));
  db.teachers.update('তানভীর আহমেদ', { classes: 7 });
  assert.equal(db.teachers.find('তানভীর আহমেদ').classes, 7);
  db.teachers.remove('তানভীর আহমেদ');
  assert.equal(db.teachers.find('তানভীর আহমেদ'), null);

  const noticeCount = db.notices.list().length;
  db.notices.add({ id: 'n-test', title: 'পরীক্ষার নোটিশ', audience: 'শিক্ষার্থী', date: '২০২৬-০৯-০৩' });
  assert.equal(db.notices.list().length, noticeCount + 1);
  db.notices.update('n-test', { title: 'পরীক্ষার নোটিশ (সংশোধিত)' });
  assert.equal(db.notices.find('n-test').title, 'পরীক্ষার নোটিশ (সংশোধিত)');
  db.notices.remove('n-test');
  assert.equal(db.notices.find('n-test'), null);
  assert.equal(db.notices.list().length, noticeCount);

  db.settings.update({ monthlyFee: 1500, orgName: 'Active Plus Coaching (শাখা ২)' });
  const settings = db.settings.get();
  assert.equal(settings.monthlyFee, 1500);
  assert.match(settings.orgName, /শাখা ২/);

  db.reset();
  assert.equal(db.settings.get().monthlyFee, 1200, 'reset restores the seed');
});
