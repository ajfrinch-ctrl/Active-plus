/**
 * Installable-PWA audit: the manifest, the service worker and every page
 * must keep meeting Chrome's installability criteria (Android + Desktop),
 * so "Install App / Add to Home Screen" keeps working.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = ['index.html', 'student.html', 'teacher.html', 'admin.html'];

/** PNG dimensions without any dependency: signature + IHDR width/height. */
function pngSize(relativePath) {
  const buf = readFileSync(path.join(ROOT, relativePath));
  assert.equal(
    buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
    `${relativePath} is a real PNG`
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const manifest = JSON.parse(read('manifest.json'));

test('manifest carries the identity Chrome installs (name, urls, display, colors)', () => {
  assert.ok(manifest.name && manifest.name.length > 0, 'name present');
  assert.ok(manifest.short_name && manifest.short_name.length > 0, 'short_name present');
  assert.ok(manifest.start_url, 'start_url present');
  assert.ok(manifest.scope, 'scope present');
  assert.ok(manifest.id, 'explicit id present');
  assert.equal(manifest.display, 'standalone', 'installed app hides the browser chrome');
  assert.match(manifest.theme_color || '', /^#[0-9a-fA-F]{6}$/, 'theme_color is a hex color');
  assert.match(manifest.background_color || '', /^#[0-9a-fA-F]{6}$/, 'background_color paints the splash screen');

  // The start page must exist inside the scope, so first launch works offline.
  const start = manifest.start_url.replace(/^\.\//, '').split('?')[0];
  assert.ok(existsSync(path.join(ROOT, start)), `start_url page exists: ${start}`);
});

test('manifest icons meet the installable sizes and match their files', () => {
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'icons listed');
  const maxSize = (sizes) => Math.max(...String(sizes).split(' ').map((s) => parseInt(s, 10) || 0));
  const anyIcons = manifest.icons.filter((i) => String(i.purpose || 'any').includes('any'));
  assert.ok(anyIcons.some((i) => maxSize(i.sizes) >= 192), 'an "any" icon of 192px+');
  assert.ok(anyIcons.some((i) => maxSize(i.sizes) >= 512), 'an "any" icon of 512px+ (splash/install UI)');
  assert.ok(
    manifest.icons.some((i) => String(i.purpose || '').includes('maskable') && maxSize(i.sizes) >= 512),
    'a 512px+ maskable icon (adaptive launcher icons)'
  );
  for (const icon of manifest.icons) {
    const file = String(icon.src).replace(/^\.\//, '');
    assert.ok(existsSync(path.join(ROOT, file)), `icon file exists: ${file}`);
    const { width, height } = pngSize(file);
    const declared = maxSize(icon.sizes);
    assert.equal(width, declared, `${file} width matches "sizes"`);
    assert.equal(height, declared, `${file} height matches "sizes"`);
    assert.ok(width === height, `${file} is square`);
  }
});

test('manifest shortcuts deep-link to real portals with real icons', () => {
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0, 'shortcuts listed');
  const urls = manifest.shortcuts.map((s) => String(s.url).replace(/^\.\//, ''));
  assert.ok(urls.includes('admin.html'), 'an Admin Panel shortcut exists');
  for (const shortcut of manifest.shortcuts) {
    assert.ok(shortcut.name, 'shortcut has a name');
    const page = String(shortcut.url).replace(/^\.\//, '').split('?')[0];
    assert.ok(PAGES.includes(page), `shortcut "${shortcut.name}" lands on a real page`);
    for (const icon of shortcut.icons || []) {
      const file = String(icon.src).replace(/^\.\//, '');
      assert.ok(existsSync(path.join(ROOT, file)), `shortcut icon exists: ${file}`);
      const { width } = pngSize(file);
      assert.ok(width >= 96, `shortcut icon is 96px+: ${file}`);
    }
  }
});

test('every page links the manifest and declares the installed-app metadata', () => {
  for (const page of PAGES) {
    const dom = new JSDOM(read(page));
    const { document } = dom.window;
    assert.ok(document.querySelector('link[rel="manifest"]'), `${page} links the manifest`);
    const theme = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '';
    assert.match(theme, /^#[0-9a-fA-F]{6}$/, `${page} sets theme-color`);
    assert.ok(
      document.querySelector('meta[name="mobile-web-app-capable"]'),
      `${page} opts into installed display mode`
    );
    assert.ok(
      document.querySelector('link[rel="apple-touch-icon"]'),
      `${page} offers a home-screen icon`
    );
  }
});

test('service worker precaches the installed shell (start page, manifest, icons)', () => {
  const sw = read('service-worker.js');
  assert.ok(/addEventListener\(['"]install['"]/.test(sw), 'caches on install');
  assert.ok(/addEventListener\(['"]fetch['"]/.test(sw), 'a fetch handler serves the app');
  const precached = new Set([...sw.matchAll(/'([^']+\.(?:html|css|js|json|png))'/g)].map((m) => m[1]));
  assert.ok(precached.has('index.html'), 'start_url is precached');
  assert.ok(precached.has('manifest.json'), 'manifest is precached');
  for (const icon of manifest.icons) {
    assert.ok(precached.has(String(icon.src)), `icon precached: ${icon.src}`);
  }
  for (const page of PAGES) {
    assert.ok(precached.has(page), `portal precached: ${page}`);
  }
});

test('every page registers the service worker', () => {
  // The login page (start_url) registers directly; the portals reach
  // initApp() in js/app.js through their own modules (one hop).
  const app = read('js/app.js');
  assert.ok(/export function registerServiceWorker/.test(app), 'app.js exports the registrar');
  assert.ok(/function initApp[\s\S]*?registerServiceWorker\(\)/.test(app), 'initApp registers the worker');
  for (const page of PAGES) {
    const html = read(page);
    if (html.includes('service-worker')) continue; // direct registration
    const modules = [...html.matchAll(/from\s*['"]\.\/js\/([^'"]+)['"]/g)].map((m) => `js/${m[1]}`);
    assert.ok(modules.length > 0, `${page} imports app modules`);
    // Follow one more hop: Admin Panel v2 moved the page boot behind a page
    // module (admin.html → js/admin-modules.js → js/admin/boot.js), so the
    // worker registration may sit two imports away from the HTML.
    const graph = [...modules];
    for (const mod of modules) {
      for (const m of read(mod).matchAll(/from\s*['"]\.\/((?:admin\/)?[^'"]+)['"]/g)) {
        graph.push(`js/${m[1]}`);
      }
    }
    const reachesInitApp = graph.some((mod) => {
      try { return read(mod).includes('initApp('); } catch { return false; }
    });
    assert.ok(reachesInitApp, `${page} reaches initApp(), which registers the worker`);
  }
});

test('install helper exposes the in-app install flow and stays inert in tests', async () => {
  const source = read('js/install.js');
  for (const name of ['initInstall', 'promptInstall', 'isStandalone', 'isInstallAvailable', 'mountInstallButton']) {
    assert.ok(new RegExp(`export (async )?function ${name}\\b`).test(source), `install.js exports ${name}`);
  }
  // Importing must not touch the DOM or throw outside a browser.
  const install = await import('../js/install.js');
  assert.equal(install.isStandalone(), false, 'not standalone in Node');
  assert.equal(install.isInstallAvailable(), false, 'no prompt in Node');
  assert.equal(install.initInstall(), false, 'init is a no-op in Node');
  assert.equal(install.mountInstallButton('#install-btn'), null, 'no button outside a browser');
  assert.equal(await install.promptInstall(), 'unavailable', 'prompt reports unavailable');
});
