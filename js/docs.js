/**
 * Clean, standalone document builders (payment receipt + report pages).
 *
 * These templates are self-contained (inline styles + absolute asset URLs) so
 * they render identically on screen, when captured to an image, and when
 * embedded into a PDF — with no trace of the application UI.
 */

import { db, CLASS_TO_NUMBER, ALL_CLASSES } from './data.js';
import { absUrl, htmlToCanvas, downloadBlob, canvasToPngBlob, logoDataUrl } from './pdf.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;

/* ------------------------------------------------------------------ */
/* Payment receipt                                                     */
/* ------------------------------------------------------------------ */

/**
 * Money breakdown for a receipt: what was still due, what was paid now and
 * what remains. Computed live from the store so it never goes stale.
 */
export function receiptSummary(pay) {
  const fees = db.fees.list().filter((f) => f.studentId === pay.studentId);
  const remainingDue = fees
    .filter((f) => f.status === 'বকেয়া')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const paidAmount = Number(pay.amount || 0);
  const previousDue = remainingDue + paidAmount;
  return { remainingDue, paidAmount, previousDue };
}

/** Clean, professional, print/PDF-ready payment receipt (no app UI). */
export function buildReceiptHtml(pay, { student, settings, logo } = {}) {
  const { remainingDue, paidAmount, previousDue } = receiptSummary(pay);
  const org = settings || {};
  const logoSrc = logo || absUrl('assets/logo.png');

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 2px;border-bottom:1px solid #eef0f3;font-size:14px;line-height:1.5">
      <span style="color:#5b6470;flex:none">${label}</span>
      <span style="font-weight:600;text-align:right;color:#111827;word-break:break-word">${value}</span>
    </div>`;

  const refLine = pay.reference
    ? row('ট্রানজেকশন নম্বর', esc(pay.reference))
    : '';

  return `
  <div data-receipt-sheet style="background:#ffffff;color:#111827;font-family:'Hind Siliguri','Noto Sans Bengali',sans-serif;border-radius:14px;padding:24px 22px;max-width:560px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.06)">
    <div style="text-align:center;border-bottom:3px solid #2563eb;padding-bottom:14px">
      <img src="${logoSrc}" alt="" style="width:60px;height:60px;object-fit:contain;margin-bottom:6px">
      <div style="font-size:19px;font-weight:800">${esc(org.orgName || 'Active Plus')}</div>
      <div style="font-size:12px;color:#6b7280">${esc(org.address || '')}</div>
      <div style="font-size:12px;color:#6b7280">${esc(org.mobile || '')}${org.email ? ` · ${esc(org.email)}` : ''}</div>
      <div style="font-size:16px;font-weight:800;margin-top:10px;letter-spacing:.02em">পেমেন্ট রিসিট</div>
    </div>

    <div style="margin-top:6px">
      ${row('রিসিট নম্বর', esc(pay.receiptNo || pay.id))}
      ${row('তারিখ', esc(pay.date || '—'))}
      ${row('শিক্ষার্থীর নাম', esc(student?.name || pay.studentId))}
      ${row('ইউনিক আইডি', esc(pay.studentId))}
      ${row('শ্রেণি', esc(student?.className || '—'))}
      ${row('ফি টাইপ', esc(pay.month || '—'))}
      ${row('পেমেন্টের পরিমাণ', taka(pay.amount))}
      ${previousDue > 0 ? row('আগের বকেয়া', taka(previousDue)) : ''}
      ${row('পরিশোধিত', taka(paidAmount))}
      ${row('অবশিষ্ট বকেয়া', remainingDue > 0 ? taka(remainingDue) : 'নেই')}
      ${row('মাধ্যম', esc(pay.method || '—'))}
      ${refLine}
      ${row('গ্রহণকারী', esc(pay.receivedBy || '—'))}
    </div>

    <div style="display:flex;gap:24px;margin-top:40px;text-align:center">
      <div style="flex:1">
        <div style="border-top:1px solid #111827;padding-top:6px;font-size:12px;color:#374151">আদায়কারীর স্বাক্ষর</div>
      </div>
      <div style="flex:1">
        <div style="border-top:1px solid #111827;padding-top:6px;font-size:12px;color:#374151">শিক্ষার্থী / অভিভাবকের স্বাক্ষর</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:11px;color:#9ca3af">ধন্যবাদ — Active Plus</div>
  </div>`;
}

export function receiptFileName(pay) {
  return `receipt-${pay.receiptNo || pay.id}.png`;
}

async function receiptCanvas(pay, opts) {
  const logo = await logoDataUrl();
  const html = buildReceiptHtml(pay, { ...opts, logo });
  return htmlToCanvas({ html, width: 900, height: 1320 });
}

/**
 * Share the receipt as an IMAGE via the Web Share API (native share sheet →
 * user picks WhatsApp). Falls back to downloading the PNG when file sharing
 * is unsupported. Never sends the receipt as a text-only message.
 */
export async function shareReceiptAsImage(pay, opts) {
  const canvas = await receiptCanvas(pay, opts);
  const blob = await canvasToPngBlob(canvas);
  const file = new File([blob], receiptFileName(pay), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'পেমেন্ট রিসিট' });
    return { shared: true };
  }
  downloadBlob(blob, receiptFileName(pay));
  return { shared: false, downloaded: true };
}

/** Download the receipt as a PNG image. */
export async function downloadReceiptPng(pay, opts) {
  const canvas = await receiptCanvas(pay, opts);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, receiptFileName(pay));
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

/** Filename-safe class label, e.g. "Class-9" for নবম, "All-Classes" for সব. */
export function classFileLabel(className) {
  if (!className || className === ALL_CLASSES) return 'All-Classes';
  const num = CLASS_TO_NUMBER[className];
  if (num) return `Class-${num}`;
  const cleaned = String(className).replace(/[^\w-]/g, '');
  return cleaned || 'Class';
}

/**
 * Clean standalone report page. `columns` are `{ key, label }`, rows are
 * plain objects. Values are escaped, so app/user data never breaks the layout.
 */
export function buildReportHtml({ settings, title, subtitle, columns, rows, logo }) {
  const org = settings || {};
  const logoSrc = logo || absUrl('assets/logo.png');
  const head = columns.map((c) =>
    `<th style="padding:9px 8px;border:1px solid #d3d9e0;background:#eef2f7;text-align:left;font-size:12px;font-weight:700;color:#111827">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) =>
    `<tr>${columns.map((c) =>
      `<td style="padding:8px;border:1px solid #e6e9ee;font-size:12px;color:#111827">${esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  const empty = `<tr><td colspan="${columns.length}" style="padding:16px;text-align:center;color:#6b7280">কোনো তথ্য নেই।</td></tr>`;

  return `
  <div style="width:100%;height:100%;box-sizing:border-box;background:#ffffff;color:#111827;font-family:'Hind Siliguri','Noto Sans Bengali',sans-serif;padding:46px 50px;display:flex;flex-direction:column">
    <div style="text-align:center;border-bottom:3px solid #2563eb;padding-bottom:14px">
      <img src="${logoSrc}" alt="" style="width:58px;height:58px;object-fit:contain;margin-bottom:6px">
      <div style="font-size:20px;font-weight:800">${esc(org.orgName || 'Active Plus')}</div>
      <div style="font-size:12px;color:#6b7280">${esc(org.address || '')}${org.mobile ? ` · ${esc(org.mobile)}` : ''}</div>
      <div style="font-size:16px;font-weight:800;margin-top:10px">${esc(title)}</div>
      ${subtitle ? `<div style="font-size:13px;color:#374151">${esc(subtitle)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      <thead><tr>${head}</tr></thead>
      <tbody>${body || empty}</tbody>
    </table>
    <div style="margin-top:auto;padding-top:20px;text-align:center;font-size:11px;color:#9ca3af">
      Active Plus · ${new Date().toLocaleDateString('bn-BD')}
    </div>
  </div>`;
}

export const CLASS_REPORT_COLUMNS = [
  { key: 'sl', label: 'ক্রম' },
  { key: 'name', label: 'শিক্ষার্থীর নাম' },
  { key: 'id', label: 'ইউনিক আইডি' },
  { key: 'className', label: 'শ্রেণি' },
  { key: 'roll', label: 'রোল' },
  { key: 'guardian', label: 'অভিভাবক' },
  { key: 'phone', label: 'মোবাইল' },
  { key: 'status', label: 'অবস্থা' }
];

/**
 * Map students to report rows, flagging records missing a Name or Unique ID
 * as "অসম্পূর্ণ রেকর্ড" (spec: these two fields are mandatory in every report).
 */
export function classReportRows(students) {
  let incomplete = 0;
  const rows = (students || []).map((s, i) => {
    const missing = !String(s.name || '').trim() || !String(s.id || '').trim();
    if (missing) incomplete += 1;
    return {
      sl: i + 1,
      name: missing ? 'অসম্পূর্ণ রেকর্ড' : s.name,
      id: String(s.id || '').trim() || '—',
      className: s.className || '—',
      roll: s.roll || '—',
      guardian: s.guardian || '—',
      phone: s.phone || '—',
      status: s.status || '—'
    };
  });
  return { rows, incomplete };
}
