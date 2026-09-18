/**
 * Clean, standalone document builders (payment receipt + report pages).
 *
 * Institution Pad/Logo Standard (mandatory):
 * - Every generated PDF must automatically use the configured:
 *   Institution Logo + Institution Name + Official Pad/Header + Footer
 * - The same Institution Profile controls both WhatsApp Image and PDF
 * - No institutional PDF may be generated without branding
 * - Header: [Logo] INSTITUTION NAME, Address, Mobile | Email | Website, Document Title
 * - Footer: institution info, generated date, page number, institution name, authorized/by
 * - Layout: professional, print-ready, margins, logo proportional, no clipping,
 *   auto-paginate long tables, repeat header/footer on every page, Bengali+English Unicode
 *
 * Two outputs share the same field logic:
 *   - HTML builders (buildReceiptHtml / buildReportHtml) for preview/tests
 *   - Canvas renderers (renderReceiptCanvas / renderReportCanvases) for PDF/PNG
 * Neither output contains any application UI.
 */

import { db, CLASS_TO_NUMBER, ALL_CLASSES, formatBnDate, todayBn } from './data.js';
import { absUrl, downloadBlob, canvasToPngBlob, logoDataUrl, assetDataUrl, loadImage, makeCanvas, wrapText, clearLogoCache } from './pdf.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;

const FONT = "'Hind Siliguri', 'Noto Sans Bengali', sans-serif";
const INK = '#111827';
const MUTED = '#5b6470';
const FAINT = '#9ca3af';
const BORDER = '#e6e9ee';
const ACCENT = '#2563eb';

/* ------------------------------------------------------------------ */
/* Institution Pad helpers                                             */
/* ------------------------------------------------------------------ */

function resolveOrg(settingsOrOpts) {
  const s = settingsOrOpts?.settings || settingsOrOpts || {};
  // db fallback when no settings passed
  let fallback = {};
  try { fallback = db.settings.get(); } catch (e) {}
  const orgName = (s.orgName || fallback.orgName || 'Active Plus').trim() || 'Active Plus';
  const address = (s.address || fallback.address || '').trim();
  const mobile = (s.mobile || fallback.mobile || '').trim();
  const email = (s.email || fallback.email || '').trim();
  const website = (s.website || fallback.website || '').trim();
  const footerText = (s.footerText || fallback.footerText || '').trim();
  const orgLogo = s.orgLogo || fallback.orgLogo || null;
  const contactParts = [mobile, email, website].filter(Boolean);
  return {
    orgName,
    name: orgName,
    address,
    mobile,
    email,
    website,
    footerText,
    orgLogo,
    logo: orgLogo,
    contactLine: contactParts.join(' | '),
    contactLinePipe: contactParts.join(' | '),
    contactLineDot: contactParts.join(' · '),
    academicYear: (s.academicYear || fallback.academicYear || '').trim()
  };
}

/**
 * Documents print the same Bengali long date as the rest of the app
 * (১৬ সেপ্টেম্বর ২০২৬) — derived from todayBn() so a receipt made at 11pm
 * carries the same date the app is showing.
 */
function formatGenDate() {
  return formatBnDate(todayBn());
}

function formatGenDateTime() {
  const time = (() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${bn(hh)}:${bn(mm)}`;
  })();
  return `${formatGenDate()} · ${time}`;
}

/* ------------------------------------------------------------------ */
/* Payment receipt                                                     */
/* ------------------------------------------------------------------ */

export function receiptSummary(pay) {
  const fees = db.fees.list().filter((f) => f.studentId === pay.studentId);
  const remainingDue = fees
    .filter((f) => f.status === 'বকেয়া')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);
  const paidAmount = Number(pay.amount || 0);
  const previousDue = remainingDue + paidAmount;
  return { remainingDue, paidAmount, previousDue };
}

function receiptRows(pay, { student }) {
  const { previousDue, paidAmount, remainingDue } = receiptSummary(pay);
  const rows = [
    ['রিসিট নম্বর', pay.receiptNo || pay.id],
    ['তারিখ', formatBnDate(pay.date) || '—'],
    ['শিক্ষার্থীর নাম', student?.name || pay.studentId],
    ['ইউনিক আইডি', pay.studentId],
    ['শ্রেণি', student?.className || '—'],
    ['ফি টাইপ', pay.month || '—'],
    ['পেমেন্টের পরিমাণ', taka(pay.amount)],
  ];
  if (previousDue > 0) rows.push(['আগের বকেয়া', taka(previousDue)]);
  rows.push(['পরিশোধিত', taka(paidAmount)]);
  rows.push(['অবশিষ্ট বকেয়া', remainingDue > 0 ? taka(remainingDue) : 'নেই']);
  rows.push(['মাধ্যম', pay.method || '—']);
  if (pay.reference) rows.push(['ট্রানজেকশন নম্বর', pay.reference]);
  rows.push(['গ্রহণকারী', pay.receivedBy || '—']);
  return rows;
}

export function buildReceiptHtml(pay, { student, settings, logo } = {}) {
  const org = resolveOrg(settings);
  const logoSrc = logo || org.orgLogo || absUrl('assets/logo.png');
  const contact = org.contactLine;

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 2px;border-bottom:1px solid #eef0f3;font-size:14px;line-height:1.5">
      <span style="color:#5b6470;flex:none">${label}</span>
      <span style="font-weight:600;text-align:right;color:#111827;word-break:break-word">${value}</span>
    </div>`;

  return `
  <div data-receipt-sheet style="background:#ffffff;color:#111827;font-family:'Hind Siliguri','Noto Sans Bengali',sans-serif;border-radius:14px;padding:24px 22px;max-width:560px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.06)">
    <div style="text-align:center;border-bottom:3px solid #2563eb;padding-bottom:14px">
      <img src="${logoSrc}" alt="" style="width:60px;height:60px;object-fit:contain;margin-bottom:6px">
      <div style="font-size:19px;font-weight:800">${esc(org.orgName)}</div>
      <div style="font-size:12px;color:#6b7280">${esc(org.address)}</div>
      ${contact ? `<div style="font-size:12px;color:#6b7280">${esc(contact)}</div>` : ''}
      <div style="font-size:16px;font-weight:800;margin-top:10px;letter-spacing:.02em">PAYMENT RECEIPT</div>
      <div style="font-size:13px;color:#374151">পেমেন্ট রিসিট</div>
    </div>

    <div style="margin-top:6px">
      ${receiptRows(pay, { student }).map(([label, value]) => row(label, esc(value))).join('')}
    </div>

    <div style="display:flex;gap:24px;margin-top:40px;text-align:center">
      <div style="flex:1">
        <div style="border-top:1px solid #111827;padding-top:6px;font-size:12px;color:#374151">আদায়কারীর স্বাক্ষর</div>
      </div>
      <div style="flex:1">
        <div style="border-top:1px solid #111827;padding-top:6px;font-size:12px;color:#374151">শিক্ষার্থী / অভিভাবকের স্বাক্ষর</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:11px;color:#9ca3af">
      ${esc(org.footerText || `ধন্যবাদ — ${org.orgName}`)}<br>
      Generated: ${esc(formatGenDateTime())} · ${esc(org.orgName)}
    </div>
  </div>`;
}

export function receiptFileName(pay) {
  return `receipt-${pay.receiptNo || pay.id}.png`;
}

/* ------------------------------------------------------------------ */
/* Canvas drawing (shared by receipt + report)                         */
/* ------------------------------------------------------------------ */

async function warmFonts() {
  if (!document.fonts) return;
  try { await document.fonts.ready; } catch (e) { /* proceed */ }
  try {
    await Promise.all([
      document.fonts.load(`400 22px ${FONT}`),
      document.fonts.load(`700 22px ${FONT}`)
    ]);
  } catch (e) { /* proceed */ }
}

async function loadLogo(customDataUrl = null) {
  try {
    if (customDataUrl && typeof customDataUrl === 'string' && customDataUrl.startsWith('data:image/')) {
      return await loadImage(customDataUrl);
    }
    return await loadImage(await logoDataUrl());
  } catch (e) {
    return null;
  }
}

function setFont(ctx, px, weight = 400) {
  ctx.font = `${weight} ${px}px ${FONT}`;
}

function drawLogo(ctx, img, centerX, top, size) {
  if (!img) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.min(size / iw, size / ih);
  ctx.drawImage(img, centerX - (iw * scale) / 2, top, iw * scale, ih * scale);
}

/* Professional footer for every PDF page */
function paintPageFooter(ctx, width, height, pad, org, pageNum, totalPages, generatedBy = null, paint = true) {
  if (!paint) return;
  const footerTop = height - pad - 56;
  const lineY = footerTop - 12;

  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, lineY);
  ctx.lineTo(width - pad, lineY);
  ctx.stroke();

  ctx.textBaseline = 'top';
  const dateStr = formatGenDate();
  const pageStr = `Page ${pageNum} / ${totalPages}`;

  // Line 1: Institution Name | Page | Date
  setFont(ctx, 14, 400);
  ctx.fillStyle = MUTED;

  ctx.textAlign = 'left';
  ctx.fillText(org.orgName || 'Active Plus', pad, footerTop);

  ctx.textAlign = 'center';
  ctx.fillText(pageStr, width / 2, footerTop);

  ctx.textAlign = 'right';
  ctx.fillText(dateStr, width - pad, footerTop);

  // Line 2: footerText + contact + generatedBy
  let secondLineY = footerTop + 18;
  const extras = [];
  if (org.footerText) extras.push(org.footerText);
  if (generatedBy) extras.push(`Generated by: ${generatedBy}`);

  if (extras.length) {
    setFont(ctx, 12, 400);
    ctx.fillStyle = FAINT;
    ctx.textAlign = 'center';
    const txt = extras.join(' | ');
    const lines = wrapText(ctx, txt, width - pad * 2);
    lines.forEach((ln, i) => {
      ctx.fillText(ln, width / 2, secondLineY + i * 16);
    });
  } else if (org.contactLine) {
    setFont(ctx, 11, 400);
    ctx.fillStyle = FAINT;
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, org.contactLine, width - pad * 2);
    lines.forEach((ln, i) => ctx.fillText(ln, width / 2, secondLineY + i * 14));
  }
}

/**
 * Receipt layout pass. Runs twice: once to measure the height (paint=false)
 * and once to actually paint (paint=true). Both passes advance the cursor
 * identically so the measured height is exact.
 * Uses Institution Pad: Logo + Name + Address + Mobile | Email | Website + Title + Footer
 */
function receiptPass(ctx, width, pay, opts, paint) {
  const pad = 44;
  const inner = width - pad * 2;
  let y = pad;
  const org = resolveOrg(opts.settings || opts);
  const genBy = opts.generatedBy || pay.receivedBy || null;

  ctx.textBaseline = 'top';

  const center = (text, px, weight, color, lhMul = 1.4) => {
    if (!text) return;
    setFont(ctx, px, weight);
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, text, inner);
    const lh = Math.round(px * lhMul);
    if (paint) {
      ctx.fillStyle = color;
      lines.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * lh));
    }
    y += lines.length * lh;
  };

  if (opts.logoImg) {
    if (paint) drawLogo(ctx, opts.logoImg, width / 2, y, 96);
    y += 96 + 10;
  }

  center(org.orgName, 32, 700, INK);
  if (org.address) center(org.address, 16, 400, MUTED, 1.4);
  if (org.contactLine) center(org.contactLine, 16, 400, MUTED, 1.4);

  y += 12;
  center('PAYMENT RECEIPT', 26, 700, INK);
  center('পেমেন্ট রিসিট', 20, 400, MUTED, 1.4);
  y += 10;
  if (paint) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pad, y, inner, 3);
  }
  y += 3 + 18;

  const labelW = Math.round(inner * 0.42);
  const valueW = inner - labelW - 26;
  const lh = 34;

  for (const [label, value] of receiptRows(pay, opts)) {
    setFont(ctx, 24, 400);
    const labelLines = wrapText(ctx, label, labelW);
    setFont(ctx, 24, 700);
    const valueLines = wrapText(ctx, String(value), valueW);
    const rowH = Math.max(labelLines.length, valueLines.length) * lh + 16;
    if (paint) {
      setFont(ctx, 24, 400);
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      labelLines.forEach((ln, i) => ctx.fillText(ln, pad, y + 8 + i * lh));
      setFont(ctx, 24, 700);
      ctx.fillStyle = INK;
      valueLines.forEach((ln, i) => ctx.fillText(ln, pad + labelW + 26, y + 8 + i * lh));
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y + rowH);
      ctx.lineTo(pad + inner, y + rowH);
      ctx.stroke();
    }
    y += rowH;
  }

  y += 36;
  const sigW = (inner - 40) / 2;
  if (paint) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + sigW, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad + sigW + 40, y); ctx.lineTo(pad + sigW + 40 + sigW, y); ctx.stroke();
    setFont(ctx, 18, 400);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#374151';
    ctx.fillText('আদায়কারীর স্বাক্ষর', pad, y + 12);
    ctx.fillText('শিক্ষার্থী / অভিভাবকের স্বাক্ষর', pad + sigW + 40, y + 12);
  }
  y += 48;

  // Footer area inside receipt
  if (paint) {
    // separator
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + inner, y);
    ctx.stroke();
    y += 12;

    setFont(ctx, 14, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = FAINT;
    const footerMain = org.footerText || `ধন্যবাদ — ${org.orgName}`;
    const lines = wrapText(ctx, footerMain, inner);
    lines.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * 18));
    y += lines.length * 18 + 6;

    setFont(ctx, 12, 400);
    ctx.fillStyle = FAINT;
    const genLine = `Generated: ${formatGenDateTime()}${genBy ? ` | By: ${genBy}` : ''} | ${org.orgName}`;
    const genLines = wrapText(ctx, genLine, inner);
    genLines.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * 16));
    y += genLines.length * 16 + 6;

    setFont(ctx, 11, 400);
    ctx.fillText(`Page 1 / 1`, width / 2, y);
    y += 16;
  } else {
    y += 80;
  }

  return y + pad;
}

/** Draw the receipt onto a clean canvas (white background, no app UI). */
export async function renderReceiptCanvas(pay, opts = {}) {
  await warmFonts();
  const width = 760;
  const org = resolveOrg(opts.settings || opts);
  const logoImg = await loadLogo(org.orgLogo || opts.settings?.orgLogo || null);
  const fullOpts = { ...opts, settings: org, logoImg, generatedBy: opts.generatedBy || pay.receivedBy || null };

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  const height = receiptPass(pctx, width, pay, fullOpts, false);

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  receiptPass(ctx, width, pay, fullOpts, true);
  return canvas;
}

export async function shareReceiptAsImage(pay, opts) {
  const canvas = await renderReceiptCanvas(pay, opts);
  const blob = await canvasToPngBlob(canvas);
  const file = new File([blob], receiptFileName(pay), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'PAYMENT RECEIPT' });
    return { shared: true };
  }
  downloadBlob(blob, receiptFileName(pay));
  return { shared: false, downloaded: true };
}

export async function downloadReceiptPng(pay, opts) {
  const canvas = await renderReceiptCanvas(pay, opts);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, receiptFileName(pay));
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export function classFileLabel(className) {
  if (!className || className === ALL_CLASSES) return 'All-Classes';
  const num = CLASS_TO_NUMBER[className];
  if (num) return `Class-${num}`;
  const cleaned = String(className).replace(/[^\\w-]/g, '');
  return cleaned || 'Class';
}

export function buildReportHtml({ settings, title, subtitle, columns, rows, logo }) {
  const org = resolveOrg(settings);
  const logoSrc = logo || org.orgLogo || absUrl('assets/logo.png');
  const contact = org.contactLine;
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
      <div style="font-size:20px;font-weight:800">${esc(org.orgName)}</div>
      <div style="font-size:12px;color:#6b7280">${esc(org.address)}</div>
      ${contact ? `<div style="font-size:12px;color:#6b7280">${esc(contact)}</div>` : ''}
      <div style="font-size:16px;font-weight:800;margin-top:10px;letter-spacing:.04em">${esc(title)}</div>
      ${subtitle ? `<div style="font-size:13px;color:#374151">${esc(subtitle)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:16px">
      <thead><tr>${head}</tr></thead>
      <tbody>${body || empty}</tbody>
    </table>
    <div style="margin-top:auto;padding-top:20px;text-align:center;font-size:11px;color:#9ca3af">
      ${esc(org.footerText || org.orgName)} · ${esc(formatGenDate())} · Page 1<br>
      ${esc(org.orgName)} · ${esc(contact)}
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

/* Additional standard columns for various reports as per task */
export const STUDENT_STATEMENT_COLUMNS = [
  { key: 'field', label: 'বিবরণ' },
  { key: 'value', label: 'তথ্য' }
];

export const DUE_STATEMENT_COLUMNS = [
  { key: 'month', label: 'মাস' },
  { key: 'amount', label: 'পরিমাণ' },
  { key: 'status', label: 'অবস্থা' },
  { key: 'due', label: 'বকেয়া' }
];

export const FINANCE_REPORT_COLUMNS = [
  { key: 'date', label: 'তারিখ' },
  { key: 'student', label: 'শিক্ষার্থী' },
  { key: 'type', label: 'ধরন' },
  { key: 'amount', label: 'পরিমাণ' },
  { key: 'method', label: 'মাধ্যম' }
];

export const TEACHER_REPORT_COLUMNS = [
  { key: 'name', label: 'নাম' },
  { key: 'subject', label: 'বিষয়' },
  { key: 'phone', label: 'মোবাইল' },
  { key: 'classes', label: 'ক্লাস' }
];

export const ROUTINE_REPORT_COLUMNS = [
  { key: 'day', label: 'দিন' },
  { key: 'time', label: 'সময়' },
  { key: 'subject', label: 'বিষয়' },
  { key: 'teacher', label: 'শিক্ষক' },
  { key: 'room', label: 'কক্ষ' }
];

export const NOTICE_REPORT_COLUMNS = [
  { key: 'title', label: 'শিরোনাম' },
  { key: 'className', label: 'ক্লাস' },
  { key: 'audience', label: 'কাদের জন্য' },
  { key: 'date', label: 'তারিখ' }
];

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

/* ------------------------------------------------------------------ */
/* Canvas report renderer (paged, no app UI)                           */
/* ------------------------------------------------------------------ */

const PAGE = { width: 1240, height: 1754 };
const PAD = 60;
const CELL_PAD = 22;
const BODY = 21;
const LH = 30;

function reportHeaderPass(ctx, width, pad, opts, paint) {
  const org = resolveOrg(opts.settings || {});
  let y = pad;
  const inner = width - pad * 2;

  ctx.textBaseline = 'top';
  const center = (text, px, weight, color, lhMul = 1.4) => {
    if (!text) return;
    setFont(ctx, px, weight);
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, text, inner);
    const lh = Math.round(px * lhMul);
    if (paint) {
      ctx.fillStyle = color;
      lines.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * lh));
    }
    y += lines.length * lh;
  };

  if (opts.logoImg) {
    if (paint) drawLogo(ctx, opts.logoImg, width / 2, y, 80);
    y += 80 + 10;
  }
  center(org.orgName, 36, 700, INK);
  if (org.address) center(org.address, 18, 400, MUTED, 1.4);
  if (org.contactLine) center(org.contactLine, 18, 400, MUTED, 1.4);
  y += 12;
  // Document title — professional, consistent header as per spec
  center((opts.title || 'REPORT').toUpperCase(), 30, 700, INK);
  if (opts.subtitle) center(opts.subtitle, 20, 400, MUTED, 1.4);
  y += 12;
  if (paint) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pad, y, inner, 3);
  }
  y += 3 + 18;
  return y;
}

function columnWidths(ctx, columns, rows, usable) {
  const req = columns.map((c) => {
    setFont(ctx, 22, 700);
    let w = ctx.measureText(c.label).width;
    setFont(ctx, BODY, 400);
    for (const r of rows) {
      const v = String(r[c.key] ?? '');
      for (const ln of v.split('\n')) w = Math.max(w, ctx.measureText(ln).width);
    }
    return Math.min(w + CELL_PAD, usable);
  });
  const total = req.reduce((a, b) => a + b, 0);
  if (total > usable) {
    const scale = usable / total;
    return req.map((w) => Math.max(48, w * scale));
  }
  const extra = (usable - total) / columns.length;
  return req.map((w) => w + extra);
}

function cellLines(ctx, columns, widths, row) {
  return columns.map((c, i) => {
    const v = String(row[c.key] ?? '');
    setFont(ctx, BODY, 400);
    return v.split('\n').reduce((acc, ln) => acc.concat(wrapText(ctx, ln, widths[i] - CELL_PAD)), []);
  });
}

function rowHeight(ctx, columns, widths, row) {
  let h = 0;
  setFont(ctx, BODY, 400);
  for (const lines of cellLines(ctx, columns, widths, row)) h = Math.max(h, lines.length * LH);
  return h + CELL_PAD;
}

function tableHeaderHeight(ctx, columns, widths) {
  let h = 0;
  setFont(ctx, 22, 700);
  columns.forEach((c, i) => {
    const lines = wrapText(ctx, c.label, widths[i] - CELL_PAD);
    h = Math.max(h, lines.length * LH);
  });
  return h + CELL_PAD;
}

function paintTable(ctx, width, pad, top, columns, widths, rows) {
  let y = top;
  const totalW = widths.reduce((a, b) => a + b, 0);
  const headerH = tableHeaderHeight(ctx, columns, widths);

  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(pad, y, totalW, headerH);
  let x = pad;
  columns.forEach((c, i) => {
    setFont(ctx, 22, 700);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    const lines = wrapText(ctx, c.label, widths[i] - CELL_PAD);
    lines.forEach((ln, li) => ctx.fillText(ln, x + CELL_PAD / 2, y + CELL_PAD / 2 + li * LH));
    x += widths[i];
  });
  ctx.strokeStyle = '#d3d9e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, y, totalW, headerH);
  y += headerH;

  if (!rows.length) {
    setFont(ctx, BODY, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.fillText('কোনো তথ্য নেই।', width / 2, y + CELL_PAD / 2);
    y += CELL_PAD + LH + 8;
  }
  for (const row of rows) {
    const rh = rowHeight(ctx, columns, widths, row);
    x = pad;
    columns.forEach((c, i) => {
      setFont(ctx, BODY, 400);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      const lines = cellLines(ctx, columns, widths, row)[i];
      lines.forEach((ln, li) => ctx.fillText(ln, x + CELL_PAD / 2, y + CELL_PAD / 2 + li * LH));
      x += widths[i];
    });
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y + rh);
    ctx.lineTo(pad + totalW, y + rh);
    ctx.stroke();
    y += rh;
  }

  return y;
}

function summaryHeight(summary) {
  return summary.length ? summary.length * LH + 40 : 0;
}

function paintSummary(ctx, width, pad, top, summary, paint) {
  if (!summary.length) return top;
  let y = top + 18;
  if (paint) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }
  y += 16;
  for (const s of summary) {
    if (paint) {
      setFont(ctx, 24, 400);
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.fillText(String(s.label), pad, y);
      setFont(ctx, 24, 700);
      ctx.textAlign = 'right';
      ctx.fillStyle = INK;
      ctx.fillText(String(s.value), width - pad, y);
    }
    y += LH;
  }
  return y;
}

export async function renderReportCanvases({ settings, title, subtitle, columns, rows, summary = [], generatedBy = null }) {
  await warmFonts();
  const org = resolveOrg(settings);
  const logoImg = await loadLogo(org.orgLogo || settings?.orgLogo || null);
  const opts = { settings: org, title: title || 'REPORT', subtitle, logoImg, generatedBy };
  const { width, height } = PAGE;
  const usable = width - PAD * 2;

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  const tableTop = reportHeaderPass(pctx, width, PAD, opts, false);
  const widths = columnWidths(pctx, columns, rows, usable);
  const headerH = tableHeaderHeight(pctx, columns, widths);
  const footerReserve = PAD + 80;
  const pageLimit = height - footerReserve;

  const pages = [];
  const usedYs = [];
  let current = [];
  let y = tableTop + headerH;
  for (const row of rows) {
    const rh = rowHeight(pctx, columns, widths, row);
    if (current.length && y + rh > pageLimit) {
      pages.push(current);
      usedYs.push(y);
      current = [row];
      y = tableTop + headerH;
    } else {
      current.push(row);
      y += rh;
    }
  }
  pages.push(current);
  usedYs.push(y);

  if (usedYs[usedYs.length - 1] + summaryHeight(summary) > pageLimit) {
    pages.push([]);
    usedYs.push(tableTop + headerH);
  }

  const totalPages = pages.length;

  return pages.map((chunk, idx) => {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const top = reportHeaderPass(ctx, width, PAD, opts, true);
    const bottom = paintTable(ctx, width, PAD, top, columns, widths, chunk);
    let afterSummary = bottom;
    if (idx === pages.length - 1) afterSummary = paintSummary(ctx, width, PAD, bottom, summary, true);
    paintPageFooter(ctx, width, height, PAD, org, idx + 1, totalPages, generatedBy, true);
    return canvas;
  });
}

/* ------------------------------------------------------------------ */
/* ID card, ledger and admission form documents                        */
/* ------------------------------------------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderIdCardCanvas(student, opts = {}) {
  await warmFonts();
  const width = 760;
  const org = resolveOrg(opts.settings || opts);
  const photo = student?.photo ? await assetDataUrl(student.photo) : null;
  const photoImg = photo ? await loadImage(photo).catch(() => null) : null;
  const logoImg = await loadLogo(org.orgLogo || opts.settings?.orgLogo || null);
  const fullOpts = { ...opts, student, settings: org, logoImg, photoImg, generatedBy: opts.generatedBy || null };

  const pass = (ctx, paint) => {
    const pad = 40;
    const inner = width - pad * 2;
    let y = pad;
    ctx.textBaseline = 'top';

    const center = (text, px, weight, color, lhMul = 1.4) => {
      if (!text) return;
      setFont(ctx, px, weight);
      ctx.textAlign = 'center';
      const lines = wrapText(ctx, text, inner);
      const lh = Math.round(px * lhMul);
      if (paint) {
        ctx.fillStyle = color;
        lines.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * lh));
      }
      y += lines.length * lh;
    };

    if (fullOpts.logoImg) {
      if (paint) drawLogo(ctx, fullOpts.logoImg, width / 2, y, 96);
      y += 96 + 8;
    }
    center(org.orgName, 32, 700, INK);
    if (org.address) center(org.address, 16, 400, MUTED, 1.4);
    if (org.contactLine) center(org.contactLine, 14, 400, MUTED, 1.4);
    y += 8;
    center('STUDENT ID CARD', 20, 700, ACCENT);
    center('স্টুডেন্ট আইডি কার্ড', 18, 400, MUTED);
    y += 16;

    const boxW = 150;
    const boxH = 176;
    const boxX = (width - boxW) / 2;
    if (paint) {
      ctx.fillStyle = '#eef2f7';
      roundRect(ctx, boxX, y, boxW, boxH, 12);
      ctx.fill();
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (photoImg) {
        const pw = photoImg.naturalWidth || photoImg.width;
        const ph = photoImg.naturalHeight || photoImg.height;
        if (pw && ph) {
          const scale = Math.max(boxW / pw, boxH / ph);
          const dw = pw * scale;
          const dh = ph * scale;
          ctx.save();
          roundRect(ctx, boxX, y, boxW, boxH, 12);
          ctx.clip();
          ctx.drawImage(photoImg, boxX - (dw - boxW) / 2, y - (dh - boxH) / 2, dw, dh);
          ctx.restore();
        }
      } else {
        setFont(ctx, 64, 700);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2563eb';
        ctx.fillText(String(student?.name || 'অ').trim().charAt(0) || 'অ', width / 2, y + boxH / 2 - 36);
      }
    }
    y += boxH + 20;

    const fields = [
      ['নাম', student?.name],
      ['আইডি', student?.id],
      ['শ্রেণি', student?.className],
      ['রোল', student?.roll],
      ['সেশন', formatBnDate(student?.admissionDate) || org?.academicYear || '—']
    ];
    const labelW = Math.round(inner * 0.38);
    const valueW = inner - labelW - 26;
    const lh = 32;
    for (const [label, value] of fields) {
      setFont(ctx, 22, 400);
      const ll = wrapText(ctx, label, labelW);
      setFont(ctx, 24, 700);
      const vl = wrapText(ctx, String(value ?? '—'), valueW);
      const rowH = Math.max(ll.length, vl.length) * lh + 14;
      if (paint) {
        setFont(ctx, 22, 400);
        ctx.textAlign = 'left';
        ctx.fillStyle = MUTED;
        ll.forEach((ln, i) => ctx.fillText(ln, pad, y + 7 + i * lh));
        setFont(ctx, 24, 700);
        ctx.fillStyle = INK;
        vl.forEach((ln, i) => ctx.fillText(ln, pad + labelW + 26, y + 7 + i * lh));
        ctx.strokeStyle = BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, y + rowH);
        ctx.lineTo(pad + inner, y + rowH);
        ctx.stroke();
      }
      y += rowH;
    }

    y += 30;
    if (paint) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + inner, y);
      ctx.stroke();
      setFont(ctx, 16, 400);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#374151';
      ctx.fillText('প্রতিষ্ঠানের স্বাক্ষর', width / 2, y + 10);
      y += 28;
      // footer
      setFont(ctx, 12, 400);
      ctx.fillStyle = FAINT;
      const footer = org.footerText || org.orgName;
      ctx.fillText(footer, width / 2, y);
      y += 16;
      ctx.fillText(`${formatGenDate()} | Page 1 / 1 | ${org.orgName}`, width / 2, y);
    }
    y += 42;
    return y + pad;
  };

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  const height = pass(pctx, false);

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 4;
  roundRect(ctx, 10, 10, width - 20, height - 20, 16);
  ctx.stroke();
  pass(ctx, true);
  return canvas;
}

export async function renderLedgerCanvases(student, opts = {}) {
  const fees = db.fees.list().filter((f) => f.studentId === student.id);
  const payments = db.payments.list().filter((p) => p.studentId === student.id);
  let debit = 0;
  let credit = 0;
  const rows = [];
  for (const f of fees) {
    debit += Number(f.amount || 0);
    rows.push({ date: formatBnDate(f.date) || '—', desc: `${f.month} ফি`, debit: taka(f.amount), credit: '', balance: taka(debit - credit) });
  }
  for (const p of payments) {
    credit += Number(p.amount || 0);
    rows.push({ date: formatBnDate(p.date) || '—', desc: `পেমেন্ট (${p.month})`, debit: '', credit: taka(p.amount), balance: taka(debit - credit) });
  }
  const org = resolveOrg(opts.settings || opts);
  return renderReportCanvases({
    settings: org,
    title: 'STUDENT LEDGER',
    subtitle: `${student.name || student.id} · ${student.id} — ফি লেজার`,
    columns: [
      { key: 'date', label: 'তারিখ' },
      { key: 'desc', label: 'বিবরণ' },
      { key: 'debit', label: 'ডেবিট' },
      { key: 'credit', label: 'ক্রেডিট' },
      { key: 'balance', label: 'ব্যালেন্স' }
    ],
    rows,
    summary: [
      { label: 'মোট চার্জ', value: taka(debit) },
      { label: 'মোট পরিশোধিত', value: taka(credit) },
      { label: 'বর্তমান ব্যালেন্স', value: taka(debit - credit) }
    ],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderAdmissionFormCanvases(student, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const fields = [
    ['শিক্ষার্থীর নাম', student.name],
    ['স্টুডেন্ট আইডি', student.id],
    ['শ্রেণি', student.className],
    ['শাখা (Section)', student.section],
    ['রোল', student.roll],
    ['ব্যাচ', student.batch],
    ['স্কুল / কলেজ', student.school],
    ['অভিভাবকের নাম', student.guardian],
    ['অভিভাবকের মোবাইল', student.guardianPhone || student.phone],
    ['ভর্তির তারিখ', formatBnDate(student.admissionDate)]
  ];
  return renderReportCanvases({
    settings: org,
    title: 'ADMISSION FORM',
    subtitle: `ভর্তি ফরম — ${student.name || student.id}`,
    columns: [{ key: 'label', label: 'বিবরণ' }, { key: 'value', label: 'তথ্য' }],
    rows: fields.map(([label, value]) => ({ label, value: value || '—' })),
    generatedBy: opts.generatedBy || null
  });
}

/* ------------------------------------------------------------------ */
/* Additional standard documents as per task                           */
/* ------------------------------------------------------------------ */

export async function renderStudentStatementCanvases(student, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const fees = db.fees.list().filter((f) => f.studentId === student.id);
  const payments = db.payments.list().filter((p) => p.studentId === student.id);
  const total = fees.reduce((s, f) => s + Number(f.amount || 0), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const due = total - paid;

  const infoRows = [
    { field: 'শিক্ষার্থীর নাম', value: student.name || '—' },
    { field: 'ইউনিক আইডি', value: student.id || '—' },
    { field: 'শ্রেণি', value: student.className || '—' },
    { field: 'রোল', value: student.roll || '—' },
    { field: 'শাখা', value: student.section || '—' },
    { field: 'ব্যাচ', value: student.batch || '—' },
    { field: 'মোবাইল', value: student.phone || '—' },
    { field: 'অভিভাবক', value: student.guardian || '—' },
    { field: 'মোট ফি', value: taka(total) },
    { field: 'পরিশোধিত', value: taka(paid) },
    { field: 'বকেয়া', value: taka(due) },
    { field: 'অবস্থা', value: student.status || '—' }
  ];

  return renderReportCanvases({
    settings: org,
    title: 'STUDENT STATEMENT',
    subtitle: `${student.name || ''} · ${student.id} — শিক্ষার্থী বিবরণী`,
    columns: [
      { key: 'field', label: 'বিবরণ' },
      { key: 'value', label: 'তথ্য' }
    ],
    rows: infoRows,
    summary: [
      { label: 'মোট ফি', value: taka(total) },
      { label: 'পরিশোধিত', value: taka(paid) },
      { label: 'বকেয়া', value: taka(due) }
    ],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderDueStatementCanvases(student, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const dues = db.fees.list().filter((f) => f.studentId === student.id && f.status === 'বকেয়া');
  const rows = dues.map((d) => ({
    month: d.month || '—',
    amount: taka(d.amount),
    status: d.status || 'বকেয়া',
    due: taka(d.amount)
  }));
  const totalDue = dues.reduce((s, d) => s + Number(d.amount || 0), 0);

  return renderReportCanvases({
    settings: org,
    title: 'STUDENT DUE STATEMENT',
    subtitle: `${student.name || ''} · ${student.id} — বকেয়া বিবরণী`,
    columns: DUE_STATEMENT_COLUMNS,
    rows,
    summary: [
      { label: 'মোট বকেয়া', value: taka(totalDue) }
    ],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderFinanceReportCanvases({ from, to, payments, summary } = {}, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const pays = payments || db.payments.list();
  const rows = pays.map((p) => {
    const st = db.students.find(p.studentId);
    return {
      date: formatBnDate(p.date) || '—',
      student: st?.name || p.studentId,
      type: p.month || '—',
      amount: taka(p.amount),
      method: p.method || '—'
    };
  });
  const total = pays.reduce((s, p) => s + Number(p.amount || 0), 0);

  return renderReportCanvases({
    settings: org,
    title: 'FINANCE REPORT',
    subtitle: `${from || ''}${from && to ? ' - ' : ''}${to || ''} — অর্থ বিবরণী`.trim() || 'অর্থ বিবরণী',
    columns: FINANCE_REPORT_COLUMNS,
    rows,
    summary: summary || [
      { label: 'মোট আদায়', value: taka(total) },
      { label: 'মোট লেনদেন', value: `${rows.length} টি` }
    ],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderStudentListCanvases(students, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const { rows } = classReportRows(students || db.students.list());
  return renderReportCanvases({
    settings: org,
    title: 'STUDENT LIST',
    subtitle: opts.subtitle || 'শিক্ষার্থী তালিকা',
    columns: CLASS_REPORT_COLUMNS,
    rows,
    summary: [{ label: 'মোট শিক্ষার্থী', value: bn(rows.length) }],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderTeacherReportCanvases(teachers, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const list = teachers || db.teachers.list();
  return renderReportCanvases({
    settings: org,
    title: 'TEACHER REPORT',
    subtitle: opts.subtitle || 'শিক্ষক তালিকা',
    columns: TEACHER_REPORT_COLUMNS,
    rows: list,
    summary: [{ label: 'মোট শিক্ষক', value: bn(list.length) }],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderBatchReportCanvases(batches, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const list = batches || db.batches.list();
  return renderReportCanvases({
    settings: org,
    title: 'CLASS/BATCH REPORT',
    subtitle: opts.subtitle || 'ক্লাস/ব্যাচ রিপোর্ট',
    columns: [
      { key: 'name', label: 'ব্যাচ' },
      { key: 'className', label: 'ক্লাস' },
      { key: 'teacher', label: 'শিক্ষক' },
      { key: 'students', label: 'শিক্ষার্থী' }
    ],
    rows: list,
    summary: [{ label: 'মোট ব্যাচ', value: bn(list.length) }],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderNoticeCanvases(notices, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const list = notices || db.notices.list();
  return renderReportCanvases({
    settings: org,
    title: 'NOTICE',
    subtitle: opts.subtitle || 'নোটিশ',
    columns: NOTICE_REPORT_COLUMNS,
    rows: list.map((n) => ({
      title: n.title || '—',
      className: n.className || 'সব',
      audience: n.audience || 'সবাই',
      date: formatBnDate(n.date) || '—'
    })),
    summary: [{ label: 'মোট নোটিশ', value: bn(list.length) }],
    generatedBy: opts.generatedBy || null
  });
}

export async function renderRoutineCanvases(routineRows, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const list = routineRows || db.routine.list();
  return renderReportCanvases({
    settings: org,
    title: 'CLASS ROUTINE',
    subtitle: opts.subtitle || 'ক্লাস রুটিন',
    columns: ROUTINE_REPORT_COLUMNS,
    rows: list,
    summary: [{ label: 'মোট ক্লাস', value: bn(list.length) }],
    generatedBy: opts.generatedBy || null
  });
}

/* ------------------------------------------------------------------ */
/* Generic WhatsApp-shareable image with Institution Pad               */
/* ------------------------------------------------------------------ */

export async function renderBrandedImageCanvas({ title, subtitle, lines = [], orgSettings, generatedBy } = {}) {
  await warmFonts();
  const width = 760;
  const org = resolveOrg(orgSettings || {});
  const logoImg = await loadLogo(org.orgLogo || orgSettings?.orgLogo || null);

  const pass = (ctx, paint) => {
    const pad = 44;
    const inner = width - pad * 2;
    let y = pad;
    ctx.textBaseline = 'top';

    const center = (text, px, weight, color, lhMul = 1.4) => {
      if (!text) return;
      setFont(ctx, px, weight);
      ctx.textAlign = 'center';
      const wrapped = wrapText(ctx, text, inner);
      const lh = Math.round(px * lhMul);
      if (paint) {
        ctx.fillStyle = color;
        wrapped.forEach((ln, i) => ctx.fillText(ln, width / 2, y + i * lh));
      }
      y += wrapped.length * lh;
    };

    if (logoImg) {
      if (paint) drawLogo(ctx, logoImg, width / 2, y, 96);
      y += 96 + 10;
    }
    center(org.orgName, 32, 700, INK);
    if (org.address) center(org.address, 16, 400, MUTED);
    if (org.contactLine) center(org.contactLine, 16, 400, MUTED);
    y += 12;
    center((title || 'NOTICE').toUpperCase(), 28, 700, INK);
    if (subtitle) center(subtitle, 18, 400, MUTED);
    y += 12;
    if (paint) {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(pad, y, inner, 3);
    }
    y += 21;

    for (const line of lines) {
      setFont(ctx, 20, 400);
      const wrapped = wrapText(ctx, String(line), inner);
      const lh = 28;
      if (paint) {
        ctx.textAlign = 'left';
        ctx.fillStyle = INK;
        wrapped.forEach((ln, i) => ctx.fillText(ln, pad, y + i * lh));
      }
      y += wrapped.length * lh + 10;
    }

    y += 20;
    if (paint) {
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + inner, y);
      ctx.stroke();
      y += 12;
      setFont(ctx, 12, 400);
      ctx.textAlign = 'center';
      ctx.fillStyle = FAINT;
      ctx.fillText(org.footerText || org.orgName, width / 2, y);
      y += 16;
      ctx.fillText(`${formatGenDate()} | ${org.orgName}`, width / 2, y);
      y += 16;
    } else {
      y += 50;
    }

    return y + pad;
  };

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  const height = pass(pctx, false);

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  pass(ctx, true);
  return canvas;
}


/* ------------------------------------------------------------------ */
/* MCQ question paper + answer key                                     */
/* ------------------------------------------------------------------ */

/** 'ক', 'খ', 'গ', 'ঘ' — the option markers a printed paper uses. */
const OPTION_LETTERS = ['ক', 'খ', 'গ', 'ঘ'];

/** '১. প্রশ্ন' / the option lines, wrapped to the column width. */
function questionLines(ctx, question, number, inner) {
  setFont(ctx, BODY + 3, 600);
  const text = wrapText(ctx, `${bn(number)}. ${question.q || ''}`, inner - 12);
  setFont(ctx, BODY, 400);
  const options = (question.options || []).filter(Boolean)
    .map((opt, oi) => `${OPTION_LETTERS[oi] || bn(oi + 1)}) ${opt}`);
  const half = (inner - 16) / 2;
  return { text, options, optionLines: options.map((o) => wrapText(ctx, o, half - 12)) };
}

/** Height of one question block, measured with the very same rules. */
function questionHeight(ctx, question, number, inner) {
  const { text, options, optionLines } = questionLines(ctx, question, number, inner);
  return text.length * (BODY + 9)
    + Math.ceil(options.length / 2) * (BODY + 12)
    + 16;
}

/** Paints one question block (number, text, two option columns). */
function paintQuestion(ctx, question, number, x, y, inner) {
  const { text, optionLines } = questionLines(ctx, question, number, inner);
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  setFont(ctx, BODY + 3, 600);
  text.forEach((line, i) => ctx.fillText(line, x, y + i * (BODY + 9)));
  let cursor = y + text.length * (BODY + 9) + 4;

  const half = (inner - 16) / 2;
  optionLines.forEach((lines, oi) => {
    const col = oi % 2;
    const row = Math.floor(oi / 2);
    setFont(ctx, BODY, 400);
    ctx.fillStyle = INK;
    lines.forEach((line, li) => ctx.fillText(
      line, x + col * half, cursor + row * (BODY + 12) + li * (BODY + 6)
    ));
  });
  return cursor + Math.ceil(optionLines.length / 2) * (BODY + 12) + 12;
}

/**
 * Builds the printable MCQ paper for an exam: institution pad, the exam heading
 * (class · subject · time · marks · date) and every question with its options,
 * flowing across A4 pages. With `withAnswers` a final key page is appended —
 * the teacher's copy, marked "শিক্ষকের জন্য".
 *
 * @returns {Promise<HTMLCanvasElement[]>} one canvas per page, ready for buildPdf.
 */
export async function renderQuestionPaperCanvases(exam, { settings, withAnswers = false, generatedBy = null } = {}) {
  await warmFonts();
  const org = resolveOrg(settings || {});
  const logoImg = await loadLogo(org.orgLogo || settings?.orgLogo || null);
  const { width, height } = PAGE;
  const pad = PAD;
  const inner = width - pad * 2;
  const pageLimit = height - (pad + 90);

  const questions = (exam?.questions || []).filter((q) => q && q.q);
  const heading = [
    exam?.className ? `শ্রেণি: ${exam.className}` : '',
    exam?.subject ? `বিষয়: ${exam.subject}` : '',
    exam?.duration ? `সময়: ${bn(exam.duration)} মিনিট` : '',
    questions.length ? `পূর্ণমান: ${bn(questions.length)}` : '',
    exam?.date ? `তারিখ: ${formatBnDate(exam.date)}` : ''
  ].filter(Boolean).join('   ·   ');

  const opts = {
    settings: org,
    title: exam?.title || 'MCQ পরীক্ষা',
    subtitle: 'বহুনির্বাচনি প্রশ্নপত্র',
    logoImg,
    generatedBy
  };

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  pctx.textBaseline = 'top';
  const headerH = reportHeaderPass(pctx, width, pad, opts, false);
  const firstTop = headerH + 6 + (heading ? LH + 8 : 0) + LH + 10;
  const nextTop = headerH + 6 + LH + 4;

  // Split the questions into pages of what fits (the first page carries the
  // heading and the instruction line).
  const pages = [];
  let current = [];
  let y = firstTop;
  questions.forEach((question, index) => {
    const h = questionHeight(pctx, question, index + 1, inner);
    if (current.length && y + h > pageLimit) {
      pages.push(current);
      current = [];
      y = nextTop;
    }
    current.push({ question, number: index + 1, y });
    y += h;
  });
  pages.push(current);
  if (!questions.length) pages[0] = [];

  const totalPages = pages.length + (withAnswers ? 1 : 0);

  const canvases = pages.map((page, index) => {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'top';
    const top = reportHeaderPass(ctx, width, pad, opts, true);
    let y = top + 6;

    ctx.textAlign = 'center';
    if (index === 0) {
      if (heading) {
        setFont(ctx, 20, 600);
        ctx.fillStyle = INK;
        ctx.fillText(heading, width / 2, y);
        y += LH + 8;
      }
      setFont(ctx, 18, 400);
      ctx.fillStyle = MUTED;
      ctx.fillText('নিচের প্রতিটি প্রশ্নের সঠিক উত্তরে টিক (✓) দিন।', width / 2, y);
      y += LH + 10;
    } else {
      setFont(ctx, 16, 400);
      ctx.fillStyle = MUTED;
      ctx.fillText(`${exam?.title || ''} · পৃষ্ঠা ${bn(index + 1)}`, width / 2, y);
      y += LH + 4;
    }

    if (!page.length) {
      setFont(ctx, BODY, 400);
      ctx.fillStyle = MUTED;
      ctx.fillText('এই পরীক্ষায় এখনো কোনো প্রশ্ন যোগ করা হয়নি।', width / 2, firstTop);
    }
    page.forEach(({ question, number, y: lineY }) => {
      paintQuestion(ctx, question, number, pad + 6, lineY, inner);
    });

    paintPageFooter(ctx, width, height, pad, org, index + 1, totalPages, generatedBy, true);
    return canvas;
  });

  if (withAnswers) {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'top';
    const top = reportHeaderPass(ctx, width, pad, { ...opts, subtitle: 'সঠিক উত্তরপত্র — শিক্ষকের জন্য' }, true);
    let y = top + 10;

    setFont(ctx, 18, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.fillText(`${exam?.className || ''}${exam?.subject ? ` · ${exam.subject}` : ''} · মোট প্রশ্ন: ${bn(questions.length)}`, width / 2, y);
    y += LH + 16;

    const cols = 4;
    const colW = inner / cols;
    const rowH = LH + 8;
    const maxRows = Math.max(1, Math.floor((pageLimit - y) / rowH));
    questions.slice(0, cols * maxRows).forEach((question, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const lineY = y + row * rowH;
      setFont(ctx, BODY + 2, 700);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.fillText(`${bn(index + 1)}.`, pad + col * colW, lineY);
      ctx.fillStyle = ACCENT;
      ctx.fillText(`${OPTION_LETTERS[question.answer] ?? ''}`, pad + col * colW + 60, lineY);
    });
    y += Math.min(questions.length, cols * maxRows) === 0 ? 0 : Math.ceil(Math.min(questions.length, cols * maxRows) / cols) * rowH + 16;
    if (questions.length > cols * maxRows) {
      setFont(ctx, 16, 400);
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(`বাকি ${bn(questions.length - cols * maxRows)}টি উত্তর পরের পৃষ্ঠায়`, width / 2, y);
      y += LH;
    }

    setFont(ctx, 15, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = FAINT;
    ctx.fillText('এই পৃষ্ঠাটি শিক্ষকের জন্য — শিক্ষার্থীদের দেওয়ার আগে সরিয়ে নিন।', width / 2, Math.min(y + 10, pageLimit));

    paintPageFooter(ctx, width, height, pad, org, totalPages, totalPages, generatedBy, true);
    canvases.push(canvas);
  }

  return canvases;
}

export function receiptPdfFileName(pay) {
  return `receipt-${pay.receiptNo || pay.id}.pdf`;
}

export async function receiptPreviewDoc(pay, opts = {}) {
  const org = resolveOrg(opts.settings || opts);
  const canvas = await renderReceiptCanvas(pay, { ...opts, settings: org });
  return {
    title: 'পেমেন্ট রিসিট',
    meta: `${pay.receiptNo || pay.id} · ${opts.student?.name || pay.studentId} — ${org.orgName}`,
    filename: receiptPdfFileName(pay),
    canvases: [canvas],
    shareable: true
  };
}
