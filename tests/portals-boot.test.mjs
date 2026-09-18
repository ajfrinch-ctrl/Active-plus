/**
 * Boots the real inline module scripts of the admin and teacher portals in
 * jsdom, so the wiring added for the student home (tips, banners, submissions,
 * student queries) is actually executed — not just syntax-checked.
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

/** Writes the inline script next to the page so its ./js/... imports resolve. */
async function bootPage(page, { username, password, role, nonce = '' }) {
  const html = read(page);
  const dom = new JSDOM(html, { url: `http://localhost:8080/${page}`, pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  dom.window.prompt = () => 'ok';

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
  // Inline page code resolves these off globalThis. Node's own FormData cannot
  // wrap a jsdom form element, so the window's constructors must win here —
  // in a real browser they are the same object.
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
  await auth.signIn(username, password, role);

  const scripts = inlineModuleScripts(html);
  assert.ok(scripts.length, `${page} has an inline module script`);
  const tmp = path.join(ROOT, `.boot-${page.replace('.html', '')}${nonce ? `-${nonce}` : ''}.mjs`);
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
  return { dom, doc: dom.window.document, errors };
}

test('admin portal boots and wires the home-content tabs', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin'
  });

  // the tabs added for the student home render their CRUD widgets
  for (const id of ['tips-crud', 'banners-crud', 'submissions-crud', 'home-cards', 'home-features', 'student-editable']) {
    assert.ok(doc.getElementById(id), `#${id} exists`);
  }
  assert.ok(doc.querySelectorAll('#tips-crud .btn').length > 0, 'tips CRUD mounted');
  assert.ok(doc.querySelectorAll('#banners-crud .btn').length > 0, 'banners CRUD mounted');
  assert.ok(doc.getElementById('submissions-table'), 'submissions review table rendered');

  // the app-style admin home rendered from real data
  const adminHome = doc.getElementById('admin-home');
  assert.ok(adminHome && adminHome.innerHTML.length > 200, 'admin home rendered');
  assert.ok(doc.getElementById('admin-overview'), 'সামগ্রিক অবস্থা overview card present');
  assert.ok(doc.querySelector('.analytics-grid'), 'academic analytics grid present');
  assert.ok(doc.querySelectorAll('.analytics-cell').length >= 11, 'analytics summary cells rendered');
  assert.ok(doc.querySelectorAll('#admin-home .feature-grid .tile').length >= 8, 'feature grid rendered');
  assert.ok(doc.querySelectorAll('#admin-quick .chip').length >= 4, 'quick shortcuts rendered');

  // Minimal first screen: no duplicate stat cards, no English filler, and
  // every feature list stays folded (minimized) until tapped.
  assert.equal(doc.querySelectorAll('#admin-home .nav-card').length, 0, 'no duplicate navigation cards');
  assert.ok(!/View [a-z]/i.test(adminHome.innerHTML), 'no English description text on the home');
  assert.equal(doc.getElementById('admin-see-more'), null, 'no view-swapping See More button');
  const folds = doc.querySelectorAll('#admin-home details.mini-details');
  assert.ok(folds.length >= 4, 'feature groups are collapsible');
  for (const d of folds) assert.equal(d.open, false, 'sections open minimized');
  assert.ok(doc.getElementById('admin-more-sec'), 'আরও ফিচার collapsible present');
  // the grid is the only navigation now — every tile must land on a real panel
  for (const tile of doc.querySelectorAll('#admin-home [data-goto]')) {
    const key = tile.dataset.goto;
    if (key === 'logout') continue;
    assert.ok(doc.getElementById(`tab-${key}`), `admin grid tile "${key}" has a panel`);
  }
  // the summary is computed live from the seeded data (4 students) and shown in
  // Bengali digits; each figure appears exactly once — মোট বকেয়া is not repeated.
  const homeText = adminHome.textContent;
  assert.ok(homeText.includes('৪'), 'real counts shown in Bengali digits');
  assert.equal((homeText.match(/মোট বকেয়া/g) || []).length, 1, 'no duplicated due-total figure');
  for (const key of ['reports', 'dues', 'notices', 'activity']) {
    assert.ok(doc.querySelector(`#admin-home [data-goto="${key}"]`), `navigation card routes to "${key}"`);
  }
  // database status chip is present and never exposes credentials
  const chip = doc.getElementById('admin-net-chip');
  assert.ok(chip, 'connection status chip rendered');
  assert.match(chip.textContent, /অনলাইন|অফলাইন|সিংক/, `live status shown: "${chip.textContent}"`);
  assert.ok(chip.getAttribute('aria-label'), 'chip is labelled for screen readers');
  assert.ok(!/AIza|apiKey|authDomain/i.test(adminHome.innerHTML), 'no credentials leaked');

  // settings hydration worked
  assert.equal(doc.getElementById('set-challenge').value, '10', 'challenge target hydrated');
  assert.ok([...doc.querySelectorAll('#home-cards input')].every((i) => i.checked), 'home cards default on');
  assert.ok([...doc.querySelectorAll('#home-features input')].some((i) => i.checked), 'features hydrated');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('tapping হোম after আরও folds the admin home back to minimal', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'morehome'
  });
  const doc = out.dom.window.document;
  const win = out.dom.window;

  const moreSec = doc.getElementById('admin-more-sec');
  assert.ok(moreSec, 'the আরও ফিচার collapsible exists');
  assert.equal(moreSec.open, false, 'it stays minimized by default');

  // Open the extra features via the bottom navigation ("আরও").
  doc.querySelector('.bottom-nav button[data-tab="more"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(moreSec.open, true, 'the আরও ফিচার list unfolds');
  assert.equal(doc.getElementById('admin-overview').hidden, false,
    'the overview stays on screen — nothing is swapped away');

  // Tapping "হোম" must fold every section back to the minimal view.
  doc.querySelector('.bottom-nav button[data-tab="home"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(moreSec.open, false, 'the আরও ফিচার list is folded again');
  assert.equal(doc.querySelectorAll('#admin-home details[open]').length, 0,
    'every section is minimized again');

  const fatal = out.errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('tapping হোম after আরও folds the teacher home back to minimal', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'morehome'
  });
  const doc = out.dom.window.document;
  const win = out.dom.window;

  const folds = doc.querySelectorAll('#teacher-home details.mini-details');
  assert.ok(folds.length >= 3, 'the teacher home keeps its sections folded');
  for (const f of folds) assert.equal(f.open, false, 'minimized by default');

  // "আরও" unfolds every section; the overview stays where it is.
  doc.querySelector('.bottom-nav button[data-tab="more"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (const f of doc.querySelectorAll('#teacher-home details.mini-details')) {
    assert.equal(f.open, true, 'every section unfolded');
  }
  assert.ok(doc.getElementById('teaching-hero'), 'the overview stays on screen');

  // Tapping "হোম" folds everything back to minimal.
  doc.querySelector('.bottom-nav button[data-tab="home"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (const f of doc.querySelectorAll('#teacher-home details.mini-details')) {
    assert.equal(f.open, false, 'folded again after হোম');
  }

  const fatal = out.errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('teacher portal boots and shows the student query inbox', async () => {
  const { doc, errors } = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher'
  });
  assert.ok(doc.getElementById('tab-queries'), 'queries panel exists');
  assert.ok(doc.getElementById('teacher-query-list'), 'query list container exists');
  assert.ok(doc.getElementById('teacher-query-list').innerHTML.length > 0, 'query list rendered (empty state or rows)');

  // the app-style teacher home rendered from this teacher's own rows
  const teacherHome = doc.getElementById('teacher-home');
  assert.ok(teacherHome && teacherHome.innerHTML.length > 200, 'teacher home rendered');
  assert.ok(doc.getElementById('teaching-hero'), "Today's Teaching hero present");
  assert.ok(doc.getElementById('teaching-hero'), 'আজকের সামগ্রিক অবস্থা overview present');
  assert.ok(doc.querySelectorAll('#teacher-quick .chip').length >= 6, 'quick shortcuts rendered');
  const tFolds = doc.querySelectorAll('#teacher-home details.mini-details');
  assert.ok(tFolds.length >= 3, 'info sections folded like the admin home');
  for (const f of tFolds) assert.equal(f.open, false, 'folds open minimized');
  assert.equal(doc.getElementById('teacher-see-more'), null, 'no view-swapping See More button');
  const tChip = doc.getElementById('teacher-net-chip');
  assert.ok(tChip, 'teacher connection chip rendered');
  assert.match(tChip.textContent, /অনলাইন|অফলাইন|সিংক/, `live status shown: "${tChip.textContent}"`);
  // রাহেলা আক্তার teaches নবম only — the home must not list other classes
  const homeText = teacherHome.textContent;
  assert.ok(!homeText.includes('দশম'), 'no unassigned class appears on the teacher home');
  // new teaching panels exist and rendered
  for (const id of ['teacher-student-list', 'teacher-submissions', 'teacher-material-list', 'teacher-results', 'teacher-notif-list']) {
    assert.ok(doc.getElementById(id), `#${id} exists`);
  }
  assert.ok(doc.getElementById('teacher-student-list').innerHTML.length > 0, 'student list rendered');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

/**
 * Waits for an asynchronous UI effect instead of sleeping a fixed 50ms. The
 * report preview is built from canvas pages, so its exact latency depends on
 * the machine — a fixed sleep makes the suite flaky without testing anything.
 */
async function waitFor(predicate, { timeout = 4000, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return predicate();
}

/**
 * Captures the files a document download produces. jsdom has no object URLs, so
 * the blob handed to `URL.createObjectURL` and the anchor's download name are
 * recorded instead — that pair is exactly what a browser would write to disk.
 */
function captureDownloads(win) {
  const blobs = [];
  const clicked = [];
  win.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:stub'; };
  win.URL.revokeObjectURL = () => {};
  globalThis.URL = win.URL;
  const originalClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () {
    clicked.push({ name: this.download, blob: blobs[blobs.length - 1] });
  };
  return {
    clicked,
    restore() { win.HTMLAnchorElement.prototype.click = originalClick; },
    async last() {
      const entry = clicked[clicked.length - 1];
      assert.ok(entry, 'a file download was triggered');
      // `text` is UTF-8 decoded (a BOM is stripped by the decoder), `bytes` is
      // what really lands on disk — the BOM has to be checked there.
      return {
        name: entry.name,
        text: await entry.blob.text(),
        bytes: new Uint8Array(await entry.blob.arrayBuffer())
      };
    }
  };
}

/** Points the report class filter at one class ('সব' keeps every class). */
function selectReportClass(doc, className) {
  const sel = doc.getElementById('report-class');
  sel.value = className;
  sel.dispatchEvent(new sel.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

/** Taps one report card and waits for its document preview. */
async function openReport(doc, key) {
  const card = doc.querySelector(`#report-groups [data-report="${key}"]`);
  assert.ok(card, `report card "${key}" exists`);
  card.dispatchEvent(new card.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.ok(await waitFor(() => doc.getElementById('document-preview-modal').classList.contains('active')),
    `report "${key}" opened the preview`);
  return card;
}

/** Closes the shared document preview again. */
async function closePreview(doc) {
  doc.querySelector('#document-preview-modal [data-close]')
    .dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await waitFor(() => !doc.getElementById('document-preview-modal').classList.contains('active'));
}

test('the report centre is three icon-card groups and every card previews a document', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'reports'
  });
  const win = doc.defaultView;

  // Exactly the three groups that were asked for, in order.
  const groups = [...doc.querySelectorAll('#report-groups .report-group')];
  assert.deepEqual(
    groups.map((g) => g.querySelector('.report-group-title strong').textContent),
    ['Finance Reports', 'Student Reports', 'Notice Reports'],
    'three report groups and nothing else'
  );

  // Eight cards — 4 finance + 3 student + 1 notice. No duplicate due/finance
  // variants and no exam, result, assignment, routine or teacher report.
  const cards = [...doc.querySelectorAll('#report-groups .report-card')];
  assert.deepEqual(cards.map((c) => c.dataset.report), [
    'collection', 'due', 'studentFinance', 'paymentHistory',
    'students', 'classwise', 'activeInactive',
    'noticeHistory'
  ], 'the eight simplified reports, grouped');
  assert.equal(groups[0].querySelectorAll('.report-card').length, 4, 'four finance reports');
  assert.equal(groups[1].querySelectorAll('.report-card').length, 3, 'three student reports');
  assert.equal(groups[2].querySelectorAll('.report-card').length, 1, 'one notice report');
  for (const card of cards) {
    assert.ok(card.querySelector('.ico').textContent.trim(), `"${card.dataset.report}" shows an icon`);
    assert.ok(card.querySelector('.rc-label').textContent.trim(), `"${card.dataset.report}" is labelled`);
    assert.ok(card.querySelector('.rc-bn').textContent.trim(), `"${card.dataset.report}" keeps its Bangla name`);
  }

  // The dropdown → Generate → table chrome is gone with the removed reports.
  for (const id of ['report-type', 'report-generate', 'report-csv', 'report-table']) {
    assert.equal(doc.getElementById(id), null, `#${id} no longer exists`);
  }

  // One tap per card: the branded document opens in the shared preview offering
  // a PDF and an Excel download — never an image share for a multi-page report.
  const preview = doc.getElementById('document-preview-modal');
  for (const card of cards) {
    card.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.ok(await waitFor(() => preview.classList.contains('active')),
      `card "${card.dataset.report}" opened the preview`);
    const title = doc.getElementById('document-preview-title').textContent;
    assert.ok(title.startsWith(card.querySelector('.rc-label').textContent),
      `preview is titled for "${card.dataset.report}": "${title}"`);
    assert.ok(doc.querySelectorAll('#document-preview-body .doc-page').length > 0,
      `"${card.dataset.report}" drew at least one A4 page`);
    assert.equal(doc.getElementById('document-preview-download').hidden, false, 'PDF download offered');
    assert.equal(doc.getElementById('document-preview-excel').hidden, false, 'Excel download offered');
    assert.equal(doc.getElementById('document-preview-share').hidden, true, 'a report is not shared as an image');
    assert.ok(await waitFor(() => card.getAttribute('aria-busy') === 'false'),
      `"${card.dataset.report}" is ready to be tapped again`);
    await closePreview(doc);
  }

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors while opening every report: ${fatal.join(' | ')}`);
});

test('the analytics dashboard and its charts are gone from the admin panel', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'noanalytics'
  });

  assert.equal(doc.getElementById('tab-analytics'), null, 'the analytics panel was removed');
  for (const id of ['analytics-cards', 'chart-admissions', 'chart-collection', 'chart-due',
    'chart-passrate', 'class-perf', 'subject-perf']) {
    assert.equal(doc.getElementById(id), null, `#${id} went with it`);
  }
  assert.equal(doc.querySelectorAll('#admin-home .mini-chart').length, 0,
    'no graph is drawn anywhere in the admin panel');
  assert.equal(doc.querySelector('[data-goto="analytics"]'), null,
    'nothing routes to the removed panel');

  // The handful of live figures the owner checks daily stay on the home card.
  assert.ok(doc.getElementById('admin-overview'), 'সামগ্রিক অবস্থা overview is still there');
  assert.ok(doc.querySelectorAll('#admin-overview .analytics-cell').length >= 6,
    'its numbers still render');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('student profile sheet shows ID card, fee ledger and results', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'profile'
  });

  const btn = doc.querySelector('[data-profile-student="2026-09-002"]');
  assert.ok(btn, 'profile button rendered for a student');
  btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

  const body = doc.getElementById('student-detail-body');
  assert.ok(body.innerHTML.length > 200, 'profile sheet rendered');

  // ID card carries the real identity fields
  const card = body.querySelector('[data-idcard]');
  assert.ok(card, 'ID card present');
  assert.ok(card.textContent.includes('2026-09-002'), 'shows the student id');
  assert.ok(card.textContent.includes('সুমাইয়া ইসলাম'), 'shows the student name');
  assert.ok(card.textContent.includes('নবম'), 'shows the class');
  assert.equal(card.textContent.includes('সক্রিয়'), false, 'active/inactive status is not on the ID card');

  // fee ledger: this student has 1200 outstanding in the seed data
  assert.match(body.textContent, /ফি লেজার/);
  assert.ok(body.textContent.includes('১২০০'), 'real due amount shown in Bengali digits');

  // academic section exists even with no results yet
  assert.match(body.textContent, /একাডেমিক অগ্রগতি/);

  assert.ok(doc.getElementById('preview-idcard'), 'ID card preview action available');
  assert.ok(doc.getElementById('preview-ledger'), 'ledger preview action available');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('payment capture: class-wise dues list, student-wise multi-month collection, receipt', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'payment'
  });
  const data = await import('../js/data.js');
  const click = (el) => el.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

  // class chips: সব + every class, each carrying its due-student count
  let chips = [...doc.querySelectorAll('#due-class-chips .due-chip')];
  assert.ok(chips.length >= 2, 'class chips rendered');
  assert.ok(chips[0].textContent.startsWith('সব'), 'সব chip first');
  assert.ok(chips[0].classList.contains('active'), 'সব selected by default');

  // summary strip describes the selected class scope
  assert.match(doc.getElementById('due-summary').textContent, /মোট বকেয়া/, 'due total summarised');
  assert.match(doc.getElementById('due-summary').textContent, /আজকের আদায়/, 'today collection summarised');

  // selecting a class scopes the due list to that class only
  const ninthDues = data.dueFees('নবম');
  click(chips.find((c) => c.textContent.includes('নবম')));
  const dueText = doc.getElementById('due-table').textContent;
  assert.ok(ninthDues.every((d) => dueText.includes(d.student?.name || d.studentId)), 'every নবম due student listed');
  if (ninthDues.length) {
    const ninthIds = new Set(ninthDues.map((d) => d.id));
    const elsewhere = data.dueFees().filter((d) => !ninthIds.has(d.id));
    assert.ok(elsewhere.every((d) => !dueText.includes(d.student?.name || '!!')), 'other classes filtered out');
  } else {
    assert.match(dueText, /বকেয়া নেই/, 'paid-up class shows a clean empty state');
  }

  // back to সব, then student-wise rows (one row per owing student)
  chips = [...doc.querySelectorAll('#due-class-chips .due-chip')];
  click(chips[0]);
  const sid = data.dueFees()[0].studentId;
  const payButtons = [...doc.querySelectorAll('#due-table [data-pay-student]')];
  assert.equal(new Set(payButtons.map((b) => b.dataset.payStudent)).size, payButtons.length,
    'one pay button per student, not one per due month');
  const payBtn = doc.querySelector(`[data-pay-student="${sid}"]`);
  assert.ok(payBtn, 'pay button rendered for that student');
  click(payBtn);

  // modal: student's due months all ticked, amount prefilled with their total
  const months = [...doc.querySelectorAll('#pay-months [data-pay-month]')];
  assert.ok(months.length >= 1, 'due months listed for ticking');
  assert.ok(months.every((m) => m.checked), 'all months ticked by default');
  const totalDue = data.dueFees().filter((d) => d.studentId === sid).reduce((s, d) => s + d.remaining, 0);
  assert.equal(doc.getElementById('pay-amount').value, String(totalDue), 'amount prefilled with the student total due');
  assert.ok(doc.getElementById('pay-student').value.includes(sid), 'student shown');

  // fill the extra details the spec asks for and submit
  doc.getElementById('pay-method').value = 'বিকাশ';
  doc.getElementById('pay-reference').value = 'TRX-9911';
  doc.getElementById('pay-remarks').value = 'অভিভাবকের কাছ থেকে';
  doc.getElementById('payment-form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));

  const savedPayments = data.db.payments.list().filter((p) => p.reference === 'TRX-9911');
  assert.equal(savedPayments.length, months.length, 'one payment row per collected month');
  const saved = savedPayments[savedPayments.length - 1];
  assert.equal(saved.method, 'বিকাশ');
  assert.equal(saved.remarks, 'অভিভাবকের কাছ থেকে');
  assert.equal(savedPayments.reduce((s, p) => s + Number(p.amount || 0), 0), totalDue, 'payments add up to the form amount');
  const receipts = new Set(savedPayments.map((p) => p.receiptNo));
  assert.equal(receipts.size, savedPayments.length, 'every month got its own receipt number');
  savedPayments.forEach((p) => assert.match(p.receiptNo || '', /^\d{11}$/, 'unique YYYYMMDDXXX receipt numbers'));
  months.forEach((box) => assert.equal(data.db.fees.find(box.value).status, 'পরিশোধিত', 'every ticked month settled'));

  // Unique, sequential per-day receipt numbers — even across rapid payments.
  const today = new Date();
  const prefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  assert.equal(saved.receiptNo.slice(0, 8), prefix, 'receipt number carries today YYYYMMDD prefix');
  const n1 = Number(saved.receiptNo.slice(8));
  const n2 = data.nextReceiptNo();
  assert.equal(Number(n2.slice(8)), n1 + 1, 'the next receipt is the next sequential serial');
  assert.notEqual(n2, saved.receiptNo, 'receipt numbers never collide');

  // the success sheet opens first: "পেমেন্ট সফল" + view/WhatsApp/download
  const success = doc.getElementById('payment-success-modal');
  assert.ok(success.classList.contains('active'), 'success sheet opens after saving');
  assert.match(success.textContent, /পেমেন্ট সফল/, 'announces the payment succeeded');
  assert.ok(doc.getElementById('pay-success-view'), 'view-receipt action available');
  assert.ok(doc.getElementById('pay-success-whatsapp'), 'WhatsApp image share action available');
  assert.ok(doc.getElementById('pay-success-download'), 'download action available');

  // viewing the receipt opens the shared document preview (preview-first), not
  // a printable sheet — with the real receipt values drawn onto a canvas page.
  doc.getElementById('pay-success-view')
    .dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(doc.getElementById('document-preview-modal').classList.contains('active'),
    'receipt opens in the shared document preview');
  assert.equal(doc.getElementById('document-preview-title').textContent, 'পেমেন্ট রিসিট',
    'preview title is the payment receipt');
  assert.equal(doc.getElementById('receipt-print'), null, 'no direct print button remains');
  assert.ok(doc.getElementById('document-preview-download'), 'Download PDF action available');
  assert.ok(doc.getElementById('document-preview-share'), 'Share Image action available');

  // a receipt button now exists in the recent payments list
  assert.ok(doc.querySelector('[data-receipt]'), 'receipt reachable from the payment list');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('notification bells count unread items and clear on open', async () => {
  // teacher: the seed carries an unread teacher-directed notification
  let out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'bell-t'
  });
  let doc = out.dom.window.document;
  let badge = doc.getElementById('teacher-bell-count');
  assert.ok(badge, 'teacher bell has a badge');
  assert.equal(badge.hidden, false, 'badge visible while something is unread');
  const before = badge.textContent;
  assert.notEqual(before, '০', 'badge shows a real unread count');

  // opening the bell marks teacher notifications read and clears the badge
  doc.getElementById('teacher-bell').dispatchEvent(new out.dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(badge.hidden, true, 'badge clears after the notifications are read');
  assert.equal(badge.textContent, '০');

  // admin: no activity yet, so the badge starts hidden
  out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'bell-a'
  });
  doc = out.dom.window.document;
  const adminBadge = doc.getElementById('admin-bell-count');
  assert.ok(adminBadge, 'admin bell has a badge');
  assert.equal(adminBadge.hidden, true, 'no unread alerts on a fresh install');

  // once an action is logged, the bell reports it
  // Same module instance the page uses — a query string would fork the store.
  const { logActivity, db } = await import('../js/data.js');
  logActivity({ user: 'অ্যাডমিন', role: 'admin', action: 'added student', target: 'পরীক্ষা' });
  // switching tabs re-reads the alert count
  doc.querySelector('[data-tab="students"]').dispatchEvent(new out.dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(adminBadge.hidden, false, 'bell reports the new activity');
  assert.notEqual(adminBadge.textContent, '০', 'count is not zero');

  // clicking the bell marks everything seen
  doc.getElementById('admin-bell').dispatchEvent(new out.dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(adminBadge.hidden, true, 'badge clears once the admin has looked');
  assert.ok(db.activityLogs.list().length >= 1, 'the action was really logged');
});

test('attendance is saved and limited to the teacher own classes', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'att'
  });
  const doc = out.dom.window.document;
  const picker = doc.getElementById('attendance-picker');
  assert.ok(picker, 'the attendance picker rendered');

  const { db, teacherStudents, activityLogs } = await import('../js/data.js');
  const own = teacherStudents('রাহেলা আক্তার');
  assert.ok(own.length > 0, 'the teacher has students of her own');

  // only her own students are listed — never the whole institute
  const ids = [...picker.querySelectorAll('button[data-student]')].map((b) => b.dataset.student);
  assert.deepEqual(ids.sort(), own.map((s) => s.id).sort(),
    'the picker lists exactly the assigned students');
  const other = db.students.list().find((s) => !own.some((o) => o.id === s.id));
  assert.ok(other, 'there is a student outside her classes in the seed');
  assert.equal(ids.includes(other.id), false, 'that student is not offered');

  // marking absent really writes to the store
  const target = ids[0];
  const before = db.attendance.list().filter((a) => a.studentId === target).length;
  picker.querySelector(`button[data-student="${target}"]`)
    .dispatchEvent(new out.dom.window.MouseEvent('click', { bubbles: true }));

  const saved = db.attendance.list().find((a) => a.studentId === target);
  assert.ok(saved, 'an attendance row was created');
  assert.equal(saved.status, 'অনুপস্থিত', 'the first tap records absent');
  assert.ok(activityLogs().some((l) => l.action === 'marked absent'),
    'the action was logged');

  // and the new state survives a re-render
  assert.equal(picker.querySelector(`button[data-student="${target}"]`).getAttribute('aria-pressed'),
    'false', 'the button reflects the stored state');
  assert.ok(before >= 0);
});

test('teacher writes are refused without the matching permission', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'perm'
  });
  const doc = out.dom.window.document;
  const { db, newId, todayBn } = await import('../js/data.js');

  // Batch creation is an admin-only right (manageBatches); teachers lack it.
  const batchesBefore = db.batches.list().length;
  const batchForm = doc.getElementById('batch-form');
  batchForm.querySelector('[name="name"]').value = 'অনুমতি-পরীক্ষা ব্যাচ';
  batchForm.dispatchEvent(new out.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(db.batches.list().length, batchesBefore, 'no batch was created');
  assert.match(doc.getElementById('toast-container').textContent, /অনুমতি নেই/,
    'the teacher is told why, in Bengali');

  // Notices ARE in the teacher default set, so that write goes through.
  const noticesBefore = db.notices.list().length;
  const noticeForm = doc.getElementById('teacher-notice-form');
  noticeForm.querySelector('[name="title"]').value = 'পরীক্ষার সিলেবাস';
  const classSelect = noticeForm.querySelector('[name="className"]');
  assert.ok(classSelect.options.length, 'the picker offers the teacher own classes');
  assert.equal([...classSelect.options].some((o) => o.value === 'সব'), false,
    'the unusable "all classes" option is gone');
  classSelect.value = 'নবম';
  noticeForm.dispatchEvent(new out.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(db.notices.list().length, noticesBefore + 1, 'the notice was published');

  // Replying to a query from another class's student is refused.
  const other = db.students.list().find((s) => s.className !== 'নবম');
  assert.ok(other, 'the seed has a student outside the teacher classes');
  const qid = newId('ntf');
  db.notifications.add({
    id: qid, type: 'শিক্ষক প্রশ্ন', title: 'অন্য ক্লাসের প্রশ্ন', target: 'শিক্ষক',
    studentId: other.id, studentName: other.name, date: todayBn(),
    createdAt: new Date().toISOString(), read: false
  });
  // the inbox must not even list it
  assert.equal(doc.querySelector(`[data-reply-form="${qid}"]`), null,
    'a query from another class is not shown in the inbox');

  // and forcing the write through the handler is still blocked
  const host = doc.getElementById('teacher-query-list');
  host.insertAdjacentHTML('beforeend',
    `<form data-reply-form="${qid}"><input name="reply" value="জবাব"><button type="submit">পাঠান</button></form>`);
  host.querySelector(`[data-reply-form="${qid}"]`)
    .dispatchEvent(new out.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(db.notifications.find(qid).reply, undefined, 'the reply was not stored');
});

test('offline writes are refused once a remote is configured (spec 51)', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'offline'
  });
  const doc = out.dom.window.document;
  const { db, _setRemoteTransport } = await import('../js/data.js');

  // With no remote configured the local store IS the database, so writes go
  // through even offline — that is a real save, not a faked one.
  Object.defineProperty(out.dom.window.navigator, 'onLine', { value: false, configurable: true });
  const noticesBefore = db.notices.list().length;
  const form = doc.getElementById('notice-form');
  form.querySelector('[name="title"]').value = 'অফলাইন নোটিশ';
  form.dispatchEvent(new out.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(db.notices.list().length, noticesBefore + 1,
    'local mode still saves offline');

  // Now pretend a real backend is configured: an offline write would be lost,
  // so the panel must refuse it and say so.
  _setRemoteTransport(() => {});
  const before = db.notices.list().length;
  form.querySelector('[name="title"]').value = 'হারিয়ে যাওয়া নোটিশ';
  form.dispatchEvent(new out.dom.window.Event('submit', { bubbles: true, cancelable: true }));

  assert.equal(db.notices.list().length, before, 'nothing was written');
  assert.match(doc.getElementById('toast-container').textContent, /অফলাইনে/,
    'the user is told why, in Bengali');
  assert.equal(db.notices.list().some((x) => x.title === 'হারিয়ে যাওয়া নোটিশ'), false,
    'the record was not faked into existence');
});

test('saving the permission matrix really changes what a teacher may do', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'perms'
  });
  const doc = out.dom.window.document;
  const { db, can } = await import('../js/data.js');

  assert.equal(can('teacher', 'manageQuestions'), true, 'teachers start with question rights');

  const box = doc.querySelector('#perm-matrix input[data-role="teacher"][data-perm="manageQuestions"]');
  assert.ok(box, 'the matrix renders a checkbox per role and permission');
  box.checked = false;
  doc.getElementById('perm-save')
    .dispatchEvent(new out.dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(db.settings.get().permissions.teacher.includes('manageQuestions'), false,
    'the change was persisted');
  assert.equal(can('teacher', 'manageQuestions'), false,
    'the data layer now refuses it — not just the UI');
  assert.equal(can('teacher', 'manageMaterials'), true, 'other rights are untouched');
});

test('the report centre exports documents and never opens the browser print dialog', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'reportpdf'
  });

  // Print is gone from the whole admin report flow: no button, no window.print.
  assert.equal(doc.getElementById('report-print'), null, 'the Print button is removed');
  for (const file of ['admin.html', 'js/admin-modules.js', 'js/preview.js']) {
    assert.equal(/window\s*\.\s*print/.test(read(file)), false, `${file} never calls window.print`);
  }

  // The old direct-download buttons went too — every document is reviewed first.
  for (const id of ['report-pdf', 'report-class-pdf', 'report-all-pdf']) {
    assert.equal(doc.getElementById(id), null, `#${id} is removed`);
  }

  // The class dropdown offers the real class list and drives every card.
  const classSel = doc.getElementById('report-class');
  assert.ok(classSel, 'class dropdown exists');
  const labels = [...classSel.options].map((o) => o.textContent);
  const { CLASS_OPTIONS } = await import('../js/data.js');
  assert.ok(labels.includes('সব ক্লাস'), 'class dropdown offers the all-classes option');
  for (const c of CLASS_OPTIONS) assert.ok(labels.includes(c), `class dropdown offers ${c}`);

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('the class filter narrows a report down to that class', async () => {
  const { dom, doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'clsfilter'
  });
  const win = dom.window;
  const files = captureDownloads(win);

  /** Opens one report for one class and returns the Excel file it produced. */
  const excelFor = async (report, className) => {
    selectReportClass(doc, className);
    await openReport(doc, report);
    files.clicked.length = 0;
    doc.getElementById('document-preview-excel')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const file = await files.last();
    await closePreview(doc);
    return {
      name: file.name,
      rows: file.text.split('\n').slice(1).filter(Boolean)
    };
  };

  try {
    // One class: only its own students reach the document.
    const ninth = await excelFor('students', 'নবম');
    assert.equal(ninth.name, 'student-list-report-Class-9.csv', 'named after the report and the class');
    assert.equal(ninth.rows.length, 2, 'only the two নবম students are exported');
    assert.ok(ninth.rows.every((r) => r.includes('নবম')), 'every exported row belongs to নবম');
    assert.ok(!ninth.rows.some((r) => r.includes('নাফিস ইকবাল')), 'a দশম student is excluded');

    // Every class: all four seeded students are in the file.
    const all = await excelFor('students', 'সব');
    assert.equal(all.name, 'student-list-report-All-Classes.csv', 'the all-class file says so');
    assert.equal(all.rows.length, 4, 'all four seeded students are exported');

    // The same filter reaches the finance reports.
    const dues = await excelFor('due', 'নবম');
    assert.ok(dues.rows.length > 0, 'নবম has an outstanding fee in the seed data');
    assert.ok(dues.rows.every((r) => r.includes('নবম')), 'only নবম dues are exported');

    // A class-wise list of one class is that single row, never the whole school.
    const classwise = await excelFor('classwise', 'নবম');
    assert.equal(classwise.rows.length, 1, 'one class, one row');
    assert.ok(classwise.rows[0].includes('নবম'), 'the row is the selected class');
  } finally {
    files.restore();
  }

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('student save requires a name and assigns a unique auto ID', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'studentval'
  });
  const win = doc.defaultView;
  const data = await import('../js/data.js');

  doc.getElementById('open-student-modal')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const form = doc.getElementById('student-form');
  assert.ok(form.elements.name.hasAttribute('required'), 'name field marked required');

  // Empty name is blocked with the exact Bangla message and nothing is written.
  const before = data.db.students.list().length;
  form.elements.name.value = '';
  form.elements.className.value = 'নবম';
  form.elements.roll.value = '1';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.students.list().length, before, 'no student saved without a name');
  assert.match(doc.getElementById('toast-container').textContent,
    /শিক্ষার্থীর নাম আবশ্যক/, 'the Bangla name-required error is shown');

  // A valid save persists the student with a generated, unique ID.
  form.elements.name.value = 'পরীক্ষা শিক্ষার্থী';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.students.list().length, before + 1, 'the student was saved');
  const saved = data.db.students.list().find((s) => s.name === 'পরীক্ষা শিক্ষার্থী');
  assert.ok(saved.id, 'an auto ID was assigned');
  assert.equal(data.db.students.list().filter((s) => s.id === saved.id).length, 1,
    'the assigned ID is unique');

  // Editing keeps the same ID — never re-validates it as a duplicate.
  const editBtn = doc.querySelector(`[data-edit-student="${saved.id}"]`);
  assert.ok(editBtn, 'the new student can be edited');
  editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(doc.getElementById('student-edit-id').value, saved.id, 'edit mode holds the ID');
  form.elements.name.value = 'পরীক্ষা শিক্ষার্থী (আপডেট)';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.students.find(saved.id).name, 'পরীক্ষা শিক্ষার্থী (আপডেট)',
    'editing updates in place without a duplicate complaint');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('a report downloads as Excel and as a PDF straight from its preview', async () => {
  const { dom, doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'csv'
  });
  const win = dom.window;
  const files = captureDownloads(win);

  try {
    await openReport(doc, 'collection');

    // Excel: a UTF-8 CSV with a BOM, so Excel opens the Bengali columns cleanly.
    doc.getElementById('document-preview-excel')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const excel = await files.last();
    assert.equal(excel.name, 'collection-report-All-Classes.csv',
      'named after the report and the class filter');
    assert.deepEqual([...excel.bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF],
      'the CSV carries a UTF-8 BOM so Excel reads the Bengali columns');
    const [header, ...rows] = excel.text.split('\n');
    assert.deepEqual(header.split(','), ['"মাস"', '"লেনদেন"', '"শিক্ষার্থী"', '"আদায়"'],
      'the Excel columns are the Collection columns');
    assert.ok(rows.length > 0 && rows[0].includes('৳'), 'the seeded collection is in the sheet');

    // PDF: the same document, branded, built without touching the print dialog.
    files.clicked.length = 0;
    doc.getElementById('document-preview-download')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.ok(await waitFor(() => files.clicked.length > 0), 'a PDF download was triggered');
    const pdf = await files.last();
    assert.equal(pdf.name, 'collection-report-All-Classes.pdf', 'the PDF is named the same way');
    assert.ok(pdf.text.startsWith('%PDF-'), 'a real PDF was downloaded');
    assert.match(doc.getElementById('toast-container').textContent, /ডাউনলোড/,
      'the admin is told the file landed');
  } finally {
    files.restore();
  }

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('the submissions review table paginates instead of painting every row', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'paginate'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  // Grow the collection well past one page.
  const asg = data.db.assignments.list()[0];
  const students = data.db.students.list();
  for (let i = 0; i < 30; i++) {
    const st = students[i % students.length];
    data.db.submissions.add({
      id: `sub-page-${i}`, assignmentId: asg.id, studentId: st.id,
      studentName: `${st.name} ${i}`, status: 'জমা হয়েছে', date: '০১/০৯', feedback: ''
    });
  }
  const total = data.db.submissions.list().length;
  assert.ok(total > 25, `collection is bigger than one page (has ${total})`);

  // Navigation is the app-style grid now: unfold the আরও ফিচার section, then
  // open the Submissions tile (the same panel the old top bar used to switch to).
  doc.getElementById('admin-more-sec').open = true;
  doc.querySelector('#admin-more-grid [data-goto="submissions"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  // Checking one submission re-renders the table; that render must paginate.
  win.prompt = () => 'চমৎকার কাজ';
  const checkBtn = doc.querySelector('#submissions-table [data-check]');
  assert.ok(checkBtn, 'a submission can be checked');
  checkBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const table = doc.getElementById('submissions-table');
  const firstPage = table.querySelectorAll('tbody tr').length;
  assert.ok(firstPage <= 26, `only one page painted at a time, got ${firstPage} rows`);
  assert.ok(firstPage < total, `not every row was painted (${firstPage} of ${total})`);

  const more = table.querySelector('[data-load-more]');
  assert.ok(more, 'a load-more control is offered');
  assert.match(more.textContent, /বাকি/, 'says how many remain');

  more.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(table.querySelectorAll('tbody tr').length > firstPage, 'load-more reveals the next page');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('the question bank import flow validates, previews and really imports', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'qbimport'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  doc.querySelector('[data-tab="questions"]')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const examSel = doc.getElementById('tqb-exam');
  assert.ok(examSel, 'exam picker rendered');
  assert.equal(examSel.value, 'exam-1', 'the teacher own exam is selected by default');

  const before = data.db.exams.find('exam-1').questions.length;

  // Two valid blocks, one duplicate of the first, one incomplete block.
  doc.getElementById('tqb-paste').value = [
    'প্রশ্ন: ৫+৩=?', 'A. ৬', 'B. ৭', 'C. ৮', 'D. ৯', 'সঠিক: C',
    '',
    'প্রশ্ন: ২*৪=?', 'A. ৬', 'B. ৭', 'C. ৮', 'D. ৯', 'সঠিক: C',
    '',
    'প্রশ্ন: ৫+৩=?', 'A. ৬', 'B. ৭', 'C. ৮', 'D. ৯', 'সঠিক: C',
    '',
    'প্রশ্ন: অসম্পূর্ণ ব্লক'
  ].join('\n');

  doc.getElementById('tqb-parse').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const report = doc.getElementById('tqb-report');
  assert.match(report.textContent, /ডুপ্লিকেট/, 'duplicate rows are reported before import');
  assert.match(report.textContent, /অসম্পূর্ণ/, 'incomplete blocks are reported before import');

  const preview = doc.getElementById('tqb-preview');
  assert.match(preview.textContent, /২টি প্রশ্ন/, 'only the two valid, unique questions are staged');
  assert.ok(preview.textContent.includes('৫+৩=?'), 'the question text is shown for review');

  // Nothing has been written yet — parsing alone must not touch the exam.
  assert.equal(data.db.exams.find('exam-1').questions.length, before,
    'parsing stages questions without writing them');

  doc.getElementById('tqb-import').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(data.db.exams.find('exam-1').questions.length, before + 2,
    'confirming the import writes the two questions');

  // Re-importing the same text must not duplicate what is already there.
  doc.getElementById('tqb-paste').value = [
    'প্রশ্ন: ৫+৩=?', 'A. ৬', 'B. ৭', 'C. ৮', 'D. ৯', 'সঠিক: C'
  ].join('\n');
  doc.getElementById('tqb-parse').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  doc.getElementById('tqb-import').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(data.db.exams.find('exam-1').questions.length, before + 2,
    'a question already on the exam is not added twice');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('a teacher cannot author exams or suggestions for a class they do not teach', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'scope'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  // রাহেলা আক্তার teaches নবম only.
  assert.deepEqual(data.teacherProfile('রাহেলা আক্তার').classNames, ['নবম']);

  // The pickers must not even offer a class this teacher does not own.
  const examOpts = [...doc.getElementById('exam-class').options].map((o) => o.value || o.textContent);
  assert.ok(!examOpts.includes('দশম'), `exam class picker offers only assigned classes, got ${examOpts}`);
  const sugOpts = [...doc.getElementById('sug-class').options].map((o) => o.value || o.textContent);
  assert.ok(!sugOpts.includes('দশম'), `suggestion class picker offers only assigned classes, got ${sugOpts}`);

  const pastePaper = (text = '১. ১+১=?\nA) ১\nB) ২\nC) ৩\nD) ৪\nউত্তর: B') => {
    doc.getElementById('exam-paste').value = text;
    doc.getElementById('exam-parse').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };

  // Defence in depth: a hand-edited select must still be refused by the handler.
  const examsBefore = data.db.exams.list().length;
  const examSel = doc.getElementById('exam-class');
  examSel.innerHTML = '<option value="দশম">দশম</option>';
  examSel.value = 'দশম';
  doc.getElementById('exam-title').value = 'অনুমোদিত নয় পরীক্ষা';
  pastePaper();
  assert.match(doc.getElementById('exam-question-count').textContent, /১টি প্রশ্ন/, 'the pasted question is staged');
  doc.getElementById('exam-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.exams.list().length, examsBefore,
    'no exam is written for a class outside the teacher assignment');

  const sugBefore = data.db.suggestions.list().length;
  const sugSel = doc.getElementById('sug-class');
  sugSel.innerHTML = '<option value="দশম">দশম</option>';
  sugSel.value = 'দশম';
  doc.getElementById('sug-title').value = 'অনুমোদিত নয় সাজেশন';
  doc.getElementById('sug-content').value = 'বিষয়বস্তু';
  doc.getElementById('suggestion-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.suggestions.list().length, sugBefore,
    'no suggestion is written for a class outside the teacher assignment');

  // The teacher own class still works, so the guard is not a blanket block.
  examSel.innerHTML = '<option value="নবম">নবম</option>';
  examSel.value = 'নবম';
  doc.getElementById('exam-title').value = 'অনুমোদিত পরীক্ষা';
  pastePaper('১. ২+২=?\nA) ৩\nB) ৪\nC) ৫\nD) ৬\nউত্তর: B');
  doc.getElementById('exam-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.exams.list().length, examsBefore + 1, 'an exam for their own class is still created');
  assert.equal(data.db.exams.list().at(-1).className, 'নবম');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('teacher assignment and material publishing write, notify and stay scoped', async () => {
  const out = await bootPage('teacher.html', {
    username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: 'writflows'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  /* ---------------- assignments (tab-tasks) ---------------- */
  doc.querySelector('[data-tab="tasks"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const asgBefore = data.db.assignments.list().length;
  const ntfBefore = data.db.notifications.list().length;
  const form = doc.getElementById('teacher-assignment-form');
  form.querySelector('[name="title"]').value = 'অধ্যায় ৩ অনুশীলন';
  form.querySelector('[name="className"]').value = 'নবম';
  form.querySelector('[name="description"]').value = 'পাঠ্যবইয়ের অনুশীলন ৩.১–৩.৪';
  form.querySelector('[name="marks"]').value = '20';   // type="number" yields ASCII
  form.querySelector('[name="dueDate"]').value = '২০২৬-০৯-২০';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  const created = data.db.assignments.list().filter((a) => a.title === 'অধ্যায় ৩ অনুশীলন');
  assert.equal(created.length, 1, 'the assignment was written');
  assert.equal(created[0].className, 'নবম');
  assert.equal(created[0].marks, 20, 'marks parsed to a number, not left as text');
  assert.equal(created[0].teacher, 'রাহেলা আক্তার', 'author recorded from the session');

  // The deadline must land under the key every consumer reads, so the student
  // sees a date and overdue detection works.
  assert.equal(created[0].deadline, '২০২৬-০৯-২০', 'deadline written under the key consumers read');
  const learner = data.db.students.list().find((s) => s.className === 'নবম');
  const status = data.assignmentStatus(created[0], learner);
  assert.ok(status.daysLeft !== null, 'the deadline parses, so days-remaining is computed');

  // spec 57: the class is told, not left to notice on their own
  assert.equal(data.db.notifications.list().length, ntfBefore + 1, 'a student notification was posted');
  const note = data.db.notifications.list().at(-1);
  assert.equal(note.target, 'শিক্ষার্থী');
  assert.equal(note.className, 'নবম', 'the notice is scoped to the assigned class');

  // a hand-edited class outside the assignment must be refused
  const asgSel = form.querySelector('[name="className"]');
  asgSel.innerHTML = '<option value="দশম">দশম</option>';
  asgSel.value = 'দশম';
  form.querySelector('[name="title"]').value = 'অনুমোদিত নয় কাজ';
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.assignments.list().length, asgBefore + 1,
    'no assignment is written for a class outside the assignment');

  /* ---------------- materials (tab-materials) ---------------- */
  doc.querySelector('[data-tab="materials"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  const matBefore = data.db.materials.list().length;
  const mform = doc.getElementById('teacher-material-form');
  mform.querySelector('[name="title"]').value = 'গতি অধ্যায়ের নোট';
  mform.querySelector('[name="className"]').value = 'নবম';
  mform.querySelector('[name="subject"]').value = 'পদার্থবিজ্ঞান';
  mform.querySelector('[name="chapter"]').value = 'গতি';
  mform.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  const mats = data.db.materials.list().filter((m) => m.title === 'গতি অধ্যায়ের নোট');
  assert.equal(mats.length, 1, 'the material was published');
  assert.equal(mats[0].className, 'নবম');
  assert.equal(mats[0].teacher, 'রাহেলা আক্তার');

  const matSel = mform.querySelector('[name="className"]');
  matSel.innerHTML = '<option value="দশম">দশম</option>';
  matSel.value = 'দশম';
  mform.querySelector('[name="title"]').value = 'অনুমোদিত নয় নোট';
  mform.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.materials.list().length, matBefore + 1,
    'no material is published to a class outside the assignment');

  // The published material must reach students of that class. This mirrors the
  // filter the student home itself uses (js/student-home.js:401).
  const visibleTo = (className) => data.db.materials.list()
    .filter((m) => !m.className || m.className === className);
  assert.ok(visibleTo('নবম').some((m) => m.title === 'গতি অধ্যায়ের নোট'),
    'a নবম student can see the material their teacher published');
  assert.ok(!visibleTo('দশম').some((m) => m.title === 'গতি অধ্যায়ের নোট'),
    'a দশম student cannot see material scoped to another class');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('the admin sees which questions each student missed', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'examresults'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  const exam = data.db.exams.list()[0];
  const student = data.db.students.list().find((s) => s.className === exam.className);
  // Two right, one deliberately wrong, one left blank.
  data.db.examResults.add({
    id: 'res-test', examId: exam.id, studentId: student.id, studentName: student.name,
    score: 2, total: 4, date: data.todayBn(), autoSubmitted: false,
    answers: [exam.questions[0].answer, exam.questions[1].answer, (exam.questions[2].answer + 1) % 4, null]
  });
  data.db.exams.update(exam.id, { questions: [...exam.questions,
    { q: 'চতুর্থ প্রশ্ন?', options: ['১', '২', '৩', '৪'], answer: 0 }
  ] });

  doc.querySelector(`[data-results="${exam.id}"]`)?.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const list = doc.getElementById('exam-results');
  assert.match(list.textContent, new RegExp(student.name), 'the student is listed');
  assert.match(list.textContent, /ভুল হয়েছে: ৩, ৪/, `the missed question numbers are shown, got: ${list.textContent.slice(0, 200)}`);
  assert.match(list.textContent, /[০-৯]{1,2} [\u0980-\u09FF]+ [০-৯]{4}/, 'with the Bengali long date');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('the admin builds an exam by pasting a paper into the template', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'adminexam'
  });
  const { doc, errors } = out;
  const win = out.dom.window;
  const data = await import('../js/data.js');

  doc.getElementById('open-exam-modal').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  // The template is on screen and can be dropped into the paste box in one tap.
  const shown = doc.getElementById('exam-template-view');
  assert.match(shown.textContent, /উত্তর: A/, 'the paste template is shown');
  doc.getElementById('exam-template').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.match(doc.getElementById('exam-paste').value, /বাংলাদেশের রাজধানী/, 'the template fills the paste box');

  const before = data.db.exams.list().length;
  doc.getElementById('exam-paste').value = [
    '১. ৭+৫=?', 'A) ১০', 'B) ১১', 'C) ১২', 'D) ১৩', 'উত্তর: C',
    '', '২. ৯×২=?', 'A) ১৬', 'B) ১৮', 'C) ২০', 'D) ২২', 'উত্তর: B'
  ].join('\n');
  doc.getElementById('exam-parse').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.equal(data.db.exams.list().length, before, 'parsing alone writes nothing');
  assert.match(doc.getElementById('exam-question-count').textContent, /২টি প্রশ্ন/, 'both questions staged');
  assert.match(doc.getElementById('exam-staged').textContent, /৭\+৫=\?/, 'the staged paper is previewed');

  doc.getElementById('exam-title').value = 'পেস্ট করা পরীক্ষা';
  doc.getElementById('exam-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  const created = data.db.exams.list().at(-1);
  assert.equal(data.db.exams.list().length, before + 1, 'the paper is published');
  assert.equal(created.questions.length, 2, 'both pasted questions are stored');
  assert.equal(created.questions[0].answer, 2, 'the উত্তর marker became the right option');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});
