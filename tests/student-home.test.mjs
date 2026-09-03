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
  const tiles = doc.querySelectorAll('#home-content .feature-grid:not(.more-grid) .tile');
  assert.equal(tiles.length, 8, 'eight main features');
  const moreTiles = doc.querySelectorAll('#more-features .tile');
  assert.ok(moreTiles.length >= 6, 'See More reveals the secondary features');
  assert.equal(doc.getElementById('more-features').hidden, true, 'collapsed by default');
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

test('exam card follows the exam window: Start only while open', async () => {
  const { doc, data } = await bootHome();
  const exam = data.upcomingExam('নবম');
  assert.equal(data.examWindow(exam).state, 'active', 'seed exam is inside its window');
  assert.ok(doc.querySelector('#home-content [data-act="startexam"]'), 'Start Exam offered while open');

  data.db.exams.update(exam.id, { endDate: '২০২০-০১-০১' }); // window long closed
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.equal(doc.querySelector('#home-content [data-act="startexam"]'), null, 'no Start button when closed');
  assert.ok(doc.querySelector('#home-content [data-act="exam"]'), 'View Exam still available');
  data.db.exams.update(exam.id, { endDate: exam.endDate });
});

test('assignments show real status and open their details', async () => {
  const { doc, data } = await bootHome();
  const asg = data.db.assignments.list()[0];
  const html = doc.getElementById('home-content').innerHTML;
  assert.ok(html.includes(`data-id="${asg.id}"`), 'assignment row is clickable');
  assert.ok(html.includes('জমা হয়েছে'), 'status reflects the stored submission');
  click(doc, `#home-content [data-act="assignment"][data-id="${asg.id}"]`);
  assert.equal(doc.getElementById('detail-modal').getAttribute('aria-hidden'), 'false', 'details modal opened');
  assert.ok(doc.getElementById('detail-body').innerHTML.includes(asg.subject), 'details show the subject');
});

test('profile lists every required field and honours admin edit permission', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  const html = doc.getElementById('more-profile').innerHTML;
  for (const label of ['শিক্ষার্থী আইডি', 'শ্রেণি', 'শাখা', 'রোল', 'ব্যাচ', 'অভিভাবক', 'ভর্তির তারিখ', 'অবস্থা']) {
    assert.ok(html.includes(label), `profile shows ${label}`);
  }
  assert.ok(doc.getElementById('pf-phone'), 'phone is editable (admin permitted)');
  assert.equal(doc.querySelectorAll('#profile-edit-form input').length, 1, 'only permitted fields are editable');

  document.getElementById('pf-phone').value = '01999-000000';
  doc.getElementById('profile-edit-form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(data.db.students.find('2026-09-001').phone, '01999-000000', 'permitted field saved');

  data.db.settings.update({ studentEditableFields: [] });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.equal(doc.getElementById('pf-phone'), null, 'no editable field once admin revokes permission');
});

test('teacher query reaches the teacher notification list', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  doc.getElementById('query-text').value = 'স্যার, অধ্যায় ২ বুঝিয়ে দিন';
  doc.getElementById('query-form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  const sent = data.db.notifications.list().filter((n) => n.target === 'শিক্ষক' && n.studentId === '2026-09-001');
  assert.equal(sent.length, 1, 'query stored for teachers');
  assert.equal(sent[0].title, 'স্যার, অধ্যায় ২ বুঝিয়ে দিন');
  assert.ok(doc.getElementById('more-query').innerHTML.includes('অধ্যায় ২'), 'student sees their own query listed');
});

test('notification preview, carousel and See More all work on the home screen', async () => {
  const { doc, data } = await bootHome();
  const html = doc.getElementById('home-content').innerHTML;
  assert.ok(doc.querySelector('#home-content [data-act="notif"]'), 'notification preview offers View All');
  click(doc, '#home-content [data-act="notif"]');
  assert.equal(doc.getElementById('notif-center').getAttribute('aria-hidden'), 'false', 'opens the centre');
  doc.getElementById('notif-center').classList.remove('active');

  assert.ok(doc.getElementById('banner-track'), 'banner carousel rendered');
  const firstBanner = data.activeBanners()[0];
  click(doc, `#home-content [data-act="banner"][data-id="${firstBanner.id}"]`);
  assert.equal(doc.getElementById('detail-title').textContent, firstBanner.title, 'banner CTA opens its details');
  doc.getElementById('detail-modal').classList.remove('active');

  const box = doc.getElementById('more-features');
  assert.equal(box.hidden, true);
  click(doc, '#home-content [data-act="seemore"]');
  assert.equal(box.hidden, false, 'See More expands');
  assert.equal(doc.querySelector('#home-content [data-act="seemore"]').getAttribute('aria-expanded'), 'true');
  click(doc, '#home-content [data-act="seemore"]');
  assert.equal(box.hidden, true, 'and collapses again');
});

test('More menu carries every secondary destination without dead links', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  for (const id of ['more-assignments', 'more-routine', 'more-fees', 'more-notices', 'more-achievements',
    'more-certificates', 'more-downloads', 'more-streak', 'more-query', 'more-profile', 'more-help']) {
    assert.ok(doc.getElementById(id), `${id} exists`);
  }
  assert.ok(doc.getElementById('home-logout'), 'logout available');
});

test('clickable rows work from the keyboard, not just a tap', async () => {
  const { doc } = await bootHome();
  const row = doc.querySelector('#home-content [role="button"][data-act="assignment"]');
  assert.ok(row, 'assignment row is focusable');
  assert.equal(row.getAttribute('tabindex'), '0');
  row.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(doc.getElementById('detail-modal').getAttribute('aria-hidden'), 'false', 'Enter opened the details');
});

test('opening the notification centre clears the unread badge', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  assert.ok(data.unreadNotifications(student) > 0, 'starts with unread items');
  assert.equal(doc.getElementById('bell-count').hidden, false, 'badge visible');
  click(doc, '#bell');
  assert.equal(doc.getElementById('bell-count').hidden, true, 'badge hidden after reading');
  assert.equal(data.unreadNotifications(student), 0, 'notifications marked read');
});

test('leaderboard visibility is an admin switch', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  data.setHomeCards({ leaderboard: true });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.ok(doc.getElementById('home-content').innerHTML.includes('র‍্যাঙ্ক'), 'rank shown when leaderboard is on');

  data.setHomeCards({ leaderboard: false });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.equal(doc.getElementById('home-content').innerHTML.includes('র‍্যাঙ্ক'), false, 'rank hidden when admin turns it off');
  data.setHomeCards({ leaderboard: true });
});

test('exam list offers Start only inside the window', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="exam"]');
  const exam = data.examsFor('নবম')[0];
  assert.ok(doc.querySelector(`[data-take="${exam.id}"]`), 'Start offered while open');

  data.db.exams.update(exam.id, { endDate: '২০০০-০১-০১' });
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '.bottom-nav button[data-view="exam"]');
  assert.equal(doc.querySelector(`[data-take="${exam.id}"]`), null, 'no Start once the window closed');
  assert.ok(doc.getElementById('student-exam-list').innerHTML.includes('সময় শেষ'), 'reason shown instead');
});

test('home lists recent study materials for the student class only', async () => {
  const { doc, data } = await bootHome();
  const cls = data.db.students.find('2026-09-001').className;
  const html = doc.getElementById('home-content').innerHTML;
  const mat = data.db.materials.list()[0];
  assert.ok(html.includes(mat.title), 'class material listed on home');

  data.db.materials.add({ id: 'mat-other', title: 'Other Class Only', subject: 'X', className: 'দশম', type: 'নোট', date: data.todayBn() });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.equal(doc.getElementById('home-content').innerHTML.includes('Other Class Only'), false, 'other class material never shown');
});

test('with no material at all the home invites the student to start', async () => {
  const { doc, data } = await bootHome();
  [...data.db.materials.list()].forEach((m) => data.db.materials.remove(m.id));
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  const html = doc.getElementById('home-content').innerHTML;
  assert.ok(html.includes('নতুন কিছু শেখা শুরু করুন'), 'start-learning empty state shown');
  assert.ok(doc.querySelector('#home-content [data-act="study"]'), 'with a way in');
});

test('More includes a Settings panel with real app state', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  const panel = doc.getElementById('more-settings');
  assert.ok(panel, 'settings panel exists');
  assert.ok(panel.innerHTML.includes(`v${data.DATA_VERSION}`), 'shows the app version');
  assert.ok(doc.getElementById('clear-cache'), 'cache refresh offered');
  click(doc, '#more-content [data-act="settings"]');
  assert.equal(doc.getElementById('view-more').hidden, false, 'settings tile routes to More');
});

test('today summary rows open their own section', async () => {
  const { doc } = await bootHome();
  const rows = [...doc.querySelectorAll('#home-content [role="button"][data-act]')]
    .filter((r) => ['routine', 'assignments', 'exam'].includes(r.dataset.act));
  assert.ok(rows.length >= 3, 'today rows are actionable');
  click(doc, '#home-content .info-row[data-act="exam"]');
  assert.equal(doc.getElementById('view-exam').hidden, false, 'exam row opens exams');
});

test('latest result card shows the class position when leaderboard is on', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });
  data.setHomeCards({ leaderboard: true });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.ok(doc.getElementById('home-content').innerHTML.includes('অবস্থান'), 'position shown');
  data.setHomeCards({ leaderboard: false });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.equal(doc.getElementById('home-content').innerHTML.includes('অবস্থান'), false, 'hidden with the leaderboard');
});
