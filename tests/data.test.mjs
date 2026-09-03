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

test('class filtering + class-targeted notices reach the right students', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();
  const mod = await import('../js/data.js?page=4');
  const { db, studentsOfClass, noticesFor, ALL_CLASSES } = mod;

  // Class filter: seeded classes.
  const ninth = studentsOfClass('নবম');
  assert.ok(ninth.length >= 1);
  assert.ok(ninth.every((s) => s.className === 'নবম'));
  assert.equal(studentsOfClass(ALL_CLASSES).length, db.students.list().length);

  // A class-targeted notice reaches that class only (+ everyone notices).
  db.notices.add({ id: 'n-ten', title: 'দশম ক্লাস নোটিশ', audience: 'শিক্ষার্থী', className: 'দশম', date: '২০৬-০৯-০৩' });
  const tenth = studentsOfClass('দশম')[0];
  const ninthSt = studentsOfClass('নবম')[0];
  const tenNotices = noticesFor(tenth).map((n) => n.id);
  const nineNotices = noticesFor(ninthSt).map((n) => n.id);
  assert.ok(tenNotices.includes('n-ten'), '10th grade student sees class notice');
  assert.ok(!nineNotices.includes('n-ten'), '9th grade student does not');

  // A personal (forStudent) notice reaches only that student.
  db.notices.add({ id: 'n-me', title: 'ব্যক্তিগত', audience: 'শিক্ষার্থী', className: ninthSt.className, forStudent: ninthSt.id, date: '২০২৬-০৯-০৩' });
  assert.ok(noticesFor(ninthSt).some((n) => n.id === 'n-me'));
  const otherNine = ninth.find?.((s) => s.id !== ninthSt.id) || studentsOfClass('নবম').find((s) => s.id !== ninthSt.id);
  if (otherNine) assert.ok(!noticesFor(otherNine).some((n) => n.id === 'n-me'), 'personal notice is private');
});

test('receivePayment clears due, records payment, notifies the student', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();
  const { db, dueFees, receivePayment } = await import('../js/data.js?page=5');

  const before = dueFees();
  assert.ok(before.length >= 1, 'seed has dues');
  const target = before[0];

  const result = receivePayment(target.id, 'অ্যাডমিন');
  assert.ok(result, 'payment processed');
  assert.equal(db.fees.find(target.id).status, 'পরিশোধিত');
  assert.ok(db.payments.list().some((p) => p.studentId === target.studentId));

  // If nothing else is due, the student's status flips back to সক্রিয়.
  const stillDue = dueFees().some((d) => d.studentId === target.studentId);
  if (!stillDue) assert.equal(db.students.find(target.studentId).status, 'সক্রিয়');

  // A personal/class notice was sent to that student.
  const { noticesFor } = await import('../js/data.js?page=5');
  const student = db.students.find(target.studentId);
  assert.ok(
    noticesFor(student).some((n) => n.forStudent === student.id && n.title.includes('পেমেন্ট গৃহীত')),
    'student receives payment notice'
  );
  assert.equal(dueFees().length, before.length - 1, 'due list shrank');
});

test('scoreExam grades answers correctly', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();
  const { db, scoreExam } = await import('../js/data.js?page=6');
  const exam = db.exams.list()[0];
  const perfect = {};
  exam.questions.forEach((q, i) => { perfect[i] = q.answer; });
  assert.deepEqual(scoreExam(exam, perfect), { score: exam.questions.length, total: exam.questions.length });
  const wrong = {};
  exam.questions.forEach((q, i) => { wrong[i] = (q.answer + 1) % 4; });
  assert.equal(scoreExam(exam, wrong).score, 0);
});

test('parseMcqPaste parses blocks, drops invalid + duplicates', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const { parseMcqPaste } = await import('../js/data.js?page=7');
  const text = [
    '৫+৩=?\nA. ৮\nB. ১\nC. ১৬\nD. ১০\nসঠিক: B',
    'ত্রিভুজের কোণের সমষ্টি?\nA. ৯০\nB. ১৮০\nC. ২৭০\nD. ৩৬০\nসঠিক: B',
    'অসম্পূর্ণ', // invalid
    '৫+৩=?\nA. ৮\nB. ১১\nC. ১৬\nD. ১০\nসঠিক: B' // duplicate
  ].join('\n\n');
  const { questions, duplicates } = parseMcqPaste(text);
  assert.equal(questions.length, 2, 'two valid unique questions');
  assert.equal(questions[0].answer, 1);
  assert.equal(duplicates.length, 1, 'one duplicate detected');
});

test('backup export -> import round-trips collections', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const mod = await import('../js/data.js?page=8');
  const { db, exportBackup, importBackup } = mod;
  db.students.add({ id: '2026-09-999', name: 'ব্যাকআপ টেস্ট', className: 'নবম', roll: '৯', school: 'x', status: 'সক্রিয়' });
  const backup = exportBackup();
  db.students.remove('2026-09-999');
  assert.equal(db.students.find('2026-09-999'), null);
  const res = importBackup(backup);
  assert.equal(res.ok, true);
  assert.ok(db.students.find('2026-09-999'), 'record restored from backup');
  assert.equal(importBackup('not json').ok, false, 'invalid rejected');
});
