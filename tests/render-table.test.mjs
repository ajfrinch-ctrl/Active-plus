/**
 * Lazy table pagination (spec 62): large datasets render one page at a time so
 * the phone does not build thousands of rows at once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTable } from '../js/app.js';

function makeDoc(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost:8080/', pretendToBeVisual: true
  });
  dom.window.scrollTo = () => {};
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  return dom;
}

test('a long table renders one page and appends on demand', () => {
  const dom = makeDoc('<table id="t"><thead><tr></tr></thead><tbody></tbody></table>');
  const rows = Array.from({ length: 60 }, (_, i) => ({ name: `student-${i}` }));
  renderTable('#t', [{ key: 'name', label: 'নাম' }], rows, 'নেই', { pageSize: 10 });

  const body = dom.window.document.querySelector('#t tbody');
  let dataRows = body.querySelectorAll('tr:not(:last-child)').length;
  assert.equal(dataRows, 10, 'only the first page is in the DOM');
  const more = body.querySelector('[data-load-more]');
  assert.ok(more, 'a load-more control is offered');
  assert.match(more.textContent, /৫০ বাকি/, 'remaining count shown in Bengali digits');

  more.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  dataRows = body.querySelectorAll('tr:not(:last-child)').length;
  assert.equal(dataRows, 20, 'the next page was appended');

  // click through to the end
  for (let i = 0; i < 5; i += 1) {
    body.querySelector('[data-load-more]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  }
  assert.equal(body.querySelectorAll('tr').length, 60, 'all rows loaded');
  assert.equal(body.querySelector('[data-load-more]'), null, 'no load-more once complete');
});

test('a short table renders fully with no load-more control', () => {
  const dom = makeDoc('<table id="t"><thead><tr></tr></thead><tbody></tbody></table>');
  renderTable('#t', [{ key: 'name', label: 'নাম' }], [{ name: 'a' }, { name: 'b' }], 'নেই');
  const body = dom.window.document.querySelector('#t tbody');
  assert.equal(body.querySelectorAll('tr').length, 2);
  assert.equal(body.querySelector('[data-load-more]'), null);
});

test('an empty table still shows the empty state', () => {
  const dom = makeDoc('<table id="t"><thead><tr></tr></thead><tbody></tbody></table>');
  renderTable('#t', [{ key: 'name', label: 'নাম' }], [], 'কোনো তথ্য নেই।');
  assert.match(dom.window.document.querySelector('#t tbody').textContent, /কোনো তথ্য নেই/);
});

test('re-rendering a table resets to the first page', () => {
  const dom = makeDoc('<table id="t"><thead><tr></tr></thead><tbody></tbody></table>');
  const rows = Array.from({ length: 40 }, (_, i) => ({ name: `s${i}` }));
  const body = dom.window.document.querySelector('#t tbody');

  renderTable('#t', [{ key: 'name', label: 'নাম' }], rows, 'নেই', { pageSize: 10 });
  body.querySelector('[data-load-more]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(body.querySelectorAll('tr:not(:last-child)').length, 20);

  renderTable('#t', [{ key: 'name', label: 'নাম' }], rows, 'নেই', { pageSize: 10 });
  assert.equal(body.querySelectorAll('tr:not(:last-child)').length, 10,
    'a fresh render starts from page one');
});
