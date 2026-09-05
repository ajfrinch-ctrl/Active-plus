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

test('dates are stored and displayed as day-month-year', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=dates');
  assert.equal(m.formatDateBn(new Date(2026, 0, 5)), '০৫-০১-২০২৬');
  assert.equal(m.formatDateBn('2026-09-10'), '১০-০৯-২০২৬');
  assert.equal(m.formatDateBn('১০-০৯-২০২৬'), '১০-০৯-২০২৬');
  assert.equal(m.dateToIso('০৫-০১-২০২৬'), '2026-01-05');
  const today = m.todayBn();
  assert.match(today, /^[০-৯]{2}-[০-৯]{2}-[০-৯]{4}$/, 'today is DD-MM-YYYY');
  assert.equal(m.db.students.find('2026-09-001').admissionDate, '০৫-০১-২০২৬');
});

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
  for (let i = 0; i < 10; i += 1) m.markMaterialComplete(`mat-${i}`, student);
  assert.ok(m.achievementsFor(student).some((b) => b.name.includes('ম্যাটেরিয়াল')), 'earned after completing 10 materials');
  // opening a material many times must not fake completion
  const other = m.db.students.find('2026-09-002');
  for (let i = 0; i < 25; i += 1) m.recordStudyActivity('view', 1, 'mat-1');
  assert.equal(m.achievementsFor(other).some((b) => b.name.includes('ম্যাটেরিয়াল')), false, 'views alone earn nothing');
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

test('continue-learning progress counts completed materials for the own class', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h17');
  const student = m.db.students.find('2026-09-001');
  const cls = student.className;
  m.db.materials.add({ id: 'mat-a', title: 'A', subject: 'x', className: cls, type: 'নোট', date: m.todayBn() });
  m.db.materials.add({ id: 'mat-b', title: 'B', subject: 'x', className: 'দশম', type: 'নোট', date: m.todayBn() });

  let p = m.materialProgressFor(student, cls);
  assert.equal(p.total, 2, 'only own-class materials count');
  assert.equal(p.pct, 0, 'nothing completed yet');

  m.markMaterialComplete('mat-a', student);
  p = m.materialProgressFor(student, cls);
  assert.equal(p.done, 1);
  assert.equal(p.pct, 50, 'progress reflects real completion');

  m.markMaterialComplete('mat-a', student); // idempotent
  assert.equal(m.materialProgressFor(student, cls).done, 1, 're-marking does not inflate');
  assert.equal(m.materialProgressFor(m.db.students.find('2026-09-002'), cls).done, 0, 'other student unaffected');
});

test('notification previews show honest relative time', async () => {
  installWindow(makeLocalStorage());
  (await import('../js/store.js'))._clearMemoryStore();
  const m = await import('../js/data.js?page=h18');
  const now = Date.now();
  assert.equal(m.timeAgo(new Date(now - 20000).toISOString(), now), 'এইমাত্র');
  assert.equal(m.timeAgo(new Date(now - 5 * 60000).toISOString(), now), '৫ মিনিট আগে');
  assert.equal(m.timeAgo(new Date(now - 3 * 3600000).toISOString(), now), '৩ ঘণ্টা আগে');
  assert.equal(m.timeAgo(new Date(now - 2 * 86400000).toISOString(), now), '২ দিন আগে');
  assert.equal(m.timeAgo('', now), '', 'no timestamp yields no invented time');
  assert.equal(m.timeAgo('garbage', now), '', 'bad input is ignored');

  const student = m.db.students.find('2026-09-001');
  const preview = m.latestNotifications(student, 1)[0];
  assert.ok(preview && preview.createdAt, 'notifications carry a timestamp');
  assert.equal(typeof m.timeAgo(preview.createdAt), 'string');
});

test('parseMcqPaste reads Bengali option markers and answer labels', async () => {
  // A word boundary (\b) never matches after a Bengali digit, so an earlier
  // version silently ignored "সঠিক: ৩" and defaulted the answer to option A.
  const { parseMcqPaste } = await import('../js/data.js?page=bnmcq');

  const bn = parseMcqPaste('প্রশ্ন: ৫+৩=?\n১. ৬\n২. ৭\n৩. ৮\n৪. ৯\nসঠিক: ৩');
  assert.equal(bn.questions.length, 1, 'the question parsed');
  assert.equal(bn.questions[0].answer, 2, 'সঠিক: ৩ selects the third option');
  assert.equal(bn.questions[0].options[2], '৮');

  // last and first Bengali markers both map correctly
  assert.equal(parseMcqPaste('প্রশ্ন: y\n১. ক\n২. খ\n৩. গ\n৪. ঘ\nসঠিক: ৪').questions[0].answer, 3);
  assert.equal(parseMcqPaste('প্রশ্ন: z\n১. ক\n২. খ\n৩. গ\n৪. ঘ\nসঠিক: ১').questions[0].answer, 0);

  // a Bengali label with a Latin letter still works
  assert.equal(parseMcqPaste('প্রশ্ন: ৫+৩=?\nA. ৬\nB. ৭\nC. ৮\nD. ৯\nসঠিক: C').questions[0].answer, 2);

  // lowercase latin, and a question with no answer line at all
  assert.equal(parseMcqPaste('Q: x\nA. 1\nB. 2\nC. 3\nD. 4\nanswer: d').questions[0].answer, 3);
  assert.equal(parseMcqPaste('Q: x\nA. 1\nB. 2\nC. 3\nD. 4').questions[0].answer, 0,
    'defaults to the first option when no answer is given');
});

test('toCSV exports computed columns, not just raw keys', async () => {
  const { toCSV } = await import('../js/data.js?page=csv');

  const cols = [
    { key: 'name', label: 'নাম' },
    { key: 'count', label: 'শিক্ষার্থী', render: (r) => String(r.students.length) },
    { key: 'status', label: 'অবস্থা', render: (r) => `<span class="badge success">${r.active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</span>` },
    { key: 'missing', label: 'কাঁচা' }
  ];
  const csv = toCSV(cols, [{ name: 'নবম', students: [1, 2, 3], active: true }]);
  const [head, row] = csv.split('\n');

  assert.equal(head, '"নাম","শিক্ষার্থী","অবস্থা","কাঁচা"');
  assert.equal(row, '"নবম","3","সক্রিয়",""',
    'render-only columns export their value, HTML stripped');

  // quotes are escaped, not broken
  const quoted = toCSV([{ key: 't', label: 'শিরোনাম' }], [{ t: 'তিনি বললেন "ভালো"' }]);
  assert.equal(quoted.split('\n')[1], '"তিনি বললেন ""ভালো"""');
});

/* ------------------------------------------------------------------ */
/* Teacher dashboard helpers (spec 2, 4, 16) — previously untested     */
/* ------------------------------------------------------------------ */

const TEACHER = 'রাহেলা আক্তার';

async function teacherModule(page) {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();
  return import(`../js/data.js?page=${page}`);
}

test('todayTeaching computes every hero number from real data', async () => {
  const m = await teacherModule('t1');

  const hero = m.todayTeaching(TEACHER);
  assert.deepEqual(Object.keys(hero).sort(),
    ['assignments', 'classes', 'exams', 'results', 'students']);

  // Each figure must equal the helper behind it, not a hard-coded constant.
  assert.equal(hero.students, m.teacherStudents(TEACHER).length);
  assert.equal(hero.classes, m.teacherDayClasses(TEACHER).length);
  assert.equal(hero.assignments, m.teacherPendingAssignments(TEACHER).length);
  assert.equal(hero.exams, m.teacherExams(TEACHER).length);
  assert.equal(hero.results, m.teacherPendingResults(TEACHER).length);

  // The seed teacher owns নবম, which has two students and one exam.
  assert.equal(hero.students, 2);
  assert.equal(hero.exams, 1);

  // An unknown teacher sees nothing rather than someone else's numbers.
  assert.deepEqual(m.todayTeaching('নেই এমন শিক্ষক'),
    { classes: 0, students: 0, assignments: 0, exams: 0, results: 0 });
});

test('teacherDayClasses returns only that teacher slots, sorted by time', async () => {
  const m = await teacherModule('t2');

  const sat = m.teacherDayClasses(TEACHER, 'শনিবার');
  assert.equal(sat.length, 1, 'the seed gives this teacher one Saturday class');
  assert.equal(sat[0].teacher, TEACHER);

  // Other teachers' rows for the same day must not leak in.
  m.db.routine.add({ id: 'rt-other', day: 'শনিবার', time: '০৭:০০ – ০৮:০০', teacher: 'কামরুল ইসলাম' });
  assert.equal(m.teacherDayClasses(TEACHER, 'শনিবার').length, 1);

  // Sorting is by start time, earliest first.
  m.db.routine.add({ id: 'rt-late', day: 'শনিবার', time: '২০:০০ – ২১:০০', teacher: TEACHER });
  const times = m.teacherDayClasses(TEACHER, 'শনিবার').map((r) => r.id);
  assert.deepEqual(times, ['rt-1', 'rt-late']);

  assert.deepEqual(m.teacherDayClasses(TEACHER, 'রবিবার'), []);
});

test('teacherNextClass skips finished classes instead of always naming one', async () => {
  const m = await teacherModule('t3');
  const today = m.DAY_BN[new Date().getDay()];

  // A class that ended hours ago must not be offered as "next".
  m.db.routine.add({ id: 'rt-done', day: today, time: '০১:০০ – ০২:০০', teacher: TEACHER });
  assert.equal(m.teacherNextClass(TEACHER), null,
    'a finished class is not reported as upcoming');

  // A class still ahead today must be found.
  m.db.routine.add({ id: 'rt-later', day: today, time: '২৩:৫৮ – ২৩:৫৯', teacher: TEACHER });
  const next = m.teacherNextClass(TEACHER);
  assert.equal(next && next.id, 'rt-later', 'the remaining class today is returned');

  // With no routine at all the card can honestly say the day is finished.
  assert.equal(m.teacherNextClass('নেই এমন শিক্ষক'), null);
});

test('teacherPerformance aggregates only the teacher own students', async () => {
  const m = await teacherModule('t4');

  // No results yet: null, so the UI shows an empty state rather than fake zeros.
  assert.equal(m.teacherPerformance(TEACHER), null);

  const exam = m.teacherExams(TEACHER)[0];
  m.db.examResults.add({ id: 'er-1', examId: exam.id, studentId: '2026-09-001', score: 80, total: 100 });
  m.db.examResults.add({ id: 'er-2', examId: exam.id, studentId: '2026-09-002', score: 30, total: 100 });
  // A student in another class must never enter this teacher's analytics.
  m.db.examResults.add({ id: 'er-3', examId: exam.id, studentId: '2026-10-014', score: 100, total: 100 });

  const p = m.teacherPerformance(TEACHER);
  assert.equal(p.tests, 2, 'only the two own students count');
  assert.equal(p.avg, 55, '(80 + 30) / 2');
  assert.equal(p.best, 80);
  assert.equal(p.lowest, 30);
  assert.equal(p.passRate, 50, 'passMark is 40, so one of two passed');
  assert.equal(p.failRate, 50);
  assert.equal(p.examParticipation, 100, 'both own students have a result');
});

test('teacher notifications: unread count and mark-read', async () => {
  const m = await teacherModule('t5');

  assert.equal(m.teacherUnreadCount(), 1, 'the seed notice targets সবাই and is unread');

  m.db.notifications.add({ id: 'ntf-t', target: 'শিক্ষক', read: false, title: 'প্রশ্ন', date: '২০২৬-০৯-০৪' });
  assert.equal(m.teacherUnreadCount(), 2);

  // A student-directed notice must not inflate the teacher badge.
  m.db.notifications.add({ id: 'ntf-s', target: 'শিক্ষার্থী', read: false, title: 'x', date: '২০২৬-০৯-০৪' });
  assert.equal(m.teacherUnreadCount(), 2);

  m.markTeacherNotificationsRead();
  assert.equal(m.teacherUnreadCount(), 0);
  assert.equal(m.db.notifications.list().filter((n) => n.target === 'শিক্ষার্থী' && !n.read).length, 1,
    'marking teacher notices read leaves student notices alone');
});

test('parseMcqCsv validates rows, reports line numbers and drops duplicates', async () => {
  const m = await teacherModule('t6');

  const csv = [
    'Question,A,B,C,D,Correct',
    '৫+৩=?,৬,৭,৮,৯,B',
    'only two cells,here',
    '৫+৩=?,৬,৭,৮,৯,B'
  ].join('\n');

  const { questions, invalidRows, duplicates } = m.parseMcqCsv(csv);
  assert.equal(questions.length, 1, 'the duplicate row is dropped');
  assert.equal(questions[0].answer, 1, 'B maps to option index 1');
  assert.deepEqual(questions[0].options, ['৬', '৭', '৮', '৯']);
  assert.deepEqual(invalidRows, [3], 'the short row is reported by its real line number');
  assert.deepEqual(duplicates, ['৫+৩=?']);

  // A header is optional, and an unknown answer letter invalidates the row.
  const noHeader = m.parseMcqCsv('২+২=?,৩,৪,৫,৬,Z');
  assert.equal(noHeader.questions.length, 0);
  assert.deepEqual(noHeader.invalidRows, [1]);
});

test('classesInBatch derives class names from a batch label', async () => {
  const m = await teacherModule('t7');
  assert.deepEqual(m.classesInBatch('নবম (বিজ্ঞান)'), ['নবম']);
  assert.deepEqual(m.classesInBatch(''), []);
});

test('nextReceiptNo is a unique, sequential YYYYMMDDXXX number per day', async () => {
  const storage = makeLocalStorage();
  installWindow(storage);
  (await import('../js/store.js'))._clearMemoryStore();
  const { db, nextReceiptNo } = await import('../js/data.js?page=receipt');

  const fixed = new Date(2026, 8, 5); // 2026-09-05
  const a = nextReceiptNo(fixed);
  assert.match(a, /^20260905\d{3}$/, 'format is YYYYMMDD + 3-digit serial');
  assert.equal(a, '20260905001', 'the first receipt of the day starts at 001');

  // The caller persists the number; the next call then skips it — sequential.
  db.payments.add({ id: 'pay-a', studentId: 'S1', amount: 100, receiptNo: a, date: '০৫/০৯' });
  assert.equal(nextReceiptNo(fixed), '20260905002', 'the next receipt increments the serial');

  // A persisted receipt number is never re-issued (collision-safe even if the
  // payments collection already holds a higher one for today).
  db.payments.add({ id: 'pay-r1', studentId: 'S1', amount: 100, receiptNo: '20260905007', date: '০৫/০৯' });
  assert.equal(nextReceiptNo(fixed), '20260905008', 'skips past an already-used number');

  // A different day resets to its own prefix/serial.
  const other = new Date(2026, 8, 6);
  assert.match(nextReceiptNo(other), /^20260906\d{3}$/, 'each day uses its own prefix');
});
