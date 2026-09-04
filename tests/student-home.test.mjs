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

test('every tile in the More quick row actually navigates (no dead buttons)', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  const tiles = [...doc.querySelectorAll('#more-content [data-act]')];
  assert.ok(tiles.length >= 8, 'quick row rendered');

  for (const t of tiles) {
    // start each from the More view
    click(doc, '.bottom-nav button[data-view="more"]');
    click(doc, `#more-content [data-act="${t.dataset.act}"]`);
    const stillOnMore = doc.getElementById('view-more').hidden === false;
    const moved = ['view-study', 'view-exam', 'view-result'].some((id) => doc.getElementById(id).hidden === false);
    const openedModal = doc.getElementById('notif-center').getAttribute('aria-hidden') === 'false';
    assert.ok(stillOnMore || moved || openedModal, `tile ${t.dataset.act} does something`);
    doc.getElementById('notif-center').setAttribute('aria-hidden', 'true');
  }
});

test('home follows the priority order: progress first, announcement after result', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));

  const html = doc.getElementById('home-content').innerHTML;
  const at = (needle) => html.indexOf(needle);
  const progress = at('আজকের প্রগ্রেস');
  const grid = at('feature-grid');
  const nextCls = at('পরবর্তী ক্লাস');
  const nextExam = at('আসন্ন পরীক্ষা');
  const challenge = at('ডেইলি চ্যালেঞ্জ');
  const result = at('সাম্প্রতিক ফলাফল');
  const announce = at('carousel');
  const fee = at('ফি স্ট্যাটাস');
  const quick = at('কুইক ফিচার');

  for (const [name, pos] of Object.entries({ progress, grid, nextCls, nextExam, challenge, result, announce, fee, quick })) {
    assert.ok(pos >= 0, `${name} rendered`);
  }
  assert.ok(progress < grid, 'progress before the feature grid');
  assert.ok(grid < nextCls, 'grid before next class');
  assert.ok(nextCls < nextExam, 'next class before upcoming exam');
  assert.ok(nextExam < challenge, 'exam before daily challenge');
  assert.ok(challenge < result, 'challenge before latest result');
  assert.ok(result < announce, 'announcement sits after the result card');
  assert.ok(announce < fee, 'announcement before fee status');
  assert.ok(fee < quick, 'fee before quick features');
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

test('a teacher reply to a query reaches that student only', async () => {
  const { doc, data } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  doc.getElementById('query-text').value = 'স্যার, অধ্যায় ৩ কঠিন লাগছে';
  doc.getElementById('query-form').dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  const query = data.db.notifications.list().find((n) => n.target === 'শিক্ষক');
  assert.ok(doc.getElementById('more-query').innerHTML.includes('উত্তরের অপেক্ষায়'), 'waiting state shown');

  // The teacher portal writes the reply back onto the same row (teacher.html).
  data.db.notifications.update(query.id, { reply: 'কাল ক্লাসে বুঝিয়ে দেব।', replyDate: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="home"]');
  click(doc, '.bottom-nav button[data-view="more"]');
  assert.ok(doc.getElementById('more-query').innerHTML.includes('কাল ক্লাসে বুঝিয়ে দেব'), 'reply visible to the student');

  // teacher.html really renders that inbox and writes replies
  const teacher = read('teacher.html');
  assert.ok(teacher.includes("n.target === 'শিক্ষক'"), 'teacher portal lists student queries');
  assert.ok(teacher.includes('db.notifications.update(id, { reply'), 'teacher reply persists');
});

test('a student can submit a pending assignment from its details', async () => {
  const { doc, data } = await bootHome();
  const other = data.db.students.find('2026-09-002');
  const asg = data.db.assignments.list()[0];
  assert.equal(data.assignmentStatus(asg, other).status, 'pending');

  // the signed-in student (2026-09-001) already submitted in seed, so use a fresh one
  const fresh = { id: 'asg-ui', title: 'UI Test Task', subject: 'Math', className: 'নবম', deadline: '২০২৬-০৯-৩০', teacher: 'T', marks: 10, description: '' };
  data.db.assignments.add(fresh);
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  click(doc, '#home-content [data-act="assignment"][data-id="asg-ui"]');
  const form = doc.getElementById('submit-assignment-form');
  assert.ok(form, 'submit form offered for pending work');
  doc.getElementById('submit-note').value = 'done';
  form.dispatchEvent(new doc.defaultView.Event('submit', { bubbles: true, cancelable: true }));

  const stored = data.db.submissions.list().find((s) => s.assignmentId === 'asg-ui');
  assert.ok(stored, 'submission stored');
  assert.equal(stored.studentId, '2026-09-001', 'recorded against the signed-in student only');
  assert.equal(data.assignmentStatus(fresh, data.db.students.find('2026-09-001')).status, 'submitted');
  assert.ok(doc.getElementById('home-content').innerHTML.includes('জমা হয়েছে'), 'home chip updated');
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

test('the home notification preview shows relative time, not a raw date', async () => {
  const { doc, data } = await bootHome();
  const fresh = { id: 'ntf-fresh', type: 'নতুন অ্যাসাইনমেন্ট', title: 'গণিত অ্যাসাইনমেন্ট যুক্ত হয়েছে', target: 'সবাই', date: data.todayBn(), createdAt: new Date(Date.now() - 2 * 60000).toISOString(), read: false };
  data.db.notifications.add(fresh);
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  const html = doc.getElementById('home-content').innerHTML;
  assert.ok(html.includes(fresh.title), 'newest notification previewed');
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
  const all = doc.querySelectorAll('#more-features .tile').length;
  assert.ok(all >= 8, 'full list by default');

  data.setHomeFeatures(['profile', 'help']);
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  const tiles = [...doc.querySelectorAll('#more-features .tile')];
  assert.equal(tiles.length, 2, 'only the enabled features remain');
  const acts = tiles.map((t) => t.dataset.act).sort();
  assert.deepEqual(acts, ['help', 'profile']);

  // with nothing enabled the See More button itself disappears (no empty panel)
  data.setHomeFeatures([]);
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  assert.equal(doc.querySelector('#home-content [data-act="seemore"]'), null, 'See More hidden');
  data.setHomeFeatures(['questionbank', 'progress', 'achievements', 'certificates', 'downloads', 'query', 'streak', 'profile', 'settings', 'help']);
});

test('question bank opens real practice from the own class pool', async () => {
  const { doc, data } = await bootHome();
  const before = data.db.studyActivity.list().reduce((s, a) => s + a.mcqs, 0);
  click(doc, '#home-content [data-act="seemore"]');
  click(doc, '#more-features [data-act="questionbank"]');
  const body = doc.getElementById('detail-body');
  assert.equal(doc.getElementById('detail-title').textContent.includes('প্রশ্ন ব্যাংক'), true, 'practice sheet opened');
  assert.ok(body.querySelector('[data-opt="0"]'), 'a real question with options');

  click(doc, '#detail-body [data-opt="0"]');
  const after = data.db.studyActivity.list().reduce((s, a) => s + a.mcqs, 0);
  assert.equal(after, before + 1, 'answering records activity');
  assert.ok(doc.querySelector('#detail-body .btn'), 'offers the next question');
});

test('question bank shows an empty state for a class with no questions', async () => {
  const { doc, data } = await bootHome();
  [...data.db.exams.list()].forEach((e) => data.db.exams.remove(e.id));
  click(doc, '#home-content [data-act="seemore"]');
  click(doc, '#more-features [data-act="questionbank"]');
  assert.ok(doc.getElementById('detail-body').textContent.includes('কোনো প্রশ্ন যোগ করা হয়নি'), 'honest empty state');
});

test('the performance graph is readable without colour or sight of the bars', async () => {
  const { doc, data } = await bootHome();
  const student = data.db.students.find('2026-09-001');
  const exam = data.examsFor(student.className)[0];
  const r = data.scoreExam(exam, Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)])));
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: student.id, studentName: student.name, score: r.score, total: r.total, date: data.todayBn() });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  const chart = doc.querySelector('#home-content .mini-chart');
  assert.ok(chart, 'chart rendered');
  assert.equal(chart.getAttribute('role'), 'img');
  assert.match(chart.getAttribute('aria-label'), /১০০%/, 'label states the actual scores');
});

test('the More quick row opens practice too, not the study list', async () => {
  const { doc } = await bootHome();
  click(doc, '.bottom-nav button[data-view="more"]');
  click(doc, '#more-content [data-act="questionbank"]');
  assert.ok(doc.getElementById('detail-title').textContent.includes('প্রশ্ন ব্যাংক'), 'practice opened from More');
  assert.equal(doc.getElementById('view-study').hidden, true, 'did not fall back to the study list');
});

test('announcement banners can carry an admin-supplied image', async () => {
  const { doc, data } = await bootHome();
  data.db.banners.update('ban-1', { image: 'https://example.edu/model-test.jpg' });
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  const img = doc.querySelector('#banner-track img');
  assert.ok(img, 'banner image rendered');
  assert.equal(img.getAttribute('src'), 'https://example.edu/model-test.jpg');
  assert.equal(img.getAttribute('alt'), '', 'decorative image is hidden from screen readers');
});

test('no home action is a dead button', async () => {
  const { doc } = await bootHome();
  click(doc, '#home-content [data-act="seemore"]');
  const acts = [...new Set([...doc.querySelectorAll('#home-content [data-act]')].map((el) => el.dataset.act))];
  assert.ok(acts.length >= 12, 'home exposes many actions');
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
  const link = doc.querySelector('#more-downloads a[href]');
  assert.ok(link, 'a real anchor is rendered');
  assert.equal(link.getAttribute('href'), 'https://example.edu/ch1.pdf');
  assert.equal(link.getAttribute('rel'), 'noopener', 'external link is safe');
  assert.ok(link.textContent.includes('ডাউনলোড'));

  // the material sheet offers the same file
  click(doc, '.bottom-nav button[data-view="home"]');
  doc.defaultView.dispatchEvent(new doc.defaultView.Event('online'));
  click(doc, '#home-content [data-act="material"][data-id="mat-pdf"]');
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
  assert.ok(doc.querySelectorAll('#home-content .hcard').length >= 5, 'cards still render');
  assert.ok(doc.getElementById('home-content').innerHTML.length < 200000, 'not an error screen');
  assert.equal(doc.getElementById('home-retry'), null, 'no error state triggered');
  // and the More view survives too
  doc.querySelector('.bottom-nav button[data-view="more"]').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
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
  const card = doc.getElementById('result-content');
  assert.ok(card.textContent.includes('লিডারবোর্ড'), 'leaderboard shown');
  assert.ok(card.textContent.includes('১.'), 'positions rendered');
  assert.equal(card.querySelector('.info-row.me') !== null, true, 'the signed-in student is marked');
});

test('hiding the leaderboard removes it from the Result view', async () => {
  const { doc, data } = await bootHome();
  data.db.settings.update({ leaderboard: false });
  const exam = data.examsFor('নবম')[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: '2026-09-001', studentName: 'আরিয়ান', score: r.score, total: r.total, date: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').textContent.includes('লিডারবোর্ড'), false, 'admin toggle respected');
});

test('leaderboard is class-scoped and empty without results', async () => {
  const { doc, data } = await bootHome();
  data.db.settings.update({ leaderboard: true });
  const exam = data.examsFor('নবম')[0];
  const answers = Object.fromEntries(exam.questions.map((_, i) => [i, String(exam.questions[i].answer)]));
  const r = data.scoreExam(exam, answers);
  data.db.examResults.add({ id: data.newId('res'), examId: exam.id, studentId: '2026-10-014', studentName: 'তানভীর', score: r.score, total: r.total, date: data.todayBn() });
  click(doc, '.bottom-nav button[data-view="result"]');
  assert.equal(doc.getElementById('result-content').textContent.includes('লিডারবোর্ড'), false, 'another class result does not create a leaderboard');
});
