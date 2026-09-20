/**
 * Phone navigation — can every admin section actually be reached?
 *
 * The grouped sidebar is the comfortable way around the panel, but CSS hides it
 * below 1024px (css/admin-panel.css), and this is a mobile-first PWA: on a
 * phone the bottom navigation plus the dashboard rendered by js/admin-home.js
 * are the *only* menu. A section that exists in js/admin/registry.js but has no
 * tile there is desktop-only in practice — which is exactly how Student App
 * Control (শিক্ষার্থীর অ্যাপ) went missing for its owner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

const ADMIN = { username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin' };
const click = (el) => el?.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));

test('শিক্ষার্থীর অ্যাপ is one tap away on a phone, not only in the desktop sidebar', async () => {
  const dom = await bootPortal('admin.html', { ...ADMIN, nonce: 'navapp' });
  const doc = dom.window.document;

  // The sidebar entry is the desktop route — keep it, but it is not enough.
  assert.ok(doc.querySelector('#admin-side-nav [data-side-tab="studentapp"]'), 'the desktop sidebar lists it');

  // The dashboard quick action: the first row a phone shows.
  const quick = doc.querySelector('#admin-quick [data-act="studentapp"]');
  assert.ok(quick, 'the dashboard offers a শিক্ষার্থীর অ্যাপ quick action');
  assert.match(quick.textContent, /শিক্ষার্থীর অ্যাপ/, 'labelled in Bangla');

  // …and the feature grid under সব ফিচার → ম্যানেজমেন্ট.
  assert.ok(doc.querySelector('#admin-home .feature-grid [data-goto="studentapp"]'),
    'সব ফিচার lists it as a tile too');

  // Tapping the quick action opens the panel — the phone has no other way in.
  const panel = doc.getElementById('tab-studentapp');
  assert.equal(panel.hidden, true, 'the panel starts closed');
  click(quick);
  assert.equal(panel.hidden, false, 'the quick action opens Student App Control');
  assert.match(doc.getElementById('sa-summary').textContent, /\S/, 'and the panel is alive');

  // Tapping home, then the tile, must work as well.
  click(doc.querySelector('.bottom-nav button[data-tab="home"]'));
  assert.equal(doc.getElementById('tab-home').hidden, false, 'back on the dashboard');
  click(doc.querySelector('#admin-home .feature-grid [data-goto="studentapp"]'));
  assert.equal(panel.hidden, false, 'the feature tile opens the same panel');

  // And the global search finds it under the names people actually type —
  // including a whole phrase in a different script from the label.
  const input = doc.getElementById('admin-global-search');
  const results = doc.getElementById('admin-search-results');
  for (const query of ['স্টুডেন্ট এপ ম্যানেজমেন্ট', 'স্টুডেন্ট এপ', 'স্টুডেন্ট অ্যাপ', 'student app management']) {
    input.value = query;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.ok(results.querySelector('[data-goto="studentapp"]'), `search “${query}” finds the section`);
  }
});

test('every admin section has a route a phone can take', async () => {
  const dom = await bootPortal('admin.html', { ...ADMIN, nonce: 'navall' });
  const doc = dom.window.document;
  const { visibleSections } = await import('../js/admin/registry.js');

  // Three sections have their own dedicated entry point instead of a tile:
  //   home     — the screen the tiles sit on,
  //   overview — its card is printed on the dashboard itself,
  //   profile  — the 👤 menu in the top bar.
  const OWN_ENTRY = {
    home: () => doc.getElementById('admin-home'),
    overview: () => doc.getElementById('admin-overview'),
    profile: () => doc.getElementById('pm-view-profile')
  };

  const phoneRoutes = new Set([
    ...[...doc.querySelectorAll('#admin-home [data-goto]')].map((el) => el.dataset.goto),
    ...[...doc.querySelectorAll('.bottom-nav button[data-tab]')].map((el) => el.dataset.tab)
  ]);

  const unreachable = visibleSections('admin')
    .filter((s) => !phoneRoutes.has(s.key) && !OWN_ENTRY[s.key]?.())
    .map((s) => `${s.key} (${s.label})`);

  assert.deepEqual(unreachable, [], `no section is desktop-only: ${unreachable.join(', ')}`);

  // Every route the phone offers must land on a real panel, too.
  for (const key of phoneRoutes) {
    if (key === 'more') continue; // folds the extra-features list open instead
    assert.ok(doc.getElementById(`tab-${key}`), `route “${key}” has a panel`);
  }
});
