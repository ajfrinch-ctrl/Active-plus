/**
 * Admin Home — the app-style landing screen of the admin panel.
 *
 * Same visual language as the student and teacher homes, but the information
 * architecture answers the admin's question: "How is my whole coaching centre
 * performing right now?"
 *
 * Every figure is computed live from the database through analytics() and the
 * collections themselves — nothing is hard-coded, and the feature grid simply
 * routes into the existing CRUD panels instead of duplicating them.
 */
import { escapeHtml, mountConnectionStatus } from './app.js';
import {
  db, analytics, recentActivity, activeBanners, latestNotifications,
  timeAgo, dueFees, todayBn, logActivity, classPerformance, getDbStatus
} from './data.js';

const FEATURES = [
  { key: 'students', icon: '👨‍🎓', label: 'শিক্ষার্থী' },
  { key: 'teachers', icon: '👨‍🏫', label: 'শিক্ষক' },
  { key: 'classes', icon: '🏫', label: 'ক্লাস' },
  { key: 'batches', icon: '📚', label: 'ব্যাচ' },
  { key: 'exam', icon: '📝', label: 'পরীক্ষা' },
  { key: 'results', icon: '🏆', label: 'ফলাফল' },
  { key: 'dues', icon: '💰', label: 'ফি ও পেমেন্ট' },
  { key: 'reports', icon: '📊', label: 'রিপোর্ট' }
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
  { key: 'notices', icon: '📢', label: 'নোটিশ' },
  { key: 'suggestion', icon: '📝', label: 'সাজেশন' },
  { key: 'notifications', icon: '🔔', label: 'নোটিফিকেশন' },
  { key: 'analytics', icon: '📈', label: 'অ্যানালিটিক্স' },
  { key: 'users', icon: '🔐', label: 'ইউজার ও অনুমতি' },
  { key: 'activity', icon: '🧾', label: 'অ্যাক্টিভিটি লগ' },
  { key: 'backup', icon: '💾', label: 'ব্যাকআপ' },
  { key: 'tips', icon: '💡', label: 'টিপ' },
  { key: 'banners', icon: '🖼️', label: 'ব্যানার' },
  { key: 'profile', icon: '👤', label: 'প্রোফাইল' },
  { key: 'settings', icon: '⚙️', label: 'সেটিংস' },
  { key: 'logout', icon: '🚪', label: 'লগআউট' }
];

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;

export function initAdminHome({ session, tabs, openModal, showToast, onLogout }) {
  const host = document.getElementById('admin-home');
  if (!host) return null;

  const goto = (key) => {
    if (key === 'logout') { onLogout?.(); return; }
    tabs?.activate?.(key);
  };

  /* -------------------------------------------------------------- */
  /* Sections                                                        */
  /* -------------------------------------------------------------- */
  // Live chip: online / offline / syncing / synced — never fakes success.
  const statusChip = () => `<span class="net-chip" id="admin-net-chip" role="status" aria-live="polite">…</span>`;

  const hero = () => {
    const a = analytics();
    const cell = (icon, value, label) => `
      <div class="tile"><span class="ico">${icon}</span><strong>${bn(value)}</strong><span>${label}</span></div>`;
    return `<div class="hero" id="institute-overview">
      <div class="h-title">প্রতিষ্ঠান পর্যালোচনা</div>
      <div class="feature-grid four">
        ${cell('👨‍🎓', a.totalStudents, 'শিক্ষার্থী')}
        ${cell('👨‍🏫', a.totalTeachers, 'শিক্ষক')}
        ${cell('📚', a.activeBatches, 'ব্যাচ')}
        ${cell('📖', a.totalSubjects, 'বিষয়')}
      </div>
      <div class="info-row"><span class="l">সক্রিয় শিক্ষার্থী</span><span class="v">${bn(a.activeStudents)}</span></div>
      <div class="info-row"><span class="l">আজকের আদায়</span><span class="v">${taka(a.todayCollection)}</span></div>
      <div class="info-row"><span class="l">এই মাসে</span><span class="v">${taka(a.monthlyCollection)}</span></div>
      <div class="info-row"><span class="l">মোট বকেয়া</span><span class="v">${taka(a.totalDue)}</span></div>
    </div>`;
  };

  const featureGrid = () => `
    <div class="feature-grid" id="admin-features">
      ${FEATURES.map((f) => `<button type="button" class="tile" data-goto="${f.key}"><span class="ico">${f.icon}</span>${escapeHtml(f.label)}</button>`).join('')}
    </div>
    <button type="button" class="see-more" id="admin-see-more">আরও দেখুন ↓</button>`;

  const quickActions = () => `
    <div class="quick-row" id="admin-quick">
      ${QUICK_ACTIONS.map((q) => `<button type="button" class="chip" data-act="${q.act}">${q.icon} ${escapeHtml(q.label)}</button>`).join('')}
    </div>`;

  const academic = () => {
    const a = analytics();
    const perf = classPerformance();
    const rows = perf.length
      ? perf.slice(0, 5).map((c) => `<div class="info-row"><span class="l">${escapeHtml(c.className)}</span><span class="v">${bn(c.avg)}%</span></div>`).join('')
      : '<p>এখনো কোনো ফলাফল নেই।</p>';
    return `<div class="hcard"><div class="h-title">📊 একাডেমিক পর্যালোচনা</div>
      <div class="info-row"><span class="l">আসন্ন পরীক্ষা</span><span class="v">${bn(a.upcomingExams)}</span></div>
      <div class="info-row"><span class="l">প্রকাশিত ফলাফল</span><span class="v">${bn(a.publishedResults)}</span></div>
      <div class="info-row"><span class="l">অপেক্ষমাণ অ্যাসাইনমেন্ট</span><span class="v">${bn(a.pendingAssignments)}</span></div>
      <div class="h-title" style="margin-top:.75rem">ক্লাস অনুযায়ী গড়</div>${rows}</div>`;
  };

  const finance = () => {
    const a = analytics();
    const due = dueFees();
    return `<div class="hcard"><div class="h-title">💰 ফিন্যান্স</div>
      <div class="info-row"><span class="l">আজ</span><span class="v">${taka(a.todayCollection)}</span></div>
      <div class="info-row"><span class="l">এই মাস</span><span class="v">${taka(a.monthlyCollection)}</span></div>
      <div class="info-row"><span class="l">বকেয়া</span><span class="v">${taka(a.totalDue)}</span></div>
      <div class="info-row"><span class="l">বকেয়া শিক্ষার্থী</span><span class="v">${bn(due.length)} জন</span></div>
      <button type="button" class="btn btn-block" data-goto="dues">বকেয়া ও পেমেন্ট</button></div>`;
  };

  const announcements = () => {
    const latest = db.notices.list().slice(-1)[0];
    return `<div class="hcard"><div class="h-title">📢 ঘোষণা</div>${
      latest ? `<p><strong>${escapeHtml(latest.title)}</strong></p>
        <p class="meta">${escapeHtml(latest.date || '')} · ${escapeHtml(latest.audience || '')}</p>
        <button type="button" class="btn btn-block" data-goto="notices">সব নোটিশ</button>`
        : '<p>কোনো ঘোষণা নেই।</p>'}</div>`;
  };

  const activity = () => {
    const items = recentActivity(6);
    return `<div class="hcard"><div class="h-title">📝 সাম্প্রতিক কার্যক্রম</div>${
      items.length ? items.map((it) => `
        <div class="info-row"><span class="l">${it.icon} ${escapeHtml(it.text)}</span>
        <span class="v">${escapeHtml(it.meta || '')}</span></div>`).join('')
        : '<p>এখনো কোনো কার্যক্রম নেই।</p>'}
      <button type="button" class="btn btn-block" data-goto="activity">সব দেখুন</button></div>`;
  };

  const bannerCard = () => {
    const banners = activeBanners();
    if (!banners.length) return '';
    return `<div class="carousel"><div class="carousel-track">${banners.map((b) => `
      <div class="banner"${b.image ? ` style="background-image:url('${escapeHtml(b.image)}')"` : ''}>
        <strong>${escapeHtml(b.title)}</strong>${b.subtitle ? `<span>${escapeHtml(b.subtitle)}</span>` : ''}
      </div>`).join('')}</div></div>`;
  };

  const morePanel = () => `
    <div class="feature-grid more-grid" id="admin-more-grid">
      ${MORE_ITEMS.map((m) => `<button type="button" class="tile" data-goto="${m.key}"><span class="ico">${m.icon}</span>${escapeHtml(m.label)}</button>`).join('')}
    </div>`;

  /* -------------------------------------------------------------- */
  /* Render + wire                                                   */
  /* -------------------------------------------------------------- */
  function render() {
    const headerSub = document.getElementById('user-role');
    if (headerSub) headerSub.textContent = db.settings.get().orgName || 'Active Plus';
    host.innerHTML = `
      <div id="admin-home-content">
        ${statusChip()}
        ${hero()}
        ${featureGrid()}
        ${quickActions()}
        ${academic()}
        ${finance()}
        ${bannerCard()}
        ${announcements()}
        ${activity()}
      </div>
      <div id="admin-more" hidden>${morePanel()}</div>`;
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

  /**
   * Render with a safety net (spec 60): a failure shows a friendly message with
   * Retry rather than a blank dashboard, and hides the technical error.
   */
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

  renderSafe();
  return { render: renderSafe, goto, openMore: () => {
    const btn = host.querySelector('#admin-see-more');
    if (btn && host.querySelector('#admin-more')?.hidden) btn.click();
  } };
}
