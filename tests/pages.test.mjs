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
    './js/exams.js': read('js/exams.js'),
    './js/crud.js': read('js/crud.js'),
    './js/admin-modules.js': read('js/admin-modules.js'),
    './js/pdf.js': read('js/pdf.js'),
    './js/docs.js': read('js/docs.js'),
    './js/student-home.js': read('js/student-home.js'),
    './js/teacher-home.js': read('js/teacher-home.js'),
    './js/admin-home.js': read('js/admin-home.js')
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

test('service worker precaches every page asset (offline home must render)', () => {
  const sw = read('service-worker.js');
  const precached = new Set([...sw.matchAll(/'([^']+\.(?:html|css|js|json|png))'/g)].map((m) => m[1]));
  const assets = new Set();
  for (const page of PAGES) {
    const html = read(page);
    assets.add(page);
    for (const m of html.matchAll(/href=["'](css\/[^"']+)["']/g)) assets.add(m[1]);
    for (const m of html.matchAll(/from\s+['"](\.\/js\/[^'"]+)['"]/g)) assets.add(m[1].replace('./', ''));
    for (const m of html.matchAll(/import\(['"](\.\/js\/[^'"]+)['"]\)/g)) assets.add(m[1].replace('./', ''));
  }
  // Modules imported by our modules must be cached too, or the graph breaks offline.
  for (const file of [...assets]) {
    if (!file.startsWith('js/')) continue;
    for (const m of read(file).matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) assets.add(`js/${m[1]}`);
  }
  const missing = [...assets].filter((a) => !precached.has(a));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
});

test('database rules deny by default and scope student-owned data', () => {
  const rules = JSON.parse(read('database.rules.json')).rules;
  assert.equal(rules['.read'], false, 'no anonymous reads');
  assert.equal(rules['.write'], false, 'no anonymous writes');

  const adminOnly = "root.child('roles/' + auth.uid + '/role').val() === 'admin'";
  // Financial data: the student alone (and admin) — never another student.
  assert.ok(rules.fees.$studentId['.read'].includes("auth.uid === data.child('uid').val()"), 'fees read is owner-scoped');
  assert.equal(rules.fees.$studentId['.write'], adminOnly, 'only admin writes fees');
  assert.equal(rules.payments.$studentId['.read'], adminOnly, 'payments are admin-only');
  assert.equal(rules.payments.$studentId['.write'], adminOnly);

  // Full store mirror is admin-only, so a student client cannot pull everything.
  assert.equal(rules.activeplus.data['.read'], adminOnly, 'store mirror is admin-only');

  // Student-writable surfaces are narrow and self-scoped.
  assert.ok(rules.students.$studentId.phone['.write'].includes('auth.uid ==='), 'phone editable by its owner only');
  assert.ok(rules.studyActivity.$studentId['.write'].includes('auth.uid === data.child'), 'activity written by its owner only');

  // Reference/shared data: readable when signed in, never student-writable.
  for (const key of ['classes', 'subjects', 'routine', 'materials', 'assignments', 'exams', 'notices', 'tips', 'attendance', 'teachers']) {
    assert.equal(rules[key]['.read'], 'auth !== null', `${key} needs a session`);
    assert.notEqual(rules[key]['.write'], 'auth !== null', `${key} is not freely writable`);
  }
  assert.equal(rules.banners['.write'], adminOnly, 'banners are admin-managed');
});

test('admin student form carries every profile field the student page shows', () => {
  const admin = read('admin.html');
  for (const name of ['name', 'school', 'className', 'section', 'batch', 'roll', 'phone', 'guardian', 'admissionDate', 'photo', 'status']) {
    assert.ok(admin.includes(`name="${name}"`), `student form has ${name}`);
  }
  const student = read('js/student-home.js');
  for (const field of ['meRow.section', 'meRow.batch', 'meRow.guardian', 'meRow.admissionDate', 'meRow.photo']) {
    assert.ok(student.includes(field), `profile renders ${field}`);
  }
});
