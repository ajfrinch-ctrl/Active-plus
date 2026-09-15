/**
 * Admin Home — the landing screen of the admin panel.
 *
 * A clean, information-focused dashboard (no raw transaction lists, no
 * announcement text, no activity-log dump):
 *   1. an Academic Analytics summary grid computed live from the database,
 *   2. feature tiles grouped by job (Academic / Finance / Management), and
 *   3. navigation cards for Finance, Academic Review, Announcements and
 *      Recent Activities — each routes into its panel instead of dumping data.
 *
 * Every figure is computed live through analytics() and the collections
 * themselves — nothing is hard-coded.
 */
import { escapeHtml, safeUrl, mountConnectionStatus } from './app.js';
import {
  db, analytics, dueFees, getDbStatus, DAY_BN, orgInfo, mobileDigits, sharedNotices
} from './data.js';

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;

const GROUPS = [
  {
    title: '🎓 একাডেমিক',
    tiles: [
      { key: 'students', icon: '👨‍🎓', label: 'শিক্ষার্থী' },
      { key: 'classes', icon: '🏫', label: 'ক্লাস' },
      { key: 'teachers', icon: '👨‍🏫', label: 'শিক্ষক' },
      { key: 'exam', icon: '📝', label: 'পরীক্ষা' },
      { key: 'results', icon: '🏆', label: 'ফলাফল' }
    ],
    cards: ['academic-review']
  },
  {
    title: '💰 ফিন্যান্স',
    tiles: [
      { key: 'dues', icon: '🧾', label: 'বকেয়া ও পেমেন্ট' },
      { key: 'reports', icon: '📊', label: 'রিপোর্ট' }
    ],
    cards: ['finance']
  },
  {
    title: '🗂️ ম্যানেজমেন্ট',
    tiles: [
      { key: 'notices', icon: '📢', label: 'নোটিশ' },
      { key: 'notifications', icon: '🔔', label: 'নোটিফিকেশন' },
      { key: 'users', icon: '🔐', label: 'ইউজার ও অনুমতি' },
      { key: 'settings', icon: '⚙️', label: 'সেটিংস' }
    ],
    cards: ['announcements', 'recent-activities']
  }
];

const QUICK_ACTIONS = [
  { act: 'add-student', icon: '＋', label: 'শিক্ষার্থী' },
  { act: 'add-teacher', icon: '＋', label: 'শিক্ষক' },
  { act: 'create-exam', icon: '＋', label: 'পরীক্ষা' },
  { act: 'add-question', icon: '＋', label: 'প্রশ্ন' },
  { act: 'record-payment', icon: '＋', label: 'পেমেন্ট' },
  { act: 'create-notice', icon: '＋', label: 'নোটিশ' }
];

const MORE_ITEMS = [
  { key: 'subjects', icon: '📖', label: 'বিষয়' },
  { key: 'questionbank', icon: '❓', label: 'প্রশ্ন ব্যাংক' },
  { key: 'materials', icon: '📚', label: 'ম্যাটেরিয়াল' },
  { key: 'assignments', icon: '📋', label: 'অ্যাসাইনমেন্ট' },
  { key: 'submissions', icon: '✅', label: 'জমাকৃত কাজ' },
  { key: 'routine', icon: '📅', label: 'রুটিন' },
  { key: 'suggestion', icon: '📝', label: 'সাজেশন' },
  { key: 'batches', icon: '📚', label: 'ব্যাচ' },
  { key: 'tips', icon: '💡', label: 'টিপ' },
  { key: 'banners', icon: '🖼️', label: 'ব্যানার' },
  { key: 'backup', icon: '💾', label: 'ব্যাকআপ' },
  { key: 'profile', icon: '👤', label: 'প্রোফাইল' },
  { key: 'logout', icon: '🚪', label: 'লগআউট' }
];

export function initAdminHome({ session, tabs, openModal, showToast, onLogout }) {
  const host = document.getElementById('admin-home');
  if (!host) return null;

  const goto = (key) => {
    if (key === 'logout') { onLogout?.(); return; }
    tabs?.activate?.(key);
  };

  const statusChip = () => `<span class="net-chip" id="admin-net-chip" role="status" aria-live="polite">…</span>`;

  /** `tel:` / `mailto:` hrefs — Bangladeshi numbers are normalised to +880. */
  const telHref = (mobile) => {
    const digits = mobileDigits(mobile);
    if (!digits) return null;
    const intl = digits.startsWith('880') ? digits : (digits.startsWith('0') ? `88${digits}` : `880${digits}`);
    return `tel:+${intl}`;
  };

  /**
   * Institute identity — the name, address, mobile and email written in
   * Settings, shown on the landing screen with a one-tap way to edit them.
   * The same four fields feed every receipt, report, admission form and ID
   * card, so the admin can always see what will be printed.
   */
  const instituteCard = () => {
    const org = orgInfo();
    const contact = (icon, label, value, href) => `
      <div class="info-row">
        <span class="l">${icon} ${label}</span>
        ${value
          ? `<span class="v">${href
            ? `<a href="${escapeHtml(safeUrl(href))}">${escapeHtml(value)}</a>`
            : escapeHtml(value)}</span>`
          : '<span class="v empty">যোগ করুন</span>'}
      </div>`;

    return `
      <section class="home-section" aria-label="প্রতিষ্ঠানের তথ্য">
        <h2 class="sec-title">🏛️ প্রতিষ্ঠানের তথ্য</h2>
        <div class="hcard org-card" id="admin-org-card">
          <div class="org-top">
            <img src="assets/logo.png" alt="">
            <div class="org-id">
              <strong>${escapeHtml(org.name)}</strong>
              <small>${escapeHtml(org.address || 'ঠিকানা যোগ করুন')}</small>
            </div>
            <button type="button" class="chip" data-goto="settings" title="সেটিংস থেকে সম্পাদনা করুন">✏️ সম্পাদনা</button>
          </div>
          ${contact('📱', 'মোবাইল', org.mobile, telHref(org.mobile))}
          ${contact('✉️', 'ইমেইল', org.email, org.email ? `mailto:${org.email}` : null)}
        </div>
      </section>`;
  };

  const analyticsGrid = () => {
    const a = analytics();
    const due = dueFees();
    const dueStudents = new Set(due.map((d) => d.studentId)).size;
    const results = db.examResults.list();
    const pcts = results.map((r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100));
    const avgResult = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : 0;
    const todayClasses = db.routine.list().filter((r) => r.day === DAY_BN[new Date().getDay()]).length;
    const activityCount = db.activityLogs.list().length;

    const cell = (icon, value, label) => `
      <div class="analytics-cell"><span class="ico">${icon}</span><strong>${value}</strong><span>${label}</span></div>`;

    return `
      <section class="home-section" aria-label="একাডেমিক অ্যানালিটিক্স">
        <h2 class="sec-title">📈 একাডেমিক অ্যানালিটিক্স</h2>
        <div class="analytics-grid">
          ${cell('👨‍🎓', bn(a.totalStudents), 'মোট শিক্ষার্থী')}
          ${cell('✅', bn(a.activeStudents), 'সক্রিয় শিক্ষার্থী')}
          ${cell('🏫', bn(a.totalClasses), 'মোট ক্লাস')}
          ${cell('👨‍🏫', bn(a.totalTeachers), 'মোট শিক্ষক')}
          ${cell('📅', bn(todayClasses), 'আজকের ক্লাস')}
          ${cell('📝', bn(a.upcomingExams), 'মোট পরীক্ষা')}
          ${cell('🏆', bn(results.length), 'পরীক্ষার ফলাফল')}
          ${cell('📈', avgResult ? `${bn(avgResult)}%` : '—', 'গড় ফলাফল')}
          ${cell('⚠️', bn(dueStudents), 'বকেয়া শিক্ষার্থী')}
          ${cell('💰', taka(a.totalDue), 'মোট বকেয়া')}
          ${cell('🧾', bn(activityCount), 'সাম্প্রতিক কার্যক্রম')}
        </div>
      </section>`;
  };

  const navCard = (icon, title, desc, count, countLabel, gotoKey) => `
    <button type="button" class="nav-card" data-goto="${gotoKey}">
      <span class="ico">${icon}</span>
      <span class="nc-body"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(desc)}</small></span>
      ${count != null ? `<span class="nc-count">${count}<i>${escapeHtml(countLabel || '')}</i></span>` : ''}
      <span class="nc-view">দেখুন ›</span>
    </button>`;

  const cards = {
    'academic-review': (a, avgResult) => navCard(
      '📊', 'একাডেমিক রিভিউ', 'View academic performance and analytics',
      avgResult ? `${bn(avgResult)}%` : '—', 'গড় ফলাফল', 'analytics'),
    finance: (a) => navCard(
      '💰', 'ফিন্যান্স', 'Financial overview and payment management',
      taka(a.totalDue), 'মোট বকেয়া', 'dues'),
    announcements: () => navCard(
      '📢', 'ঘোষণা', 'View latest announcements',
      bn(sharedNotices().length), 'টি নোটিশ', 'notices'),
    'recent-activities': () => navCard(
      '📝', 'সাম্প্রতিক কার্যক্রম', 'View recent system activities',
      bn(db.activityLogs.list().length), 'টি কার্যক্রম', 'activity')
  };

  const groupSection = (group, ctx) => `
    <section class="home-section">
      <h2 class="sec-title">${group.title}</h2>
      ${group.tiles.length ? `<div class="feature-grid">${group.tiles.map((t) => `
        <button type="button" class="tile" data-goto="${t.key}"><span class="ico">${t.icon}</span>${escapeHtml(t.label)}</button>`).join('')}</div>` : ''}
      ${group.cards.map((key) => cards[key] ? cards[key](ctx.a, ctx.avgResult) : '').join('')}
    </section>`;

  const quickActions = () => `
    <div class="quick-row" id="admin-quick">
      ${QUICK_ACTIONS.map((q) => `<button type="button" class="chip" data-act="${q.act}">${q.icon} ${escapeHtml(q.label)}</button>`).join('')}
    </div>`;

  const morePanel = () => `
    <div class="feature-grid more-grid" id="admin-more-grid">
      ${MORE_ITEMS.map((m) => `<button type="button" class="tile" data-goto="${m.key}"><span class="ico">${m.icon}</span>${escapeHtml(m.label)}</button>`).join('')}
    </div>`;

  function render() {
    const headerSub = document.getElementById('user-role');
    if (headerSub) headerSub.textContent = orgInfo().name;
    const a = analytics();
    const results = db.examResults.list();
    const pcts = results.map((r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100));
    const avgResult = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : 0;
    const ctx = { a, avgResult };

    host.innerHTML = `
      <div id="admin-home-content">
        ${statusChip()}
        ${instituteCard()}
        ${analyticsGrid()}
        ${GROUPS.map((g) => groupSection(g, ctx)).join('')}
        <section class="home-section">
          <h2 class="sec-title">⚡ কুইক অ্যাকশন</h2>
          ${quickActions()}
        </section>
        <button type="button" class="see-more" id="admin-see-more">আরও দেখুন ↓</button>
      </div>
      <div id="admin-more" hidden>
        <section class="home-section"><h2 class="sec-title">আরও ফিচার</h2>${morePanel()}</section>
      </div>`;
  }

  host.addEventListener('click', (e) => {
    if (e.target.closest('#admin-see-more')) {
      const more = host.querySelector('#admin-more');
      const content = host.querySelector('#admin-home-content');
      const showing = more.hidden;
      more.hidden = !showing;
      content.hidden = showing;
      e.target.textContent = showing ? '← হোমে ফিরুন' : 'আরও দেখুন ↓';
      return;
    }
    const tile = e.target.closest('[data-goto]');
    if (tile) { goto(tile.dataset.goto); return; }
    const action = e.target.closest('[data-act]');
    if (!action) return;
    const act = action.dataset.act;
    if (act === 'add-student') { tabs?.activate?.('students'); openModal?.('student-modal'); }
    else if (act === 'add-teacher') { tabs?.activate?.('teachers'); openModal?.('teacher-modal'); }
    else if (act === 'create-exam') { tabs?.activate?.('exam'); openModal?.('exam-modal'); }
    else if (act === 'add-question') { tabs?.activate?.('questionbank'); }
    else if (act === 'record-payment') { tabs?.activate?.('dues'); }
    else if (act === 'create-notice') { tabs?.activate?.('notices'); openModal?.('notice-modal'); }
  });

  function renderSafe() {
    try {
      render();
      mountConnectionStatus('#admin-net-chip', getDbStatus);
    } catch (err) {
      console.error('[Active Plus] admin home render failed:', (err && err.stack) || err);
      host.innerHTML = `
        <div class="hcard">
          <div class="h-title">দুঃখিত 😔</div>
          <p>ড্যাশবোর্ড লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</p>
          <button type="button" class="btn btn-block" data-retry-home style="margin-top:.75rem">আবার চেষ্টা করুন</button>
        </div>`;
      host.querySelector('[data-retry-home]')?.addEventListener('click', renderSafe);
    }
  }

  /** Reset the home to the main dashboard (used when "হোম" is tapped again). */
  const showHome = () => {
    const more = host.querySelector('#admin-more');
    const content = host.querySelector('#admin-home-content');
    const btn = host.querySelector('#admin-see-more');
    if (more) more.hidden = true;
    if (content) content.hidden = false;
    if (btn) btn.textContent = 'আরও দেখুন ↓';
  };

  renderSafe();
  return {
    render: renderSafe,
    goto,
    showHome,
    openMore: () => {
      const btn = host.querySelector('#admin-see-more');
      if (btn && host.querySelector('#admin-more')?.hidden) btn.click();
    }
  };
}
