/**
 * Shared helper: boot one of the real portals in jsdom at an exact URL, with a
 * signed-in session, running the page's own inline module script.
 *
 * Node's test runner gives every `*.test.mjs` its own process, which matters
 * here: the portals read the URL fragment once at module load (the login
 * handoff), so two boots with different URLs belong in different files.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { loadDemo } from './demo.mjs';

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

export function inlineModuleScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) if (/type\s*=\s*["']module["']/i.test(m[1])) out.push(m[2]);
  return out;
}

export function makeCanvasStub(dom) {
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '', textAlign: '',
    fillText() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    closePath() {}, arcTo() {}, fill() {}, stroke() {}, save() {}, restore() {}, clip() {},
    drawImage() {}, measureText: (t) => ({ width: String(t).length * 12 })
  };
  return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,AAAA', toBlob: (cb) => cb(new dom.window.Blob(['x'], { type: 'image/png' })) };
}

export async function bootPortal(page, {
  url = `http://localhost:8080/${page}`,
  username, password, role, nonce = 'p', beforeBoot = () => {}
} = {}) {
  const dom = new JSDOM(read(page), { url, pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  const origCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvasStub(dom) : origCreate(tag));

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.FormData = dom.window.FormData;
  globalThis.File = dom.window.File;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.Blob = dom.window.Blob;

  (await import(new URL('../../js/store.js', import.meta.url).href))._clearMemoryStore();
  // The store ships empty, so the demo institute (and its three accounts) is
  // loaded before the page boots — js/demo-data.js, test-only by design.
  await loadDemo();
  const auth = await import(new URL('../../js/auth.js', import.meta.url).href);
  await auth.signIn(username, password, role);
  beforeBoot(dom);

  const files = [];
  const tmp = path.join(ROOT, `.portal-${nonce}.mjs`);
  try {
    for (const [i, code] of inlineModuleScripts(read(page)).entries()) {
      const file = i === 0 ? tmp : tmp.replace('.mjs', `-${i}.mjs`);
      writeFileSync(file, code);
      files.push(file);
      await import(`file://${file}`);
    }
  } finally {
    for (const f of files) { try { unlinkSync(f); } catch { /* already gone */ } }
  }
  await new Promise((r) => setTimeout(r, 250));
  return dom;
}
