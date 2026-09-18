/**
 * Shared UI shell for the Active Plus dashboards (student / teacher / admin).
 * Keeps the three pages small: they call initApp() and then render their data.
 */

import { requireRole, currentSession, logoutButton, homeFor, ROLES, enteredFromLogin } from './auth.js';
import { showToast, getAuthMode } from './firebase.js';
import { formatBnDate, looksLikeDate } from './data.js';

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
  // The brand-mark shows the organisation logo (an <img>) or, when it is still
  // the plain initials tile, the user's first initial. Never overwrite an image.
  if (avatar && !avatar.querySelector('img')) avatar.textContent = (session.name || 'A').trim().charAt(0).toUpperCase();
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
  const buttons = bar ? Array.from(bar.querySelectorAll('button[data-tab]')) : [];
  // When there is no top tab bar (app-style grid navigation), derive the tab
  // list from the panels themselves so the same switcher still works.
  const panels = Array.from(document.querySelectorAll('.tab-panel[id^="tab-"]'));
  const tabNames = buttons.length
    ? buttons.map((button) => button.dataset.tab)
    : panels.map((panel) => panel.id.replace(/^tab-/, ''));
  if (!tabNames.length) return null;

  const page = window.location.pathname.split('/').pop() || 'page';
  const memoryKey = `${storageKey}:${page}`;

  const activate = (name, { focus = false } = {}) => {
    const target = tabNames.includes(name) ? name : tabNames[0];
    buttons.forEach((button) => {
      const selected = button.dataset.tab === target;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== `tab-${target}`;
    });
    const targetBtn = bar ? bar.querySelector(`button[data-tab="${target}"]`) : null;
    if (targetBtn) {
      targetBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      if (focus) targetBtn.focus();
    }
    try { window.localStorage.setItem(memoryKey, target); } catch (e) { /* ignore */ }
    // Let app-style shells (bottom nav, grids) stay in sync with the active tab.
    window.dispatchEvent(new window.CustomEvent('tabchange', { detail: { tab: target } }));
    return target;
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

  // After a login the portal always opens on Home ("লগিন করলে হোম এ ঢুকবে আগে"),
  // whatever tab this device was left on last time.
  let initial = null;
  if (!enteredFromLogin()) {
    try { initial = window.localStorage.getItem(memoryKey); } catch (e) { /* ignore */ }
    if (!initial && window.location.hash.startsWith('#')) initial = window.location.hash.slice(1);
  }
  const homeTab = tabNames.includes('home') ? 'home' : tabNames[0];
  const current = activate(initial || homeTab);
  // Expose the switcher so app-style shells (bottom nav, feature grids, More
  // menu) can drive the very same panels instead of duplicating them.
  return { activate, current, buttons };
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
 * A date cell for any table/detail view: the app prints every date the same
 * Bengali long way (১৬ সেপ্টেম্বর ২০২৬). Values that are not dates at all
 * (a fee month label, '—', 'চলমান') are passed through untouched.
 */
export function dateCell(value, fallback = '—') {
  const raw = String(value ?? '').trim();
  if (!raw) return escapeHtml(fallback);
  return escapeHtml(looksLikeDate(raw) ? formatBnDate(raw) : raw);
}

const SAFE_URL_SCHEMES = ['http', 'https', 'mailto', 'tel', 'sms'];

/**
 * A link target that is safe to put in an href.
 *
 * Material/banner links come from a teacher's keyboard, so `javascript:` (or
 * `data:`) pasted there would run script in the portal of every student who
 * clicks it. Anything that is not a relative path or one of the schemes above
 * is replaced with `fallback`.
 */
export function safeUrl(value, fallback = '#') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  // Browsers strip whitespace/control characters inside a scheme, so strip them
  // here too — "java\tscript:" must not slip through the check below.
  const cleaned = raw.replace(/[\u0000-\u0020\u007f-\u00a0]+/g, '');
  if (!cleaned || cleaned.startsWith('//')) return fallback; // protocol-relative → off-site
  const scheme = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return cleaned;                               // relative path or #anchor
  return SAFE_URL_SCHEMES.includes(scheme[1].toLowerCase()) ? cleaned : fallback;
}

/**
 * Renders rows into a <tbody>. `columns` = [{ key, label, render? }].
 */
/**
 * Render a table from rows.
 *
 * Large datasets are paginated lazily (spec 62): only the first page is put in
 * the DOM, with a "load more" row that appends the next page. This keeps the
 * student/dues/result tables usable on low-end phones with thousands of rows.
 */
export function renderTable(tableSelector, columns, rows, emptyMessage = 'কোনো তথ্য নেই।', { pageSize = 25 } = {}) {
  const table = document.querySelector(tableSelector);
  if (!table) return null;
  const head = table.querySelector('thead tr');
  const body = table.querySelector('tbody');
  if (head) head.innerHTML = columns.map((col) => `<th scope="col">${escapeHtml(col.label)}</th>`).join('');
  if (!body) return null;

  const all = Array.isArray(rows) ? rows : [];
  if (!all.length) {
    table.__pageState = null;
    body.innerHTML = `<tr><td colspan="${columns.length}"><div class="empty-state">${escapeHtml(emptyMessage)}</div></td></tr>`;
    return table;
  }

  const bnDigits = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const paint = () => {
    const st = table.__pageState;
    if (!st) return;
    const slice = st.all.slice(0, st.shown);
    const remaining = st.all.length - st.shown;
    // Columns without a render() print their raw value — which is exactly
    // where a stored '২০২৬-০৯-১৬' used to leak through. Dates are formatted
    // here for every table in the app in one place.
    const cell = (row, col) => {
      if (col.render) return col.render(row);
      const value = row[col.key];
      return looksLikeDate(value) ? escapeHtml(formatBnDate(value)) : escapeHtml(value);
    };
    body.innerHTML = slice.map((row) => `<tr>${
      st.columns.map((col) => `<td>${cell(row, col)}</td>`).join('')
    }</tr>`).join('') + (remaining > 0
      ? `<tr><td colspan="${st.columns.length}"><button type="button" class="btn btn-small" data-load-more>আরও ${bnDigits(Math.min(st.pageSize, remaining))}টি দেখুন (${bnDigits(remaining)} বাকি)</button></td></tr>`
      : '');
  };

  table.__pageState = {
    all, columns, pageSize,
    shown: Math.min(pageSize, all.length),
    paint
  };
  paint();

  // One delegated listener per table, always reading the latest page state.
  if (!table.__pageWired) {
    table.__pageWired = true;
    table.addEventListener('click', (event) => {
      if (!event.target.closest('[data-load-more]')) return;
      const st = table.__pageState;
      if (!st) return;
      st.shown = Math.min(st.shown + st.pageSize, st.all.length);
      st.paint();
    });
  }
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openModals = new Map(); // id → { opener, release }
const wiredModals = new WeakSet();
const escapeDocuments = new WeakSet();

/**
 * Wire one overlay's dismiss controls. Some overlays are part of the HTML,
 * while CRUD/detail overlays are created after initApp() has already run. A
 * querySelectorAll() in initModals() only covers the first group, which made
 * the × button look dead in dynamically-created dialogs. Wiring from
 * openModal() as well keeps both kinds of modal consistent.
 */
function wireModal(modal) {
  if (!modal || wiredModals.has(modal)) return;
  wiredModals.add(modal);
  modal.addEventListener('click', (event) => {
    const closeButton = event.target.closest?.('[data-close]');
    if (event.target === modal || (closeButton && modal.contains(closeButton))) {
      event.preventDefault();
      closeModal(modal.id);
    }
  });
}

/** Keeps Tab inside the dialog so keyboard users cannot land on the page behind it. */
function trapFocus(modal) {
  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const items = Array.from(modal.querySelectorAll(FOCUSABLE))
      .filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) { event.preventDefault(); first.focus(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  modal.addEventListener('keydown', handler);
  return () => modal.removeEventListener('keydown', handler);
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  // A modal may have been appended after initModals() (generic CRUD and
  // student detail dialogs do exactly that). Make its × and backdrop work
  // before showing it.
  wireModal(modal);
  const content = modal.querySelector('.modal-content') || modal;
  if (!content.getAttribute('role')) content.setAttribute('role', 'dialog');
  content.setAttribute('aria-modal', 'true');
  const heading = content.querySelector('h1, h2, h3');
  if (heading) {
    if (!heading.id) heading.id = `${id}-title`;
    content.setAttribute('aria-labelledby', heading.id);
  }
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open'); // print uses this to drop the app shell
  document.body.style.overflow = 'hidden';
  if (!openModals.has(id)) {
    openModals.set(id, { opener: document.activeElement || null, release: trapFocus(modal) });
  }
  const focusable = modal.querySelector('input, select, textarea, button:not(.modal-close)');
  if (focusable) setTimeout(() => focusable.focus(), 120);
  return modal;
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return null;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  const opened = openModals.get(id);
  if (opened) {
    openModals.delete(id);
    opened.release();
    // Give focus back to whatever opened the dialog instead of dropping it on <body>.
    try {
      if (opened.opener && typeof opened.opener.focus === 'function' && document.contains(opened.opener)) {
        opened.opener.focus();
      }
    } catch (e) { /* detached opener */ }
  }
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
  return modal;
}

export function initModals() {
  // Wire the overlays that are already in the document. Overlays created
  // later are wired by openModal(), so their close button is never a dead end.
  document.querySelectorAll('.modal-overlay').forEach(wireModal);
  if (escapeDocuments.has(document)) return;
  escapeDocuments.add(document);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach((modal) => closeModal(modal.id));
    }
  });
}

/* ------------------------------------------------------------------ */
/* One-call bootstrapper                                               */
/* ------------------------------------------------------------------ */
/**
 * Live connection status for every portal (spec 51): online / offline /
 * syncing / synced. Paints into a .net-chip element and keeps itself updated
 * on connectivity changes. Never reports success for a write that failed.
 */
/**
 * Guard for writes that must reach the database (spec 51).
 *
 * In local mode the browser store *is* the database, so an offline write is
 * genuinely saved and we let it through. Once a remote is configured an offline
 * write would be silently lost, so we refuse it and say so plainly instead of
 * showing a success toast for something that never happened.
 */
export function requireOnline(action = 'এই কাজটি', getStatus = null) {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  if (online) return true;
  const configured = typeof getStatus === 'function' ? !!(getStatus() || {}).configured : true;
  if (!configured) return true;
  showToast(`অফলাইনে ${action} করা যাবে না — সংযোগ ফিরলে আবার চেষ্টা করুন।`, 'error');
  return false;
}

export function mountConnectionStatus(chipSelector = '.net-chip', getStatus = null) {
  const chip = document.querySelector(chipSelector);
  if (!chip) return null;
  const paint = () => {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    const status = typeof getStatus === 'function' ? (getStatus() || {}) : {};
    let text;
    let tone = 'ok';
    if (!online) { text = '● অফলাইন'; tone = 'off'; }
    else if (status.error) { text = '● সিংক ব্যর্থ'; tone = 'off'; }
    else if (status.pending > 0) { text = '● সিংক হচ্ছে…'; tone = 'sync'; }
    else if (status.lastSync) { text = '● সিংক হয়েছে'; tone = 'ok'; }
    else { text = '● অনলাইন'; tone = 'ok'; }
    chip.textContent = text;
    chip.classList.toggle('off', tone === 'off');
    chip.classList.toggle('sync', tone === 'sync');
    chip.setAttribute('aria-label', text.replace('● ', ''));
  };
  paint();
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  return { paint, chip };
}

let activeTabsController = null;

/** The tab controller created by the most recent initApp() call, if any. */
export function activeTabs() { return activeTabsController; }

/**
 * One honest message when something unexpected throws, instead of a panel that
 * quietly stops updating. Mounted once per page by initApp().
 */
let errorGuardsMounted = false;
export function initErrorGuards() {
  if (errorGuardsMounted || typeof window === 'undefined') return;
  errorGuardsMounted = true;
  const report = () => {
    try { showToast('অপ্রত্যাশিত সমস্যা হয়েছে — কাজটি সংরক্ষিত নাও হতে পারে, পেজটি রিফ্রেশ করুন।', 'error', 6000); }
    catch (e) { /* no toast host yet */ }
  };
  window.addEventListener('error', (event) => {
    console.error('[Active Plus]', event.error || event.message);
    report();
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Active Plus] unhandled rejection:', event.reason);
    report();
  });
}

export function initApp({ roles = [], tabs = true } = {}) {
  const session = requireRole(roles);
  if (!session) return null;
  initErrorGuards();
  mountHeader(session);
  logoutButton('#logout-btn');
  initModals();
  registerServiceWorker(); // every portal is installable/offline-capable
  if (tabs) activeTabsController = initTabs();
  return session;
}
