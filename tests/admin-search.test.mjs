/**
 * Admin global search — results must remain readable on a phone and useful
 * after selection, rather than collapsing into the narrow header slot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal, read } from './helpers/portal.mjs';

const ADMIN = {
  username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'globalsearch'
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('global search renders responsive, keyboard-friendly grouped results and reveals a selected student', async () => {
  const dom = await bootPortal('admin.html', ADMIN);
  const doc = dom.window.document;
  const input = doc.getElementById('admin-global-search');
  const results = doc.getElementById('admin-search-results');
  const root = input.closest('.admin-search');
  const fireInput = (value) => {
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const key = (target, value) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true
  }));

  input.focus();
  assert.ok(root.classList.contains('is-active'), 'focus enters the expanded search mode');
  assert.equal(input.getAttribute('role'), 'combobox', 'the input exposes combobox semantics');
  assert.equal(input.getAttribute('aria-controls'), results.id, 'the combobox owns the result list');

  // Words may live in separate fields (name + class), but still form one query.
  fireInput('আরিয়ান নবম');
  const ariyan = results.querySelector('[data-student="2026-09-001"]');
  assert.ok(ariyan, 'a multi-field query finds the student');
  assert.equal(ariyan.getAttribute('role'), 'option', 'each selectable result is a listbox option');
  assert.ok(ariyan.querySelector('.gs-copy .gs-main'), 'name sits in a dedicated, truncatable copy column');
  assert.ok(ariyan.querySelector('.gs-copy .gs-sub'), 'metadata sits on its own second line');
  assert.ok(ariyan.querySelector('.gs-mark'), 'matching text is highlighted for quick scanning');
  assert.match(results.querySelector('.gs-summary').textContent, /১টি ফলাফল/, 'a visible result count is shown');
  assert.match(doc.getElementById('admin-search-status').textContent, /১টি ফলাফল/, 'screen readers receive the count too');
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.getElementById('admin-search-clear').hidden, false, 'typed text has a clear affordance');

  // Punctuation and Bengali/English digits should not make phone/ID search fail.
  fireInput('01711000001');
  assert.ok(results.querySelector('[data-student="2026-09-001"]'),
    'an unformatted ASCII phone finds the formatted Bengali phone');

  // Arrow navigation keeps working after focus has moved out of the input.
  fireInput('নবম');
  input.focus();
  key(input, 'ArrowDown');
  const firstFocused = doc.activeElement;
  assert.ok(firstFocused.classList.contains('gs-item'), 'ArrowDown enters the result list');
  key(firstFocused, 'ArrowDown');
  assert.notEqual(doc.activeElement, firstFocused, 'ArrowDown continues between result buttons');
  key(doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, firstFocused, 'ArrowUp returns to the previous result');

  // The empty state explains what happened and can reset the query in one tap.
  fireInput('এমন-কিছু-নেই-৯৯৯');
  assert.match(results.querySelector('.gs-empty').textContent, /কোনো ফল পাওয়া যায়নি/);
  results.querySelector('[data-clear-search]').click();
  assert.equal(input.value, '', 'the empty-state action clears the field');
  assert.equal(results.hidden, true, 'clearing also closes stale results');

  // A stale class filter used to make a valid global result open an empty list.
  const classFilter = doc.getElementById('class-filter');
  classFilter.value = 'দশম';
  classFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  fireInput('আরিয়ান');
  results.querySelector('[data-student="2026-09-001"]').click();
  await sleep(320); // the student list intentionally debounces local filtering

  assert.equal(doc.getElementById('tab-students').hidden, false, 'selection opens Students');
  assert.equal(classFilter.value, 'সব', 'selection clears an incompatible class filter');
  assert.equal(doc.getElementById('student-search').value, '2026-09-001', 'the unique id isolates the record');
  const rows = [...doc.querySelectorAll('#student-table tbody tr')];
  assert.equal(rows.length, 1, 'only the selected student remains in view');
  assert.ok(rows[0].classList.contains('row-flash'), 'the selected row is visually called out');
  assert.equal(input.value, '', 'the global field resets after navigation');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('compact search CSS expands results to the viewport instead of the narrow header slot', () => {
  const css = read('css/admin-panel.css');
  assert.match(css, /\.gs-item\s*\{[\s\S]*?grid-template-columns:\s*2\.25rem minmax\(0, 1fr\) 1\.25rem/,
    'result rows reserve a flexible copy column');
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.admin-search\.is-active\s*\{[\s\S]*?position:\s*fixed/,
    'compact search escapes the cramped header width');
  assert.match(css, /\.admin-search\.is-active \.admin-search-results\s*\{[\s\S]*?left:\s*0;[\s\S]*?right:\s*0/,
    'the dropdown spans the expanded search surface');
});
