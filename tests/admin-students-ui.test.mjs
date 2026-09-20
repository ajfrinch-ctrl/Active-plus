/**
 * Admin → শিক্ষার্থী (Students) list UI.
 *
 * The refresh moved the two action buttons out of the <h2> into a panel head
 * with a live count, added a sort control and an in-field clear button,
 * debounced the search, and replaced the four full-text row buttons with icon
 * buttons. What must stay intact is the wiring those buttons carry: the
 * `data-edit-student` / `data-delete-student` / `data-profile-student` /
 * `data-wa-student` hooks, `#student-search`, `#class-filter` and `#student-table`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('admin students list: panel head, filters, sort and compact row actions', async () => {
  const dom = await bootPortal('admin.html', {
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'studentsui'
  });
  const doc = dom.window.document;
  const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  const rows = () => [...doc.querySelectorAll('#student-table tbody tr')];
  const namesInTable = () => rows().map((tr) => tr.querySelector('.cell-student-name')?.textContent?.trim());

  /* ---- Heading is a heading again: the buttons sit beside it, not in it ---- */
  const title = doc.querySelector('#tab-students .panel-head .section-title');
  assert.ok(title, 'the students panel has a section title');
  assert.ok(!/নতুন ভর্তি|সিএসভি/.test(title.textContent), 'the heading no longer contains the buttons');
  assert.ok(doc.querySelector('#tab-students .panel-actions #open-student-modal'), 'new-admission button is in the panel head');
  assert.ok(doc.querySelector('#tab-students .panel-actions #students-csv'), 'CSV button is in the panel head');
  assert.ok(doc.getElementById('student-summary'), 'the count line exists for the live region');

  /* ---- Rows read as students, not as raw strings ---- */
  assert.equal(namesInTable().length, 4, 'all four seeded students render');
  const first = rows()[0];
  assert.ok(first.querySelector('.cell-avatar')?.textContent.trim(), 'every row shows an initial avatar');
  const avatars = () => rows().map((tr) => tr.querySelector('.cell-avatar')?.textContent.trim());
  assert.ok(avatars().includes('সু'), 'a name opening with a matra keeps the whole grapheme, not just "স"');
  assert.ok(first.querySelector('.cell-id')?.textContent.includes('2026'), 'the id prints in its own chip');
  assert.ok(first.querySelector('.badge.accent'), 'the class prints as a badge');
  assert.ok(first.querySelector('.cell-student-sub')?.textContent.includes('রোল'),
    'the roll shows under the name');

  /* ---- A phone number is dialable, and Bengali digits become a real href ---- */
  const tel = doc.querySelector('#student-table a.cell-tel');
  assert.ok(tel, 'the phone renders as a tel: link');
  assert.equal(tel.getAttribute('href'), 'tel:01711000001', 'Bengali digits are converted for the href');
  assert.ok(tel.textContent.includes('০১৭১১'), 'the label keeps the Bengali digits the admin expects');

  /* ---- The row actions are icon buttons that still carry their hooks ---- */
  const actions = first.querySelectorAll('.row-actions button');
  assert.equal(actions.length, 4, 'profile, whatsapp, edit and delete are still there');
  for (const hook of ['data-profile-student', 'data-wa-student', 'data-edit-student', 'data-delete-student']) {
    assert.ok(first.querySelector(`[${hook}]`), `${hook} survived the markup change`);
  }
  assert.ok([...actions].every((b) => b.getAttribute('aria-label') && b.title),
    'every icon button is labelled and titled');
  assert.ok(!first.querySelector('.row-actions .btn-small'), 'no full-text buttons left in the row');

  /* ---- Live count follows the list, and the empty span is never destroyed ---- */
  assert.ok(doc.getElementById('student-summary').textContent.trim().startsWith('৪'),
    'the count line reports four students');
  assert.ok(doc.getElementById('student-count'), 'the #student-count span still exists');

  /* ---- Search filters after a short pause instead of per keystroke ---- */
  const search = doc.getElementById('student-search');
  search.value = 'নাফিস';
  fire(search, 'input');
  assert.equal(doc.getElementById('student-search-clear').hidden, false,
    'the clear button appears once there is text to clear');
  await sleep(250);
  assert.deepEqual(namesInTable(), ['নাফিস ইকবাল'], 'searching isolates the matching student');
  assert.match(doc.getElementById('student-summary').textContent, /মিলেছে/,
    'the count line says how many matched');

  /* ---- Clearing restores the whole list ---- */
  doc.getElementById('student-search-clear').click();
  assert.equal(search.value, '', 'the clear button empties the search box');
  assert.ok(doc.getElementById('student-search-clear').hidden, 'and hides itself again');
  assert.equal(rows().length, 4, 'clearing brings all four rows back');

  /* ---- Sorting reorders the same rows ---- */
  const sort = doc.getElementById('student-sort');
  assert.ok(sort, 'the list has a sort control');
  sort.value = 'id';
  fire(sort, 'change');
  const ids = () => rows().map((tr) => tr.querySelector('.cell-id')?.textContent.trim());
  assert.deepEqual(ids(), ['2026-08-007', '2026-09-001', '2026-09-002', '2026-10-014'],
    'sorting by id is ascending and uses natural ids');
  sort.value = 'newest';
  fire(sort, 'change');
  assert.equal(namesInTable()[0], 'তাসনিম জাহান', 'newest admission sorts to the top');
  sort.value = 'name';
  fire(sort, 'change');
  assert.equal(namesInTable()[0], 'আরিয়ান হাসান', 'the name sort starts from the first letter');

  /* ---- The class filter still narrows the list and is named in the count ---- */
  const classFilter = doc.getElementById('class-filter');
  classFilter.value = 'নবম';
  fire(classFilter, 'change');
  assert.deepEqual(namesInTable().sort(), ['আরিয়ান হাসান', 'সুমাইয়া ইসলাম'],
    'the class filter keeps only নবম students');
  assert.match(doc.getElementById('student-summary').textContent, /নবম/, 'the count line names the class');

  /* ---- An empty result explains itself instead of showing a bare table ---- */
  search.value = 'অ exist না এমন নাম';
  fire(search, 'input');
  await sleep(250);
  assert.match(doc.querySelector('#student-table tbody').textContent, /ফিল্টারে কোনো শিক্ষার্থী নেই/,
    'no matches explains the filter rather than looking broken');

});
