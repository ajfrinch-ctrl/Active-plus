/**
 * Two of the requests from the same round as the date format:
 *
 *   ২. "☰ টপ বার থেকে সরান"       — no ☰ button in any top bar
 *   ৩. "লগিন করলে হোম এ ঢুকবে আগে" — a sign-in lands on Home, even when the
 *                                   device remembers another tab
 *
 * (The other half of ৩ — a plain reload still restores the remembered tab —
 * lives in remembered-tab.test.mjs because the portals read the URL fragment
 * once per page load.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bootPortal, read } from './helpers/portal.mjs';

const PAGES = ['index.html', 'student.html', 'teacher.html', 'admin.html'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

/** The text a user can actually read — inline script sources do not count. */
function visibleText(doc) {
  let out = '';
  for (const el of doc.querySelectorAll('body *')) {
    if (SKIP.has(el.tagName)) continue;
    for (const node of el.childNodes) if (node.nodeType === 3) out += node.textContent;
  }
  return out;
}

test('no top bar carries the ☰ button any more', () => {
  for (const page of PAGES) {
    const doc = new JSDOM(read(page)).window.document;
    assert.equal(visibleText(doc).includes('☰'), false, `${page} still shows ☰`);
    assert.equal(doc.getElementById('admin-menu-btn'), null, `${page} still has the ☰ menu button`);
    for (const bar of doc.querySelectorAll('.app-header, .home-header, .topbar')) {
      assert.equal(/☰/.test(bar.innerHTML), false, `${page}: a top bar still contains ☰`);
      assert.equal(bar.querySelector('button[aria-label*="মেনু"]'), null, `${page}: a top bar still has a menu button`);
    }
  }
});

test('the admin top bar keeps the essentials after the ☰ left', () => {
  const doc = new JSDOM(read('admin.html')).window.document;
  const bar = doc.querySelector('.app-header');
  assert.ok(bar.querySelector('#admin-bell'), 'notifications stay in the top bar');
  assert.ok(bar.querySelector('#admin-profile-btn'), 'the profile button stays in the top bar');
});

test('signing in opens Home first, even with a remembered tab', async () => {
  const dom = await bootPortal('admin.html', {
    url: 'http://localhost:8080/admin.html#s=token&home=1',
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'home',
    beforeBoot: (d) => d.window.localStorage.setItem('activeplus_tab:admin.html', 'reports')
  });
  const doc = dom.window.document;
  try {
    assert.equal(doc.getElementById('tab-home').hidden, false, 'Home is the open tab');
    assert.equal(doc.getElementById('tab-reports').hidden, true, 'the remembered tab stayed closed');
  } finally {
    dom.window.close();
  }
});
