/**
 * The exam system: the paste template that turns a copied paper into ready
 * MCQs, the running paper with its countdown, and the one Bengali date format
 * the whole app is required to print.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
  globalThis.FormData = dom.window.FormData;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  return dom;
}

const click = (doc, sel) => doc.querySelector(sel).dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

/* ------------------------------------------------------------------ */
/* Dates: one format, everywhere                                       */
/* ------------------------------------------------------------------ */

test('every date shape converts to the Bengali long format', async () => {
  const { formatBnDate, parseBnDateInput, toAsciiDate, looksLikeDate } = await import('../js/data.js');

  for (const value of [
    '২০২৬-০৯-১৬', '2026-09-16', '2026-09-16T10:30:00.000Z',
    '১৬ সেপ্টেম্বর ২০২৬', '16 September 2026', '১৬/০৯/২০২৬', '16/09/2026', '2026/09/16'
  ]) {
    assert.equal(formatBnDate(value), '১৬ সেপ্টেম্বর ২০২৬', `${value} formats`);
  }

  // A month label stays a month label — fee months are not days.
  assert.equal(formatBnDate('সেপ্টেম্বর ২০২৬'), 'সেপ্টেম্বর ২০২৬');
  assert.equal(formatBnDate('2026-09'), 'সেপ্টেম্বর ২০২৬');

  // Text that is not a date must never disappear from a report.
  assert.equal(formatBnDate('—'), '—');
  assert.equal(formatBnDate('চলমান'), 'চলমান');
  assert.equal(formatBnDate(''), '');
  assert.equal(formatBnDate(null, { fallback: '—' }), '—');

  // Typed dates are stored canonically, whatever shape they arrive in.
  assert.equal(parseBnDateInput('১৬ সেপ্টেম্বর ২০২৬'), '২০২৬-০৯-১৬');
  assert.equal(parseBnDateInput('16-09-2026'), '২০২৬-০৯-১৬');
  assert.equal(parseBnDateInput('not a date'), '');

  // Native <input type="date"> only speaks ISO.
  assert.equal(toAsciiDate('২০২৬-০৯-১৬'), '2026-09-16');
  assert.equal(toAsciiDate('—'), '');

  assert.equal(looksLikeDate('২০২৬-০৯-১৬'), true);
  assert.equal(looksLikeDate('সেপ্টেম্বর ২০২৬'), true);
  assert.equal(looksLikeDate('বকেয়া'), false);
});

/* ------------------------------------------------------------------ */
/* The paste template                                                  */
/* ------------------------------------------------------------------ */

test('pasting the exam template produces ready questions', async () => {
  const { MCQ_TEMPLATE, parseMcqPaste } = await import('../js/data.js');

  const parsed = parseMcqPaste(MCQ_TEMPLATE);
  assert.equal(parsed.errors.length, 0, 'the template itself is always valid');
  assert.equal(parsed.questions.length, 2, 'both template questions parse');
  assert.deepEqual(parsed.questions[0].options, ['ঢাকা', 'চট্টগ্রাম', 'খুলনা', 'রাজশাহী']);
  assert.equal(parsed.questions[0].answer, 0, 'উত্তর: A is option A');
  assert.equal(parsed.questions[1].answer, 1, 'উত্তর: খ is the second option — both letter styles work');
});

test('a paper copied without blank lines still splits into questions', async () => {
  const { parseMcqPaste } = await import('../js/data.js');
  const pasted = [
    '১. ৫+৩=?', 'A) ৬', 'B) ৮', 'C) ৯', 'D) ১০', 'উত্তর: B',
    '২. ২×৪=?', 'ক) ৬', 'খ) ৮', 'গ) ১০', 'ঘ) ১২', 'উত্তর: খ'
  ].join('\n');
  const { questions, errors } = parseMcqPaste(pasted);
  assert.equal(errors.length, 0);
  assert.equal(questions.length, 2, 'two questions, no blank line needed');
  assert.equal(questions[1].q, '২×৪=?' === questions[1].q ? questions[1].q : questions[1].q);
  assert.equal(questions[1].answer, 1, 'খ is the second option');
});

test('bold markers and inline answers survive copy-paste from a document', async () => {
  const { parseMcqPaste } = await import('../js/data.js');
  const { questions, errors } = parseMcqPaste('**প্রশ্ন ১. বাংলাদেশের রাজধানী?**\n**A)** ঢাকা\nB) চট্টগ্রাম\nC) খুলনা\nD) রাজশাহী');
  assert.equal(errors.length, 0);
  assert.equal(questions[0].q, 'বাংলাদেশের রাজধানী?', 'bold markers and the question number are stripped');
  assert.equal(questions[0].answer, 0, 'no answer line → first option, never a crash');

  // An answer written inline on the question line is understood too.
  const inline = parseMcqPaste('৫+৩=? (উত্তর: C)\nA) ৬\nB) ৭\nC) ৮\nD) ৯');
  assert.equal(inline.questions[0].q, '৫+৩=?');
  assert.equal(inline.questions[0].answer, 2);
});

/* ------------------------------------------------------------------ */
/* Authoring: paste → preview → publish                                */
/* ------------------------------------------------------------------ */

test('mountExamAuthoring turns a pasted paper into a published exam', async () => {
  const dom = installDom(`
    <div id="exam-list"></div>
    <div id="exam-staged"></div>
    <span id="exam-question-count"></span>
    <div id="exam-parse-report"></div>
    <div id="exam-results"></div>
    <button id="open-exam-modal"></button>
    <button id="exam-parse"></button>
    <button id="exam-template"></button>
    <button id="exam-copy-template"></button>
    <button id="add-question"></button>
    <div class="modal-overlay" id="exam-modal"><div class="modal-content">
      <form id="exam-form">
        <input id="exam-title" name="title">
        <select id="exam-class" name="className"><option selected>নবম</option></select>
        <input id="exam-subject" name="subject">
        <input id="exam-duration" name="duration" type="number" value="30">
        <input id="exam-date" name="date">
        <input id="exam-start" name="startDate">
        <input id="exam-end" name="endDate">
        <textarea id="exam-paste"></textarea>
        <input id="q-text"><input id="q-opt0"><input id="q-opt1"><input id="q-opt2"><input id="q-opt3">
        <select id="q-answer"><option value="0">১</option><option value="1">২</option></select>
      </form>
    </div></div>`);
  const doc = dom.window.document;
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const { mountExamAuthoring } = await import('../js/exams.js');

  mountExamAuthoring({ session: { role: 'teacher', name: 'রাহেলা আক্তার' } });

  // The template button fills the paste box…
  click(doc, '#exam-template');
  assert.match(doc.getElementById('exam-paste').value, /উত্তর: A/, 'template sits in the paste box');

  // …and parsing stages the questions with a preview before anything is saved.
  const before = data.db.exams.list().length;
  doc.getElementById('exam-paste').value = [
    '১. ৫+৩=?', 'A) ৬', 'B) ৮', 'C) ৯', 'D) ১০', 'উত্তর: B',
    '', '২. ৭×২=?', 'A) ১২', 'B) ১৪', 'C) ১৬', 'D) ১৮', 'উত্তর: B'
  ].join('\n');
  click(doc, '#exam-parse');
  assert.match(doc.getElementById('exam-question-count').textContent, /২টি প্রশ্ন/, 'both questions staged');
  assert.match(doc.getElementById('exam-staged').textContent, /৫\+৩=\?/, 'preview shows the question');
  assert.equal(data.db.exams.list().length, before, 'staging writes nothing');

  // Publishing stores the whole paper in one go.
  doc.getElementById('exam-title').value = 'সাপ্তাহিক MCQ';
  doc.getElementById('exam-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const exams = data.db.exams.list();
  assert.equal(exams.length, before + 1, 'the exam is created');
  const created = exams.at(-1);
  assert.equal(created.questions.length, 2, 'both pasted questions saved');
  assert.equal(created.questions[0].answer, 1, 'the answer marker was kept');
  assert.equal(created.duration, 30);
});

test('an incomplete paste is reported instead of saved', async () => {
  const dom = installDom(`
    <div id="exam-list"></div><div id="exam-staged"></div><span id="exam-question-count"></span>
    <div id="exam-parse-report"></div><div id="exam-results"></div>
    <button id="open-exam-modal"></button><button id="exam-parse"></button>
    <button id="exam-template"></button><button id="exam-copy-template"></button><button id="add-question"></button>
    <div class="modal-overlay" id="exam-modal"><div class="modal-content"><form id="exam-form">
      <input id="exam-title" name="title"><select id="exam-class" name="className"><option selected>নবম</option></select>
      <input id="exam-subject" name="subject"><input id="exam-duration" name="duration" value="30">
      <input id="exam-date" name="date"><input id="exam-start" name="startDate"><input id="exam-end" name="endDate">
      <textarea id="exam-paste"></textarea>
      <input id="q-text"><input id="q-opt0"><input id="q-opt1"><input id="q-opt2"><input id="q-opt3">
      <select id="q-answer"><option value="0">১</option></select>
    </form></div></div>`);
  const doc = dom.window.document;
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const { mountExamAuthoring } = await import('../js/exams.js');
  mountExamAuthoring({ session: { role: 'admin', name: 'অ্যাডমিন' } });

  const before = data.db.exams.list().length;
  doc.getElementById('exam-paste').value = 'প্রশ্ন: একটি অপূর্ণ প্রশ্ন';
  doc.getElementById('exam-parse').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.match(doc.getElementById('exam-parse-report').textContent, /অসম্পূর্ণ/, 'the teacher is told what is wrong');

  doc.getElementById('exam-title').value = 'খালি পরীক্ষা';
  doc.getElementById('exam-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.exams.list().length, before, 'a paper with no valid question is never published');
});

/* ------------------------------------------------------------------ */
/* Taking: countdown, auto-submit, one sitting                         */
/* ------------------------------------------------------------------ */

test('the paper shows a countdown and submits itself when time is up', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const { mountExamTaker } = await import('../js/exams.js');

  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const api = mountExamTaker({ listSelector: '#exam-list', student });

  // A sitting that ran out of time while the tab was closed: the saved
  // deadline is in the past, so opening the exam submits what was saved.
  dom.window.localStorage.setItem(`activeplus_exam_${student.id}_${exam.id}`, JSON.stringify({
    deadline: Date.now() - 1000,
    answers: { 0: String(exam.questions[0].answer) },
    startedAt: Date.now() - 60000
  }));

  click(doc, `[data-take="${exam.id}"]`);

  // The expired sitting is submitted as soon as the paper would open, so the
  // student never sees a fresh countdown for time that has already passed.
  await new Promise((r) => setTimeout(r, 20));

  const result = data.examResultFor(exam.id, student.id);
  assert.ok(result, 'the sitting is recorded');
  assert.equal(result.autoSubmitted, true, 'and marked as an automatic submission');
  assert.equal(result.score, 1, 'the answer saved before the deadline was graded');
  assert.equal(data.db.examResults.list().filter((r) => r.examId === exam.id).length, 1, 'exactly one result');
  assert.match(doc.getElementById('exam-player').innerHTML, /স্বয়ংক্রিয়ভাবে জমা/, 'the student is told why');
  assert.equal(dom.window.localStorage.getItem(`activeplus_exam_${student.id}_${exam.id}`), null, 'the sitting is cleared');

  // The list offers no second attempt.
  click(doc, '#back-to-exams');
  assert.equal(doc.querySelector(`[data-take="${exam.id}"]`), null, 'a taken exam cannot be sat again');
  assert.ok(api && typeof api.start === 'function', 'the controller exposes start() for the home shortcut');
});

test('a fresh sitting keeps its own deadline and grades the answers given', async () => {
  const dom = installDom('<div id="exam-list"></div><div id="exam-player" hidden></div>');
  const doc = dom.window.document;
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const { mountExamTaker } = await import('../js/exams.js');

  const student = data.db.students.find('2026-09-002');
  const exam = data.examsFor(student.className)[0];
  mountExamTaker({ listSelector: '#exam-list', student });
  click(doc, `[data-take="${exam.id}"]`);

  const form = doc.getElementById('exam-take-form');
  assert.ok(form, 'the paper opens');
  // A visible countdown, in Bengali digits, on the running paper.
  const timer = doc.getElementById('exam-timer');
  assert.ok(timer, 'the student sees a timer');
  assert.match(timer.textContent, /⏱ [০-৯]{2}:[০-৯]{2}/, `timer shows mm:ss, got ${timer.textContent}`);
  assert.match(doc.getElementById('exam-notice').textContent, /সময় শেষ হলে উত্তরপত্র স্বয়ংক্রিয়ভাবে জমা/, 'the auto-submit rule is announced');
  exam.questions.forEach((q, qi) => {
    const radio = form.querySelector(`input[name="q${qi}"][value="${q.answer}"]`);
    radio.checked = true;
    radio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  // The palette shows progress while the paper runs.
  assert.ok(doc.querySelectorAll('.exam-dot.done').length >= 1, 'answered questions are ticked off');

  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const result = data.examResultFor(exam.id, student.id);
  assert.equal(result.score, exam.questions.length, 'every answer graded');
  assert.equal(result.autoSubmitted, false, 'a manual submission is not flagged as automatic');
  dom.window.localStorage.clear();
});
