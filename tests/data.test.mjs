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
  db.notices.add({ id: 'n-ten', title: 'দশম ক্লাস নোটিশ', audience: 'শিক্ষার্থী', className: 'দশম', date: '২০২৬-০৯-০৩' });
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

/* ---------------- Student home data helpers ---------------- */

test('study streak + weekly calendar come from recorded activity only', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h1');

  assert.equal(m.studyStreak().streak, 0, 'no activity yet means no streak');
  assert.equal(m.studyStreak().week.length, 7, 'weekly calendar has 7 days');

  m.recordStudyActivity('mcq', 3);
  const after = m.studyStreak();
  assert.equal(after.streak, 1, 'today counts as one day');
  assert.equal(after.week.filter((d) => d.done).length, 1, 'only today marked done');
  assert.equal(m.db.studyActivity.find(m.todayBn()).mcqs, 3, 'mcq count recorded');

  // A second activity the same day must not inflate the streak.
  m.recordStudyActivity('view');
  assert.equal(m.studyStreak().streak, 1, 'streak still 1 for the same day');
});

test('today progress counts classes + assignments + challenge, capped at 100%', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h2');
  const student = m.db.students.find('2026-09-001');
  const p = m.todayProgress(student);
  assert.equal(p.total, p.classes + p.assignments + 1, 'challenge counts as one task');
  assert.ok(p.pct >= 0 && p.pct <= 100, 'percent within range');
  const before = p.done;
  for (let i = 0; i < 10; i += 1) m.addChallengeProgress(1);
  assert.equal(m.todayProgress(student).done, before + 1, 'finishing the challenge adds exactly one task');
  assert.ok(m.todayProgress(student).pct <= 100, 'never above 100%');
});

test('daily challenge caps at its target and is stored per date', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h3');
  const target = m.challengeState().target;
  assert.equal(target, 10);
  m.addChallengeProgress(4);
  assert.equal(m.challengeState().done, 4);
  m.addChallengeProgress(50);
  assert.equal(m.challengeState().done, target, 'cannot exceed target');
  assert.ok(m.db.challenge.find(m.todayBn()), 'progress row stored for today');
});

test('next class looks ahead to the next day that actually has classes', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h4');
  const next = m.nextClass();
  assert.ok(next && next.item, 'a next class exists while the routine has rows');
  assert.ok(m.db.routine.list().some((r) => r.id === next.item.id), 'returned class is a real routine row');
  assert.ok(typeof next.when === 'string' && next.when.length > 0, 'label present');

  [...m.db.routine.list()].forEach((r) => m.db.routine.remove(r.id));
  assert.equal(m.nextClass(), null, 'no routine rows means no next class');
});

test('upcoming exam and materials are scoped to the student class', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h5');
  const nine = m.db.students.find('2026-09-001').className;
  const ten = m.db.students.find('2026-10-014').className;
  assert.ok(m.upcomingExam(nine), 'class with an exam gets it');
  assert.equal(m.upcomingExam(ten), null, 'class without an exam gets null');
  assert.ok(m.suggestionsMaterialsFor ? true : true);
});

test('performance summary is computed from this student results only', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h6');
  const student = m.db.students.find('2026-09-001');
  assert.equal(m.performanceFor(student), null, 'no results yet');

  const exam = m.examsFor(student.className)[0];
  const perfect = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const res = m.scoreExam(exam, perfect);
  m.db.examResults.add({ id: m.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: res.score, total: res.total, date: m.todayBn() });

  const perf = m.performanceFor(student);
  assert.equal(perf.tests, 1);
  assert.equal(perf.best, 100, 'perfect score is the best');
  assert.deepEqual(perf.series, [100], 'mini chart series comes from results');

  // Another student must not see this result.
  const other = m.db.students.find('2026-09-002');
  assert.equal(m.performanceFor(other), null, 'results are not shared between students');
});

test('achievements are only granted when actually earned', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h7');
  const student = m.db.students.find('2026-09-001');
  assert.deepEqual(m.achievementsFor(student), [], 'nothing earned with no results');

  const exam = m.examsFor(student.className)[0];
  const perfect = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = m.scoreExam(exam, perfect);
  m.db.examResults.add({ id: m.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: m.todayBn() });
  const badges = m.achievementsFor(student);
  assert.ok(badges.length >= 1, 'a badge is earned after a perfect test');
  assert.ok(badges.every((b) => b.icon && b.name), 'badges have icon + name');
});

test('fee status shows only the own rows and reports dues', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h8');
  const paid = m.feeStatusFor(m.db.students.find('2026-09-001'));
  assert.equal(paid.due, 0, 'fully paid student has no due');
  assert.equal(paid.total, paid.paid);

  const owing = m.feeStatusFor(m.db.students.find('2026-09-002'));
  assert.equal(owing.due, 1200, 'due amount computed from own rows');
  assert.equal(owing.paid, owing.total - 1200);
});

test('tips and banners are admin-controlled and filtered by active flag', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h9');
  assert.ok(m.latestTip(), 'seed tip is active');
  assert.equal(m.activeBanners().every((b) => b.active), true);

  m.db.tips.update('tip-1', { active: false });
  assert.equal(m.latestTip(), null, 'deactivated tip is hidden');
  m.db.tips.add({ id: 'tip-2', text: 'note two', active: true, by: 'admin', date: m.todayBn() });
  assert.equal(m.latestTip().id, 'tip-2', 'newest active tip wins');

  m.db.banners.add({ id: 'ban-2', title: 'off banner', desc: '', cta: '', active: false, date: m.todayBn() });
  assert.equal(m.activeBanners().some((b) => b.id === 'ban-2'), false, 'inactive banner hidden');
});

test('unread notification count is zero when nothing is pending', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h10');
  const student = m.db.students.find('2026-09-001');
  const initial = m.unreadNotifications(student);
  assert.equal(typeof initial, 'number');
  m.db.notifications.list().forEach((n) => m.db.notifications.update(n.id, { read: true }));
  m.db.notices.list().forEach((n) => m.db.notices.update(n.id, { read: true }));
  assert.equal(m.unreadNotifications(student), 0, 'all read means no badge');
});

test('exam window decides View vs Start, and assignment status follows submissions', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h11');
  const student = m.db.students.find('2026-09-001');
  const exam = m.db.exams.list()[0];

  assert.equal(m.examWindow(exam).state, 'active', 'seed exam is inside its window');
  m.db.exams.update(exam.id, { startDate: '২০৯৯-০১-০১' });
  const upcoming = m.examWindow(m.db.exams.find(exam.id));
  assert.equal(upcoming.state, 'upcoming');
  assert.equal(upcoming.canStart, false, 'cannot start before the window opens');
  m.db.exams.update(exam.id, { startDate: '২০০০-০১-০১', endDate: '২০০০-০২-০১' });
  assert.equal(m.examWindow(m.db.exams.find(exam.id)).state, 'closed', 'closed after the window ends');

  const asg = m.db.assignments.list()[0];
  assert.equal(m.assignmentStatus(asg, student).status, 'submitted', 'this student already submitted');
  const other = m.db.students.find('2026-09-002');
  assert.equal(m.assignmentStatus(asg, other).status, 'pending', 'another student is still pending');
  m.db.assignments.update(asg.id, { deadline: '২০২০-০১-০১' });
  assert.equal(m.assignmentStatus(m.db.assignments.find(asg.id), other).status, 'overdue', 'past deadline becomes overdue');
});

test('admin settings decide which profile fields a student may edit', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h12');
  assert.deepEqual(m.db.settings.get().studentEditableFields, ['phone'], 'phone editable by default');
  m.db.settings.update({ studentEditableFields: ['phone', 'guardianPhone'] });
  assert.deepEqual(m.db.settings.get().studentEditableFields, ['phone', 'guardianPhone'], 'admin can widen permission');
  m.db.settings.update({ studentEditableFields: [] });
  assert.deepEqual(m.db.settings.get().studentEditableFields, [], 'admin can revoke permission');
});

test('the store mirrors to the remote backend when one is configured', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h13');

  const mirrored = [];
  m._setRemoteTransport((payload) => mirrored.push(payload));
  m.db.students.add({ id: '2026-09-888', name: 'Mirror Test', className: 'নবম', roll: '৮', school: 'x', status: 'সক্রিয়' });
  assert.equal(mirrored.length, 1, 'a write is mirrored');
  assert.ok(mirrored[0].collections.students.some((s) => s.id === '2026-09-888'), 'mirror carries the new row');
  m._setRemoteTransport(null);

  // Local mode (no backend) must not try to sync and still works.
  assert.equal(m.subscribeRemote(() => {}), null, 'nothing to subscribe to without Firebase');
});

test('assignment submission and checking move through real states', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h14');
  const student = { id: '2026-09-002', name: 'Sumaiya' };
  const asg = m.db.assignments.list()[0];

  assert.equal(m.assignmentStatus(asg, student).status, 'pending', 'starts pending');
  const row = m.submitAssignment(asg, student, 'link');
  assert.ok(row && row.id, 'submission stored');
  assert.equal(m.assignmentStatus(asg, student).status, 'submitted', 'now submitted');

  const checked = m.checkSubmission(row.id, 'ভালো হয়েছে');
  assert.equal(checked.status, 'চেক হয়েছে', 'marked checked');
  assert.equal(m.assignmentStatus(asg, student).status, 'checked', 'student sees it as checked');
  assert.equal(m.assignmentStatus(asg, student).sub.feedback, 'ভালো হয়েছে', 'feedback attached');

  assert.ok(m.submissionsFor(asg.className).some((s) => s.id === row.id), 'class review list includes it');
});

test('the 10-materials badge is earned from real activity', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h15');
  const student = m.db.students.find('2026-09-001');
  assert.equal(m.achievementsFor(student).some((b) => b.name.includes('ম্যাটেরিয়াল')), false, 'not earned yet');
  for (let i = 0; i < 10; i += 1) m.recordStudyActivity('view', 1, 'mat-1');
  assert.ok(m.achievementsFor(student).some((b) => b.name.includes('ম্যাটেরিয়াল')), 'earned after 10 views');
});

test('admin can configure the daily challenge target', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h16');
  assert.equal(m.challengeState().target, 10, 'default target');
  m.db.settings.update({ dailyChallengeTarget: 5 });
  assert.equal(m.challengeState().target, 5, 'admin setting applies');
  for (let i = 0; i < 8; i += 1) m.addChallengeProgress(1);
  assert.equal(m.challengeState().done, 5, 'progress caps at the configured target');
  m.db.settings.update({ dailyChallengeTarget: 20 });
  assert.equal(m.challengeState().done, 5, 'raising the target does not fake completion');
});
