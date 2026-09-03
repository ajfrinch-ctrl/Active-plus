import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = ['index.html', 'student.html', 'teacher.html', 'admin.html'];

function inlineModuleScripts(html) {
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    if (/type\s*=\s*["']module["']/i.test(match[1])) scripts.push(match[2]);
  }
  return scripts;
}

test('inline module scripts are valid ESM (compile check)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ap-'));
  for (const page of PAGES) {
    inlineModuleScripts(read(page)).forEach((code, i) => {
      const file = path.join(dir, `${page.replace('.html', '')}-${i}.mjs`);
      writeFileSync(file, code);
      // .mjs extension implies ESM; --check throws on syntax errors.
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    });
  }
});

test('ids referenced by inline scripts exist in the same page', () => {
  for (const page of PAGES) {
    const html = read(page);
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const existing = new Set([...doc.querySelectorAll('[id]')].map((el) => el.id));

    const refs = new Set();
    for (const m of html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
    for (const m of html.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) refs.add(m[1]);

    for (const id of refs) {
      // Dynamically-created ids (toast container, panels) are acceptable gaps.
      if (id === 'toast-container' || id.startsWith('tab-')) continue;
      assert.ok(existing.has(id), `${page}: referenced #${id} not found in DOM`);
    }
  }
});

test('module imports resolve to real exported names', () => {
  // Map of page -> the names it imports from our local modules must exist there.
  const localSources = {
    './js/firebase.js': read('js/firebase.js'),
    './js/auth.js': read('js/auth.js'),
    './js/app.js': read('js/app.js'),
    './js/data.js': read('js/data.js'),
    './js/store.js': read('js/store.js'),
    './js/exams.js': read('js/exams.js')
  };
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/js\/[^'"]+)['"]/g)) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const source = localSources[m[2]];
      assert.ok(source, `${page}: unknown module ${m[2]}`);
      for (const name of names) {
        const exported = new RegExp(`export\\s+(async\\s+)?(function|const|let|class)\\s+${name}\\b`).test(source)
          || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source);
        assert.ok(exported, `${page}: "${name}" is not exported by ${m[2]}`);
      }
    }
  }
});
