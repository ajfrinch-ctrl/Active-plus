/**
 * Printing a receipt, ID card or fee ledger (specs 29, 40).
 *
 * Those sheets are rendered inside a modal, so the print stylesheet has to keep
 * the open modal on the page and drop the app shell instead of hiding every
 * modal — otherwise the user prints a blank sheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { openModal, closeModal } from '../js/app.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

function makeDoc() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="app"><header class="app-header">h</header><main>m</main></div>
    <div class="modal-overlay" id="receipt-modal" aria-hidden="true">
      <div class="modal-content">
        <button type="button" class="modal-close" data-close>×</button>
        <div data-receipt-sheet>রিসিট</div>
        <button type="button" class="btn" id="receipt-print">প্রিন্ট</button>
      </div>
    </div>
  </body></html>`, { url: 'http://localhost:8080/admin.html' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  return dom;
}

test('openModal marks the body so print can drop the app shell', () => {
  const dom = makeDoc();
  openModal('receipt-modal');
  assert.ok(dom.window.document.body.classList.contains('modal-open'),
    'body is flagged while a modal is open');
  assert.ok(dom.window.document.getElementById('receipt-modal').classList.contains('active'));

  closeModal('receipt-modal');
  assert.equal(dom.window.document.body.classList.contains('modal-open'), false,
    'the flag is cleared once no modal is open');
});

test('the flag survives until the last modal closes', () => {
  const dom = makeDoc();
  const second = dom.window.document.createElement('div');
  second.className = 'modal-overlay';
  second.id = 'payment-modal';
  second.innerHTML = '<div class="modal-content">x</div>';
  dom.window.document.body.appendChild(second);

  openModal('receipt-modal');
  openModal('payment-modal');
  closeModal('payment-modal');
  assert.ok(dom.window.document.body.classList.contains('modal-open'),
    'still open because another modal is showing');
  closeModal('receipt-modal');
  assert.equal(dom.window.document.body.classList.contains('modal-open'), false);
});

test('the print stylesheet prints the open sheet, not a blank page', () => {
  const css = read('css/style.css');
  const block = css.slice(css.indexOf('@media print'));
  assert.ok(block.includes('.modal-overlay.active'),
    'the active modal is styled for print');
  assert.match(block, /\.modal-overlay\.active\s*\{[^}]*display:\s*block/,
    'the open modal is displayed when printing');
  assert.match(block, /body\.modal-open \.app\s*\{[^}]*display:\s*none/,
    'the app shell behind the sheet is hidden');
  assert.match(block, /\.modal-close[\s\S]{0,80}display:\s*none/,
    'the close button is not printed');
  assert.equal(/\.toast-container,\s*\.modal-overlay\s*\{/.test(block), false,
    'modals are no longer hidden wholesale when printing');
});
