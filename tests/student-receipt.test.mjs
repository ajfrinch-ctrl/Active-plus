/**
 * Student portal: "রসিদ" click → preview → download (the reported bug).
 *
 * The old flow put a print button in a detail modal; printing it sent the
 * WHOLE student page (header, cards, bottom nav) to the print dialog because
 * the print stylesheet only dropped the admin/teacher .app shell. Now the
 * receipt follows the centralized flow: the receipt is painted on a clean
 * canvas, the shared preview modal shows it, and the download button saves
 * that receipt as a PDF. No print dialog, ever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { loadDemo } from './helpers/demo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

const click = (doc, sel) => doc.querySelector(sel).dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function bootHome() {
  const dom = new JSDOM(read('student.html'), { url: 'http://localhost:8080/student.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom has no layout

  /* Canvases: record what the document painters draw (jsdom has no canvas). */
  const drawn = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arcTo() {}, arc() {}, rect() {}, fill() {}, stroke() {}, clip() {},
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillRect() {}, strokeRect() {}, clearRect() {}, setLineDash() {},
    fillText: (t) => { drawn.push(String(t)); },
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage() {}
  };
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => (String(tag).toLowerCase() === 'canvas'
    ? { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', toBlob: (cb) => cb(new dom.window.Blob(['x'])) }
    : origCreate(tag));

  /* jsdom never loads images; a stub that resolves on demand keeps the
     document builders (logo) from waiting forever. */
  dom.window.Image = class {
    constructor() { this.naturalWidth = 64; this.naturalHeight = 64; this.width = 64; this.height = 64; }
    set src(value) { this._src = value; Promise.resolve().then(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };

  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.Image = dom.window.Image;
  globalThis.Blob = dom.window.Blob;
  globalThis.URL.createObjectURL = () => 'blob:test';
  globalThis.URL.revokeObjectURL = () => {};
  // No network in tests: the logo fetch must fail fast into its fallback.
  globalThis.fetch = async () => { throw new Error('offline test'); };

  (await import('../js/store.js'))._clearMemoryStore();
  // A receipt is only meaningful with fee rows behind it, so the demo centre
  // (records and accounts) is loaded first — the app itself ships empty.
  await loadDemo();
  const auth = await import('../js/auth.js');
  await auth.signIn('2026-09-001', 'Student@123', 'student');
  const mod = await import('../js/student-home.js');
  mod.initStudentHome();
  await tick(400); // skeleton hand-off

  // The old bug in one line: printing sent the whole page to the printer.
  const printCalls = [];
  dom.window.print = () => { printCalls.push(1); };

  return { dom, doc: dom.window.document, drawn, printCalls };
}

test('student receipt opens the preview, and its download saves the receipt — never the whole page', async () => {
  const { doc, drawn, printCalls } = await bootHome();

  // No receipt print button may exist anywhere in the page anymore.
  assert.equal(doc.getElementById('print-receipt'), null, 'the old "রসিদ প্রিন্ট করুন" button is gone');

  // Open the fees panel: home → আরও → ফি.
  click(doc, '#home-content [data-act="more"]');
  await tick();
  click(doc, '#more-menu [data-act="fees"]');
  await tick();
  const receiptBtn = doc.querySelector('#more-content [data-receipt]');
  assert.ok(receiptBtn, 'a seeded payment offers its রসিদ');

  // Clicking রসিদ opens the shared document preview — no print dialog.
  click(doc, '#more-content [data-receipt]');
  await tick(120);
  const modal = doc.getElementById('document-preview-modal');
  assert.ok(modal, 'student.html carries the shared preview modal');
  assert.ok(modal.classList.contains('active'), 'the preview modal is open');
  assert.equal(printCalls.length, 0, 'opening the receipt never calls window.print');

  const title = doc.getElementById('document-preview-title').textContent;
  assert.match(title, /পেমেন্ট রিসিট/, `preview is titled as a receipt, got "${title}"`);
  assert.ok(doc.querySelector('#document-preview-body .doc-page img'), 'the receipt sheet is shown as a page image');

  // The painted receipt is the clean document (no app UI strings).
  assert.ok(drawn.length > 0, 'the receipt canvas was actually painted');

  // ...and the download button saves a PDF of the receipt.
  const downloadBtn = doc.getElementById('document-preview-download');
  assert.equal(downloadBtn.hidden, false, 'PDF download is offered');
  click(doc, '#document-preview-download');
  await tick(120);
  const toasts = [...doc.querySelectorAll('#toast-container .toast')].map((t) => t.textContent).join(' | ');
  assert.match(toasts, /PDF ডাউনলোড হয়েছে/, `download reports success, got "${toasts}"`);
  assert.equal(printCalls.length, 0, 'downloading never calls window.print either');
});

test('every portal page serves the bundled Bengali font — no CDN dependency', () => {
  for (const page of ['index.html', 'student.html', 'teacher.html', 'admin.html']) {
    const html = read(page);
    assert.match(html, /css\/fonts\.css/, `${page} loads the local fonts.css`);
    assert.equal(html.includes('fonts.googleapis.com'), false, `${page} no longer needs the Google Fonts CDN`);
    assert.equal(html.includes('fonts.gstatic.com'), false, `${page} no longer preconnects the font CDN`);
  }
  const css = read('css/fonts.css');
  for (const weight of [400, 600, 700]) {
    for (const subset of ['bengali', 'latin', 'latin-ext']) {
      const file = `assets/fonts/hind-siliguri-${subset}-${weight}.woff2`;
      assert.ok(readFileSync(path.join(ROOT, file)).subarray(0, 4).equals(new Uint8Array([0x77, 0x4f, 0x46, 0x32])), `${file} is a real woff2`);
      assert.ok(css.includes(file), `fonts.css declares ${file}`);
    }
  }
  const sw = read('service-worker.js');
  for (const weight of [400, 600, 700]) {
    for (const subset of ['bengali', 'latin', 'latin-ext']) {
      assert.ok(sw.includes(`assets/fonts/hind-siliguri-${subset}-${weight}.woff2`), `the service worker precaches the ${subset} ${weight} font`);
    }
  }
});
