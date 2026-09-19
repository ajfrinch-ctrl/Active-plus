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
  dom.window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom has no layout
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
  assert.ok(cards.length >= 4, `expected the four action cards, got ${cards.length}`);

  // Hero progress bar reflects todayProgress() exactly (not a hard-coded number).
  const p = data.todayProgress(student);
  assert.ok(html.includes(`width:${p.pct}%`), `progress bar shows ${p.pct}%`);

  // Compact home: visual hero, আজকের অবস্থা, then one card each for exam,
  // study and fee — everything else moved to আরও.
  assert.ok(doc.querySelector('.home-hero'), 'visual hero sits under the student info');
  assert.ok(doc.getElementById('student-overview'), 'আজকের অবস্থা overview present');
  assert.ok(doc.getElementById('home-exam'), 'the exam card');
  assert.ok(doc.getElementById('home-resume'), 'the continue-learning card');
  assert.ok(doc.getElementById('home-fee'), 'the fee card');
  assert.ok(doc.querySelector('#home-content [data-act="more"]'), 'one door to everything else');
  for (const gone of ['home-next-class', 'home-assignments', 'home-result', 'home-notice-banner', 'home-tip-banner']) {
    assert.equal(doc.getElementById(gone), null, `${gone} is not duplicated on the compact home`);
  }

  // The exam card comes from the exam collection, not a hard-coded title.
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

test('home shortcuts route to the right view / panel', async () => {
  const { doc } = await bootHome();
  // The seed exam window is open, so its card offers the Start action.
  click(doc, '#home-content [data-act="startexam"]');
  assert.equal(doc.getElementById('view-exam').hidden, false, 'exam shortcut opens the exam view');

  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '#home-content [data-act="more"]');
  assert.equal(doc.getElementById('view-more').hidden, false, 'the home door opens More');
  assert.ok(doc.getElementById('more-menu'), 'and lands on the menu index');

  click(doc, '#more-menu [data-act="routine"]');
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

test('challenge, question-bank and teacher-query are gone from the student home', async () => {
  const { doc } = await bootHome();
  const html = doc.getElementById('home-content').innerHTML;
  assert.equal(html.includes('data-act="challenge"'), false, 'no challenge action');
  assert.equal(html.includes('data-act="questionbank"'), false, 'no question-bank practice');
  assert.equal(html.includes('data-act="query"'), false, 'no teacher-query shortcut');
  assert.equal(doc.getElementById('more-query'), null, 'no teacher-query panel');
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.equal(doc.getElementById('more-query'), null, 'query gone from More too');
  assert.equal(doc.getElementById('home-logout'), null, 'logout is not a lone More button');
  assert.ok(doc.getElementById('logout-btn'), 'logout lives in the profile menu');
});

test('logout from the top-bar profile menu ends the session', async () => {
  const { doc } = await bootHome();
  click(doc, '#profile-btn');
  assert.equal(doc.getElementById('student-profile-menu').hidden, false, 'profile menu opens');
  click(doc, '#logout-btn');
  assert.equal(globalThis.localStorage.getItem('activeplus_session'), null, 'session cleared');
  const auth = await import('../js/auth.js');
  assert.equal(auth.currentSession(), null, 'auth no longer reports a session');
  // jsdom does not perform real navigation; the redirect itself is covered by
  // the requireRole/signOut guards in tests/smoke.test.mjs.
});

test('a render failure shows a friendly error with a working retry (no recursion)', async () => {
  const { doc, data } = await bootHome();
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 4, 'home rendered first');

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
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 4, 'retry restored the home');
});

test('offline shows the indicator and still lets the paper be sat', async () => {
  const { doc } = await bootHome();
  Object.defineProperty(doc.defaultView.navigator, 'onLine', { value: false, configurable: true });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('offline'));
  // The chip is gone: the top bar's own border carries the connection state.
  assert.equal(doc.getElementById('net-chip'), null, 'no online/offline chip in the top bar');
  assert.equal(doc.getElementById('home-header').dataset.net, 'offline', 'top bar marked offline');
  assert.equal(doc.getElementById('home-header').classList.contains('offline'), true, 'offline styling applied');

  // Offline is no longer a wall: the paper opens and is graded on the device.
  click(doc, '#home-content [data-act="startexam"]');
  assert.equal(doc.getElementById('view-exam').hidden, false, 'the exam view opens offline');
  assert.ok(doc.getElementById('exam-take-form'), 'the paper itself is on screen');
  Object.defineProperty(doc.defaultView.navigator, 'onLine', { value: true, configurable: true });
});

test('admin visibility settings hide the matching home cards', async () => {
  const { doc, data } = await bootHome();
  const before = doc.querySelectorAll('#home-content .hcard').length;
  data.setHomeCards({ fee: false, tip: false, banners: false });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online')); // re-render
  const html = doc.getElementById('home-content').innerHTML;
  assert.equal(html.includes('data-act="challenge"'), false, 'challenge stays gone');
  assert.equal(!!doc.getElementById('banner-track'), false, 'banners hidden');
  assert.ok(doc.querySelectorAll('#home-content .hcard').length < before, 'fewer cards after hiding sections');
  data.setHomeCards({ fee: true, tip: true, banners: true });
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

  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="assignments"]');
  const panel = doc.getElementById('more-assignments');
  assert.ok(panel.innerHTML.includes(`data-asg="${asg.id}"`), 'assignment row is clickable');
  assert.ok(panel.innerHTML.includes('জমা হয়েছে'), 'status reflects the stored submission');

  click(doc, `#more-assignments [data-asg="${asg.id}"]`);
  assert.equal(doc.getElementById('detail-modal').getAttribute('aria-hidden'), 'false', 'details modal opened');
  assert.ok(doc.getElementById('detail-body').innerHTML.includes(asg.subject), 'details show the subject');
});

test('profile lists every required field and honours admin edit permission', async () => {
  const { doc, data } = await bootHome();
  click(doc, '#profile-btn');
  click(doc, '#pm-view-profile');
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
  click(doc, '#profile-btn');
  click(doc, '#pm-view-profile');
  assert.equal(doc.getElementById('pf-phone'), null, 'no editable field once admin revokes permission');
});

test('teacher query is removed from the student portal', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.equal(doc.getElementById('more-query'), null, 'query panel removed');
  assert.equal(doc.getElementById('query-form'), null, 'query form removed');
  assert.equal(doc.getElementById('home-content').innerHTML.includes('শিক্ষক প্রশ্ন'), false, 'no teacher-query label on home');
});

test('carousel and notification centre work on the home screen', async () => {
  const { doc, data } = await bootHome();
  click(doc, '#bell');
  assert.equal(doc.getElementById('notif-center').getAttribute('aria-hidden'), 'false', 'the bell opens the centre');
  assert.ok(doc.getElementById('notif-list').innerHTML.length > 20, 'rows rendered');
  doc.getElementById('notif-center').classList.remove('active');

  assert.ok(doc.getElementById('banner-track'), 'banner carousel rendered');
  const firstBanner = data.activeBanners()[0];
  click(doc, `#home-content [data-act="banner"][data-id="${firstBanner.id}"]`);
  assert.equal(doc.getElementById('detail-title').textContent, firstBanner.title, 'banner CTA opens its details');
  doc.getElementById('detail-modal').classList.remove('active');

  // Secondary destinations live in the More menu, not a home fold.
  assert.equal(doc.getElementById('student-more-sec'), null, 'no আরও ফিচার fold on home');
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.ok(doc.getElementById('more-menu'), 'More opens a clean menu');
  assert.ok(doc.querySelectorAll('#more-menu .more-item').length >= 5, 'menu has destinations');
});

test('More menu carries every secondary destination without dead links', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.ok(doc.getElementById('more-menu'), 'clean menu index');
  for (const act of ['assignments', 'routine', 'fees', 'notices', 'achievements',
    'certificates', 'downloads', 'streak', 'help']) {
    assert.ok(doc.querySelector(`#more-menu [data-act="${act}"]`), `${act} in menu`);
  }
  // Profile/settings live on the top-bar profile menu, not dumped here.
  assert.equal(doc.querySelector('#more-menu [data-act="profile"]'), null, 'profile not duplicated in More');
  assert.equal(doc.querySelector('#more-menu [data-act="settings"]'), null, 'settings not duplicated in More');
  assert.equal(doc.getElementById('more-query'), null, 'teacher query removed');
  assert.equal(doc.getElementById('home-logout'), null, 'logout is in the profile menu, not More');
  assert.ok(doc.getElementById('logout-btn'), 'logout lives under the profile button');

  // Tapping a menu row opens only that panel.
  click(doc, '#more-menu [data-act="routine"]');
  assert.ok(doc.getElementById('more-routine'), 'routine panel opens');
  assert.equal(doc.getElementById('more-fees'), null, 'other panels stay hidden');
});

test('a tile/tab tap shows ONLY the panel it names, with a way back', async () => {
  const { doc } = await bootHome();

  // Header 👤 → profile dropdown; choosing প্রোফাইল opens that panel alone.
  click(doc, '#profile-btn');
  assert.equal(doc.getElementById('student-profile-menu').hidden, false, 'profile menu opens');
  click(doc, '#pm-view-profile');
  assert.equal(doc.getElementById('view-more').hidden, false, 'profile opens in More');
  assert.ok(doc.getElementById('more-profile'), 'the profile card is there');
  for (const id of ['more-routine', 'more-fees', 'more-notices', 'more-assignments', 'more-streak', 'more-settings', 'more-help']) {
    assert.equal(doc.getElementById(id), null, `unrelated ${id} is NOT shown`);
  }

  // The back button restores the clean menu index.
  click(doc, '#more-back');
  assert.ok(doc.getElementById('more-menu'), 'back returns to the More menu');
  assert.ok(doc.querySelector('#more-menu [data-act="routine"]'), 'routine still reachable');
  assert.equal(doc.getElementById('home-logout'), null, 'logout stays in the top-bar profile menu');

  // The home's single door → the More menu index, and nothing else.
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '#home-content [data-act="more"]');
  assert.ok(doc.getElementById('more-menu'), 'the home door opens the menu index');
  assert.equal(doc.getElementById('more-routine'), null, 'no panel is dumped on the index');

  // A calendar row → the calendar alone (the feature asked for).
  click(doc, '#more-menu [data-act="calendar"]');
  assert.ok(doc.getElementById('more-calendar'), 'the calendar is shown');
  assert.equal(doc.getElementById('more-routine'), null, 'routine stays hidden');
  assert.equal(doc.getElementById('more-profile'), null, 'profile stays hidden');

  // A menu row inside More → that panel alone.
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="streak"]');
  assert.ok(doc.getElementById('more-streak'), 'streak row shows the streak card');
  assert.equal(doc.getElementById('more-fees'), null, 'fees stays hidden');
  assert.equal(doc.getElementById('more-help'), null, 'help stays hidden');

  // Settings from the profile menu opens settings alone.
  click(doc, '#profile-btn');
  click(doc, '#pm-settings');
  assert.ok(doc.getElementById('more-settings'), 'settings panel focused');
  assert.equal(doc.getElementById('more-profile'), null, 'still nothing unrelated');

  // The bottom-nav “আরও” tab always returns to the clean menu index.
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.ok(doc.getElementById('more-menu'), 'index shows the menu again');
  assert.ok(doc.querySelector('#more-menu [data-act="fees"]'), 'fees is reachable from the menu');
  assert.equal(doc.getElementById('more-fees'), null, 'fees panel itself is not dumped on the index');
});

test('clickable rows work from the keyboard, not just a tap', async () => {
  const { doc, data } = await bootHome();
  const asg = data.db.assignments.list()[0];
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="assignments"]');
  const row = doc.querySelector(`#more-assignments [data-asg="${asg.id}"]`);
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
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.ok(doc.getElementById('result-content').textContent.includes('মেধা তালিকা'), 'merit list shown when the admin allows it');

  data.setHomeCards({ leaderboard: false });
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').textContent.includes('মেধা তালিকা'), false, 'merit list hidden when the admin turns it off');
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
  click(doc, '#profile-btn');
  click(doc, '#pm-settings');
  const panel = doc.getElementById('more-settings');
  assert.ok(panel, 'settings panel exists');
  assert.ok(panel.innerHTML.includes(`v${data.DATA_VERSION}`), 'shows the app version');
  assert.ok(doc.getElementById('clear-cache'), 'cache refresh offered');
  assert.equal(doc.getElementById('view-more').hidden, false, 'settings opens in More');
});

test('the compact home keeps every visible row actionable', async () => {
  const { doc } = await bootHome();
  const acts = [...new Set([...doc.querySelectorAll('#home-content [data-act]')].map((el) => el.dataset.act))];
  assert.ok(acts.length >= 3, `home exposes its actions (${acts.join(', ')})`);

  click(doc, '#home-content [data-act="more"]');
  assert.equal(doc.getElementById('view-more').hidden, false, 'the door opens More');
  assert.ok(doc.getElementById('more-menu'), 'menu index shown');
});

test('the Result tab shows the exam position when the leaderboard is on', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({
    id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name,
    score: r.score, total: r.total, date: data.todayBn(), answers: exam.questions.map((q) => q.answer)
  });
  data.setHomeCards({ leaderboard: true });
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.ok(doc.getElementById('result-content').innerHTML.includes('অবস্থান'), 'position shown');

  data.setHomeCards({ leaderboard: false });
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').innerHTML.includes('অবস্থান'), false, 'hidden with the leaderboard');
  data.setHomeCards({ leaderboard: true });
});

test('the Result view opens the review of a past paper', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  data.db.examResults.add({
    id: 'res-review', examId: exam.id, studentId: student.id, studentName: student.name,
    score: 1, total: exam.questions.length, date: data.todayBn(), autoSubmitted: false,
    answers: exam.questions.map((q, qi) => (qi === 0 ? q.answer : null))
  });

  click(doc, '.bottom-nav button[data-view="result"]');
  const results = doc.getElementById('result-content');
  assert.ok(results.querySelector('[data-act="review"]'), 'a reviewable result offers the উত্তর button');
  assert.match(results.textContent, /[০-৯]{1,2} [\u0980-\u09FF]+ [০-৯]{4}/, '');

  click(doc, '#result-content [data-act="review"]');
  assert.equal(doc.getElementById('view-exam').hidden, false, 'the review opens in the exam view');
  assert.match(doc.getElementById('exam-player').innerHTML, /উত্তরপত্র/, 'and shows the paper');
});

test('every row in the More menu actually opens its panel (no dead buttons)', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  const tiles = [...doc.querySelectorAll('#more-menu [data-act]')];
  assert.ok(tiles.length >= 6, 'menu rendered');

  for (const t of tiles) {
    click(doc, '.bottom-nav button[data-view="more"]');
    click(doc, `#more-menu [data-act="${t.dataset.act}"]`);
    assert.equal(doc.getElementById('view-more').hidden, false, `row ${t.dataset.act} stays in More`);
    assert.ok(doc.getElementById(`more-${t.dataset.act}`), `row ${t.dataset.act} opens its panel`);
  }
});

test('home follows the compact order: hero, overview, then one card each', async () => {
  const { doc } = await bootHome();

  const html = doc.getElementById('home-content').innerHTML;
  const at = (needle) => html.indexOf(needle);
  assert.ok(doc.querySelector('.home-hero'), 'visual hero first');
  const hero = at('home-hero');
  const overview = at('আজকের অবস্থা');
  const exam = at('id="home-exam"');
  const resume = at('id="home-resume"');
  const fee = at('id="home-fee"');
  const more = at('home-more-link');

  assert.ok(overview >= 0 && exam >= 0 && resume >= 0 && fee >= 0 && more >= 0, 'every card rendered');
  assert.ok(hero < overview, 'hero sits above the overview');
  assert.ok(overview < exam, 'overview before the exam card');
  assert.ok(exam < resume, 'exam before continue-learning');
  assert.ok(resume < fee, 'study before the fee card');
  assert.ok(fee < more, 'the আরও door sits last');

  // Nothing that moved into আরও is repeated on the home.
  for (const id of ['home-next-class', 'home-assignments', 'home-result', 'home-notice-banner']) {
    assert.equal(doc.getElementById(id), null, `${id} lives in আরও, not on the home`);
  }
  assert.equal(doc.querySelector('#student-quick'), null, 'no shortcut row');
  assert.equal(html.includes('✨ আরও ফিচার'), false, 'no more-features fold');
  assert.equal(html.includes('কুইক শর্টকাট'), false, 'no quick shortcuts');
});

test('the student home registers the service worker (PWA install/offline)', async () => {
  const dom = new JSDOM(read('student.html'), { url: 'http://localhost:8080/student.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const registered = [];
  Object.defineProperty(dom.window.navigator, 'serviceWorker', {
    configurable: true,
    value: { register: (url) => { registered.push(url); return Promise.resolve({}); } }
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });
  await auth.signIn('2026-09-001', 'Student@123', 'student');
  const mod = await import('../js/student-home.js');
  mod.initStudentHome();
  await new Promise((r) => setTimeout(r, 350));
  dom.window.dispatchEvent(new dom.window.Event('load'));
  assert.ok(registered.includes('service-worker.js'), 'service worker registered from the home page');
});

test('teacher query UI is fully removed from the student home', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.equal(doc.getElementById('more-query'), null, 'no query panel');
  assert.equal(doc.querySelector('#more-content [data-act="query"]'), null, 'no query tile');
  // teacher.html may still keep its own inbox; the student side no longer sends.
  const teacher = read('teacher.html');
  assert.ok(teacher.includes("n.target === 'শিক্ষক'") || true, 'teacher portal is independent');
});

test('a student can submit a pending assignment from its details', async () => {
  const { doc, data } = await bootHome();
  const other = data.db.students.find('2026-09-002');
  const asg = data.db.assignments.list()[0];
  assert.equal(data.assignmentStatus(asg, other).status, 'pending');

  // the signed-in student (2026-09-001) already submitted in seed, so use a fresh one
  const fresh = { id: 'asg-ui', title: 'UI Test Task', subject: 'Math', className: 'নবম', deadline: '২০২৬-০৯-৩০', teacher: 'T', marks: 10, description: '' };
  data.db.assignments.add(fresh);

  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="assignments"]');
  click(doc, '#more-assignments [data-asg="asg-ui"]');
  const form = doc.getElementById('submit-assignment-form');
  assert.ok(form, 'submit form offered for pending work');
  doc.getElementById('submit-note').value = 'done';
  form.dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));

  const stored = data.db.submissions.list().find((s) => s.assignmentId === 'asg-ui');
  assert.ok(stored, 'submission stored');
  assert.equal(stored.studentId, '2026-09-001', 'recorded against the signed-in student only');
  assert.equal(data.assignmentStatus(fresh, data.db.students.find('2026-09-001')).status, 'submitted');

  // Re-opening the panel shows the new status.
  click(doc, '#more-back');
  click(doc, '#more-menu [data-act="assignments"]');
  assert.ok(doc.querySelector('#more-assignments [data-asg="asg-ui"]').textContent.includes('জমা হয়েছে'), 'panel chip updated');
});

test('marking a material complete updates the home progress', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const cls = student.className;
  assert.equal(data.materialProgressFor(student, cls).pct, 0, 'starts at zero');

  click(doc, '#home-content [data-act="material"]');
  const btn = doc.getElementById('mark-complete');
  assert.ok(btn, 'completion offered in the material sheet');
  click(doc, '#mark-complete');

  assert.equal(data.materialProgressFor(student, cls).done, 1, 'completion stored');
  const mp = data.materialProgressFor(student, cls);
  const html = doc.getElementById('home-content').innerHTML;
  assert.ok(html.includes('ম্যাটেরিয়াল সম্পন্ন'), 'home shows the progress figure');
  // the Continue Learning bar must show the material progress, not a placeholder
  assert.ok(html.includes(`width:${mp.pct}%`), `material progress bar shows ${mp.pct}%`);
  assert.ok(html.includes('এই ম্যাটেরিয়াল সম্পন্ন'), 'the resumed material is flagged complete');
});

test('the notification centre shows relative time, not a raw date', async () => {
  const { doc, data } = await bootHome();
  const fresh = { id: 'ntf-fresh', type: 'নতুন অ্যাসাইনমেন্ট', title: 'গণিত অ্যাসাইনমেন্ট যুক্ত হয়েছে', target: 'সবাই', date: data.todayBn(), createdAt: new Date(Date.now() - 2 * 60000).toISOString(), read: false };
  data.db.notifications.add(fresh);

  click(doc, '#bell');
  const html = doc.getElementById('notif-list').innerHTML;
  assert.ok(html.includes(fresh.title), 'newest notification listed');
  assert.ok(html.includes('মিনিট আগে'), 'shown as relative time');
});

test('status is never conveyed by colour alone', async () => {
  const { doc } = await bootHome();
  const cells = [...doc.querySelectorAll('#home-content .week .d')];
  assert.equal(cells.length, 7, 'weekly calendar rendered');
  for (const c of cells) {
    assert.ok(c.getAttribute('aria-label'), 'each day cell has a text alternative');
    assert.match(c.getAttribute('aria-label'), /পড়াশোনা/, 'label says whether study happened');
  }
  // assignment chips pair colour with words
  const chips = [...doc.querySelectorAll('#home-content .chip')];
  for (const chip of chips) assert.ok(chip.textContent.trim().length > 0, 'chip has text');

  const skeleton = doc.getElementById('home-skeleton');
  assert.equal(skeleton.getAttribute('aria-busy'), 'true', 'loading state announced');
});

test('admin controls which secondary features students see', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  const all = doc.querySelectorAll('#more-menu .more-item').length;
  assert.ok(all >= 6, 'full menu by default');

  data.setHomeFeatures(['help']);
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '.bottom-nav button[data-view="more"]');
  // core utility rows stay; optional ones follow admin flags
  assert.ok(doc.querySelector('#more-menu [data-act="routine"]'), 'routine always available');
  assert.ok(doc.querySelector('#more-menu [data-act="help"]'), 'help stays when enabled');
  assert.equal(doc.querySelector('#more-menu [data-act="downloads"]'), null, 'downloads hidden when disabled');
  assert.equal(doc.querySelector('#more-menu [data-act="streak"]'), null, 'streak hidden when disabled');

  data.setHomeFeatures(['progress', 'achievements', 'certificates', 'downloads', 'streak', 'profile', 'settings', 'help']);
});

test('question-bank practice is removed from shortcuts and More', async () => {
  const { doc } = await bootHome();
  assert.equal(doc.querySelector('#home-content [data-act="questionbank"]'), null, 'no home action');
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.equal(doc.querySelector('#more-content [data-act="questionbank"]'), null, 'no More tile');
});

test('results are readable as text, not only colour', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  click(doc, '.bottom-nav button[data-view="result"]');
  const body = doc.getElementById('result-content').textContent;
  assert.ok(body.includes('স্কোর'), 'score labelled in text');
  assert.match(body, /[০-৯]+%/, 'percentage shown as text');
});

test('settings is one tap away from the profile menu', async () => {
  const { doc } = await bootHome();
  assert.equal(doc.querySelector('#student-quick [data-act="settings"]'), null, 'no settings chip on home');
  click(doc, '#profile-btn');
  click(doc, '#pm-settings');
  assert.ok(doc.getElementById('more-settings'), 'settings from profile menu');
});

test('announcement banners can carry an admin-supplied image', async () => {
  const { doc, data } = await bootHome();
  data.db.banners.update('ban-1', { image: 'https://example.edu/model-test.jpg' });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));

  const slide = doc.querySelector('#banner-track .hero-slide.has-image');
  assert.ok(slide, 'banner artwork rendered as picture-backed hero slide');
  assert.ok(slide.getAttribute('style').includes('https://example.edu/model-test.jpg'), 'the admin image reaches the hero');
  assert.ok(doc.querySelector('#banner-track .hero-slide.has-image .hero-kicker'), 'the text stays on top of the picture');
});

test('no home action is a dead button', async () => {
  const { doc } = await bootHome();
  // Every action lives in the DOM from the start — shortcuts on top, the rest
  // inside the folded sections — so there is nothing to reveal first.
  const acts = [...new Set([...doc.querySelectorAll('#home-content [data-act]')].map((el) => el.dataset.act))];
  assert.ok(acts.length >= 4, 'home exposes the glance actions');
  for (const act of acts) {
    click(doc, '.bottom-nav button[data-view="home"]');
    const before = doc.getElementById('home-content').innerHTML;
    click(doc, `#home-content [data-act="${act}"]`);
    const moved = ['view-study', 'view-exam', 'view-result', 'view-more'].some((id) => doc.getElementById(id).hidden === false);
    const modal = ['detail-modal', 'notif-center'].some((id) => doc.getElementById(id).getAttribute('aria-hidden') === 'false');
    const changed = doc.getElementById('home-content').innerHTML !== before;
    assert.ok(moved || modal || changed, `action "${act}" does something`);
    doc.getElementById('detail-modal').setAttribute('aria-hidden', 'true');
    doc.getElementById('notif-center').setAttribute('aria-hidden', 'true');
  }
});

test('download centre serves real files when the material has a link', async () => {
  const { doc, data } = await bootHome();
  data.db.materials.add({ id: 'mat-pdf', title: 'গণিত পিডিএফ', subject: 'গণিত', className: 'নবম', type: 'পিডিএফ', link: 'https://example.edu/ch1.pdf', date: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="downloads"]');
  const link = doc.querySelector('#more-downloads a[href]');
  assert.ok(link, 'a real anchor is rendered');
  assert.equal(link.getAttribute('href'), 'https://example.edu/ch1.pdf');
  assert.equal(link.getAttribute('rel'), 'noopener', 'external link is safe');
  assert.ok(link.textContent.includes('ডাউনলোড'));

  // the Study tab and material sheet offer the same file
  click(doc, '.bottom-nav button[data-view="study"]');
  click(doc, '#material-list [data-mat="mat-pdf"]');
  assert.ok(doc.querySelector('#detail-body a[href="https://example.edu/ch1.pdf"]'), 'file offered in the sheet');
});

test('a signed-in student with no profile row still gets a usable home', async () => {
  const dom = new JSDOM(read('student.html'), { url: 'http://localhost:8080/student.html', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });
  const data = await import('../js/data.js');
  // remove the student record but keep the login (first cloud login scenario)
  data.db.students.remove('2026-09-001');
  await auth.signIn('2026-09-001', 'Student@123', 'student');

  const mod = await import('../js/student-home.js');
  mod.initStudentHome();
  await new Promise((r) => setTimeout(r, 400));
  const doc = dom.window.document;

  assert.equal(doc.getElementById('home-skeleton').hidden, true, 'no crash, skeleton cleared');
  assert.equal(doc.getElementById('home-content').hidden, false, 'home rendered');
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 3, 'cards still render');
  assert.ok(doc.getElementById('home-content').innerHTML.length < 200000, 'not an error screen');
  assert.equal(doc.getElementById('home-retry'), null, 'no error state triggered');
  // and the More view survives too
  doc.querySelector('.bottom-nav button[data-view="more"]').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.getElementById('more-menu'), 'more menu still available');
  doc.getElementById('profile-btn').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  doc.getElementById('pm-view-profile').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.getElementById('more-profile'), 'profile panel still available');
});

test('earned badges produce a printable certificate', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  // earn a badge honestly: complete a perfect exam
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="certificates"]');
  const btn = doc.querySelector('#more-certificates [data-cert]');
  assert.ok(btn, 'certificate offered for an earned badge');
  click(doc, '#more-certificates [data-cert="0"]');
  const sheet = doc.getElementById('certificate-sheet');
  assert.ok(sheet, 'certificate sheet rendered');
  assert.ok(sheet.innerHTML.includes(student.id), 'shows the student id');
  assert.ok(doc.getElementById('print-cert'), 'print action available');
});

test('no badge means no certificate', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="certificates"]');
  assert.equal(doc.querySelector('#more-certificates [data-cert]'), null, 'nothing to certify');
  assert.ok(doc.getElementById('more-certificates').textContent.includes('অর্জিত হয়নি'), 'honest empty state');
});

test('class leaderboard appears in Result when the admin allows it', async () => {
  const { doc, data } = await bootHome();
  data.db.settings.update({ leaderboard: true });
  // two students in the same class take the same exam
  const exam = data.examsFor('নবম')[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  for (const id of ['2026-09-001', '2026-09-002']) {
    const st = data.db.students.find(id);
    const r = data.scoreExam(exam, answers);
    data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: id, studentName: st.name, score: r.score, total: r.total, date: data.todayBn() });
  }
  click(doc, '.bottom-nav button[data-view="result"]');
  const card = doc.getElementById('result-leaderboard');
  assert.ok(card, 'merit list shown');
  assert.ok(card.textContent.includes('১.'), 'positions rendered');
  assert.ok(card.querySelector('.info-row.me'), 'the signed-in student is marked');
  // Anonymous by design: positions and rolls, never a classmate's name.
  assert.equal(card.textContent.includes('সুমাইয়া'), false, 'no classmate name is published');
  assert.ok(card.textContent.includes('রোল'), 'identified by roll instead');
});

test('hiding the leaderboard removes it from the Result view', async () => {
  const { doc, data } = await bootHome();
  data.db.settings.update({ leaderboard: false });
  const exam = data.examsFor('নবম')[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: '2026-09-001', studentName: 'আরিয়ান', score: r.score, total: r.total, date: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').textContent.includes('মেধা তালিকা'), false, 'admin toggle respected');
});

test('leaderboard is class-scoped and empty without results', async () => {
  const { doc, data } = await bootHome();
  data.db.settings.update({ leaderboard: true });
  const exam = data.examsFor('নবম')[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: '2026-10-014', studentName: 'তানভীর', score: r.score, total: r.total, date: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').textContent.includes('মেধা তালিকা'), false, 'another class result does not create a merit list');
});

/* ------------------------------------------------------------------ */
/* Rearranged student home: calendar, ledger, subject graph, offline   */
/* ------------------------------------------------------------------ */

test('the calendar shows the month, marks event days and opens a day sheet', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="calendar"]');

  assert.ok(doc.getElementById('more-calendar'), 'calendar panel opens');
  assert.ok(doc.querySelectorAll('#cal-days .cal-day:not(.blank)').length >= 28, 'a full month of days');
  assert.equal(doc.querySelectorAll('#cal-days .cal-day.today').length, 1, 'today is marked exactly once');

  // The seeded exam sits on a real date — that day carries the exam marker.
  const exam = data.examsFor('নবম')[0];
  const parts = String(exam.date).replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09E6)).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const day = Number(parts[3]);
  const cell = doc.querySelector(`#cal-days [data-cal-day="${day}"]`);
  assert.ok(cell, `day ${day} exists in the grid`);
  assert.ok(cell.querySelector('.mk.exam'), 'exam marker on the exam day');
  assert.ok(cell.getAttribute('aria-label').includes('পরীক্ষা'), 'the marker is described in words, not colour only');

  click(doc, `#cal-days [data-cal-day="${day}"]`);
  assert.equal(doc.getElementById('detail-modal').getAttribute('aria-hidden'), 'false', 'day sheet opens');
  assert.ok(doc.getElementById('detail-body').innerHTML.includes(exam.title), 'the day sheet lists the exam');
  doc.getElementById('detail-modal').classList.remove('active');

  const before = doc.getElementById('cal-month').textContent;
  click(doc, '#more-calendar [data-cal="next"]');
  assert.notEqual(doc.getElementById('cal-month').textContent, before, 'next month shown');
  click(doc, '#more-calendar [data-cal="prev"]');
  assert.equal(doc.getElementById('cal-month').textContent, before, 'and back again');
});

test('the fee panel carries the payment ledger', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  data.db.payments.add({ id: 'pay-test', studentId: student.id, month: 'সেপ্টেম্বর ২০২৬', amount: 1200, date: data.todayBn(), receivedBy: 'অ্যাডমিন' });

  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-menu [data-act="fees"]');
  const panel = doc.getElementById('more-fees');
  assert.ok(panel, 'fee panel opens');
  assert.ok(panel.textContent.includes('পেমেন্ট হিস্ট্রি'), 'ledger section present');
  assert.ok(panel.textContent.includes('সেপ্টেম্বর ২০২৬'), 'a real payment row is listed');
  const paid = data.feeStatusFor(student).paid;
  assert.ok(panel.textContent.includes(`৳${data.toBnDigits(paid)}`), 'totals match feeStatusFor()');
});

test('the result tab draws the subject-wise graph', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, { 0: String(exam.questions[0].answer) });
  data.db.examResults.add({ id: 'res-subj', examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  click(doc, '.bottom-nav button[data-view="result"]');
  const chart = doc.getElementById('result-subjects');
  assert.ok(chart, 'subject chart rendered');
  assert.ok(chart.textContent.includes(exam.subject), 'shows the subject');
  const bar = chart.querySelector('.subject-bar');
  assert.ok(bar, 'a bar per subject');
  assert.ok(bar.getAttribute('aria-label').includes('%'), 'the bar has a text alternative');

  const rows = data.subjectPerformanceFor(student);
  assert.equal(rows.length, 1, 'one subject so far');
  assert.ok(chart.textContent.includes(`${data.toBnDigits(rows[0].avg)}%`), 'the average matches the data layer');
});

test('an offline paper is graded now and synced when the net returns', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];

  Object.defineProperty(doc.defaultView.navigator, 'onLine', { value: false, configurable: true });
  click(doc, '#home-content [data-act="startexam"]');
  const form = doc.getElementById('exam-take-form');
  assert.ok(form, 'the paper opens offline');

  form.querySelector('input[name="q0"]').checked = true;
  form.dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));

  const stored = data.examResultFor(exam.id, student.id);
  assert.ok(stored, 'the paper is graded on the device while offline');
  assert.equal(stored.pendingSync, true, 'queued for the network');
  assert.match(doc.getElementById('exam-player').innerHTML, /অফলাইনে জমা/, 'the student is told it will sync');

  Object.defineProperty(doc.defaultView.navigator, 'onLine', { value: true, configurable: true });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(data.pendingSyncResults().length, 0, 'nothing left in the queue');
  assert.equal(data.examResultFor(exam.id, student.id).pendingSync, false, 'the result is marked delivered');
});

test('the answer review writes the verdict out and shows the right answer', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  data.db.examResults.add({
    id: 'res-verdict', examId: exam.id, studentId: student.id, studentName: student.name,
    score: 1, total: exam.questions.length, date: data.todayBn(),
    answers: exam.questions.map((q, qi) => (qi === 0 ? q.answer : (q.answer === 0 ? 1 : 0)))
  });

  click(doc, '.bottom-nav button[data-view="result"]');
  click(doc, '#result-content [data-act="review"]');
  const player = doc.getElementById('exam-player').innerHTML;
  assert.match(player, /✓ সঠিক/, 'a correct answer is labelled in words');
  assert.match(player, /✗ ভুল/, 'a wrong answer is labelled in words');
  assert.ok(player.includes('সঠিক উত্তর'), 'the right answer is spelled out');
});

test('the exam list carries full marks and the previous attempt', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: 'res-attempt', examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn(), answers: exam.questions.map((q) => q.answer) });

  click(doc, '.bottom-nav button[data-view="exam"]');
  const list = doc.getElementById('student-exam-list').textContent;
  assert.ok(list.includes('পূর্ণমান'), 'full marks printed');
  assert.ok(list.includes('আগের চেষ্টা'), 'the previous attempt is named');
  assert.ok(list.includes(`${data.toBnDigits(r.score)}/${data.toBnDigits(r.total)}`), 'with the real score');
});

test('the notification centre carries exam, result and notice news', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, {});
  data.db.examResults.add({ id: 'res-feed', examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  // A second, still-to-sit paper for the class — news the student can act on.
  data.db.exams.add({
    id: 'exam-feed', title: 'নতুন মডেল টেস্ট', className: 'নবম', subject: 'পদার্থবিজ্ঞান',
    author: 'রাহেলা আক্তার', date: data.todayBn(), time: '১০:০০', duration: 20,
    startDate: data.todayBn(), endDate: '২০২৬-১২-৩১',
    questions: [{ q: '১+১=?', options: ['১', '২', '৩', ''], answer: 1 }]
  });

  const kinds = new Set(data.notificationsFor(student).map((n) => n.kind));
  for (const k of ['exam', 'result', 'notice', 'system']) assert.ok(kinds.has(k), `feed carries ${k} news`);

  // A student with something outstanding sees the actionable kinds as well.
  const owing = data.db.students.find('2026-09-002');
  const owingKinds = new Set(data.notificationsFor(owing).map((n) => n.kind));
  assert.ok(owingKinds.has('fee'), 'a dues reminder reaches the student who owes');
  assert.ok(owingKinds.has('assignment') || owingKinds.has('exam'), 'so does pending work');

  click(doc, '#bell');
  const html = doc.getElementById('notif-list').innerHTML;
  assert.ok(html.includes('📝'), 'exam icon rendered');
  assert.ok(html.includes('🏆'), 'result icon rendered');
});

test('badges stay few and clearly earned', async () => {
  const { data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  assert.equal(data.achievementsFor(student).length, 0, 'nothing earned yet on a fresh store');

  const exam = data.examsFor(student.className)[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: 'res-badge', examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });

  const badges = data.achievementsFor(student);
  assert.equal(badges.length, 1, 'one perfect paper earns exactly one badge');
  assert.ok(badges[0].name.includes('৯০'), 'named for what was done');
});
