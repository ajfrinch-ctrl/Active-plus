/**
 * End-to-end login: submit the real index.html form, follow the handoff token,
 * and confirm the student home renders for that session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const TOKEN_RE = /#s=[^\s"']+/;

function inlineModuleScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) if (/type\s*=\s*["']module["']/i.test(m[1])) out.push(m[2]);
  return out;
}

function makeDom(page, url) {
  const navigations = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e.message || '');
    if (/navigation/i.test(msg)) navigations.push(msg);
  });
  const dom = new JSDOM(read(page), { url, pretendToBeVisual: true, virtualConsole: vc, runScripts: 'outside-only' });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  return { dom, navigations };
}

function bindGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

test('login from index.html hands off to the student home', async () => {
  const { dom, navigations } = makeDom('index.html', 'http://localhost:8080/index.html');
  bindGlobals(dom);
  (await import('../js/store.js'))._clearMemoryStore();
  const auth = await import('../js/auth.js');
  await auth.seedUsers({ force: true });

  // run the page's real inline module
  const tmp = path.join(ROOT, '.boot-index.mjs');
  writeFileSync(tmp, inlineModuleScripts(read('index.html'))[0]);
  try { await import(`file://${tmp}`); } finally { unlinkSync(tmp); }

  // fill the actual form and submit it
  const doc = dom.window.document;
  doc.querySelector('input[name="role"][value="student"]').checked = true;
  doc.getElementById('login-input').value = '2026-09-001';
  doc.getElementById('login-password').value = 'Student@123';
  doc.getElementById('login-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 400));

  // jsdom blocks real navigation (Location.replace is unforgeable), so assert the
  // attempt happened and rebuild the same handoff URL the page itself computes.
  assert.match(navigations.join(' '), /Not implemented: navigation/, 'the login handler navigated');
  assert.equal(auth.currentSession()?.role, 'student', 'a real session was created by the form');
  assert.equal(auth.homeFor('student'), 'student.html');

  // now load student.html with that token and confirm the home renders
  const url = auth.handoffUrl('student.html', auth.currentSession());
  assert.match(url, /student\.html#s=/, `handoff URL: ${url}`);
  const token = url.match(TOKEN_RE)[0];

  const home = makeDom('student.html', `http://localhost:8080/student.html${token}`);
  bindGlobals(home.dom);
  const mod = await import('../js/student-home.js');
  mod.initStudentHome();
  await new Promise((r) => setTimeout(r, 400));
  const hdoc = home.dom.window.document;
  assert.equal(hdoc.getElementById('home-content').hidden, false, 'home rendered from the handed-off session');
  assert.ok(hdoc.querySelectorAll('#home-content .hcard').length >= 8, 'full home, not an error state');
  assert.equal(hdoc.getElementById('student-name').textContent, auth.currentSession().name);
});
