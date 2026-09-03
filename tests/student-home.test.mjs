/** Renders the real student home (js/student-home.js) in jsdom and exercises its interactions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// Sign in through the real auth module instead of faking a session object.

async function bootHome() {
  const dom = new JSDOM(read('student.html'), { url: 'http://localhost:8080/student.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
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
  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });
  await auth.signIn('2026-09-001', 'Student@123', 'student');
  // Same specifier the page uses, so the test mutates the very instance the home reads.
  const data = await import('../js/data.js');
  const mod = await import('../js/student-home.js');
  mod.initStudentHome();
  await new Promise((r) => setTimeout(r, 400)); // skeleton hand-off
  return { dom, data, doc: dom.window.document };
}

const click = (doc, sel) => doc.querySelector(sel).dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));

test('student home renders every priority section from live data', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');

  assert.equal(doc.getElementById('home-skeleton').hidden, true, 'skeleton hidden after load');
  assert.equal(doc.getElementById('home-content').hidden, false, 'home content shown');
  const auth = await import('../js/auth.js');
  assert.equal(doc.getElementById('student-name').textContent, auth.currentSession().name, 'name comes from the session');
  assert.ok(doc.getElementById('greet').textContent.length > 3, 'greeting rendered');

  const html = doc.getElementById('home-content').innerHTML;
  const cards = doc.querySelectorAll('#home-content .hcard');
  assert.ok(cards.length >= 8, `expected many cards, got ${cards.length}`);

  // Hero progress bar reflects todayProgress() exactly (not a hard-coded number).
  const p = data.todayProgress(student);
  assert.ok(html.includes(`width:${p.pct}%`), `progress bar shows ${p.pct}%`);

  // Feature grid: 8 destinations, each wired to an action.
  const tiles = doc.querySelectorAll('#home-content .feature-grid .tile');
  assert.equal(tiles.length, 8, 'eight main features');
  for (const t of tiles) assert.ok(t.dataset.act, 'tile has an action');

  // Next class / upcoming exam come from the routine + exam collections.
  const next = data.nextClass();
  assert.ok(next, 'routine yields a next class');
  assert.ok(html.includes(next.item.subject), `next class card shows ${next.item.subject}`);
  const exam = data.upcomingExam(student.className);
  assert.ok(exam && html.includes(exam.title), 'upcoming exam card shows the real exam title');

  // Student sees only their own fee rows.
  const fee = data.feeStatusFor(student);
  assert.equal(fee.due, 0, 'seed student has no due fee');
});

test('bottom nav switches views and exactly one stays highlighted', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('view-result').hidden, false);
  assert.equal(doc.getElementById('view-home').hidden, true);
  assert.equal(doc.querySelector('.bottom-nav button[data-view="result"]').getAttribute('aria-current'), 'true');
  assert.equal(doc.querySelector('.bottom-nav button[data-view="home"]').getAttribute('aria-current'), 'false');
  click(doc, '.bottom-nav button[data-view="home"]');
  assert.equal(doc.getElementById('view-home').hidden, false);
});

test('feature tiles route to the right view / panel', async () => {
  const { doc } = await bootHome();
  click(doc, '#home-content [data-act="exam"]');
  assert.equal(doc.getElementById('view-exam').hidden, false, 'exam tile opens the exam view');
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '#home-content [data-act="routine"]');
  assert.equal(doc.getElementById('view-more').hidden, false, 'routine tile opens More');
  assert.ok(doc.getElementById('more-routine'), 'routine panel exists');
});

test('notification bell opens the centre and hides the badge at zero', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  assert.equal(doc.getElementById('bell-count').hidden, data.unreadNotifications(student) === 0);
  click(doc, '#bell');
  assert.equal(doc.getElementById('notif-center').getAttribute('aria-hidden'), 'false');
  assert.ok(doc.getElementById('notif-list').innerHTML.length > 20, 'notification rows rendered');
});

test('daily challenge asks a real question and records progress', async () => {
  const { doc, data } = await bootHome();
  const before = data.challengeState().done;
  click(doc, '#home-content [data-act="challenge"]');
  const body = doc.querySelector('#detail-body').innerHTML;
  assert.ok(body.includes('data-opt="0"'), 'challenge shows answer options');
  click(doc, '#detail-body [data-opt="0"]');
  assert.equal(data.challengeState().done, before + 1, 'challenge progress stored');
  assert.equal(doc.getElementById('detail-modal').getAttribute('aria-hidden'), 'true', 'modal closed');
});

test('logout from More ends the session', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#home-logout');
  assert.equal(globalThis.localStorage.getItem('activeplus_session'), null, 'session cleared');
  const auth = await import('../js/auth.js');
  assert.equal(auth.currentSession(), null, 'auth no longer reports a session');
  // jsdom does not perform real navigation; the redirect itself is covered by
  // the requireRole/signOut guards in tests/smoke.test.mjs.
});

test('a render failure shows a friendly error with a working retry (no recursion)', async () => {
  const { doc, data } = await bootHome();
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 8, 'home rendered first');

  const original = data.db.routine;
  const broken = { list() { throw new Error('boom'); }, find: () => null };

  // Coming back online re-renders the home; with the data layer broken it must
  // fall back to the error card instead of throwing or blanking the screen.
  data.db.routine = broken;
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.ok(doc.getElementById('home-retry'), 'retry button offered');
  assert.ok(doc.getElementById('home-content').innerHTML.length < 2000, 'small error state, not a stack overflow');

  // Restore the data layer and retry: the real home must come back.
  data.db.routine = original;
  click(doc, '#home-retry');
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 8, 'retry restored the home');
});

test('offline shows the indicator and blocks starting an exam', async () => {
  const { doc } = await bootHome();
  Object.defineProperty(doc.defaultView.navigator, 'onLine', { value: false, configurable: true });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('offline'));
  assert.equal(doc.getElementById('net-chip').classList.contains('off'), true, 'chip marked offline');
  click(doc, '#home-content [data-act="exam"]');
  assert.equal(doc.getElementById('view-exam').hidden, true, 'exam view not opened while offline');
});

test('admin visibility settings hide the matching home cards', async () => {
  const { doc, data } = await bootHome();
  const before = doc.querySelectorAll('#home-content .hcard').length;
  data.setHomeCards({ fee: false, tip: false, banners: false, challenge: false });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online')); // re-render
  const html = doc.getElementById('home-content').innerHTML;
  assert.equal(html.includes('data-act="challenge"'), false, 'challenge card hidden');
  assert.equal(html.includes('banner'), false, 'banners hidden');
  assert.ok(doc.querySelectorAll('#home-content .hcard').length < before, 'fewer cards after hiding sections');
  data.setHomeCards({ fee: true, tip: true, banners: true, challenge: true });
});

test('continue learning resumes the material the student actually opened last', async () => {
  const { doc, data } = await bootHome();
  const cls = data.db.students.find('2026-09-001').className;
  data.db.materials.add({ id: 'mat-resume', title: 'Resume Me', subject: 'Math', className: cls, type: 'note', date: data.todayBn() });

  click(doc, '.bottom-nav button[data-view="study"]');
  click(doc, '#material-list [data-mat="mat-resume"]');   // student opens this one
  click(doc, '.bottom-nav button[data-view="home"]');      // returning home re-renders with fresh data
  assert.equal(data.lastAccessedMaterial().id, 'mat-resume', 'activity remembers the material');
  assert.ok(doc.getElementById('home-content').innerHTML.includes('Resume Me'), 'home resumes that material');
});
