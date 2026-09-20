/**
 * Student App Control — the admin panel's live mirror of the student portal.
 *
 * Covers the three things the feature promises:
 *   1. the preview shows the class's real student app, tab by tab;
 *   2. a switch here changes what the student app renders (no side copy of
 *      the settings), and dead flags are shown disabled rather than fake;
 *   3. publishing from the panel is what hides a material from a student —
 *      which is only true because js/student-home.js honours `published`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

const ADMIN = { username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin' };
const click = (el) => el?.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

test('admin → শিক্ষার্থীর অ্যাপ mirrors the student app and switches it for real', async () => {
  const dom = await bootPortal('admin.html', { ...ADMIN, nonce: 'studentapp' });
  const doc = dom.window.document;
  const data = await import('../js/data.js');

  // The section is registry-driven: one entry adds the nav item, no markup.
  assert.ok(doc.querySelector('#admin-side-nav [data-side-tab="studentapp"]'), 'the sidebar lists the new section');
  const panel = doc.getElementById('tab-studentapp');
  assert.ok(panel, 'the panel exists');
  click(doc.querySelector('#admin-side-nav [data-side-tab="studentapp"]'));
  assert.equal(panel.hidden, false, 'clicking the sidebar item opens the panel');

  /* ---- scope: which class ---- */
  const classSelect = doc.getElementById('sa-class');
  assert.ok(classSelect.querySelector(`option[value="${data.ALL_CLASSES}"]`) || classSelect.options[0].textContent === data.ALL_CLASSES,
    'সব is offered alongside the classes');
  classSelect.value = 'নবম';
  classSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(doc.getElementById('sa-summary').textContent, /নবম/, 'the summary names the chosen class');
  const studentSelect = doc.getElementById('sa-student');
  assert.ok(studentSelect.options.length >= 2, 'and offers that class’s students to preview as');

  /* ---- the phone preview shows real data, not placeholders ---- */
  const screen = doc.getElementById('sa-screen');
  assert.match(screen.textContent, /আসন্ন পরীক্ষা/, 'the home preview paints the exam card');
  assert.match(screen.textContent, /গণিত MCQ মডেল টেস্ট/, 'with the class’s real exam title');
  assert.match(screen.textContent, /পড়া চালিয়ে যান/, 'and the study card');
  assert.match(screen.textContent, /গণিত নোট — অধ্যায় ১/, 'showing the published material');
  assert.match(screen.textContent, /শিক্ষকের টিপ|ব্যানার|💡|📢/, 'hero slides come from banners/tips');

  /* ---- the five student tabs switch the preview ---- */
  const navBtns = [...doc.querySelectorAll('#sa-nav [data-sa-view]')];
  assert.deepEqual(navBtns.map((b) => b.dataset.saView), ['home', 'study', 'exam', 'result', 'more'],
    'the preview carries the student’s own five tabs');
  // Every write repaints the panel, so look elements up again each time.
  const goView = (id) => click(doc.querySelector(`#sa-nav [data-sa-view="${id}"]`));
  goView('study');
  assert.match(doc.getElementById('sa-editor').textContent, /স্টাডি ম্যাটেরিয়াল/, 'the editor follows the tab');
  assert.equal(doc.querySelector('#sa-nav [data-sa-view="study"]').getAttribute('aria-current'), 'page',
    'and the tapped tab is marked current');

  /* ---- a switch here is a switch in the student app ---- */
  // Every write repaints the editor, so elements must be re-queried each time.
  goView('home');
  const q = (sel) => doc.querySelector(sel);
  const flip = (input) => input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const examToggle = q('[data-sa-set="card:exam"]');
  assert.ok(examToggle, 'the exam card exposes a switch');
  examToggle.checked = false;
  flip(examToggle);
  assert.equal(data.homeCards().exam, false, 'the real store was written');
  assert.doesNotMatch(doc.getElementById('sa-screen').textContent, /আসন্ন পরীক্ষা/,
    'and the preview dropped the card at once');
  const repainted = q('[data-sa-set="card:exam"]');
  assert.equal(repainted.checked, false, 'the switch is repainted in its new (off) state, not its old one');
  repainted.checked = true;
  flip(repainted);
  assert.match(doc.getElementById('sa-screen').textContent, /আসন্ন পরীক্ষা/, 'switching it back restores the card');

  /* ---- flags nothing reads are shown, but never faked as working ---- */
  const dead = q('[data-sa-set="card:challenge"]');
  assert.ok(dead, 'the dead flag is still listed — that is how the admin learns about it');
  assert.ok(dead.disabled, 'but it is disabled, because no screen reads it');
  assert.match(dead.closest('.sa-row').textContent, /স্টুডেন্ট অ্যাপ এই সুইচ পড়ে না/, 'and it says so in words');
  assert.ok([...doc.querySelectorAll('#sa-editor [data-sa-set]')].every((input) => input.getAttribute('aria-label')),
    'every switch names itself — the visible words sit beside it, not in its label');

  /* ---- scoring settings that used to be unreachable from the panel ---- */
  const passMark = q('[data-sa-setting="passMark"]');
  assert.ok(passMark, 'the pass mark has a control now');
  passMark.value = '55';
  passMark.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(Number(db_settings().passMark), 55, 'and it saves');
  const passMark2 = q('[data-sa-setting="passMark"]');
  passMark2.value = '900';
  flip(passMark2);
  assert.equal(Number(db_settings().passMark), 55, 'an impossible value is refused');
  assert.match(doc.getElementById('toast-container').textContent, /পাসের নম্বর/, 'with a Bangla error naming the field');

  function db_settings() { return data.db.settings.get(); }

  /* ---- quick publish: add a material from here, for this class ---- */
  goView('study');
  const form = q('#sa-editor form[data-sa-add="materials"]');
  assert.ok(form, 'the study tab offers a material form');
  form.elements.title.value = 'পরীক্ষামূলক নোট';
  form.elements.subject.value = 'গণিত';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const saved = data.db.materials.list().find((m) => m.title === 'পরীক্ষামূলক নোট');
  assert.ok(saved, 'the material was written to the real collection');
  assert.equal(saved.className, 'নবম', 'scoped to the class that is selected');
  assert.equal(saved.published, true, 'and published, because the admin pressed "সংরক্ষণ ও প্রকাশ"');
  assert.match(doc.getElementById('sa-screen').textContent, /পরীক্ষামূলক নোট/, 'it appears in the preview immediately');

  /* ---- and hiding it takes it out of the preview ---- */
  const publishSwitch = [...doc.querySelectorAll('[data-sa-set^="material:published:"]')]
    .find((input) => input.dataset.saSet.endsWith(`:${saved.id}`));
  assert.ok(publishSwitch, 'every material row carries a publish switch');
  publishSwitch.checked = false;
  flip(publishSwitch);
  assert.equal(data.db.materials.find(saved.id).published, false, 'the flag was written');
  assert.doesNotMatch(doc.getElementById('sa-screen').textContent, /পরীক্ষামূলক নোট/,
    'the preview no longer shows it');

  /* ---- the “আরও” menu follows the feature flags ---- */
  goView('more');
  const downloads = q('[data-sa-set="feat:downloads"]');
  assert.ok(downloads.checked, 'ডাউনলোড starts enabled in the seed');
  downloads.checked = false;
  flip(downloads);
  assert.ok(!data.homeFeatures().includes('downloads'), 'the flag was written to settings');
  assert.doesNotMatch(doc.querySelector('#sa-screen .sa-menu').textContent, /ডাউনলোড/,
    'and it left the preview’s menu grid');
  assert.match(doc.getElementById('sa-screen').textContent, /লুকানো: ডাউনলোড/,
    'the preview says what is hidden, rather than just looking shorter');

  /* ---- an empty class must not break the mirror ---- */
  classSelect.value = 'অষ্টম';
  classSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  for (const dropped of data.studentsOfClass('অষ্টম')) data.db.students.remove(dropped.id);
  classSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(doc.getElementById('sa-summary').textContent, /শিক্ষার্থী নেই/,
    'the summary says nobody is in this class');
  assert.ok(doc.getElementById('sa-screen').textContent.length > 0, 'and the preview still paints');
});

test('a student never sees an unpublished material — that is what the panel switch means', async () => {
  const data = await import('../js/data.js');
  const dom = await bootPortal('student.html', {
    username: '2026-09-001', password: 'Student@123', role: 'student', nonce: 'studentdraft',
    beforeBoot: () => {
      data.db.materials.add({ id: 'mat-draft', title: 'খসড়া নোট — দেখার কথা না', subject: 'গণিত', className: 'নবম', type: 'নোট', published: false });
      data.db.materials.add({ id: 'mat-live', title: 'প্রকাশিত নোট — দেখার কথা', subject: 'গণিত', className: 'নবম', type: 'নোট', published: true });
    }
  });
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 500)); // the skeleton hands over on a timer
  // The study view renders when it is opened, like every other student view.
  click(doc.querySelector('.bottom-nav button[data-view="study"]'));
  const study = doc.getElementById('material-list');
  const home = doc.getElementById('home-content')?.textContent || '';
  const text = (study?.textContent || '') + home;
  assert.ok(study, 'the student portal has a study list to check');
  assert.match(study.textContent, /প্রকাশিত নোট — দেখার কথা/, 'published material reaches the student');
  assert.doesNotMatch(text, /খসড়া নোট — দেখার কথা/, 'the draft does not');
  dom.window.close();
});
