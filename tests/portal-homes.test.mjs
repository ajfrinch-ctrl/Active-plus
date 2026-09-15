/**
 * Error handling on the teacher and admin homes (spec 60): a render failure
 * must show a friendly message with Retry, never a blank panel and never the
 * technical error text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { _clearMemoryStore } from '../js/store.js';
import { db } from '../js/data.js';
import { initAdminHome } from '../js/admin-home.js';
import { initTeacherHome } from '../js/teacher-home.js';

function makeDoc(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost:8080/', pretendToBeVisual: true
  });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.FormData = dom.window.FormData;
  return dom;
}

/** Temporarily make the student collection explode, like a failed data read. */
function breakStudents() {
  const original = db.students;
  db.students = { list() { throw new Error('simulated database failure'); }, find: () => null };
  return () => { db.students = original; };
}

test('admin home shows a retry card when rendering fails', () => {
  const dom = makeDoc('<div id="admin-home"></div>');
  _clearMemoryStore();
  const restore = breakStudents();
  try {
    const home = initAdminHome({ session: { role: 'admin', name: 'অ্যাডমিন' }, tabs: { activate() {} } });
    const host = dom.window.document.getElementById('admin-home');
    assert.match(host.textContent, /দুঃখিত/, 'friendly message shown');
    assert.match(host.textContent, /আবার চেষ্টা করুন/, 'retry offered');
    assert.equal(/simulated database failure|TypeError|at /.test(host.textContent), false,
      'technical error is not leaked to the user');

    // once the data is healthy again, Retry recovers the dashboard
    restore();
    host.querySelector('[data-retry-home]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(dom.window.document.querySelector('.analytics-grid'), 'dashboard recovered after retry');
    assert.ok(home, 'module returned its controller');
  } finally { restore(); }
});

test('teacher home shows a retry card when rendering fails', () => {
  const dom = makeDoc('<div id="teacher-home"></div>');
  _clearMemoryStore();
  const restore = breakStudents();
  try {
    initTeacherHome({ session: { role: 'teacher', name: 'রাহেলা আক্তার' }, tabs: { activate() {} } });
    const host = dom.window.document.getElementById('teacher-home');
    assert.match(host.textContent, /দুঃখিত/, 'friendly message shown');
    assert.ok(host.querySelector('[data-retry-home]'), 'retry button rendered');

    restore();
    host.querySelector('[data-retry-home]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.ok(dom.window.document.getElementById('teaching-hero'), 'dashboard recovered after retry');
  } finally { restore(); }
});

test('a healthy render does not show the error card', () => {
  const dom = makeDoc('<div id="admin-home"></div><div id="teacher-home"></div>');
  _clearMemoryStore();
  initAdminHome({ session: { role: 'admin', name: 'অ্যাডমিন' }, tabs: { activate() {} } });
  initTeacherHome({ session: { role: 'teacher', name: 'রাহেলা আক্তার' }, tabs: { activate() {} } });
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-retry-home]'), null, 'no error card when data is fine');
  assert.ok(doc.querySelector('.analytics-grid'), 'admin analytics dashboard rendered');
  assert.ok(doc.getElementById('teaching-hero'), 'teacher hero rendered');
});
