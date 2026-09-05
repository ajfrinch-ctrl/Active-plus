/**
 * Printable Admission Form (logo + institution header).
 *
 * After a successful admission the admin can open the admission form, verify it
 * shows the institution logo and org name plus the student's details, then open
 * the shared document preview (Generate → Preview → Download PDF) instead of a
 * direct print. This boots the real admin portal module in jsdom and drives the
 * actual button wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

function inlineModuleScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/type\s*=\s*["']module["']/i.test(m[1])) out.push(m[2]);
  }
  return out;
}

async function bootAdmin(nonce) {
  const html = read('admin.html');
  const dom = new JSDOM(html, { url: 'http://localhost:8080/admin.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  dom.window.prompt = () => 'ok';
  let printed = 0;
  dom.window.print = () => { printed += 1; };

  // jsdom has no Canvas 2D context; provide a minimal fake so the preview-first
  // document flow (render → preview modal) can be exercised end to end.
  const fakeCtx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: 'top', textAlign: 'left',
    fillText: () => {}, fillRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {}, arcTo: () => {},
    fill: () => {}, stroke: () => {}, save: () => {}, restore: () => {}, clip: () => {},
    drawImage: () => {},
    measureText: (t) => ({ width: String(t).length * 12 })
  };
  const makeCanvas = (w, h) => ({
    width: w, height: h,
    getContext: () => fakeCtx,
    toDataURL: () => 'data:image/png;base64,AAAA',
    toBlob: (cb) => cb(new dom.window.Blob(['x'], { type: 'image/png' }))
  });
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) =>
    (String(tag).toLowerCase() === 'canvas' ? makeCanvas(0, 0) : origCreate(tag));

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.FormData = dom.window.FormData;
  globalThis.File = dom.window.File;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.Blob = dom.window.Blob;

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };

  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });
  await auth.signIn('admin@activeplus.edu', 'Admin@123', 'admin');

  const scripts = inlineModuleScripts(html);
  const tmp = path.join(ROOT, `.boot-admission-${nonce}.mjs`);
  const written = [];
  try {
    for (const [i, code] of scripts.entries()) {
      const file = i === 0 ? tmp : tmp.replace('.mjs', `-${i}.mjs`);
      writeFileSync(file, code);
      written.push(file);
      await import(`file://${file}`);
    }
  } finally {
    console.error = originalError;
    written.forEach((f) => { try { unlinkSync(f); } catch (e) { /* gone */ } });
  }
  await new Promise((r) => setTimeout(r, 200));
  return { dom, doc: dom.window.document, errors, printed: () => printed };
}

test('admission form renders org header + student details and prints a PDF', async () => {
  const { doc, errors, printed } = await bootAdmin('form1');
  const data = await import('../js/data.js');
  const win = doc.defaultView;

  // Set a known org name so we can assert the letterhead uses it.
  data.db.settings.update({ orgName: 'Active Plus Tutorial', address: 'চট্টগ্রাম', mobile: '01711-000000' });

  // Register a brand-new admission through the real form.
  const openBtn = doc.getElementById('open-student-modal');
  openBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  doc.getElementById('student-name').value = 'নতুন ভর্তি শিক্ষার্থী';
  doc.getElementById('student-class').value = 'নবম';
  doc.getElementById('student-roll').value = '7';
  doc.getElementById('student-section').value = 'B';
  doc.getElementById('student-guardian').value = 'করিম উদ্দিন';
  doc.getElementById('student-phone').value = '01711000001';
  doc.getElementById('student-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  // The admission-done confirm modal must appear with the saved student.
  assert.ok(doc.getElementById('admission-modal').classList.contains('active'), 'done modal opens');
  assert.match(doc.getElementById('admission-summary').textContent, /নতুন ভর্তি শিক্ষার্থী/);

  // Find the button that opens the admission form and click it.
  const formBtn = doc.getElementById('admission-form');
  assert.ok(formBtn, 'admission form button exists');
  formBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  assert.ok(doc.getElementById('admission-form-modal').classList.contains('active'), 'admission form modal opens');
  assert.equal(doc.getElementById('admission-modal').classList.contains('active'), false, 'the done modal closes so it does not print on top');
  assert.ok(doc.body.classList.contains('print-admission-form'), 'print-admission-form flag set while open');

  const sheet = doc.querySelector('#admission-form-body .admission-sheet');
  assert.ok(sheet, 'admission sheet rendered');
  assert.ok(doc.querySelector('#admission-form-body img[src="assets/logo.png"]'), 'logo shown in the sheet header');
  assert.ok(sheet.textContent.includes('Active Plus Tutorial'), 'org name from settings in header');
  assert.ok(sheet.textContent.includes('নতুন ভর্তি শিক্ষার্থী'), 'student name present');
  assert.match(sheet.textContent, /ভর্তি ফরম/);
  assert.ok(sheet.textContent.includes('অভিভাবকের স্বাক্ষর'), 'signature area present');
  assert.ok(sheet.textContent.includes('শিক্ষার্থীর মোবাইল'), 'student mobile field present');
  assert.ok(sheet.textContent.includes('অভিভাবকের মোবাইল'), 'guardian mobile field present');
  // The student's active/inactive status must never appear on the form.
  assert.equal(sheet.textContent.includes('অবস্থা'), false, 'no status field on the admission form');
  assert.equal(sheet.textContent.includes('সক্রিয়'), false, 'no active/inactive status on the admission form');

  // Preview-first: the PDF button opens the shared document preview (it must
  // never call window.print() directly).
  const before = printed();
  doc.getElementById('admission-form-pdf').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(printed(), before, 'PDF button never calls window.print() directly');
  assert.ok(doc.getElementById('document-preview-modal').classList.contains('active'), 'document preview opens');
  assert.equal(doc.getElementById('document-preview-title').textContent, 'ভর্তি ফরম', 'preview title is the admission form');

  // Closing clears the flag.
  doc.getElementById('admission-form-close').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(doc.body.classList.contains('print-admission-form'), false, 'flag cleared on close');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('admission form is reachable from the student profile', async () => {
  const { doc, errors } = await bootAdmin('form2');

  const profileBtn = doc.querySelector('[data-profile-student]');
  assert.ok(profileBtn, 'a student row is rendered');
  profileBtn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

  assert.ok(doc.getElementById('student-detail-modal').classList.contains('active'), 'profile modal opens');
  const formBtn = doc.getElementById('admission-form-profile');
  assert.ok(formBtn, 'admission form button on the profile');
  formBtn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

  assert.ok(doc.getElementById('admission-form-modal').classList.contains('active'), 'admission form opens from profile');
  assert.ok(doc.querySelector('#admission-form-body .admission-sheet'), 'sheet rendered from profile');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});
