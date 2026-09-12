/**
 * Regression tests for the audit fixes (see AUDIT.md).
 *
 * Every test here pins a bug that used to be silent: money that closed a due it
 * did not cover, an unanswered question that scored a mark, a restore that lost
 * five collections, a version bump that wiped the centre, a "saved" toast for a
 * write that never landed, personal payment receipts on a shared board, and
 * `javascript:` links that reached an href.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k)
  };
}

function installWindow(localStorage) {
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
}

/** Fresh window + fresh store; the module instances stay, the data does not. */
async function boot(storage = makeLocalStorage()) {
  installWindow(storage);
  const store = await import('../js/store.js');
  store._clearMemoryStore();
  const data = await import('../js/data.js');
  const app = await import('../js/app.js');
  return { data, app, store, storage };
}

/** A Bengali ISO date `monthsBack` months ago, on the given day. */
function bnDateMonthsBack(monthsBack, day) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10).replace(/\d/g, (x) => '০১২৩৪৫৬৭৮৯'[x]);
}

/* ------------------------------------------------------------------ */
/* Finance: a payment must match what is actually owed                  */
/* ------------------------------------------------------------------ */

test('a partial payment reduces the due instead of closing it', async () => {
  const { data } = await boot();
  const fee = data.dueFees()[0];
  const owed = data.dueRemaining(fee);
  assert.ok(owed > 500, 'seed due is large enough to split');

  const res = data.receivePayment(fee.id, 'অ্যাডমিন', { amount: 500 });
  assert.ok(res, 'the partial payment is accepted');
  assert.equal(res.settled, false, 'and it does not settle the fee');

  const after = data.db.fees.find(fee.id);
  assert.equal(after.status, 'বকেয়া', 'still outstanding');
  assert.equal(data.dueRemaining(after), owed - 500, 'balance reduced by exactly what was taken');
  assert.equal(Number(data.db.payments.find(res.payment.id).amount), 500, 'the receipt records ৳500, not the whole due');
  assert.ok(data.dueFees().some((d) => d.id === fee.id), 'still on the dues list');
  assert.equal(data.analytics().totalDue >= owed - 500, true, 'dashboard total follows the balance');
});

test('an amount above the outstanding due is refused and writes nothing', async () => {
  const { data } = await boot();
  const fee = data.dueFees()[0];
  const paymentsBefore = data.db.payments.list().length;

  assert.equal(data.receivePayment(fee.id, 'অ্যাডমিন', { amount: data.dueRemaining(fee) + 1 }), null, 'over-payment refused');
  assert.equal(data.receivePayment(fee.id, 'অ্যাডমিন', { amount: 0 }), null, 'zero refused');
  assert.equal(data.receivePayment(fee.id, 'অ্যাডমিন', { amount: -50 }), null, 'negative refused');
  assert.equal(data.receivePayment(fee.id, 'অ্যাডমিন', { amount: 'abc' }), null, 'unparsable refused');

  assert.equal(data.db.fees.find(fee.id).status, 'বকেয়া', 'the due is untouched');
  assert.equal(data.db.payments.list().length, paymentsBefore, 'no phantom payment row');
});

test('paying the balance in two instalments settles the fee exactly once', async () => {
  const { data } = await boot();
  const fee = data.dueFees()[0];
  const owed = data.dueRemaining(fee);

  const first = data.receivePayment(fee.id, 'অ্যাডমিন', { amount: owed - 200, method: 'নগদ' });
  const second = data.receivePayment(fee.id, 'অ্যাডমিন', { amount: 200, method: 'বিকাশ', reference: 'TRX-1' });
  assert.equal(first.settled, false);
  assert.equal(second.settled, true, 'the last instalment settles it');

  const row = data.db.fees.find(fee.id);
  assert.equal(row.status, 'পরিশোধিত');
  assert.equal(data.dueRemaining(row), 0);
  assert.equal(data.dueFees().some((d) => d.id === fee.id), false, 'off the dues list');

  const rows = data.db.payments.list().filter((p) => p.studentId === fee.studentId && p.month === fee.month);
  assert.equal(rows.length, 2, 'two instalments, two receipts');
  assert.equal(rows.reduce((sum, p) => sum + Number(p.amount), 0), owed, 'together exactly the due');
  assert.equal(rows.find((p) => p.reference === 'TRX-1').method, 'বিকাশ', 'captured details land on the payment itself');

  assert.equal(data.receivePayment(fee.id, 'অ্যাডমিন', { amount: 1 }), null, 'nothing left to collect');
});

test('receivePayment with no amount still settles the whole due (existing callers)', async () => {
  const { data } = await boot();
  const fee = data.dueFees()[0];
  const res = data.receivePayment(fee.id, 'অ্যাডমিন');
  assert.ok(res && res.settled, 'settled');
  assert.equal(Number(res.payment.amount), fee.amount, 'records the full due');
  assert.equal(data.db.fees.find(fee.id).status, 'পরিশোধিত');
});

/* ------------------------------------------------------------------ */
/* Exams: unanswered means zero, and one sitting means one result       */
/* ------------------------------------------------------------------ */

test('an unanswered question scores zero even when option A is the answer', async () => {
  const { data } = await boot();
  const exam = { questions: [{ q: '৫ + ৩ = ?', options: ['৮', '৯'], answer: 0 }] };
  assert.deepEqual(data.scoreExam(exam, { 0: null }), { score: 0, total: 1 }, 'FormData.get() → null');
  assert.deepEqual(data.scoreExam(exam, {}), { score: 0, total: 1 }, 'missing key');
  assert.deepEqual(data.scoreExam(exam, { 0: '' }), { score: 0, total: 1 }, 'empty string');
  assert.deepEqual(data.scoreExam(exam, null), { score: 0, total: 1 }, 'no answers at all');
  assert.deepEqual(data.scoreExam(exam, { 0: '0' }), { score: 1, total: 1 }, 'a real answer still counts');
  assert.deepEqual(data.scoreExam(exam, { 0: 0 }), { score: 1, total: 1 });
  assert.deepEqual(data.scoreExam(exam, { 0: '1' }), { score: 0, total: 1 }, 'a wrong answer is wrong');
});

test('a student cannot sit the same exam twice', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="exam-list"></div><div id="exam-player" hidden></div></body></html>',
    { url: 'http://localhost:8080/student.html', pretendToBeVisual: true }
  );
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  // Node's own FormData cannot read a DOM form; the page code expects the browser one.
  globalThis.FormData = dom.window.FormData;

  const store = await import('../js/store.js');
  store._clearMemoryStore();
  const data = await import('../js/data.js');
  const { mountExamTaker } = await import('../js/exams.js');

  const doc = dom.window.document;
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  mountExamTaker({ listSelector: '#exam-list', student });

  const start = doc.querySelector(`[data-take="${exam.id}"]`);
  assert.ok(start, 'the open exam offers a Start button');
  start.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const form = doc.getElementById('exam-take-form');
  assert.ok(form, 'the paper is on screen');
  exam.questions.forEach((q, qi) => {
    const radio = form.querySelector(`input[name="q${qi}"][value="${q.answer}"]`);
    radio.checked = true;
  });
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.examResults.list().length, 1, 'the sitting is recorded');
  assert.equal(data.examResultFor(exam.id, student.id).score, exam.questions.length, 'all answers correct');

  // The Start button is hidden now — but hiding paint is not a guard, so reach
  // the same handler directly the way a scripted client would.
  const list = doc.getElementById('exam-list');
  const forced = doc.createElement('button');
  forced.dataset.take = exam.id;
  list.appendChild(forced);
  forced.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(data.db.examResults.list().length, 1, 'a retake adds no second result');
  assert.equal(doc.getElementById('exam-player').hidden, true, 'and the paper does not reopen');
});

/* ------------------------------------------------------------------ */
/* Analytics: the numbers on the dashboard must be the real ones        */
/* ------------------------------------------------------------------ */

test('analytics counts this month only, and pending work that really is pending', async () => {
  const { data } = await boot();
  const student = data.db.students.find('2026-09-001');

  data.db.payments.add({
    id: 'pay-old', studentId: student.id, month: 'পুরনো মাস', amount: 999,
    date: bnDateMonthsBack(1, 1), receivedBy: 'সিস্টেম'
  });
  const a = data.analytics();
  assert.equal(a.monthlyCollection, 1200, 'last month\'s ৳999 is not this month\'s collection');
  assert.equal(data.isThisMonth(data.todayBn()), true);
  assert.equal(data.isThisMonth(bnDateMonthsBack(1, 1)), false);

  assert.equal(a.pendingAssignments, 1, 'the seeded submission is waiting to be marked');
  data.checkSubmission('subm-1', 'ভালো হয়েছে', 18);
  assert.equal(data.analytics().pendingAssignments, 0, 'marking it clears the queue');
});

test('a result with no questions cannot produce NaN or Infinity', async () => {
  const { data } = await boot();
  const student = data.db.students.find('2026-09-001');
  data.db.examResults.add({ id: 'r-zero', examId: 'exam-1', studentId: student.id, studentName: student.name, score: 0, total: 0, date: data.todayBn() });

  assert.equal(data.resultPercent({ score: 5, total: 0 }), 0);
  assert.ok(data.leaderboard().every((row) => Number.isFinite(row.pct)), 'leaderboard percentages are finite');
  assert.ok(data.classPerformance().every((c) => Number.isFinite(c.avg)), 'class averages are finite');
  const summary = data.examSummary('exam-1');
  assert.ok(Number.isFinite(summary.avg) && Number.isFinite(summary.passRate), 'exam summary is finite');
});

/* ------------------------------------------------------------------ */
/* Persistence: a failed write must never look like a saved one         */
/* ------------------------------------------------------------------ */

test('a blocked or full store reports the failure instead of swallowing it', async () => {
  const failing = {
    getItem: () => null,
    setItem: () => { const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err; },
    removeItem: () => {}
  };
  const { data, store } = await boot(failing);

  assert.equal(store.storeSet('probe', 'value'), false, 'the write itself reports failure');
  data.db.settings.update({ orgName: 'যা লেখা যায়নি' }); // must not throw
  assert.equal(data.getDbStatus().persisted, false, 'getDbStatus admits nothing landed');
  assert.equal(data.db.settings.get().orgName, 'যা লেখা যায়নি', 'this page load still works from memory');

  const working = await boot(); // a working store flips the flag back
  working.data.db.settings.update({ orgName: 'ঠিক আছে' });
  assert.equal(working.data.getDbStatus().persisted, true);
});

test('a rejected remote write is reported as a failed sync', async () => {
  const { data } = await boot();
  data._setRemoteTransport(() => Promise.reject(new Error('permission_denied')));
  data.db.settings.update({ orgName: 'Active Plus' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const status = data.getDbStatus();
  assert.equal(status.error, 'sync-failed', 'the rejection surfaced');
  assert.equal(status.connected, false);
  assert.equal(status.pending, 0, 'and the queue was not left stuck');
  data._setRemoteTransport(null);
});

/* ------------------------------------------------------------------ */
/* Backup and upgrades: restoring must not lose anything                */
/* ------------------------------------------------------------------ */

test('restoring a backup brings back every collection it holds', async () => {
  const { data } = await boot();
  const today = data.todayBn();
  data.db.tips.add({ id: 'tip-x', text: 'ব্যাকআপের টিপ', active: true });
  data.db.banners.add({ id: 'ban-x', title: 'ব্যাকআপের ব্যানার', active: true });
  data.db.materialProgress.add({ id: 'mp-x', materialId: 'mat-1', studentId: '2026-09-001' });
  data.db.studyActivity.add({ date: today, minutes: 12 });
  data.db.challenge.add({ date: today, done: 3 });
  const backup = data.exportBackup();

  data.db.reset();
  assert.equal(data.db.tips.find('tip-x'), null, 'the reset really cleared it');

  const res = data.importBackup(backup);
  assert.equal(res.ok, true);
  assert.ok(data.db.tips.find('tip-x'), 'tips restored');
  assert.ok(data.db.banners.find('ban-x'), 'banners restored');
  assert.ok(data.db.materialProgress.find('mp-x'), 'material progress restored');
  assert.ok(data.db.studyActivity.list().some((r) => r.date === today), 'study activity restored');
  assert.ok(data.db.challenge.list().some((r) => r.date === today), 'daily challenge restored');
  assert.ok(data.db.students.find('2026-09-001'), 'and the rest of the centre with it');
});

test('a store from an older DATA_VERSION is migrated, not wiped', async () => {
  const storage = makeLocalStorage();
  const { data, store } = await boot(storage);
  const oldStore = {
    version: data.DATA_VERSION - 1,
    seededAt: '2026-01-01T00:00:00.000Z',
    collections: {
      settings: { orgName: 'পুরনো প্রতিষ্ঠান', mobile: '০১৭১১-১১১১১১' },
      students: [{ id: 'S-OLD', name: 'পুরনো শিক্ষার্থী', className: 'নবম', status: 'সক্রিয়' }],
      payments: [{ id: 'p-old', studentId: 'S-OLD', amount: 500, date: data.todayBn() }],
      somethingNew: [{ id: 'n-1' }]
    }
  };
  storage.setItem('activeplus_data', JSON.stringify(oldStore));
  store._clearMemoryStore(); // force the next load to re-read

  assert.ok(data.db.students.find('S-OLD'), 'their students survived the upgrade');
  assert.equal(data.db.settings.get().orgName, 'পুরনো প্রতিষ্ঠান', 'their institute profile survived');
  assert.equal(data.db.payments.find('p-old').amount, 500, 'their money records survived');
  assert.equal(data.db.settings.get().monthlyFee, 1200, 'settings the old version lacked are filled in');
  assert.ok(data.db.teachers.list().length > 0, 'collections the old version lacked are seeded');
  assert.equal(JSON.parse(data.exportBackup()).version, data.DATA_VERSION, 'and the store is now current');
  assert.equal(JSON.parse(storage.getItem('activeplus_data')).version, data.DATA_VERSION, 'the migrated store was written back');
});

/* ------------------------------------------------------------------ */
/* Notices: a receipt belongs to one student                            */
/* ------------------------------------------------------------------ */

test('a payment receipt reaches its student but never a shared board', async () => {
  const { data } = await boot();
  const fee = data.dueFees()[0];
  const student = data.db.students.find(fee.studentId);
  const other = data.db.students.find('2026-08-007');
  const sharedBefore = data.sharedNotices().length;

  data.receivePayment(fee.id, 'অ্যাডমিন');

  assert.equal(data.sharedNotices().length, sharedBefore, 'nothing personal on the shared board');
  assert.ok(data.noticesFor(student).some((n) => n.title.includes('পেমেন্ট গৃহীত')), 'the student gets their own receipt');
  assert.equal(data.noticesFor(other).some((n) => n.title.includes('পেমেন্ট গৃহীত')), false, 'and nobody else does');
});

/* ------------------------------------------------------------------ */
/* Links: only real destinations reach an href                          */
/* ------------------------------------------------------------------ */

test('safeUrl blocks script schemes and keeps ordinary links', async () => {
  const { app } = await boot();
  const blocked = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.cookie)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/steal'
  ];
  for (const bad of blocked) assert.equal(app.safeUrl(bad), '#', `blocked: ${JSON.stringify(bad)}`);

  assert.equal(app.safeUrl('https://example.com/notes.pdf'), 'https://example.com/notes.pdf');
  assert.equal(app.safeUrl('http://example.com'), 'http://example.com');
  assert.equal(app.safeUrl('mailto:info@activeplus.edu'), 'mailto:info@activeplus.edu');
  assert.equal(app.safeUrl('tel:+8801700000000'), 'tel:+8801700000000');
  assert.equal(app.safeUrl('assets/file.pdf'), 'assets/file.pdf', 'relative path');
  assert.equal(app.safeUrl('#top'), '#top', 'in-page anchor');
  assert.equal(app.safeUrl(''), '#', 'empty falls back');
  assert.equal(app.safeUrl(null, 'x'), 'x', 'null falls back');
});

/* ------------------------------------------------------------------ */
/* Teacher queue: marking work is counted from the submissions          */
/* ------------------------------------------------------------------ */

test('a marked submission stops being counted as work waiting for the teacher', async () => {
  const { data } = await boot();
  const teacher = 'রাহেলা আক্তার'; // her batch covers নবম, where the seeded assignment lives
  assert.equal(data.teacherPendingAssignments(teacher).length, 1, 'one submission is waiting');

  data.checkSubmission('subm-1', 'ভালো', 18);
  const marked = data.db.submissions.find('subm-1');
  assert.equal(marked.checked, true, 'the flag the teacher UI reads is set');
  assert.equal(marked.status, 'চেক হয়েছে', 'and the status the student sees agrees');
  assert.equal(data.teacherPendingAssignments(teacher).length, 0, 'the queue empties');
});
