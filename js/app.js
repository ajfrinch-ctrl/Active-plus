/**
 * Shared UI shell for the Active Plus dashboards (student / teacher / admin).
 * Keeps the three pages small: they call initApp() and then render their data.
 */

import { requireRole, currentSession, logoutButton, homeFor, ROLES } from './auth.js';
import { showToast, getAuthMode } from './firebase.js';

export { showToast, getAuthMode, ROLES, homeFor };
/**
 * Registers the PWA service worker. Safe to call on every page: module scripts
 * run after parsing, so 'load' may already have fired — registering only inside
 * a load listener silently skipped deep-linked pages like student.html.
 */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  const register = () => navigator.serviceWorker.register('service-worker.js').catch((error) => {
    console.warn('[Active Plus] Service worker registration failed:', error.message);
  });
  if (typeof document !== 'undefined' && document.readyState === 'complete') return register();
  window.addEventListener('load', register, { once: true });
  return Promise.resolve(null);
}

/** Fills the sticky header with the signed-in user's details. */
export function mountHeader(session = currentSession()) {
  if (!session) return null;
  const name = document.getElementById('user-name');
  const role = document.getElementById('user-role');
  const avatar = document.getElementById('user-initial');
  const pageRole = document.getElementById('page-role');

  if (name) name.textContent = session.name || 'ব্যবহারকারী';
  if (role) {
    const labels = { student: 'শিক্ষার্থী', teacher: 'শিক্ষক', admin: 'অ্যাডমিন' };
    role.textContent = `${labels[session.role] || session.role}${session.detail ? ' · ' + session.detail : ''}`;
  }
  if (avatar) avatar.textContent = (session.name || 'A').trim().charAt(0).toUpperCase();
  if (pageRole) pageRole.textContent = session.role;
  document.body.dataset.role = session.role || '';
  return session;
}

/**
 * Accessible tab bar: buttons carry data-tab, panels carry id="tab-<name>".
 * The active tab is remembered per page and kept in view while swiping.
 */
export function initTabs({ storageKey = 'activeplus_tab' } = {}) {
  const bar = document.querySelector('.top-tab-bar');
  if (!bar) return null;
  const buttons = Array.from(bar.querySelectorAll('button[data-tab]'));
  if (!buttons.length) return null;

  const page = window.location.pathname.split('/').pop() || 'page';
  const memoryKey = `${storageKey}:${page}`;

  const activate = (name, { focus = false } = {}) => {
    let target = buttons.find((b) => b.dataset.tab === name);
    if (!target) target = buttons[0];
    buttons.forEach((button) => {
      const selected = button === target;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    buttons.forEach((button) => {
      const panel = document.getElementById(`tab-${button.dataset.tab}`);
      if (panel) panel.hidden = button !== target;
    });
    target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (focus) target.focus();
    try { window.localStorage.setItem(memoryKey, target.dataset.tab); } catch (e) { /* ignore */ }
    return target.dataset.tab;
  };

  buttons.forEach((button, index) => {
    const panel = document.getElementById(`tab-${button.dataset.tab}`);
    button.setAttribute('role', 'tab');
    button.id = button.id || `tabbtn-${button.dataset.tab}`;
    button.setAttribute('aria-controls', panel ? panel.id : `tab-${button.dataset.tab}`);
    button.addEventListener('click', () => activate(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = buttons[(index + step + buttons.length) % buttons.length];
      activate(next.dataset.tab, { focus: true });
    });
  });

  let initial = null;
  try { initial = window.localStorage.getItem(memoryKey); } catch (e) { /* ignore */ }
  if (!initial && window.location.hash.startsWith('#')) initial = window.location.hash.slice(1);
  return activate(initial || buttons[0].dataset.tab);
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

/**
 * Renders rows into a <tbody>. `columns` = [{ key, label, render? }].
 */
export function renderTable(tableSelector, columns, rows, emptyMessage = 'কোনো তথ্য নেই।') {
  const table = document.querySelector(tableSelector);
  if (!table) return null;
  const head = table.querySelector('thead tr');
  const body = table.querySelector('tbody');
  if (head) head.innerHTML = columns.map((col) => `<th scope="col">${escapeHtml(col.label)}</th>`).join('');
  if (!body) return null;
  if (!rows || !rows.length) {
    body.innerHTML = `<tr><td colspan="${columns.length}"><div class="empty-state">${escapeHtml(emptyMessage)}</div></td></tr>`;
    return table;
  }
  body.innerHTML = rows.map((row) => `<tr>${
    columns.map((col) => `<td>${col.render ? col.render(row) : escapeHtml(row[col.key])}</td>`).join('')
  }</tr>`).join('');
  return table;
}

export function statGrid(selector, stats) {
  const host = document.querySelector(selector);
  if (!host) return null;
  host.innerHTML = stats.map((stat) => `
    <div class="stat">
      <div class="stat-label">${escapeHtml(stat.label)}</div>
      <div class="stat-value ${escapeHtml(stat.tone || '')}">${escapeHtml(stat.value)}</div>
      ${stat.note ? `<div class="stat-label" style="margin-top:.25rem">${escapeHtml(stat.note)}</div>` : ''}
    </div>`).join('');
  return host;
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector('input, select, textarea, button:not(.modal-close)');
  if (focusable) setTimeout(() => focusable.focus(), 120);
  return modal;
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  return modal;
}

export function initModals() {
  document.querySelectorAll('.modal-overlay').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('[data-close]')) closeModal(modal.id);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach((modal) => closeModal(modal.id));
    }
  });
}

/* ------------------------------------------------------------------ */
/* One-call bootstrapper                                               */
/* ------------------------------------------------------------------ */
export function initApp({ roles = [], tabs = true } = {}) {
  const session = requireRole(roles);
  if (!session) return null;
  mountHeader(session);
  logoutButton('#logout-btn');
  initModals();
  registerServiceWorker(); // every portal is installable/offline-capable
  if (tabs) initTabs();
  return session;
}
