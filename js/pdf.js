/**
 * Dependency-free document utilities.
 *
 * No third-party libraries: receipts and reports are rendered as clean,
 * standalone HTML templates (inline styles only) and captured to a canvas via
 * an SVG <foreignObject>, then either shared as a PNG (receipt) or embedded
 * into a minimal, hand-written PDF (reports). This keeps every generated file
 * free of the application UI and works on mobile + desktop browsers alike.
 */

/**
 * Absolute same-origin URL for an asset (the SVG foreignObject renderer needs
 * an absolute URL; relative paths would not resolve inside a data: SVG).
 */
export function absUrl(path) {
  try { return new URL(path, document.baseURI).href; } catch (e) { return path; }
}

let logoDataUrlCache = null;

/**
 * The centre logo as a data URL. Browsers refuse to load external resources
 * from inside an SVG that is itself used as an <img>, so the SVG foreignObject
 * capture must inline the logo as a data URL rather than an http(s) URL.
 * Fetched once, then cached for the page lifetime.
 */
export async function logoDataUrl() {
  if (logoDataUrlCache) return logoDataUrlCache;
  const fallback = absUrl('assets/logo.png');
  try {
    const res = await fetch(fallback);
    if (!res.ok) throw new Error(`logo fetch ${res.status}`);
    const blob = await res.blob();
    logoDataUrlCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('logo read failed'));
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    logoDataUrlCache = fallback; // last resort: let the browser try the URL
  }
  return logoDataUrlCache;
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

/**
 * Render a standalone HTML string to a canvas (SVG foreignObject technique).
 * The HTML must be self-contained (inline styles, absolute/same-origin assets).
 */
export async function htmlToCanvas({ html, width, height, bg = '#ffffff' }) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* proceed without font wait */ }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`
    + `</foreignObject></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('render failed'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
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
