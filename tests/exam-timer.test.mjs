/**
 * "MCQ পরিক্ষা শুরু করলে টাইমার স্টার্ট হবে … টাইম শেষে অটো সাবমিট হয়ে যাবে।"
 *
 * The countdown starts with the paper, the student sees it in Bengali digits,
 * the sitting survives a reload without gaining time, and the paper submits
 * itself the moment the time is up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadDemoData } from '../js/demo-data.js';

function installDom(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost:8080/student.html', pretendToBeVisual: true
  });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.FormData = dom.window.FormData;
  return dom;
}

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const BN_TIME = /^⏱ [০-৯]{2}:[০-৯]{2}$/;

async function openExam(dom, studentId) {
  const store = await import('../js/store.js');
  store._clearMemoryStore();
  loadDemoData(); // the store ships empty; the papers under test come from the fixture
  const data = await import('../js/data.js');
  const { mountExamTaker } = await import('../js/exams.js');
  const student = data.db.students.find(studentId);
  const exam = data.examsFor(student.className)[0];
  const controller = mountExamTaker({ listSelector: '#exam-list', student });
  return { data, student, exam, controller };
}

test('starting a paper starts a countdown the student can read', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { exam, controller } = await openExam(dom, '2026-09-001');

  click(dom, doc.querySelector(`[data-take="${exam.id}"]`));
  try {
    assert.ok(doc.getElementById('exam-take-form'), 'the paper is on screen');
    const timer = doc.getElementById('exam-timer');
    assert.ok(timer, 'a timer is rendered');
    assert.match(timer.textContent, BN_TIME, `Bengali mm:ss countdown, got "${timer.textContent}"`);
    // 30 minutes on the seeded paper, so the first tick reads ২৯:৫৯ or ৩০:০০.
    assert.match(timer.textContent, /২৯:৫৯|৩০:০০/, 'counting down from the exam duration');
    assert.match(doc.getElementById('exam-notice').textContent, /স্বয়ংক্রিয়ভাবে জমা/, 'the auto-submit rule is stated up front');
  } finally {
    controller.stop();
  }
});

test('a paper whose time ran out while the app was closed submits itself', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { data, student, exam, controller } = await openExam(dom, '2026-09-002');

  // The student answered question 1, then the app closed and the deadline passed.
  dom.window.localStorage.setItem(`activeplus_exam_${student.id}_${exam.id}`, JSON.stringify({
    deadline: Date.now() - 1000,
    answers: { 0: String(exam.questions[0].answer) },
    startedAt: Date.now() - 60000
  }));

  click(dom, doc.querySelector(`[data-take="${exam.id}"]`));
  await new Promise((r) => setTimeout(r, 20));
  try {
    const result = data.examResultFor(exam.id, student.id);
    assert.ok(result, 'the sitting is recorded without the student pressing anything');
    assert.equal(result.autoSubmitted, true, 'flagged as an automatic submission');
    assert.equal(result.score, 1, 'the answer saved before the deadline is graded');
    assert.match(doc.getElementById('exam-player').innerHTML, /⏰ সময় শেষ/, 'the student is told what happened');
    assert.equal(
      dom.window.localStorage.getItem(`activeplus_exam_${student.id}_${exam.id}`), null,
      'the finished sitting is cleared'
    );
    assert.equal(doc.querySelector(`[data-take="${exam.id}"]`), null, 'no second attempt is offered');
  } finally {
    controller.stop();
  }
});

test('the countdown warns on the way down and submits itself at zero', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { data, student, exam, controller } = await openExam(dom, '2026-09-002');

  // A sitting with a little over a second to go, so the live countdown can be
  // watched all the way to zero instead of simulated.
  dom.window.localStorage.setItem(`activeplus_exam_${student.id}_${exam.id}`, JSON.stringify({
    deadline: Date.now() + 1300,
    answers: { 0: String(exam.questions[0].answer) },
    startedAt: Date.now() - 60000
  }));

  click(dom, doc.querySelector(`[data-take="${exam.id}"]`));
  try {
    const timer = doc.getElementById('exam-timer');
    assert.match(timer.textContent, /^⏱ ০০:০[০-৯]$/, 'the last seconds are counting down');
    assert.match(timer.className, /(warn|danger)/, 'the timer is flagged red/amber near the end');
    assert.match(doc.getElementById('toast-container')?.textContent || '', /১ মিনিট বাকি/, 'the student is warned first');

    await new Promise((r) => setTimeout(r, 2600));   // the 1s tick has to pass the deadline
    const result = data.examResultFor(exam.id, student.id);
    assert.ok(result, 'the paper submitted itself when the clock hit zero');
    assert.equal(result.autoSubmitted, true, 'and it is marked as an automatic submission');
    assert.match(doc.getElementById('exam-player').innerHTML, /স্বয়ংক্রিয়ভাবে জমা/, 'the student is told why');
  } finally {
    controller.stop();
  }
});

test('an interrupted sitting is offered as চালিয়ে যান with the time left', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;

  // The paper is already running when the student comes back to this screen.
  const store = await import('../js/store.js');
  store._clearMemoryStore();
  loadDemoData();
  const data = await import('../js/data.js');
  const { mountExamTaker } = await import('../js/exams.js');
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  dom.window.localStorage.setItem(`activeplus_exam_${student.id}_${exam.id}`, JSON.stringify({
    deadline: Date.now() + 95000, answers: { 0: '0' }, startedAt: Date.now() - 30000
  }));

  const controller = mountExamTaker({ listSelector: '#exam-list', student });
  try {
    const list = doc.getElementById('exam-list');
    assert.match(list.textContent, /চলছে · আর/, 'the card says the paper is still running');
    assert.match(list.textContent, /০১:৩[০-৯]|০১:৪[০-৯]|০১:[০-৯]{2}/, 'and shows the time left');
    const button = doc.querySelector(`[data-take="${exam.id}"]`);
    assert.ok(button, 'the paper can be reopened');
    assert.equal(button.textContent.trim(), 'চালিয়ে যান', 'offered as continue, not as a fresh start');

    // Opening it restores the sitting — same deadline, saved answer kept.
    click(dom, button);
    const checked = doc.getElementById('exam-take-form').querySelector('input[name="q0"]:checked');
    assert.equal(checked.value, '0', 'the answer given before is still selected');
    const saved = JSON.parse(dom.window.localStorage.getItem(`activeplus_exam_${student.id}_${exam.id}`));
    assert.ok(saved.deadline <= Date.now() + 96000, 'the deadline did not move forward');
    assert.ok(!data.examResultFor(exam.id, student.id), 'nothing was submitted early');
  } finally {
    controller.stop();
  }
});

test('a stored result can be reviewed again from the controller', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { data, student, exam, controller } = await openExam(dom, '2026-09-001');

  data.db.examResults.add({
    id: 'res-review', examId: exam.id, studentId: student.id, studentName: student.name,
    score: 1, total: exam.questions.length, date: data.todayBn(), autoSubmitted: true,
    answers: exam.questions.map((q, qi) => (qi === 0 ? q.answer : null))
  });
  controller.stop();
  controller.review(exam.id);
  try {
    const player = doc.getElementById('exam-player');
    assert.equal(player.hidden, false, 'the review opens');
    assert.match(player.innerHTML, /উত্তরপত্র/, 'it is the answer review');
    assert.match(player.innerHTML, /স্বয়ংক্রিয়ভাবে জমা/, 'an auto-submitted paper says so');
    // Every question now spells out the right answer, and each is marked
    // ✓/✗ in words (never by colour alone).
    assert.equal((player.innerHTML.match(/সঠিক উত্তর:/g) || []).length, exam.questions.length, 'the right answer is shown for every question');
    assert.equal((player.innerHTML.match(/✓ সঠিক/g) || []).length, 1, 'the correct one is marked');
    assert.equal((player.innerHTML.match(/✗ ভুল|— উত্তর দেননি/g) || []).length, exam.questions.length - 1, 'the misses are marked too');
  } finally {
    controller.stop();
  }
});

test('reopening a running paper keeps the original deadline', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { student, exam, controller } = await openExam(dom, '2026-09-001');

  click(dom, doc.querySelector(`[data-take="${exam.id}"]`));
  const first = JSON.parse(dom.window.localStorage.getItem(`activeplus_exam_${student.id}_${exam.id}`));
  controller.stop();

  // Reopen the same sitting much later: the deadline must not move forward.
  click(dom, doc.getElementById('back-to-exams') || doc.querySelector('[data-take]') || doc.body);
  const again = doc.querySelector(`[data-take="${exam.id}"]`);
  if (again) click(dom, again);
  const second = JSON.parse(dom.window.localStorage.getItem(`activeplus_exam_${student.id}_${exam.id}`) || 'null');
  assert.ok(first?.deadline, 'the sitting was saved when the paper opened');
  assert.ok(!second || second.deadline <= first.deadline, 'reopening never extends the deadline');
  controller.stop();
});

test('the time left is a progress bar as well as a clock', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  const { exam, controller } = await openExam(dom, '2026-09-001');

  click(dom, doc.querySelector(`[data-take="${exam.id}"]`));
  try {
    const bar = doc.getElementById('exam-timebar');
    assert.ok(bar, 'a time bar is rendered above the paper');
    assert.equal(bar.getAttribute('role'), 'progressbar', 'announced as a progress bar');
    assert.equal(bar.getAttribute('aria-valuemax'), '100');
    const fill = doc.getElementById('exam-time-fill');
    const shown = Number(String(fill.style.width).replace('%', ''));
    assert.ok(shown > 90 && shown <= 100, `a just-started paper shows almost all its time left (got ${fill.style.width})`);
    assert.equal(Number(bar.getAttribute('aria-valuenow')), Math.round(shown), 'the remaining share is announced');
    assert.equal(bar.classList.contains('danger'), false, 'no alarm styling at the start');
  } finally {
    controller.stop();
  }
});
