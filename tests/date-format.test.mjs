/**
 * "সকল ক্ষেত্রে তারিখ ফরমেট ১৬ সেপ্টেম্বর ২০২৬ এইভাবে রাখুন।"
 *
 * Every date the portals print must read as a Bengali long date. This boots the
 * three real portals (student, teacher, admin), walks every view/tab a user can
 * reach and fails on any leftover raw date — '2026-09-16', '১৬/০৯/২০২৬',
 * 'সেপ্টেম্বর ১৬, ২০২৬' — in the rendered text.
 *
 * Student roll numbers ('2026-09-001') look date-ish but are identifiers, so a
 * numeric run longer than a year-month-day is not treated as a date.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootPortal } from './helpers/portal.mjs';

/** Raw date shapes a reader must never meet. */
const RAW_DATE = new RegExp([
  /\d{4}-\d{2}-\d{2}(?!\d)/.source,                       // 2026-09-16
  /[০-৯]{4}-[০-৯]{2}-[০-৯]{2}(?![০-৯])/.source,           // ২০২৬-০৯-১৬
  /\d{1,2}\/\d{1,2}\/\d{4}(?!\d)/.source,                 // 16/09/2026
  /[০-৯]{1,2}\/[০-৯]{1,2}\/[০-৯]{4}(?![০-৯])/.source,      // ১৬/০৯/২০২৬
  /\b[০-৯]{1,2}\s+(?:জানু|ফেব্রু|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টে|অক্টো|নভে|ডিসে)[^\s]*\s*,\s*[০-৯]{4}/.source
].join('|'), 'u');

const TAGS_TO_SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

/** Every raw date still showing in the document, with a little context. */
function rawDates(doc) {
  const found = [];
  for (const el of doc.querySelectorAll('*')) {
    if (TAGS_TO_SKIP.has(el.tagName)) continue;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      const text = String(node.textContent);
      const hit = text.match(RAW_DATE);
      if (hit) found.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} → "${text.replace(/\s+/g, ' ').trim().slice(0, 90)}" (${hit[0]})`);
    }
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = el.getAttribute?.(attr);
      if (value && RAW_DATE.test(value)) found.push(`[${attr}] ${el.tagName.toLowerCase()} → "${value}"`);
    }
  }
  return found;
}

const click = (dom, el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const settle = () => new Promise((r) => setTimeout(r, 30));

test('the student portal never prints a raw date', async () => {
  const dom = await bootPortal('student.html', { username: '2026-09-001', password: 'Student@123', role: 'student', nonce: '-s' });
  const doc = dom.window.document;
  // The home paints its skeleton away on a 300ms timer; let it finish here so
  // the scan sees the finished page (and no stray timer outlives the test).
  await new Promise((r) => setTimeout(r, 350));
  try {
    const bad = rawDates(doc);
    for (const view of ['study', 'exam', 'result', 'more']) {
      click(dom, [...doc.querySelectorAll('.bottom-nav button')].find((b) => b.dataset.view === view));
      await settle();
      bad.push(...rawDates(doc));
    }
    assert.deepEqual(bad, [], `raw dates on the student portal: ${bad.join(' | ')}`);
    // And the date the student actually reads is the Bengali long one.
    assert.match(doc.getElementById('today-date').textContent, /[০-৯]{1,2}\s+[\u0980-\u09FF]+\s+[০-৯]{4}/, 'the header prints ১৬ সেপ্টেম্বর ২০২৬');
  } finally {
    await settle();
    dom.window.close();
  }
});

test('the teacher portal never prints a raw date', async () => {
  const dom = await bootPortal('teacher.html', { username: 'teacher@activeplus.edu', password: 'Teacher@123', role: 'teacher', nonce: '-t' });
  const doc = dom.window.document;
  try {
    const bad = rawDates(doc);
    for (const tab of ['exams', 'materials', 'assignments', 'questions', 'notices', 'result', 'profile']) {
      const btn = doc.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
      click(dom, btn);
      await settle();
      bad.push(...rawDates(doc));
    }
    assert.deepEqual(bad, [], `raw dates on the teacher portal: ${bad.join(' | ')}`);
  } finally {
    await settle();
    dom.window.close();
  }
});

test('the admin portal never prints a raw date in any tab', async () => {
  const dom = await bootPortal('admin.html', { username: 'admin@activeplus.edu', password: 'Admin@123', role: 'admin', nonce: '-a' });
  const doc = dom.window.document;
  try {
    const bad = rawDates(doc);
    for (const tab of ['students', 'teachers', 'exams', 'fees', 'notices', 'reports', 'notifications', 'settings', 'questions']) {
      const btn = doc.querySelector(`[data-tab="${tab}"]`);
      if (!btn) continue;
      click(dom, btn);
      await settle();
      bad.push(...rawDates(doc));
    }
    assert.deepEqual(bad, [], `raw dates on the admin portal: ${bad.join(' | ')}`);
  } finally {
    await settle();
    dom.window.close();
  }
});
