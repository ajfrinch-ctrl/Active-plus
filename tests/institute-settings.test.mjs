/**
 * Institute profile in the admin Settings panel:
 * name, address, mobile number and email can be written and edited there, and
 * every letterhead/document/portal that prints them picks the edit up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */
function installGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true
  });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.FormData = dom.window.FormData;
  globalThis.Blob = dom.window.Blob;
  return dom;
}

function makeDom(bodyHtml = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost:8080/admin.html', pretendToBeVisual: true
  });
  dom.window.scrollTo = () => {};
  return installGlobals(dom);
}

function inlineModuleScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/type\s*=\s*["']module["']/i.test(m[1])) out.push(m[2]);
  }
  return out;
}

/** Boots the real admin panel (inline module included) as a signed-in admin. */
async function bootAdmin(nonce) {
  const html = read('admin.html');
  const dom = new JSDOM(html, { url: 'http://localhost:8080/admin.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  installGlobals(dom);

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };

  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });
  await auth.signIn('admin@activeplus.edu', 'Admin@123', 'admin');

  const scripts = inlineModuleScripts(html);
  assert.ok(scripts.length, 'admin.html has an inline module script');
  const tmp = path.join(ROOT, `.boot-institute-${nonce}.mjs`);
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
    written.forEach((f) => { try { unlinkSync(f); } catch (e) { /* already gone */ } });
  }
  await new Promise((r) => setTimeout(r, 200));
  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `admin panel booted cleanly: ${fatal.join(' | ')}`);
  return { dom, doc: dom.window.document };
}

const submit = (doc) => doc.getElementById('settings-form')
  .dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));

/* ------------------------------------------------------------------ */
/* Data layer                                                          */
/* ------------------------------------------------------------------ */
test('the institute profile is complete by default and readable in one call', async () => {
  makeDom();
  (await import('../js/store.js'))._clearMemoryStore();
  const { orgInfo, db } = await import('../js/data.js');
  db.reset();

  const org = orgInfo();
  assert.ok(org.name.length > 0, 'an institute always has a name');
  assert.ok(org.address.length > 0, 'the seed carries an address');
  assert.ok(org.mobile.length > 0, 'the seed carries a mobile number');
  assert.ok(org.email.includes('@'), 'the seed carries an email');
  assert.equal(org.contactLine, `${org.mobile} · ${org.email}`, 'letterhead contact line');
});

test('mobile numbers are accepted in Bengali digits and validated as BD numbers', async () => {
  makeDom();
  const { isValidMobile, isValidEmail, mobileDigits } = await import('../js/data.js');

  assert.equal(mobileDigits('০১৭০০-০০০০০০'), '01700000000', 'Bengali digits normalised');
  assert.equal(isValidMobile('০১৭০০-০০০০০০'), true, 'Bengali-digit number is valid');
  assert.equal(isValidMobile('01711-000000'), true, 'ASCII number is valid');
  assert.equal(isValidMobile('+8801711000000'), true, 'country code accepted');
  assert.equal(isValidMobile('0171100'), false, 'too short');
  assert.equal(isValidMobile('12345678901'), false, 'must start with 01');
  assert.equal(isValidMobile(''), false, 'empty is not a number');

  assert.equal(isValidEmail('info@activeplus.edu'), true);
  assert.equal(isValidEmail('নাম@example.com'), true, 'a Bengali local part is still an address');
  assert.equal(isValidEmail('info@activeplus'), false, 'needs a domain suffix');
  assert.equal(isValidEmail('info activeplus.edu'), false, 'needs an @');
  assert.equal(isValidEmail('info@@activeplus.edu'), false, 'one @ only');
  assert.equal(isValidEmail(''), false, 'empty is not an address');
});

test('saving the institute profile persists it', async () => {
  makeDom();
  (await import('../js/store.js'))._clearMemoryStore();
  const { saveOrgInfo, orgInfo, db } = await import('../js/data.js');
  db.reset();

  const res = saveOrgInfo({
    orgName: '  নবদিগন্ত কোচিং সেন্টার  ',
    address: 'কলেজ রোড, যশোর',
    mobile: '০১৮১১-২২২৩৩৩',
    email: 'office@nobodigonto.edu'
  });

  assert.equal(res.ok, true, 'a complete profile saves');
  assert.deepEqual(res.errors, []);
  const org = orgInfo();
  assert.equal(org.name, 'নবদিগন্ত কোচিং সেন্টার', 'surrounding space is trimmed');
  assert.equal(org.address, 'কলেজ রোড, যশোর');
  assert.equal(org.mobile, '০১৮১১-২২২৩৩৩');
  assert.equal(org.email, 'office@nobodigonto.edu');
  assert.equal(db.settings.get().orgName, 'নবদিগন্ত কোচিং সেন্টার', 'written to the store');
});

test('an incomplete or wrong profile is refused and nothing is written', async () => {
  makeDom();
  (await import('../js/store.js'))._clearMemoryStore();
  const { saveOrgInfo, orgInfo, db } = await import('../js/data.js');
  db.reset();
  const before = orgInfo();
  const saved = db.settings.get();

  const empty = saveOrgInfo({ orgName: '', address: '', mobile: '', email: '' });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.errors.map((e) => e.field), ['orgName', 'address', 'mobile', 'email'],
    'every missing field is reported');
  assert.ok(empty.errors.every((e) => /[\u0980-\u09FF]/.test(e.message)), 'messages are in Bengali');

  const badMobile = saveOrgInfo({ ...saved, mobile: '0171' });
  assert.equal(badMobile.ok, false);
  assert.deepEqual(badMobile.errors.map((e) => e.field), ['mobile']);

  const badEmail = saveOrgInfo({ ...saved, email: 'at@' });
  assert.equal(badEmail.ok, false);
  assert.deepEqual(badEmail.errors.map((e) => e.field), ['email']);

  const after = orgInfo();
  assert.deepEqual(after, before, 'a refused save leaves the institute profile untouched');
});

/* ------------------------------------------------------------------ */
/* Admin panel UI                                                      */
/* ------------------------------------------------------------------ */
test('the settings form carries the four institute fields, pre-filled for editing', async () => {
  const { doc } = await bootAdmin('fields');
  const { db } = await import('../js/data.js');
  const settings = db.settings.get();

  const html = read('admin.html');
  assert.match(html, /<label for="set-org">/, 'label for the name');
  assert.match(html, /<label for="set-address">/, 'label for the address');
  assert.match(html, /<label for="set-mobile">/, 'label for the mobile number');
  assert.match(html, /<label for="set-email">/, 'label for the email');

  const org = doc.getElementById('set-org');
  const address = doc.getElementById('set-address');
  const mobile = doc.getElementById('set-mobile');
  const email = doc.getElementById('set-email');
  for (const [el, name] of [[org, 'orgName'], [address, 'address'], [mobile, 'mobile'], [email, 'email']]) {
    assert.ok(el, `#${el ? el.id : name} exists`);
    assert.equal(el.name, name, `${name} is part of the settings form`);
    assert.equal(el.closest('form')?.id, 'settings-form', `${name} submits with the settings form`);
  }
  assert.ok(doc.getElementById('settings-form').hasAttribute('novalidate'),
    'the Bengali messages win over the browser own English bubbles');
  assert.equal(org.value, settings.orgName, 'the saved name is loaded for editing');
  assert.equal(address.value, settings.address, 'the saved address is loaded for editing');
  assert.equal(mobile.value, settings.mobile, 'the saved mobile number is loaded for editing');
  assert.equal(email.value, settings.email, 'the saved email is loaded for editing');

  // a live mirror of the letterhead so the admin sees the edit before saving
  assert.ok(doc.getElementById('org-preview'), 'letterhead preview present');
  assert.equal(doc.getElementById('op-org').textContent, settings.orgName);
  assert.equal(doc.getElementById('op-address').textContent, settings.address);
  assert.equal(doc.getElementById('op-contact').textContent, `${settings.mobile} · ${settings.email}`);
});

test('typing in the institute fields previews the letterhead immediately', async () => {
  const { doc } = await bootAdmin('preview');
  const win = doc.defaultView;
  const type = (id, value) => {
    const el = doc.getElementById(id);
    el.value = value;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };

  type('set-org', 'সূর্যমুখী কোচিং');
  type('set-address', 'রেলগেট, বগুড়া');
  type('set-mobile', '০১৯১১-৪৪৫৫৬৬');
  type('set-email', 'hello@surjomukhi.edu');

  assert.equal(doc.getElementById('op-org').textContent, 'সূর্যমুখী কোচিং', 'name previewed');
  assert.equal(doc.getElementById('op-address').textContent, 'রেলগেট, বগুড়া', 'address previewed');
  assert.equal(doc.getElementById('op-contact').textContent, '০১৯১১-৪৪৫৫৬৬ · hello@surjomukhi.edu',
    'mobile and email previewed');
});

test('saving the institute profile updates the letterhead and the admin home', async () => {
  const { doc } = await bootAdmin('save');
  const { db, orgInfo } = await import('../js/data.js');

  doc.getElementById('set-org').value = 'অ্যাক্টিভ প্লাস কোচিং সেন্টার';
  doc.getElementById('set-address').value = 'শহীদ সড়ক, রাজশাহী';
  doc.getElementById('set-mobile').value = '01712-345678';
  doc.getElementById('set-email').value = 'info@activeplus.bd';
  submit(doc);

  const org = orgInfo();
  assert.equal(org.name, 'অ্যাক্টিভ প্লাস কোচিং সেন্টার', 'name saved');
  assert.equal(org.address, 'শহীদ সড়ক, রাজশাহী', 'address saved');
  assert.equal(org.mobile, '01712-345678', 'mobile saved');
  assert.equal(org.email, 'info@activeplus.bd', 'email saved');
  assert.equal(db.settings.get().email, 'info@activeplus.bd', 'persisted in the store');
  assert.match(doc.getElementById('toast-container').textContent, /সংরক্ষিত/, 'the admin is told it was saved');
  assert.equal(doc.getElementById('org-error').classList.contains('visible'), false, 'no error shown');

  // the printable letterhead carries the new identity (name, address, contact)
  assert.equal(doc.getElementById('ph-org').textContent, 'অ্যাক্টিভ প্লাস কোচিং সেন্টার');
  assert.equal(doc.getElementById('ph-addr').textContent, 'শহীদ সড়ক, রাজশাহী');
  assert.equal(doc.getElementById('ph-contact').textContent, '01712-345678 · info@activeplus.bd');

  // the admin home institute card shows the same four values
  const card = doc.getElementById('admin-org-card');
  assert.ok(card, 'institute card on the admin home');
  assert.match(card.textContent, /অ্যাক্টিভ প্লাস কোচিং সেন্টার/);
  assert.match(card.textContent, /শহীদ সড়ক, রাজশাহী/);
  assert.match(card.textContent, /01712-345678/);
  assert.match(card.textContent, /info@activeplus\.bd/);
  assert.equal(card.querySelector('a[href="tel:+8801712345678"]')?.textContent, '01712-345678',
    'the number is diallable');
  assert.equal(card.querySelector('a[href="mailto:info@activeplus.bd"]')?.textContent, 'info@activeplus.bd',
    'the email opens a draft');
  assert.ok(card.querySelector('[data-goto="settings"]'), 'an edit shortcut goes to Settings');

  // reloading the panel keeps the edited values (they were really stored)
  assert.equal(doc.getElementById('set-mobile').value, '01712-345678', 'the form still shows the edit');
  assert.equal(doc.getElementById('set-email').value, 'info@activeplus.bd');
});

test('a wrong mobile number or email blocks the save and says why in Bengali', async () => {
  const { doc } = await bootAdmin('invalid');
  const { db } = await import('../js/data.js');
  const before = { ...db.settings.get() };

  doc.getElementById('set-email').value = 'info@activeplus';
  doc.getElementById('set-mobile').value = '017';
  submit(doc);

  const box = doc.getElementById('org-error');
  assert.equal(box.classList.contains('visible'), true, 'the errors are shown under the form');
  assert.match(box.textContent, /মোবাইল নম্বর/, 'the mobile problem is explained');
  assert.match(box.textContent, /ইমেইল/, 'the email problem is explained');
  assert.equal(doc.getElementById('set-mobile').classList.contains('input-invalid'), true, 'bad field outlined');
  assert.equal(doc.getElementById('set-email').classList.contains('input-invalid'), true, 'bad field outlined');
  assert.equal(doc.getElementById('set-org').classList.contains('input-invalid'), false, 'good fields untouched');
  assert.match(doc.getElementById('toast-container').textContent, /মোবাইল নম্বর/, 'toast explains the problem');

  assert.equal(db.settings.get().orgName, before.orgName, 'nothing was saved');
  assert.equal(db.settings.get().mobile, before.mobile, 'the mobile number was not stored');
  assert.equal(db.settings.get().email, before.email, 'the email was not stored');
  assert.equal(db.settings.get().monthlyFee, before.monthlyFee, 'the rest of the form is not half-saved');
});

test('a missing institute name is refused even though the field is required', async () => {
  const { doc } = await bootAdmin('empty');
  const { orgInfo } = await import('../js/data.js');
  const before = orgInfo();

  doc.getElementById('set-org').value = '   ';
  submit(doc);

  assert.equal(orgInfo().name, before.name, 'the saved name survived');
  assert.match(doc.getElementById('org-error').textContent, /নাম লিখুন/, 'the admin is told what to fix');
});

/* ------------------------------------------------------------------ */
/* Login screen + documents                                            */
/* ------------------------------------------------------------------ */
test('the login screen introduces the institute written in Settings', async () => {
  const html = read('index.html');
  const dom = new JSDOM(html, { url: 'http://localhost:8080/index.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  installGlobals(dom);

  (await import('../js/store.js'))._clearMemoryStore();
  const { db } = await import('../js/data.js');
  db.reset();
  db.settings.update({
    orgName: 'সূর্যোদয় কোচিং সেন্টার', address: 'বাজার রোড, রংপুর',
    mobile: '01611-223344', email: 'info@surjoday.edu'
  });
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });

  const tmp = path.join(ROOT, '.boot-index-org.mjs');
  writeFileSync(tmp, inlineModuleScripts(html)[0]);
  try { await import(`file://${tmp}`); } finally { unlinkSync(tmp); }
  await new Promise((r) => setTimeout(r, 200));

  const doc = dom.window.document;
  const line = doc.getElementById('org-line');
  assert.ok(line, 'the login screen has an institute line');
  assert.equal(line.hidden, false, 'it is shown once the profile is known');
  assert.equal(doc.getElementById('org-line-name').textContent, 'সূর্যোদয় কোচিং সেন্টার', 'name');
  const detail = doc.getElementById('org-line-detail').textContent;
  assert.match(detail, /বাজার রোড, রংপুর/, 'address');
  assert.match(detail, /01611-223344/, 'mobile number');
  assert.match(detail, /info@surjoday\.edu/, 'email');
});

test('receipts and reports print the institute profile the admin wrote', async () => {
  makeDom();
  (await import('../js/store.js'))._clearMemoryStore();
  const { db, saveOrgInfo } = await import('../js/data.js');
  db.reset();
  saveOrgInfo({
    orgName: 'কাজীপাড়া কোচিং', address: 'কাজীপাড়া, মিরপুর, ঢাকা',
    mobile: '01555-000111', email: 'kazipara@example.com'
  });

  const { buildReceiptHtml, buildReportHtml } = await import('../js/docs.js');
  const receipt = buildReceiptHtml(
    { id: 'p1', receiptNo: 'R-1', date: '২০২৬-০৯-১০', amount: 1200, method: 'নগদ' },
    { student: db.students.list()[0], settings: db.settings.get() }
  );
  for (const value of ['কাজীপাড়া কোচিং', 'কাজীপাড়া, মিরপুর, ঢাকা', '01555-000111', 'kazipara@example.com']) {
    assert.ok(receipt.includes(value), `receipt prints ${value}`);
  }

  const report = buildReportHtml({
    settings: db.settings.get(),
    title: 'শিক্ষার্থী তালিকা',
    columns: [{ key: 'name', label: 'নাম' }, { key: 'roll', label: 'রোল' }],
    rows: [{ name: 'রহিম', roll: '০১' }]
  });
  for (const value of ['কাজীপাড়া কোচিং', '01555-000111', 'kazipara@example.com']) {
    assert.ok(report.includes(value), `report prints ${value}`);
  }
});
