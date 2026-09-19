/**
 * Admin Panel v2 — hybrid layout component.
 *
 * Desktop (>= 1024px): a left sidebar with grouped, bilingual section items.
 * Mobile: the familiar bottom navigation stays in charge; the sidebar is
 * hidden by CSS. Both navigations drive the very same tab router, and both
 * stay highlighted in sync through the `tabchange` event.
 */
import { escapeHtml } from '../app.js';
import { visibleGroups } from './registry.js';

export function mountAdminSidebar({ session, tabs }) {
  const nav = document.getElementById('admin-side-nav');
  if (!nav) return null;

  const role = session?.role || 'admin';
  const groups = visibleGroups(role);

  nav.innerHTML = groups.map((group) => `
    <details class="side-group" open data-group="${group.id}">
      <summary>
        <span class="sg-ico" aria-hidden="true">${group.icon}</span>
        <span class="sg-bn">${escapeHtml(group.label)}</span>
        <small class="sg-en">${escapeHtml(group.en)}</small>
      </summary>
      <div class="side-items" role="group" aria-label="${escapeHtml(group.label)}">
        ${group.sections.map((s) => `
          <button type="button" class="side-item" data-side-tab="${s.key}" title="${escapeHtml(s.label)} · ${escapeHtml(s.en)}">
            <span class="si-ico" aria-hidden="true">${s.icon}</span>
            <span class="si-text">
              <span class="si-bn">${escapeHtml(s.label)}</span>
              <small class="si-en">${escapeHtml(s.en)}</small>
            </span>
          </button>`).join('')}
      </div>
    </details>`).join('');

  // Identity footer: who is signed in and with which role.
  const foot = document.getElementById('admin-side-foot');
  if (foot) {
    const roleBn = { admin: 'অ্যাডমিন', teacher: 'শিক্ষক', student: 'শিক্ষার্থী' }[role] || role;
    foot.innerHTML = `
      <span class="sf-role" title="${escapeHtml(roleBn)}">🛡️ ${escapeHtml(roleBn)}</span>
      <span class="sf-name">${escapeHtml(session?.name || '')}</span>`;
  }

  nav.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-side-tab]');
    if (!btn) return;
    tabs?.activate?.(btn.dataset.sideTab);
  });

  const sync = (key) => {
    nav.querySelectorAll('[data-side-tab]').forEach((btn) => {
      const active = btn.dataset.sideTab === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
    // Open the group holding the active section so it is never hidden away.
    const current = nav.querySelector(`[data-side-tab="${key}"]`);
    current?.closest('details')?.setAttribute('open', '');
  };
  window.addEventListener('tabchange', (event) => sync(event.detail?.tab));
  sync(tabs?.current);

  return { sync };
}
