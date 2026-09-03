/**
 * Generic CRUD engine — one consistent, mobile-friendly list + modal used by
 * every admin module (classes, subjects, materials, assignments, routine…).
 * Handles search, validation, duplicate-ID guards, delete confirmation and
 * activity logging so each module stays tiny.
 */

import { db, logActivity, newId } from './data.js';
import { escapeHtml, openModal, closeModal, showToast } from './app.js';

let modalSeq = 0;

function buildFieldHtml(field) {
  const id = `f-${field.name}`;
  const label = `<label for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`;
  let input;
  if (field.type === 'select') {
    input = `<select class="form-input form-select" id="${id}" name="${field.name}">
      ${(field.options || []).map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    input = `<textarea class="form-input form-textarea" id="${id}" name="${field.name}"></textarea>`;
  } else {
    const attrs = field.type === 'number' ? 'type="number"' : field.type === 'tel' ? 'type="tel" inputmode="tel"' : 'type="text"';
    input = `<input class="form-input" id="${id}" name="${field.name}" ${attrs}>`;
  }
  return `<div class="form-group">${label}${input}</div>`;
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
      <input class="form-input" placeholder="${escapeHtml(searchPlaceholder)}" data-crud-search>
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

  const matches = (row) => {
    if (!searchTerm) return true;
    return searchKeys.some((k) => String(row[k] || '').toLowerCase().includes(searchTerm));
  };

  const render = () => {
    const rows = collectionApi.list().filter(matches);
    const table = host.querySelector('table');
    table.querySelector('thead tr').innerHTML = [...columns, { key: '_a', label: 'অ্যাকশন' }]
      .map((c) => `<th scope="col">${escapeHtml(c.label)}</th>`).join('');
    table.querySelector('tbody').innerHTML = rows.length
      ? rows.map((row) => `<tr>${columns.map((c) => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key])}</td>`).join('')}
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
      fields.forEach((f) => { if (form.elements[f.name]) form.elements[f.name].value = row[f.name] ?? ''; });
    } else {
      modal.querySelector('[data-crud-title]').textContent = `নতুন ${singular}`;
    }
    openModal(modalId);
  };

  host.addEventListener('input', (e) => {
    if (e.target.matches('[data-crud-search]')) { searchTerm = e.target.value.trim().toLowerCase(); render(); }
  });

  host.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) openModalFor(edit.dataset.edit);
    else if (del) {
      const key = del.dataset.delete;
      if (window.confirm(`আপনি কি এই ${singular} মুছে ফেলার বিষয়ে নিশ্চিত?`)) {
        collectionApi.remove(key);
        logActivity({ user: session?.name, role: session?.role, action: 'deleted', target: `${singular} ${key}` });
        showToast(`${singular} মুছে ফেলা হয়েছে।`, 'warning');
        render();
      }
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const editKey = form.querySelector('[data-crud-edit]').value;
    const record = {};
    let invalid = null;
    fields.forEach((f) => {
      let value = String(data.get(f.name) ?? '').trim();
      if (f.type === 'number') value = Number(value) || 0;
      if (f.required && !value) invalid = invalid || f;
      record[f.name] = value;
    });
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
