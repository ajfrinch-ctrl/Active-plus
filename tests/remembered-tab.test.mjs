/**
 * The other half of "লগিন করলে হোম এ ঢুকবে আগে": coming back to the portal
 * *without* a fresh sign-in (a reload, a bookmark, the installed app) still
 * restores the tab the device was left on. Own file on purpose — the portals
 * read the URL fragment once at page load, so the two cases need separate
 * processes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

test('reopening the portal without a fresh sign-in restores the remembered tab', async () => {
  const dom = await bootPortal('admin.html', {
    url: 'http://localhost:8080/admin.html',
    username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: 'plain',
    beforeBoot: (d) => d.window.localStorage.setItem('activeplus_tab:admin.html', 'reports')
  });
  const doc = dom.window.document;
  try {
    assert.equal(doc.getElementById('tab-reports').hidden, false, 'the remembered tab is respected');
    assert.equal(doc.getElementById('tab-home').hidden, true, 'Home is not forced on a plain page load');
  } finally {
    dom.window.close();
  }
});
