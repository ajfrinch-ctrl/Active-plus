/**
 * Centralized document preview system.
 *
 * Every document (receipt, ID card, ledger, admission form, any report) flows
 * through one component: render to A4 canvases → `previewDocument(doc)` →
 * review in the preview modal → Download PDF / Share Image. There is never a
 * direct download or a direct print from any feature.
 *
 * The page must include the shared modal shell (see admin.html):
 *
 *   <div class="modal-overlay" id="document-preview-modal" aria-hidden="true">
 *     <div class="modal-content doc-preview">
 *       <button class="modal-close" data-close aria-label="বন্ধ করুন">×</button>
 *       <div class="doc-preview-head">
 *         <h2 id="document-preview-title">Document Preview</h2>
 *         <p id="document-preview-meta"></p>
 *       </div>
 *       <div class="doc-preview-body" id="document-preview-body"></div>
 *       <div class="doc-preview-actions">
 *         <button id="document-preview-download">⬇️ Download PDF</button>
 *         <button id="document-preview-share">📱 Share Image</button>
 *       </div>
 *     </div>
 *   </div>
 */

import { openModal, closeModal, showToast } from './app.js';
import { canvasesToPdf, canvasToPngBlob, downloadBlob, makeCanvas } from './pdf.js';

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

/** The document currently being previewed. */
let currentDoc = null;

function title() {
  return document.getElementById('document-preview-title');
}
function meta() {
  return document.getElementById('document-preview-meta');
}
function body() {
  return document.getElementById('document-preview-body');
}
function downloadBtn() {
  return document.getElementById('document-preview-download');
}
function shareBtn() {
  return document.getElementById('document-preview-share');
}

/** Wire the modal's action buttons once (idempotent). */
export function mountDocumentPreview() {
  if (!document.getElementById('document-preview-modal')) return;
  downloadBtn()?.addEventListener('click', async () => {
    if (!currentDoc) return;
    const btn = downloadBtn();
    btn.disabled = true;
    try {
      await canvasesToPdf(currentDoc.canvases, currentDoc.filename);
      showToast('PDF ডাউনলোড হয়েছে।', 'success');
    } catch (e) {
      showToast('PDF তৈরি করা যায়নি।', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  shareBtn()?.addEventListener('click', async () => {
    if (!currentDoc || !currentDoc.canvases.length) return;
    const btn = shareBtn();
    btn.disabled = true;
    try {
      const blob = await canvasToPngBlob(currentDoc.canvases[0]);
      const name = currentDoc.filename.replace(/\.pdf$/i, '') + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: currentDoc.title });
        showToast('ছবি শেয়ার করা হয়েছে।', 'success');
      } else {
        downloadBlob(blob, name);
        showToast('ছবি ডাউনলোড হয়েছে — WhatsApp থেকে শেয়ার করুন।', 'info');
      }
    } catch (e) {
      if (!(e && e.name === 'AbortError')) showToast('ছবি শেয়ার করা যায়নি।', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * Open the shared preview modal for a document.
 *
 * `doc` = { title, meta?, filename, canvases (Canvas[]), shareable? }
 * Share is offered for single-page documents (receipts, ID cards, ledgers);
 * multi-page reports are PDF-only.
 */
export async function previewDocument(doc) {
  const modal = document.getElementById('document-preview-modal');
  if (!modal) return;
  currentDoc = doc;
  if (title()) title().textContent = doc.title || 'Document Preview';
  if (meta()) {
    meta().textContent = doc.meta || '';
    meta().hidden = !doc.meta;
  }

  // A4-simulation pages: scale each canvas down to a viewable width and show it
  // as an image, one stacked "sheet" per page.
  const PREVIEW_W = 900;
  const pages = doc.canvases.map((canvas) => {
    const w = PREVIEW_W;
    const h = Math.round(canvas.height * (w / canvas.width));
    const scaled = makeCanvas(w, h);
    const ctx = scaled.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return { url: scaled.toDataURL('image/png'), width: w, height: h };
  });

  body().innerHTML = pages.map((p, i) => `
    <figure class="doc-page">
      <img src="${p.url}" alt="পৃষ্ঠা ${bn(i + 1)}" width="${p.width}" height="${p.height}">
      <figcaption>${bn(i + 1)} / ${bn(pages.length)}</figcaption>
    </figure>`).join('');

  const single = doc.canvases.length === 1;
  if (shareBtn()) shareBtn().hidden = !(doc.shareable !== false && single);
  if (downloadBtn()) downloadBtn().hidden = false;

  openModal('document-preview-modal');
}

/** Close the preview modal. */
export function closeDocumentPreview() {
  currentDoc = null;
  closeModal('document-preview-modal');
}
