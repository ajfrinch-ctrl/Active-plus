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
  assert.ok(doc.getElementById('institute-overview'), 'Institute Overview hero present');
  assert.ok(doc.querySelectorAll('#admin-features .tile').length >= 8, 'feature grid rendered');
  assert.ok(doc.querySelectorAll('#admin-quick .chip').length >= 6, 'quick actions rendered');
  assert.ok(doc.getElementById('admin-see-more'), 'See More control present');
  // hero numbers are the real seeded counts (4 students, 4 teachers, 3 batches)
  const overview = doc.getElementById('institute-overview').textContent;
  assert.ok(overview.includes('৪'), 'real counts shown in Bengali digits');
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
  assert.ok(doc.querySelectorAll('#teacher-features .tile').length >= 8, 'feature grid rendered');
  assert.ok(doc.querySelectorAll('#teacher-quick .chip').length >= 6, 'quick actions rendered');
  assert.ok(doc.getElementById('teacher-see-more'), 'See More control present');
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

test('every report in the report centre renders without error', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'reports'
  });
  const sel = doc.getElementById('report-type');
  assert.ok(sel, 'report selector exists');
  const options = [...sel.options];
  assert.ok(options.length >= 15, `spec 45 asks for 15+ reports, found ${options.length}`);

  const table = doc.getElementById('report-table');
  for (const opt of options) {
    sel.value = opt.value;
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    // a report either renders rows or shows an honest empty state — never blanks out
    const body = table.querySelector('tbody');
    const rendered = body.children.length > 0 || /নেই|কোনো/.test(table.textContent);
    assert.ok(rendered, `report "${opt.textContent}" (${opt.value}) rendered rows or an empty state`);
    assert.ok(table.querySelector('thead th'), `report "${opt.value}" has column headers`);
  }

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors while cycling reports: ${fatal.join(' | ')}`);
});

test('analytics dashboard renders real charts with accessible labels', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'analytics'
  });

  // admission + collection trends have seeded data, so bars must render
  for (const id of ['chart-admissions', 'chart-collection', 'chart-due']) {
    const host = doc.getElementById(id);
    assert.ok(host, `#${id} exists`);
    assert.ok(host.querySelectorAll('.mini-chart .bar').length > 0, `#${id} rendered bars`);
    const chart = host.querySelector('.mini-chart');
    assert.ok(chart.getAttribute('role') === 'img', `#${id} chart exposes role=img`);
    assert.ok(chart.getAttribute('aria-label'), `#${id} chart is labelled`);
    assert.ok(host.querySelector('.chart-legend'), `#${id} has a text legend`);
  }

  // no results seeded by default -> honest empty states, not blank panels
  for (const id of ['chart-passrate', 'subject-perf']) {
    const host = doc.getElementById(id);
    assert.ok(host, `#${id} exists`);
    assert.ok(host.textContent.trim().length > 0, `#${id} shows an empty state rather than nothing`);
    assert.match(host.textContent, /নেই/, `#${id} says there is no data yet`);
  }

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

  // fee ledger: this student has 1200 outstanding in the seed data
  assert.match(body.textContent, /ফি লেজার/);
  assert.ok(body.textContent.includes('১২০০'), 'real due amount shown in Bengali digits');

  // academic section exists even with no results yet
  assert.match(body.textContent, /একাডেমিক অগ্রগতি/);

  assert.ok(doc.getElementById('print-idcard'), 'ID card print action available');
  assert.ok(doc.getElementById('print-ledger'), 'ledger print action available');

  const fatal = errors.filter((e) => !/Service worker|Firebase|firebase/i.test(e));
  assert.deepEqual(fatal, [], `no console errors: ${fatal.join(' | ')}`);
});

test('payment capture records method/reference and prints a receipt', async () => {
  const { doc, errors } = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'payment'
  });
  const data = await import('../js/data.js');

  // open the payment modal for a real outstanding fee
  const fee = data.dueFees()[0];
  assert.ok(fee, 'there is an outstanding fee to collect');
  const payBtn = doc.querySelector(`[data-pay="${fee.id}"]`);
  assert.ok(payBtn, 'pay button rendered for that fee');
  payBtn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

  assert.equal(doc.getElementById('pay-fee-id').value, fee.id, 'modal holds the fee');
  assert.equal(doc.getElementById('pay-amount').value, String(fee.amount), 'amount prefilled');
  assert.ok(doc.getElementById('pay-student').value.includes(fee.studentId), 'student shown');

  // fill the extra details the spec asks for and submit
  doc.getElementById('pay-method').value = 'বিকাশ';
  doc.getElementById('pay-reference').value = 'TRX-9911';
  doc.getElementById('pay-remarks').value = 'অভিভাবকের কাছ থেকে';
  doc.getElementById('payment-form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));

  const saved = data.db.payments.list().find((p) => p.reference === 'TRX-9911');
  assert.ok(saved, 'payment persisted with its reference');
  assert.equal(saved.method, 'বিকাশ');
  assert.equal(saved.remarks, 'অভিভাবকের কাছ থেকে');
  assert.match(saved.receiptNo || '', /^RCP-\d+$/, 'a receipt number was generated');
  assert.equal(data.db.fees.find(fee.id).status, 'পরিশোধিত', 'the fee is settled');

  // the receipt sheet opened with the real values
  const receipt = doc.querySelector('#receipt-body [data-receipt-sheet]');
  assert.ok(receipt, 'receipt sheet rendered');
  assert.ok(receipt.textContent.includes('TRX-9911'), 'shows the reference');
  assert.ok(receipt.textContent.includes('বিকাশ'), 'shows the method');
  assert.ok(receipt.textContent.includes(saved.receiptNo), 'shows the receipt number');
  assert.ok(doc.getElementById('receipt-print'), 'print action available');

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

test('the report centre exports the selected report as CSV', async () => {
  const out = await bootPage('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'csv'
  });
  const doc = out.dom.window.document;

  // jsdom has no object URLs; capture the anchor the downloader clicks.
  const win = out.dom.window;
  win.URL.createObjectURL = () => 'blob:stub';
  win.URL.revokeObjectURL = () => {};
  globalThis.URL = win.URL;
  const clicked = [];
  const originalClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () { clicked.push({ name: this.download, href: this.href }); };

  try {
    const sel = doc.getElementById('report-type');
    sel.value = 'students';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('report-csv')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    assert.equal(clicked.length, 1, 'a file download was triggered');
    assert.equal(clicked[0].name, 'students-report.csv', 'named after the selected report');

    clicked.length = 0;
    sel.value = 'due';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('report-csv')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.equal(clicked[0].name, 'due-report.csv', 'switching reports changes the export');
  } finally {
    win.HTMLAnchorElement.prototype.click = originalClick;
  }
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

  doc.querySelector('[data-tab="submissions"]')
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

  // Defence in depth: a hand-edited select must still be refused by the handler.
  const examsBefore = data.db.exams.list().length;
  const examSel = doc.getElementById('exam-class');
  examSel.innerHTML = '<option value="দশম">দশম</option>';
  examSel.value = 'দশম';
  doc.getElementById('exam-title').value = 'অনুমোদিত নয় পরীক্ষা';
  doc.getElementById('q-text').value = '১+১=?';
  ['২', '৩', '৪', '৫'].forEach((v, i) => { doc.getElementById(`q-opt${i}`).value = v; });
  doc.getElementById('add-question').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
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
  doc.getElementById('q-text').value = '২+২=?';
  ['৩', '৪', '৫', '৬'].forEach((v, i) => { doc.getElementById(`q-opt${i}`).value = v; });
  doc.getElementById('add-question').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
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
