/**
 * The phone's Back button.
 *
 * Owner report: *"ব্যাক বটম ক্লিক করলে এপ্স থেকে বের হয়ে যাচ্ছে … ব্যাক এ ক্লিক
 * করলে আগের টাস্ক এ ফিরে যাবে। ব্যাক বটম প্রেস করে রাখলে এক্সিট হবে।"*
 *
 * Every portal screen is painted in place, so the history used to be empty and
 * Back closed the installed app. These tests boot the real student portal in
 * jsdom and walk the stack the way a student does:
 *
 *   1. a drill-down (আরও → ফি)      → Back returns to the screen before it,
 *   2. a sheet (রিসিট/নোটিশ modal)  → Back closes the sheet and stays put,
 *   3. the bottom-nav tabs          → Back leaves from the tab on screen,
 *   4. the root screen              → the first Back only warns, the second exits,
 *   5. an in-app ← button           → pressed and held, it exits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

const { activeBackController, EXIT_WARNING_BN, DEFAULT_HOLD_MS } = await import('../js/back-button.js');

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Boots the student portal with a real signed-in session.
 *
 * Every boot needs its own `nonce`: the helper writes the page's inline module
 * to `.portal-<nonce>.mjs` and imports it, and Node's module cache would hand
 * back the first boot's wiring (leaving the new DOM with no listeners at all).
 */
let bootCount = 0;
async function bootStudent() {
  bootCount += 1;
  const dom = await bootPortal('student.html', {
    url: 'http://localhost:8080/student.html',
    username: '2026-09-001', password: 'Student@123', role: 'student', nonce: `back${bootCount}`
  });
  await tick(320);                       // the skeleton hand-off + exam taker
  const doc = dom.window.document;
  const nav = activeBackController();
  assert.ok(nav, 'the student portal owns a Back controller');
  return { dom, doc, nav, window: dom.window };
}

const visibleView = (doc) => Array.from(doc.querySelectorAll('.home-view'))
  .filter((v) => !v.hidden).map((v) => v.id);

const click = (doc, sel) => {
  const el = typeof sel === 'string' ? doc.querySelector(sel) : sel;
  assert.ok(el, `element exists: ${sel}`);
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  return el;
};

const pressBack = async (window) => { window.history.back(); await tick(80); };

/** Fires a real press-and-hold on an in-app back button. */
async function holdButton(doc, el, ms = DEFAULT_HOLD_MS + 60) {
  const win = doc.defaultView;
  const down = new win.Event('pointerdown', { bubbles: true, cancelable: true });
  el.dispatchEvent(down);
  await tick(ms);
  return el;
}

test('back from a drill-down returns to the screen it was opened from', async () => {
  const { doc, nav, window } = await bootStudent();

  assert.deepEqual(visibleView(doc), ['view-home'], 'the portal opens on Home');
  assert.equal(nav.top, 'home', 'Home is the root step');

  // Home → আরও (bottom nav) → ফি (a panel of আরও).
  click(doc, '.bottom-nav button[data-view="more"]');
  await tick();
  assert.deepEqual(visibleView(doc), ['view-more'], 'আরও is showing');
  click(doc, '.more-item[data-act="fees"]');
  await tick();
  assert.equal(nav.top, 'more/fees', 'the ফি panel is a step of its own');
  assert.ok(doc.getElementById('more-fees'), 'the ফি panel rendered');
  assert.ok(doc.getElementById('more-back'), 'the panel carries its ← button');

  // The phone's Back gives the panel up and lands on the আরও menu.
  await pressBack(window);
  assert.equal(nav.top, 'more', 'Back returned to the আরও menu');
  assert.ok(doc.getElementById('more-menu'), 'the আরও menu is painted again');
  assert.deepEqual(visibleView(doc), ['view-more'], 'still inside the portal — not exited');

  // One more Back leaves আরও and returns to the screen before it (Home).
  await pressBack(window);
  assert.deepEqual(visibleView(doc), ['view-home'], 'Back walked home');
});

test('a Home card that opens a sheet is closed by back, and Home stays', async () => {
  const { doc, nav, window } = await bootStudent();

  // "পড়া চালিয়ে যান" opens the material sheet — the deepest thing on Home.
  const door = doc.querySelector('#home-resume [data-act="material"]')
    || doc.querySelector('#home-content [data-act="more"]');
  assert.ok(door, 'Home offers a way deeper into the app');
  click(doc, door);
  await tick();

  if (door.dataset.act === 'material') {
    const sheet = doc.getElementById('detail-modal');
    assert.ok(sheet.classList.contains('active'), 'the material sheet opened');
    assert.ok(nav.modalOnTop, 'the sheet is a step of its own');
    assert.equal(nav.top, 'home', 'Home is still the screen behind it');

    await pressBack(window);
    assert.ok(!sheet.classList.contains('active'), 'Back closed the sheet');
    assert.deepEqual(visibleView(doc), ['view-home'], 'Home never moved');
    assert.equal(nav.top, 'home', 'Home is still the current screen');
  } else {
    assert.equal(nav.top, 'more', 'the আরও door stacked above Home');
    await pressBack(window);
    assert.deepEqual(visibleView(doc), ['view-home'], 'Back returned to Home');
  }
  assert.equal(nav.exitCalls, 0, 'the app was never handed to the browser');
});

test('back closes an open sheet and stays on the screen behind it', async () => {
  const { doc, nav, window } = await bootStudent();

  click(doc, '.bottom-nav button[data-view="more"]');
  await tick();
  click(doc, '.more-item[data-act="notices"]');
  await tick();
  assert.equal(nav.top, 'more/notices', 'the notice panel is showing');

  // Open a notice: the detail sheet is a modal, so it is a Back step of its own.
  const row = doc.querySelector('#more-notices [data-notice]');
  if (row) {
    click(doc, row);
    await tick();
    const sheet = doc.getElementById('detail-modal');
    assert.ok(sheet.classList.contains('active'), 'the sheet opened');
    const depthBefore = nav.depth;

    await pressBack(window);
    assert.ok(!sheet.classList.contains('active'), 'Back closed the sheet');
    assert.deepEqual(visibleView(doc), ['view-more'], 'the screen behind it did not move');
    assert.equal(nav.depth, depthBefore, 'the notice panel is still the current screen');
    assert.equal(nav.top, 'more/notices', 'the stack kept the panel');
  }

  // Closing a sheet with its own × must not leave a stale history entry behind.
  click(doc, '.bottom-nav button[data-view="home"]');
  await tick();
  const bell = doc.getElementById('bell');
  click(doc, bell);
  await tick();
  assert.ok(doc.getElementById('notif-center').classList.contains('active'), 'the notification centre opened');
  click(doc, '#notif-center [data-close]');
  await tick(120);
  assert.equal(nav.top, 'home', 'the × gave the sheet step back');
  assert.equal(nav.stack.filter((s) => s.modal).length, 0, 'no sheet step is left behind');
  assert.equal(nav.depth, 1, 'exactly one screen step remains');
});

test('back closes the profile dropdown before it leaves the screen', async () => {
  const { doc, nav, window } = await bootStudent();

  click(doc, '#profile-btn');
  await tick();
  const menu = doc.getElementById('student-profile-menu');
  assert.equal(menu.hidden, false, 'the profile menu opened');
  assert.ok(nav.modalOnTop, 'the open menu is a layer of its own');
  assert.equal(nav.top, 'home', 'Home is still the screen behind it');

  await pressBack(window);
  assert.equal(menu.hidden, true, 'Back closed the menu');
  assert.deepEqual(visibleView(doc), ['view-home'], 'Home did not move');
  assert.equal(nav.exitCalls, 0, 'the app stayed open');
  assert.equal(nav.stack.filter((step) => step.modal).length, 0, 'the menu step is gone');
  assert.equal(nav.pushed, nav.stack.length, 'history and the stack still agree');
});

test('the bottom-nav tabs stack, so back walks the screens the student visited', async () => {
  const { doc, nav, window } = await bootStudent();

  const walked = ['study', 'exam', 'result'];
  for (const view of walked) {
    click(doc, `.bottom-nav button[data-view="${view}"]`);
    await tick();
    assert.deepEqual(visibleView(doc), [`view-${view}`], `${view} is showing`);
    assert.equal(nav.top, view, `${view} is the current screen`);
  }
  assert.equal(nav.depth, walked.length + 1, 'Home plus every tab the student tapped');

  // Back walks the visited screens in reverse — the "আগের টাস্ক" behaviour.
  for (const view of ['exam', 'study', 'home']) {
    await pressBack(window);
    assert.deepEqual(visibleView(doc), [`view-${view}`], `Back returned to ${view}`);
    assert.equal(nav.top, view, `the stack agrees about ${view}`);
  }
  assert.equal(nav.exitCalls, 0, 'nothing was handed to the browser yet');

  // Tapping হোম makes Home the root again: the walk is given up.
  click(doc, '.bottom-nav button[data-view="study"]');
  await tick();
  click(doc, '.bottom-nav button[data-view="exam"]');
  await tick();
  click(doc, '.bottom-nav button[data-view="home"]');
  await tick();
  assert.equal(nav.depth, 1, 'হোম reset the stack to the root screen');
  assert.equal(nav.top, 'home', 'Home is the only step left');
});

test('a long session cannot turn back into an endless walk', async () => {
  const { doc, nav } = await bootStudent();
  const { MAX_DEPTH } = await import('../js/back-button.js');

  for (let i = 0; i < MAX_DEPTH + 6; i += 1) {
    click(doc, `.bottom-nav button[data-view="${['study', 'exam', 'result', 'more'][i % 4]}"]`);
    await tick(20);
  }
  assert.ok(nav.depth <= MAX_DEPTH, `the stack stops at ${MAX_DEPTH} screens (got ${nav.depth})`);
  assert.equal(nav.pushed, nav.stack.length,
    'the history holds exactly the entries the stack remembers');
});

test('at the root the first back warns and only the second one exits', async () => {
  const { doc, nav, window } = await bootStudent();

  assert.equal(nav.depth, 1, 'Home is the root screen');
  assert.equal(nav.pushed, 1, 'one entry of ours sits between the page and the student');

  await pressBack(window);
  assert.equal(nav.exitCalls, 0, 'the first Back did not close the app');
  assert.deepEqual(visibleView(doc), ['view-home'], 'Home is still on screen');
  const toast = doc.querySelector('#toast-container .toast');
  assert.ok(toast, 'a warning toast was shown');
  assert.ok(toast.textContent.includes(EXIT_WARNING_BN.slice(0, 18)), 'the warning says how to leave');
  assert.equal(nav.pushed, 1, 'the warning put our root entry back');

  // The second press inside the warning window is the one that leaves.
  await pressBack(window);
  assert.equal(nav.exitCalls, 1, 'the second Back is handed to the browser (exit)');

  // And an explicit exit — a held ← button — is counted the same way.
  assert.equal(nav.exit(), true, 'exit() runs');
  assert.equal(nav.exitCalls, 2, 'exit() is what leaves the app');
});

test('an in-app back button exits the app while it is held', async () => {
  const { doc, nav } = await bootStudent();

  click(doc, '.bottom-nav button[data-view="more"]');
  await tick();
  click(doc, '.more-item[data-act="fees"]');
  await tick();
  const back = doc.getElementById('more-back');
  assert.ok(back, 'the ফি panel has its ← button');

  const exits = nav.exitCalls;
  await holdButton(doc, back);
  assert.equal(nav.exitCalls, exits + 1, 'holding ← exits the app');

  // A short press must still be a normal back.
  click(doc, '.bottom-nav button[data-view="more"]');
  await tick();
  click(doc, '.more-item[data-act="routine"]');
  await tick();
  assert.equal(nav.top, 'more/routine', 'the routine panel is showing');
  const before = nav.exitCalls;
  click(doc, doc.getElementById('more-back'));
  await tick();
  assert.equal(nav.exitCalls, before, 'a tap does not exit');
  assert.equal(nav.top, 'more', 'a tap returned to the আরও menu');
  assert.ok(doc.getElementById('more-menu'), 'the menu is painted');
});

test('the exam paper is a step: back returns to the exam list, never out of the app', async () => {
  const { doc, nav, window } = await bootStudent();
  const data = await import('../js/data.js');

  const exam = data.examsFor(data.db.students.find('2026-09-001').className)
    .find((e) => data.examWindow(e)?.canStart && !data.examResultFor(e.id, '2026-09-001'));
  if (!exam) return; // no open paper in the seeded data — nothing to walk

  click(doc, '.bottom-nav button[data-view="exam"]');
  await tick();
  assert.equal(nav.top, 'exam', 'the exam list is showing');

  click(doc, `#student-exam-list [data-take="${exam.id}"]`);
  await tick();
  assert.equal(doc.getElementById('exam-player').hidden, false, 'the paper is on screen');
  assert.equal(nav.top, `exam/paper/${exam.id}`, 'the running paper is a Back step');

  await pressBack(window);
  assert.equal(doc.getElementById('exam-player').hidden, true, 'Back closed the paper');
  assert.equal(doc.getElementById('student-exam-list').hidden, false, 'Back returned to the exam list');
  assert.equal(nav.top, 'exam', 'the list is the current screen again');
});

test('the teacher and admin portals keep the same back behaviour', async () => {
  for (const [page, user, pass, role, nonce, tab] of [
    ['teacher.html', 'teacher@activeplus.edu', 'Teacher@123', 'teacher', 'back-t', 'batches'],
    ['admin.html', 'admin@activeplus.edu', 'Admin@123', 'admin', 'back-a', 'students']
  ]) {
    const dom = await bootPortal(page, {
      url: `http://localhost:8080/${page}`, username: user, password: pass, role, nonce
    });
    await tick(260);
    const doc = dom.window.document;
    const nav = activeBackController();
    assert.ok(nav, `${page} owns a Back controller`);
    assert.equal(nav.depth, 1, `${page} starts on one root screen`);
    assert.equal(nav.pushed, 1, `${page} keeps one entry between the root and the browser`);

    const shown = () => Array.from(doc.querySelectorAll('.tab-panel[id^="tab-"]'))
      .filter((panel) => !panel.hidden).map((panel) => panel.id.replace(/^tab-/, ''));

    // A real bottom-nav tap, exactly as the phone would send it.
    click(doc, `.bottom-nav button[data-tab="${tab}"]`);
    await tick();
    assert.deepEqual(shown(), [tab], `${page}: the ${tab} panel is showing`);
    assert.equal(nav.top, tab, `${page}: ${tab} is the current screen`);
    assert.equal(nav.depth, 2, `${page}: the tab was stacked above the home`);

    await pressBack(dom.window);
    assert.deepEqual(shown(), ['home'], `${page}: Back returned to the home panel`);
    assert.equal(nav.top, 'home', `${page}: the stack agrees`);
    assert.equal(nav.exitCalls, 0, `${page}: the app was not closed`);

    // At the root: warn first, exit on the second press.
    await pressBack(dom.window);
    assert.equal(nav.exitCalls, 0, `${page}: the first Back at the root only warns`);
    assert.ok(doc.querySelector('#toast-container .toast'), `${page}: the user is told how to leave`);
    await pressBack(dom.window);
    assert.equal(nav.exitCalls, 1, `${page}: the second Back exits`);
    nav.destroy();
  }
});
