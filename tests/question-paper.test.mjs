/**
 * প্রশ্নপত্র — the printable MCQ paper built from a pasted exam, plus the
 * teacher's answer key. The paper is painted onto canvases, so this test reads
 * back every string drawn and checks the paper says what a paper must say:
 * the institution pad, class/subject/time/marks, the Bengali date, every
 * question with its options — and no answer anywhere on the student's copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const RAW_DATE = /\d{4}-\d{2}-\d{2}(?!\d)|[০-৯]{4}-[০-৯]{2}-[০-৯]{2}(?![০-৯])/u;

/** A recording canvas: every string painted is collected, page by page. */
function installRecordingCanvas() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:8080/teacher.html' });
  const pages = [];
  let sink = null;
  void sink;
  const ctx = () => ({
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {},
    rect() {}, fill() {}, stroke() {}, clip() {}, translate() {}, scale() {}, fillRect() {}, strokeRect() {},
    clearRect() {}, setLineDash() {}, quadraticCurveTo() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillText(text, x, y) { (sink || []).push({ text: String(text), y: Math.round(y) }); }
  });
  // Every canvas the builders create gets its own sheet; the measuring passes
  // (which paint nothing) simply stay empty and are filtered out below.
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => {
    if (String(tag).toLowerCase() !== 'canvas') return origCreate(tag);
    const sheet = [];
    pages.push(sheet);
    return {
      width: 0,
      height: 0,
      getContext: () => { sink = sheet; return ctx(); },
      toDataURL: () => 'data:image/png;base64,AAAA',
      toBlob: (cb) => cb(new dom.window.Blob(['x']))
    };
  };
  dom.window.Image = class {
    constructor() { this.naturalWidth = 64; this.naturalHeight = 64; this.width = 64; this.height = 64; }
    set src(value) { this._src = value; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.Blob = dom.window.Blob;
  globalThis.URL.createObjectURL = () => 'blob:x';
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });

  return {
    dom,
    // Only the sheets something was actually drawn on, in creation order.
    get pages() { return pages.filter((sheet) => sheet.length); },
    reset() { sink = null; pages.length = 0; }
  };
}

const text = (page) => page.map((d) => d.text).join(' | ');
const painted = (pages) => pages.map(text).join(' || ');

test('the printed paper carries the pad, the heading and every question', async () => {
  const rec = installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const docs = await import('../js/docs.js');

  const base = data.db.exams.list()[0];
  const exam = {
    ...base,
    questions: [
      { q: 'বাংলাদেশের রাজধানী কোনটি?', options: ['ঢাকা', 'চট্টগ্রাম', 'খুলনা', 'রাজশাহী'], answer: 0 },
      { q: '২ + ২ = কত?', options: ['৩', '৪', '৫', '৬'], answer: 1 },
      { q: 'তিন কোণের সমষ্টি কত?', options: ['৯০°', '১৮০°', '২৭০°', '৩৬০°'], answer: 1 }
    ]
  };

  rec.reset();
  const settings = data.db.settings.get();
  const canvases = await docs.renderQuestionPaperCanvases(exam, { settings });
  const paper = painted(rec.pages);
  const flat = text(rec.pages[0]);

  assert.equal(canvases.length, 1, 'three questions fit one sheet');
  assert.match(flat, new RegExp(settings.orgName), 'the institution name is on the paper');
  assert.match(flat, /বহুনির্বাচনি প্রশ্নপত্র/, 'the paper names itself');
  assert.match(flat, /শ্রেণি: নবম/, 'class is printed');
  assert.match(flat, /বিষয়: গণিত/, 'subject is printed');
  assert.match(flat, /সময়: ৩০ মিনিট/, 'duration is printed');
  assert.match(flat, /পূর্ণমান: ৩/, 'marks equal the number of questions');
  assert.match(flat, /তারিখ: [০-৯]{1,2} [\u0980-\u09FF]+ [০-৯]{4}/, 'the Bengali long exam date is printed');
  assert.equal(RAW_DATE.test(paper), false, `no raw date on the paper: ${paper.match(RAW_DATE)}`);

  // Every question and option, with Bengali letter markers.
  exam.questions.forEach((q, qi) => {
    assert.ok(flat.includes(q.q), `question ${qi + 1} is on the paper`);
    q.options.forEach((opt) => assert.ok(flat.includes(opt), `option "${opt}" is on the paper`));
  });
  const numbers = flat.match(/[১-৯][০-৯]?।? /g) || [];
  assert.ok(flat.includes('১. বাংলাদেশের রাজধানী কোনটি?'), 'questions are numbered in Bengali digits');
  void numbers;
  for (const letter of ['ক)', 'খ)', 'গ)', 'ঘ)']) {
    assert.ok(flat.includes(letter), `options use the ${letter} marker`);
  }
  // Nothing that looks like the answer is on the student's copy.
  assert.equal(flat.includes('সঠিক উত্তরপত্র'), false, 'no answer key on the student paper');
});

test('the answer key is a separate sheet, marked for the teacher only', async () => {
  const rec = installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const docs = await import('../js/docs.js');

  const base = data.db.exams.list()[0];
  const exam = {
    ...base,
    questions: [
      { q: 'প্রশ্ন এক?', options: ['ক১', 'খ১', 'গ১', 'ঘ১'], answer: 2 },
      { q: 'প্রশ্ন দুই?', options: ['ক২', 'খ২', 'গ২', 'ঘ২'], answer: 0 }
    ]
  };

  rec.reset();
  const canvases = await docs.renderQuestionPaperCanvases(exam, { settings: data.db.settings.get(), withAnswers: true });
  assert.equal(canvases.length, 2, 'paper + key');
  assert.equal(rec.pages.length, 2, 'two sheets painted');
  assert.equal(text(rec.pages[0]).includes('উত্তরপত্র'), false, 'the first sheet is the paper');
  const key = text(rec.pages[1]);
  assert.match(key, /সঠিক উত্তরপত্র — শিক্ষকের জন্য/, 'the key says what it is');
  assert.match(key, /শিক্ষার্থীদের দেওয়ার আগে সরিয়ে নিন/, 'and warns the teacher');
  assert.match(key, /মোট প্রশ্ন: ২/, 'the key counts the questions');
  // option ৩ of question ১ is 'গ'; option ১ of question ২ is 'ক'
  assert.match(key, /১\. \| গ/, 'question 1 → গ');
  assert.match(key, /২\. \| ক/, 'question 2 → ক');
  assert.equal(RAW_DATE.test(painted(rec.pages)), false, 'the key has no raw date either');
});

test('an empty exam still produces a usable sheet instead of throwing', async () => {
  const rec = installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const docs = await import('../js/docs.js');

  rec.reset();
  const canvases = await docs.renderQuestionPaperCanvases(
    { id: 'exam-empty', title: 'ফাঁকা পরীক্ষা', className: 'নবম', questions: [] },
    { settings: data.db.settings.get() }
  );
  assert.equal(canvases.length, 1, 'one sheet is still produced');
  assert.match(text(rec.pages[0]), /কোনো প্রশ্ন যোগ করা হয়নি/, 'and it says the paper is empty');
});
