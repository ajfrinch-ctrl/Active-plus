/**
 * Dependency-free document utilities.
 *
 * No third-party libraries: receipts and reports are drawn directly with the
 * Canvas 2D API (no SVG <foreignObject>, which browsers refuse to export to
 * canvas — that path taints the canvas and breaks toDataURL/PDF export). The
 * resulting canvases are either shared as a PNG (receipt) or embedded into a
 * minimal, hand-written PDF (reports). Every generated file is free of the
 * application UI and works on mobile + desktop browsers alike.
 *
 * Institution Pad/Logo standard:
 * - The institution logo configured in Admin → Institution Profile / Pad Settings
 *   is stored locally (data URL) and reused automatically for ALL PDFs and
 *   WhatsApp-shareable images.
 * - Every PDF header must show: [Logo] INSTITUTION NAME, Address, Mobile | Email | Website
 * - Every PDF footer must show institution info, generated date, page number, etc.
 * - No institutional PDF may be generated without branding — this module always
 *   tries the custom logo first, then falls back to the default asset.
 */

import { readJSON } from './store.js';

/**
 * Absolute same-origin URL for an asset.
 */
export function absUrl(path) {
  try { return new URL(path, document.baseURI).href; } catch (e) { return path; }
}

/** Trigger a client-side file download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Create a blank canvas of the given size. */
export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Load an image (data URL or same-origin URL) into an <img> element. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

let logoDataUrlCache = null;
let customLogoChecked = false;

/**
 * Try to read the institution's custom logo stored locally.
 * The logo is saved as a data URL in settings.orgLogo (see data.js).
 * We read directly from the layered store so it works even when localStorage
 * is blocked (memory fallback) and in Node tests.
 */
function getCustomLogoDataUrl() {
  try {
    const rawStore = readJSON('activeplus_data', null);
    const custom = rawStore?.collections?.settings?.orgLogo;
    if (custom && typeof custom === 'string' && custom.startsWith('data:image/')) {
      return custom;
    }
  } catch (e) { /* ignore */ }
  // Fallback: direct localStorage parse for older stores
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('activeplus_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        const custom = parsed?.collections?.settings?.orgLogo;
        if (custom && typeof custom === 'string' && custom.startsWith('data:image/')) {
          return custom;
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/** Clear the cached logo — call after admin updates the institution logo. */
export function clearLogoCache() {
  logoDataUrlCache = null;
  customLogoChecked = false;
}

/**
 * Fetch an asset (same-origin, or cross-origin if the server allows CORS) and
 * return it as a data URL, so drawing it never taints the canvas. Returns
 * `null` when the asset cannot be loaded — callers then fall back gracefully.
 */
export async function assetDataUrl(path) {
  const src = absUrl(path);
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`asset fetch ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('asset read failed'));
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

/**
 * The institution logo as a data URL.
 * - First tries the custom logo uploaded by admin (stored locally, reused automatically)
 * - Then falls back to the default asset logo
 * A data URL can always be drawn to canvas without tainting it. Cached for page lifetime
 * but automatically picks up a new custom logo when clearLogoCache() is called.
 */
export async function logoDataUrl() {
  // Always prefer the custom logo if present — even if we have a cached default,
  // a newly uploaded logo must be used immediately for all PDFs and WhatsApp images.
  const custom = getCustomLogoDataUrl();
  if (custom) {
    logoDataUrlCache = custom;
    customLogoChecked = true;
    return custom;
  }
  // If we already checked and cached the default, reuse it
  if (logoDataUrlCache && customLogoChecked) return logoDataUrlCache;
  if (logoDataUrlCache && !custom) return logoDataUrlCache;

  // No custom logo — load the bundled asset
  const asset = await assetDataUrl('assets/logo.png');
  logoDataUrlCache = asset || absUrl('assets/logo.png');
  customLogoChecked = true;
  return logoDataUrlCache;
}

/**
 * Wrap `text` into lines that fit `maxWidth`. Words break on spaces; a single
 * word longer than the line is broken by character.
 */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else if (line) {
      lines.push(line);
      line = word;
    } else {
      let acc = '';
      for (const ch of word) {
        if (acc && ctx.measureText(acc + ch).width > maxWidth) { lines.push(acc); acc = ch; }
        else acc += ch;
      }
      line = acc;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** `data:image/jpeg;base64,...` → raw bytes. */
export function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Build a minimal but valid PDF whose pages are full-page JPEG images.
 * `images` is an array of `{ w, h, bytes }` (raw JPEG bytes).
 * Pure function — safe to unit test in Node.
 */
export function buildPdf(images, { widthPt = 595, heightPt = 842 } = {}) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
    return offset;
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const n = images.length;
  const total = 2 + n * 3;
  const bodies = new Array(total + 1);

  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[2] = `<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${n} >>`;

  images.forEach((img, i) => {
    const pageId = 3 + i * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;
    bodies[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] `
      + `/Resources << /XObject << /Im0 ${imgId} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>`;
    bodies[imgId] = {
      header: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`,
      bytes: img.bytes
    };
    const content = `q\n${widthPt} 0 0 ${heightPt} 0 0 cm\n/Im0 Do\nQ`;
    bodies[contentId] = `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`;
  });

  const offsets = new Array(total + 1);
  for (let id = 1; id <= total; id += 1) {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
    const body = bodies[id];
    if (body && body.bytes) {
      push(body.header);
      push(body.bytes);
      push('\nendstream');
    } else {
      push(`${String(body)}\n`);
    }
    push('\nendobj\n');
  }

  const xrefStart = offset;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id += 1) {
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  push(xref);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/**
 * Render one or more canvases (A4 aspect) into a single PDF and download it.
 */
export async function canvasesToPdf(canvases, filename, { quality = 0.92 } = {}) {
  const images = canvases.map((c) => ({
    w: c.width,
    h: c.height,
    bytes: dataUrlToBytes(c.toDataURL('image/jpeg', quality))
  }));
  const pdf = buildPdf(images);
  downloadBlob(new Blob([pdf], { type: 'application/pdf' }), filename);
}

/** Canvas → PNG Blob (used for the receipt image share). */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/png');
  });
}
