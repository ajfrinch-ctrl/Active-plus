/**
 * Clean, standalone document builders (payment receipt + report pages).
 *
 * Two outputs share the same field logic:
 *   - HTML builders (buildReceiptHtml / buildReportHtml) render a clean
 *     standalone sheet for on-screen preview/tests.
 *   - Canvas renderers (renderReceiptCanvas / renderReportCanvases) draw the
 *     same document straight onto a canvas with the Canvas 2D API, so it can
 *     be shared as a PNG or embedded in a PDF on every browser — no SVG
 *     <foreignObject> (which taints the canvas and blocks export).
 *
 * Neither output contains any application UI.
 */

import { db, CLASS_TO_NUMBER, ALL_CLASSES, formatDateBn } from './data.js';
import { absUrl, downloadBlob, canvasToPngBlob, logoDataUrl, assetDataUrl, loadImage, makeCanvas, wrapText } from './pdf.js';

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

/** Receipt rows in display order — shared by the HTML and canvas renderers. */
function receiptRows(pay, { student }) {
  const { previousDue, paidAmount, remainingDue } = receiptSummary(pay);
  const rows = [
    ['রিসিট নম্বর', pay.receiptNo || pay.id],
    ['তারিখ', pay.date || '—'],
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

/** Clean, professional, print/PDF-ready payment receipt (no app UI). */
export function buildReceiptHtml(pay, { student, settings, logo } = {}) {
  const org = settings || {};
  const logoSrc = logo || absUrl('assets/logo.png');

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 2px;border-bottom:1px solid #eef0f3;font-size:14px;line-height:1.5">
      <span style="color:#5b6470;flex:none">${label}</span>
      <span style="font-weight:600;text-align:right;color:#111827;word-break:break-word">${value}</span>
    </div>`;

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
    <div style="text-align:center;margin-top:18px;font-size:11px;color:#9ca3af">ধন্যবাদ — Active Plus</div>
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

async function loadLogo() {
  try {
    return await loadImage(await logoDataUrl());
  } catch (e) {
    return null; // drawing without a logo is always better than failing
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

/**
 * Receipt layout pass. Runs twice: once to measure the height (paint=false)
 * and once to actually paint (paint=true). Both passes advance the cursor
 * identically so the measured height is exact.
 */
function receiptPass(ctx, width, pay, opts, paint) {
  const pad = 44;
  const inner = width - pad * 2;
  let y = pad;
  const org = opts.settings || {};

  ctx.textBaseline = 'top';

  const center = (text, px, weight, color, lhMul = 1.4) => {
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

  center(org.orgName || 'Active Plus', 32, 700, INK);
  if (org.address) center(org.address, 16, 400, MUTED, 1.4);
  const contact = [org.mobile, org.email].filter(Boolean).join(' · ');
  if (contact) center(contact, 16, 400, MUTED, 1.4);

  y += 16;
  center('পেমেন্ট রিসিট', 28, 700, INK);
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

  if (paint) {
    setFont(ctx, 15, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = FAINT;
    ctx.fillText('ধন্যবাদ — Active Plus', width / 2, y);
  }
  y += 26;

  return y + pad;
}

/** Draw the receipt onto a clean canvas (white background, no app UI). */
export async function renderReceiptCanvas(pay, opts = {}) {
  await warmFonts();
  const width = 760;
  const fullOpts = { ...opts, logoImg: await loadLogo() };

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

/**
 * Share the receipt as an IMAGE via the Web Share API (native share sheet →
 * user picks WhatsApp). Falls back to downloading the PNG when file sharing
 * is unsupported. Never sends the receipt as a text-only message.
 */
export async function shareReceiptAsImage(pay, opts) {
  const canvas = await renderReceiptCanvas(pay, opts);
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
  const canvas = await renderReceiptCanvas(pay, opts);
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
 * Clean standalone report page (HTML form — used for preview/tests). `columns`
 * are `{ key, label }`, rows are plain objects. Values are escaped.
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
      Active Plus · ${formatDateBn(new Date())}
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

/* ------------------------------------------------------------------ */
/* Canvas report renderer (paged, no app UI)                           */
/* ------------------------------------------------------------------ */

const PAGE = { width: 1240, height: 1754 };
const PAD = 60;
const CELL_PAD = 22;
const BODY = 21;
const LH = 30;

function reportHeaderPass(ctx, width, pad, opts, paint) {
  const org = opts.settings || {};
  let y = pad;
  const inner = width - pad * 2;

  ctx.textBaseline = 'top';
  const center = (text, px, weight, color, lhMul = 1.4) => {
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
  center(org.orgName || 'Active Plus', 36, 700, INK);
  if (org.address) center(org.address, 18, 400, MUTED, 1.4);
  const contact = [org.mobile, org.email].filter(Boolean).join(' · ');
  if (contact) center(contact, 18, 400, MUTED, 1.4);
  y += 16;
  center(opts.title || 'রিপোর্ট', 32, 700, INK);
  if (opts.subtitle) center(opts.subtitle, 22, 400, MUTED, 1.4);
  y += 14;
  if (paint) {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(pad, y, inner, 3);
  }
  y += 3 + 18;
  return y; // top of the table
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
  // Spread any leftover space across the columns so the table always spans the
  // full page width — a short report must not sit squeezed onto one side.
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

function paintTable(ctx, width, pad, top, columns, widths, rows, pageHeight) {
  let y = top;
  const totalW = widths.reduce((a, b) => a + b, 0);
  const headerH = tableHeaderHeight(ctx, columns, widths);

  // header row
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

  // data rows (or an honest empty state)
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

  // footer
  setFont(ctx, 16, 400);
  ctx.textAlign = 'center';
  ctx.fillStyle = FAINT;
  ctx.fillText(`Active Plus · ${formatDateBn(new Date())}`, width / 2, pageHeight - pad - 14);

  return y; // bottom of the table, so callers can append a summary
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

/**
 * Render a report into one or more A4 canvases (a new page is started when a
 * row would overflow). `summary` is an optional `[{ label, value }]` totals
 * block drawn after the final table row. Returns an array of canvases ready
 * for canvasesToPdf.
 */
export async function renderReportCanvases({ settings, title, subtitle, columns, rows, summary = [] }) {
  await warmFonts();
  const opts = { settings, title, subtitle, logoImg: await loadLogo() };
  const { width, height } = PAGE;
  const usable = width - PAD * 2;

  const probe = makeCanvas(width, 4);
  const pctx = probe.getContext('2d');
  const tableTop = reportHeaderPass(pctx, width, PAD, opts, false);
  const widths = columnWidths(pctx, columns, rows, usable);
  const headerH = tableHeaderHeight(pctx, columns, widths);
  const footerReserve = PAD + 60;
  const pageLimit = height - footerReserve;

  // paginate, tracking how far down each page is filled so the summary has room
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

  // if the summary will not fit on the final page, give it a page of its own
  if (usedYs[usedYs.length - 1] + summaryHeight(summary) > pageLimit) {
    pages.push([]);
    usedYs.push(tableTop + headerH);
  }

  return pages.map((chunk, idx) => {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const top = reportHeaderPass(ctx, width, PAD, opts, true);
    const bottom = paintTable(ctx, width, PAD, top, columns, widths, chunk, height);
    if (idx === pages.length - 1) paintSummary(ctx, width, PAD, bottom, summary, true);
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

/**
 * Student ID card — a clean standalone card (logo, institution, photo/initial,
 * name, ID, class, roll, session, signature). Nothing else renders.
 */
export async function renderIdCardCanvas(student, opts = {}) {
  await warmFonts();
  const width = 760;
  const settings = opts.settings || {};
  const photo = student?.photo ? await assetDataUrl(student.photo) : null;
  const photoImg = photo ? await loadImage(photo).catch(() => null) : null;
  const fullOpts = { ...opts, student, settings, logoImg: await loadLogo(), photoImg };

  const pass = (ctx, paint) => {
    const pad = 40;
    const inner = width - pad * 2;
    let y = pad;
    const org = settings || {};
    ctx.textBaseline = 'top';

    const center = (text, px, weight, color, lhMul = 1.4) => {
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
    center(org.orgName || 'Active Plus', 32, 700, INK);
    y += 8;
    center('স্টুডেন্ট আইডি কার্ড', 22, 700, ACCENT);
    y += 16;

    // photo box
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

    // fields
    const fields = [
      ['নাম', student?.name],
      ['আইডি', student?.id],
      ['শ্রেণি', student?.className],
      ['রোল', student?.roll],
      ['সেশন', student?.admissionDate || settings?.academicYear || '—']
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

/** Student fee ledger — charges + payments with a running balance and totals. */
export async function renderLedgerCanvases(student, opts = {}) {
  const fees = db.fees.list().filter((f) => f.studentId === student.id);
  const payments = db.payments.list().filter((p) => p.studentId === student.id);
  let debit = 0;
  let credit = 0;
  const rows = [];
  for (const f of fees) {
    debit += Number(f.amount || 0);
    rows.push({ date: f.date || '—', desc: `${f.month} ফি`, debit: taka(f.amount), credit: '', balance: taka(debit - credit) });
  }
  for (const p of payments) {
    credit += Number(p.amount || 0);
    rows.push({ date: p.date || '—', desc: `পেমেন্ট (${p.month})`, debit: '', credit: taka(p.amount), balance: taka(debit - credit) });
  }
  return renderReportCanvases({
    settings: opts.settings || {},
    title: 'ফি লেজার',
    subtitle: `${student.name || student.id} · ${student.id}`,
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
    ]
  });
}

/** Admission form — student details as a full-width A4 sheet with signatures. */
export async function renderAdmissionFormCanvases(student, opts = {}) {
  const fields = [
    ['শিক্ষার্থীর নাম', student.name],
    ['স্টুডেন্ট আইডি', student.id],
    ['শ্রেণি', student.className],
    ['শাখা (Section)', student.section],
    ['রোল', student.roll],
    ['ব্যাচ', student.batch],
    ['স্কুল / কলেজ', student.school],
    ['অভিভাবকের নাম', student.guardian],
    ['শিক্ষার্থীর মোবাইল', student.phone],
    ['অভিভাবকের মোবাইল', student.guardianPhone || student.phone],
    ['ভর্তির তারিখ', student.admissionDate]
  ];
  const canvases = await renderReportCanvases({
    settings: opts.settings || {},
    title: 'ভর্তি ফরম',
    subtitle: 'Admission Form',
    columns: [{ key: 'label', label: 'বিবরণ' }, { key: 'value', label: 'তথ্য' }],
    rows: fields.map(([label, value]) => ({ label, value: value || '—' })),
    summary: [
      { label: 'অভিভাবকের স্বাক্ষর', value: '____________________' },
      { label: 'প্রতিষ্ঠানের স্বাক্ষর', value: '____________________' }
    ]
  });
  return canvases;
}

export function receiptPdfFileName(pay) {
  return `receipt-${pay.receiptNo || pay.id}.pdf`;
}

/** A receipt document ready for the shared preview → download/share flow. */
export async function receiptPreviewDoc(pay, opts = {}) {
  const canvas = await renderReceiptCanvas(pay, opts);
  return {
    title: 'পেমেন্ট রিসিট',
    meta: `${pay.receiptNo || pay.id} · ${opts.student?.name || pay.studentId}`,
    filename: receiptPdfFileName(pay),
    canvases: [canvas],
    shareable: true
  };
}
