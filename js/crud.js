/**
 * Generic CRUD engine — one consistent, mobile-friendly list + modal used by
 * every admin module (classes, subjects, materials, assignments, routine…).
 * Handles search, validation, duplicate-ID guards, delete confirmation and
 * activity logging so each module stays tiny.
 */

import {
  db, logActivity, newId, getDbStatus, formatBnDate, parseBnDateInput, looksLikeDate, BN_DATE_PLACEHOLDER
} from './data.js';
import { escapeHtml, openModal, closeModal, showToast, requireOnline } from './app.js';

let modalSeq = 0;

/**
 * A field that holds a date: a declaration date, a deadline, an exam date…
 * They are typed and shown the Bengali long way (১৬ সেপ্টেম্বর ২০২৬) and
 * normalised back to the canonical Bengali ISO date the store keeps.
 */
const isDateField = (field) => ['date', 'datetime', 'deadline'].includes(field.type)
  || /date|deadline/i.test(String(field.name || ''));

function buildFieldHtml(field) {
  const id = `f-${field.name}`;
  const label = `<label for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`;
  let input;
  let hint = '';
  if (field.type === 'select') {
    input = `<select class="form-input form-select" id="${id}" name="${field.name}">
      ${(field.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    input = `<textarea class="form-input form-textarea" id="${id}" name="${field.name}"></textarea>`;
  } else if (isDateField(field)) {
    input = `<input class="form-input" id="${id}" name="${field.name}" type="text" inputmode="text" placeholder="${BN_DATE_PLACEHOLDER}" autocomplete="off">`;
    hint = `<small class="form-hint">তারিখ এভাবে লিখুন: ${BN_DATE_PLACEHOLDER}</small>`;
  } else {
    const attrs = field.type === 'number' ? 'type="number"' : field.type === 'tel' ? 'type="tel" inputmode="tel"' : 'type="text"';
    input = `<input class="form-input" id="${id}" name="${field.name}" ${attrs}>`;
  }
  return `<div class="form-group">${label}${input}${hint}</div>`;
}

export function mountCrud(cfg) {
  const {
    container, collection, keyField = 'id', singular = 'রেকর্ড',
    columns, fields, searchKeys = [], idPrefix = 'rec',
    buildRecord = (form) => form, searchPlaceholder = 'খুঁজুন…', session
  } = cfg;

  const host = document.getElementById(container);
  if (!host) return null;
  const collectionApi = db[collection];
  const modalId = `crud-modal-${++modalSeq}`;
  let searchTerm = '';

  host.innerHTML = `
    <div class="form-group" style="max-width:280px">
      <input class="form-input" placeholder="${escapeHtml(searchPlaceholder)}"
             aria-label="${escapeHtml(searchPlaceholder)}" data-crud-search>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr></tr></thead><tbody></tbody></table></div>`;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = modalId;
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true">
      <button type="button" class="modal-close" data-close aria-label="বন্ধ করুন">×</button>
      <h2 data-crud-title>${escapeHtml(singular)}</h2>
      <form data-crud-form>
        <input type="hidden" data-crud-edit value="">
        ${fields.map(buildFieldHtml).join('')}
        <button type="submit" class="btn btn-block" data-crud-save>সংরক্ষণ</button>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const form = modal.querySelector('[data-crud-form]');
  // Spec 51: never report a saved record that could not be saved.
  const onlineFor = (action) => requireOnline(action, getDbStatus);

  const matches = (row) => {
    if (!searchTerm) return true;
    return searchKeys.some((k) => String(row[k] || '').toLowerCase().includes(searchTerm));
  };

  const render = () => {
    const rows = collectionApi.list().filter(matches);
    const table = host.querySelector('table');
    table.querySelector('thead tr').innerHTML = [...columns, { key: '_a', label: 'অ্যাকশন' }]
      .map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join('');
    const cell = (row, c) => {
      if (c.render) return c.render(row);
      const value = row[c.key];
      return looksLikeDate(value) ? escapeHtml(formatBnDate(value)) : escapeHtml(value);
    };
    table.querySelector('tbody').innerHTML = rows.length
      ? rows.map((row) => `<tr>${columns.map((c) => `<td>${cell(row, c)}</td>`).join('')}
        <td><span class="row-actions">
          <button type="button" class="btn btn-small btn-secondary" data-edit="${escapeHtml(row[keyField])}">সম্পাদনা</button>
          <button type="button" class="btn btn-small btn-error" data-delete="${escapeHtml(row[keyField])}">মুছুন</button>
        </span></td></tr>`).join('')
      : `<tr><td colspan="${columns.length + 1}"><div class="empty-state">কোনো ${escapeHtml(singular)} নেই।</div></td></tr>`;
  };

  const openModalFor = (editKey = null) => {
    form.reset();
    form.querySelector('[data-crud-edit]').value = '';
    if (editKey) {
      const row = collectionApi.find(editKey);
      if (!row) return;
      modal.querySelector('[data-crud-title]').textContent = `${singular} সম্পাদনা`;
      form.querySelector('[data-crud-edit]').value = editKey;
      fields.forEach((f) => {
        const el = form.elements[f.name];
        if (!el) return;
        const stored = row[f.name] ?? '';
        const value = isDateField(f) && stored !== '' ? formatBnDate(stored) : stored;
        // A stored value that is not among the select's options cannot be
        // assigned — the field silently fell back to the first option and the
        // next save overwrote the record with it.
        if (f.type === 'select' && value !== '' && ![...el.options].some((o) => o.value === String(value))) {
          el.add(new Option(String(value), String(value), true, true));
        }
        el.value = value;
      });
    } else {
      modal.querySelector('[data-crud-title]').textContent = `নতুন ${singular}`;
    }
    openModal(modalId);
  };

  let searchTimer = null;
  host.addEventListener('input', (e) => {
    if (!e.target.matches('[data-crud-search]')) return;
    const value = e.target.value.trim().toLowerCase();
    // Every keystroke re-filters and repaints the table; wait for a pause.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTerm = value; render(); }, 180);
  });

  host.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) openModalFor(edit.dataset.edit);
    else if (del) {
      const key = del.dataset.delete;
      if (!onlineFor(`${singular} মুছে ফেলা`)) return;
      const row = collectionApi.find?.(key) || collectionApi.list().find((r) => r[keyField] === key);
      const label = row?.name || row?.title || row?.text || key;
      const msg = `"${label}" ${singular} মুছে ফেলতে চান?\n\nএই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`;
      if (window.confirm(msg)) {
        collectionApi.remove(key);
        logActivity({ user: session?.name, role: session?.role, action: 'deleted', target: `${singular} ${key}` });
        showToast(`${singular} মুছে ফেলা হয়েছে।`, 'warning');
        render();
      }
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!onlineFor(`${singular} সংরক্ষণ`)) return;
    const data = new FormData(form);
    const editKey = form.querySelector('[data-crud-edit]').value;
    const record = {};
    let invalid = null;
    let badNumber = null;
    let badDate = null;
    fields.forEach((f) => {
      let value = String(data.get(f.name) ?? '').trim();
      if (isDateField(f) && value !== '') {
        // Typed dates are accepted in any shape, stored canonically — and a
        // date nobody can read is refused instead of saved as free text.
        const iso = parseBnDateInput(value);
        if (!iso) badDate = badDate || f;
        else value = iso;
      }
      if (f.type === 'number' && value !== '') {
        const parsed = Number(value);
        // "Number(value) || 0" quietly stored 0 for anything unparsable.
        if (!Number.isFinite(parsed)) badNumber = badNumber || f;
        else value = parsed;
      }
      if (f.required && value === '') invalid = invalid || f;
      record[f.name] = value;
    });
    if (badDate) { showToast(`"${badDate.label}" তারিখটি বোঝা যায়নি। এভাবে লিখুন: ${BN_DATE_PLACEHOLDER}`, 'error'); return; }
    if (badNumber) { showToast(`"${badNumber.label}"-এ একটি সঠিক সংখ্যা লিখুন।`, 'error'); return; }
    if (invalid) { showToast(`"${invalid.label}" পূরণ করুন।`, 'error'); return; }
    if (cfg.validate) {
      const err = cfg.validate(record, editKey);
      if (err) { showToast(err, 'error'); return; }
    }

    if (editKey) {
      collectionApi.update(editKey, record);
      logActivity({ user: session?.name, role: session?.role, action: 'updated', target: `${singular} ${editKey}` });
      showToast(`${singular} আপডেট হয়েছে।`, 'success');
    } else {
      const key = record[keyField] || newId(idPrefix);
      if (collectionApi.find(key)) { showToast('এই আইডি আগে থেকেই আছে।', 'error'); return; }
      collectionApi.add({ [keyField]: key, ...record });
      logActivity({ user: session?.name, role: session?.role, action: 'added', target: `${singular} ${key}` });
      showToast(`${singular} যোগ করা হয়েছে।`, 'success');
    }
    closeModal(modalId);
    render();
    cfg.onSaved && cfg.onSaved();
  });

  render();
  return { render, openAdd: () => openModalFor(null) };
}
