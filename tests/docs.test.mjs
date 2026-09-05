/**
 * Pure unit tests for the standalone document builders (js/docs.js) and the
 * dependency-free PDF/image utilities (js/pdf.js). These run in Node with no
 * DOM: the builders must produce clean HTML that never leaks the application
 * UI, and the hand-written PDF must be structurally valid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { _clearMemoryStore } from '../js/store.js';
import {
  buildReceiptHtml, receiptSummary, buildReportHtml, classReportRows,
  CLASS_REPORT_COLUMNS, classFileLabel
} from '../js/docs.js';
import { buildPdf } from '../js/pdf.js';
import { db, dueFees, receivePayment, CLASS_OPTIONS, ALL_CLASSES } from '../js/data.js';

const strip = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('classFileLabel names files from Bengali class names', () => {
  assert.equal(classFileLabel('নবম'), 'Class-9');
  assert.equal(classFileLabel('অষ্টম'), 'Class-8');
  assert.equal(classFileLabel('দ্বাদশ'), 'Class-12');
  assert.equal(classFileLabel(ALL_CLASSES), 'All-Classes');
  assert.equal(classFileLabel(''), 'All-Classes');
});

test('classReportRows numbers rows and flags records missing Name or Unique ID', () => {
  const { rows, incomplete } = classReportRows([
    { id: 'S1', name: 'রহিম', className: 'নবম' },
    { id: '', name: 'করিম', className: 'নবম' },
    { id: 'S3', name: '', className: 'নবম' },
    { id: 'S4', name: 'সালমা', className: 'নবম' }
  ]);
  assert.equal(rows.length, 4);
  assert.equal(incomplete, 2, 'the two bad records are counted');
  assert.equal(rows[0].sl, 1);
  assert.equal(rows[1].name, 'অসম্পূর্ণ রেকর্ড', 'missing id is visibly flagged');
  assert.equal(rows[1].id, '—');
  assert.equal(rows[2].name, 'অসম্পূর্ণ রেকর্ড', 'missing name is visibly flagged');
  assert.equal(rows[3].name, 'সালমা', 'complete records pass through untouched');
});

test('report columns always carry Student Name and Unique ID', () => {
  const keys = CLASS_REPORT_COLUMNS.map((c) => c.key);
  assert.ok(keys.includes('name'), 'student name column present');
  assert.ok(keys.includes('id'), 'unique id column present');
});

test('buildReportHtml is a clean standalone document with no app UI', () => {
  const html = buildReportHtml({
    settings: { orgName: 'Active Plus Coaching', address: 'মিরপুর-১০, ঢাকা', mobile: '০১৭০০-০০০০০০' },
    title: 'শিক্ষার্থী রিপোর্ট', subtitle: 'শ্রেণি: নবম',
    columns: CLASS_REPORT_COLUMNS,
    rows: [{ sl: 1, name: 'রহিম', id: 'S1', className: 'নবম', roll: '০১', guardian: '—', phone: '—', status: 'সক্রিয়' }]
  });
  const text = strip(html);
  assert.ok(html.includes('শিক্ষার্থী রিপোর্ট'), 'report title present');
  assert.ok(text.includes('Active Plus Coaching'), 'centre name present');
  assert.ok(text.includes('শিক্ষার্থীর নাম'), 'Name header present');
  assert.ok(text.includes('ইউনিক আইডি'), 'Unique ID header present');
  // never any app chrome in the exported document
  for (const banned of ['রিপোর্ট সেন্টার', 'ড্যাশবোর্ড', 'ডাউনলোড', 'সাইডবার', 'Generate', 'button']) {
    assert.equal(text.includes(banned), false, `no "${banned}" in the report document`);
  }
});

test('buildReceiptHtml shows every required field and stays clean', () => {
  _clearMemoryStore();
  const fee = dueFees()[0];
  assert.ok(fee, 'seed has a due fee');
  const result = receivePayment(fee.id, 'অ্যাডমিন');
  assert.ok(result, 'payment recorded');
  const pay = db.payments.find(result.payment.id);
  db.payments.update(pay.id, {
    amount: 1200, method: 'বিকাশ', reference: 'TRX-9911', remarks: '', receiptNo: 'RCP-123456'
  });
  const updated = db.payments.find(pay.id);

  const html = buildReceiptHtml(updated, {
    student: db.students.find(updated.studentId),
    settings: db.settings.get()
  });
  const text = strip(html);

  assert.ok(html.includes('পেমেন্ট রিসিট'), 'titled a payment receipt');
  assert.ok(text.includes('রিসিট নম্বর'), 'receipt number field');
  assert.ok(text.includes('RCP-123456'), 'shows the receipt number');
  assert.ok(text.includes('তারিখ'), 'date field');
  assert.ok(text.includes('শিক্ষার্থীর নাম'), 'student name field');
  assert.ok(text.includes('ইউনিক আইডি'), 'unique id field');
  assert.ok(text.includes('শ্রেণি'), 'class field');
  assert.ok(text.includes('ফি টাইপ'), 'fee type field');
  assert.ok(text.includes('পেমেন্টের পরিমাণ'), 'amount field');
  assert.ok(text.includes('আগের বকেয়া'), 'previous due field');
  assert.ok(text.includes('পরিশোধিত'), 'paid amount field');
  assert.ok(text.includes('অবশিষ্ট বকেয়া'), 'remaining due field');
  assert.ok(text.includes('মাধ্যম'), 'payment method field');
  assert.ok(text.includes('বিকাশ'), 'shows the method');
  assert.ok(text.includes('TRX-9911'), 'shows the reference');
  assert.ok(text.includes('গ্রহণকারী'), 'received-by field');
  assert.ok(text.includes('স্বাক্ষর'), 'signature area');
  for (const banned of ['ড্যাশবোর্ড', 'রিপোর্ট সেন্টার', 'পেমেন্ট হিস্টোরি', 'মেনু']) {
    assert.equal(text.includes(banned), false, `receipt never contains "${banned}"`);
  }
});

test('receiptSummary computes previous due, paid and remaining from the store', () => {
  _clearMemoryStore();
  const fee = dueFees()[0];
  const result = receivePayment(fee.id, 'অ্যাডমিন');
  const pay = db.payments.find(result.payment.id);
  db.payments.update(pay.id, { amount: 1200, receiptNo: 'RCP-999999' });

  const summary = receiptSummary(db.payments.find(pay.id));
  assert.equal(summary.paidAmount, 1200);
  assert.equal(summary.previousDue, 1200, 'the settled fee was the previous due');
  assert.equal(summary.remainingDue, 0, 'nothing left after settling the only due fee');
});

test('buildPdf produces a structurally valid multi-page PDF', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);
  const pdf = buildPdf([{ w: 1240, h: 1754, bytes: jpeg }, { w: 1240, h: 1754, bytes: jpeg }]);
  const dec = new TextDecoder('latin1');
  const text = dec.decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'), 'PDF header present');
  assert.ok(text.includes('/Type /Catalog'), 'catalog present');
  assert.ok(text.includes('/Count 2'), 'two pages counted');
  assert.ok(text.includes('xref'), 'xref table present');
  assert.ok(text.includes('trailer'), 'trailer present');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'EOF marker present');
  // startxref must point at the byte offset of the "xref" keyword
  const sx = text.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(sx, 'startxref written');
  const needle = new TextEncoder().encode('xref');
  const offset = Number(sx[1]);
  for (let i = 0; i < needle.length; i += 1) {
    assert.equal(pdf[offset + i], needle[i], `startxref points at "xref" (byte ${offset + i})`);
  }
});

test('every report option has a matching downloadable filename', () => {
  for (const c of CLASS_OPTIONS) {
    const label = classFileLabel(c);
    assert.match(label, /^Class-\d+$/, `${c} → ${label}`);
  }
});
