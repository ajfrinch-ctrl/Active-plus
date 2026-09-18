/**
 * "সকল ক্ষেত্রে তারিখ ফরমেট ১৬ সেপ্টেম্বর ২০২৬" — including everything the app
 * hands out as a document. The reports, receipts, ID cards and ledgers are
 * painted onto canvases, so this test records every string the painters draw
 * and fails on any raw date ('2026-09-16', '১৬/০৯/২০২৬') among them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const RAW_DATE = new RegExp([
  String.raw`\d{4}-\d{2}-\d{2}(?!\d)`,
  String.raw`[০-৯]{4}-[০-৯]{2}-[০-৯]{2}(?![০-৯])`,
  String.raw`\d{1,2}/\d{1,2}/\d{4}(?!\d)`,
  String.raw`[০-৯]{1,2}/[০-৯]{1,2}/[০-৯]{4}(?![০-৯])`
].join('|'), 'u');

const BN_LONG = /[০-৯]{1,2}\s+[\u0980-\u09FF]+\s+[০-৯]{4}/;

/** A jsdom window whose canvases record every string drawn on them. */
function installRecordingCanvas() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:8080/admin.html' });
  const drawn = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    text: '', save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arcTo() {}, arc() {}, rect() {}, fill() {}, stroke() {}, clip() {}, translate() {}, scale() {},
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillRect() {}, strokeRect() {}, clearRect() {}, setLineDash() {}, quadraticCurveTo() {},
    fillText: (t) => { drawn.push(String(t)); },
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage() {}
  };
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => (String(tag).toLowerCase() === 'canvas'
    ? { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAAA', toBlob: (cb) => cb(new dom.window.Blob(['x'])) }
    : origCreate(tag));

  // jsdom never loads images; a stub that resolves on demand keeps the
  // document builders (logo, photo) from waiting forever.
  dom.window.Image = class {
    constructor() { this.naturalWidth = 64; this.naturalHeight = 64; this.width = 64; this.height = 64; }
    set src(value) { this._src = value; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Image = dom.window.Image;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  globalThis.Blob = dom.window.Blob;
  globalThis.URL.createObjectURL = () => 'blob:x';
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  return drawn;
}

test('the receipt and reports print the Bengali long date, never a raw one', async () => {
  const drawn = installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const docs = await import('../js/docs.js');

  // Make sure something date-shaped is actually painted.
  const pay = data.db.payments.list()[0];
  assert.ok(pay && pay.date, 'the seed has a dated payment');

  await docs.renderReceiptCanvas(pay);
  const receipt = drawn.join(' | ');
  assert.match(receipt, BN_LONG, `the receipt shows a Bengali long date: ${receipt.slice(0, 200)}`);
  assert.equal(RAW_DATE.test(receipt), false, `no raw date on the receipt: ${receipt.match(RAW_DATE)}`);

  const student = data.db.students.list()[0];
  const before = drawn.length;
  await docs.renderIdCardCanvas(student);
  await docs.renderFinanceReportCanvases();
  await docs.renderNoticeCanvases();
  await docs.renderDueStatementCanvases(student);
  const documents = drawn.slice(before).join(' | ');
  assert.match(documents, BN_LONG, 'the documents carry the Bengali long date');
  assert.equal(RAW_DATE.test(documents), false, `no raw date in the documents: ${documents.match(RAW_DATE)}`);
});

test('the receipt HTML and the report HTML use the same Bengali date', async () => {
  installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');
  const docs = await import('../js/docs.js');

  const pay = data.db.payments.list()[0];
  const student = data.db.students.find(pay.studentId);
  const settings = data.db.settings.get();
  const receiptHtml = String(docs.buildReceiptHtml(pay, { student, settings })).replace(/<[^>]+>/g, ' ');
  assert.match(receiptHtml, BN_LONG, 'the receipt document prints the long date');
  assert.equal(RAW_DATE.test(receiptHtml), false, `no raw date in the receipt HTML: ${receiptHtml.match(RAW_DATE)}`);

  const reportHtml = String(docs.buildReportHtml({
    settings,
    title: 'পেমেন্ট রিপোর্ট',
    subtitle: 'নমুনা',
    columns: [{ key: 'date', label: 'তারিখ' }, { key: 'amount', label: 'পরিমাণ' }],
    rows: [{ date: data.formatBnDate(pay.date), amount: '১০০০' }, { date: '—', amount: '৫০০' }]
  })).replace(/<[^>]+>/g, ' ');
  assert.match(reportHtml, BN_LONG, 'the report body prints the long date');
  assert.equal(RAW_DATE.test(reportHtml), false, `${reportHtml.match(RAW_DATE)}`);
});

test('recent activity and exam windows speak the same date', async () => {
  installRecordingCanvas();
  (await import('../js/store.js'))._clearMemoryStore();
  const data = await import('../js/data.js');

  const activity = data.recentActivity(20).map((item) => `${item.text} ${item.meta}`).join(' | ');
  assert.equal(RAW_DATE.test(activity), false, `raw date in the admin activity feed: ${activity.match(RAW_DATE)}`);
  assert.match(activity, BN_LONG, 'the feed shows a Bengali long date');

  const exam = data.db.exams.list()[0];
  const windowLabel = data.examWindow(exam).label;
  assert.equal(RAW_DATE.test(windowLabel), false, `raw date in an exam label: ${windowLabel}`);
  assert.match(windowLabel, BN_LONG, `the exam label carries the long date, got "${windowLabel}"`);
});
