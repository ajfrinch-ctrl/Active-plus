/**
 * Admin Home — the landing screen of the admin panel.
 *
 * Deliberately minimal; the owner asked for a calm, tidy first screen:
 *   1. the institute identity card (from Settings),
 *   2. "সামগ্রিক অবস্থা" — the handful of numbers describing the whole
 *      institution at a glance (details stay folded behind a tap),
 *   3. a single row of quick shortcuts, and
 *   4. every feature list folded into collapsible sections — nothing is
 *      expanded until it is tapped.
 *
 * Duplicate data is gone: each figure appears exactly once, and the old
 * navigation cards (whose counts repeated the overview) no longer exist.
 * Every figure is computed live through analytics() and the collections
 * themselves — nothing is hard-coded.
 */
import { escapeHtml, safeUrl, mountConnectionStatus } from './app.js';
import {
  db, analytics, dueFees, getDbStatus, DAY_BN, orgInfo, mobileDigits
} from './data.js';

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const taka = (n) => `৳${bn(Number(n || 0).toLocaleString('en-US'))}`;

/* Every feature, folded away behind a tap. Duplicate routes are removed:
   শিক্ষার্থী/পেমেন্ট additions live on the bottom-nav ＋ button, প্রোফাইল and
   লগআউট live on the top-bar profile menu. */
const GROUPS = [
  {
    title: '🎓 একাডেমিক',
    tiles: [
      { key: 'students', icon: '👨‍🎓', label: 'শিক্ষার্থী' },
      { key: 'classes', icon: '🏫', label: 'ক্লাস' },
      { key: 'teachers', icon: '👨‍🏫', label: 'শিক্ষক' },
      { key: 'exam', icon: '📝', label: 'পরীক্ষা' },
      { key: 'results', icon: '🏆', label: 'ফলাফল' }
    ]
  },
  {
    title: '💰 ফিন্যান্স',
    tiles: [
      { key: 'dues', icon: '🧾', label: 'বকেয়া ও পেমেন্ট' },
      { key: 'reports', icon: '📊', label: 'রিপোর্ট' }
    ]
  },
  {
    title: '🗂️ ম্যানেজমেন্ট',
    tiles: [
      { key: 'notices', icon: '📢', label: 'নোটিশ' },
      { key: 'notifications', icon: '🔔', label: 'নোটিফিকেশন' },
      { key: 'users', icon: '🔐', label: 'ইউজার ও অনুমতি' },
      { key: 'activity', icon: '🕘', label: 'কার্যক্রম' },
      { key: 'settings', icon: '⚙️', label: 'সেটিংস' }
    ]
  }
];

/* Dashboard quick actions — the heart of the landing screen (Admin Panel v2:
   the owner asked for the daily one-tap jobs FIRST, stats after). Admission,
   payment and attendance were previously only reachable through the ⧺ FAB;
   they now sit on the dashboard itself. */
const DASH_ACTIONS = [
  { act: 'admission', icon: '🎓', label: 'নতুন ভর্তি', en: 'Admission' },
  { act: 'payment', icon: '💰', label: 'পেমেন্ট নিন', en: 'Payment' },
  { act: 'attendance', icon: '✅', label: 'হাজিরা নিন', en: 'Attendance' },
  { act: 'add-teacher', icon: '👨‍🏫', label: 'শিক্ষক যোগ', en: 'Add Teacher' },
  { act: 'create-exam', icon: '📝', label: 'নতুন পরীক্ষা', en: 'New Exam' },
  { act: 'create-notice', icon: '📢', label: 'নোটিশ দিন', en: 'New Notice' },
  // The ☰ menu left the top bar, so the extra-features grid keeps its own
  // one-tap entry right here on the first screen.
  { act: 'more', icon: '⊞', label: 'সব ফিচার', en: 'All Features' }
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
  { key: 'banners', icon: '🖼️', label: 'ব্যানার' },
  { key: 'tips', icon: '💡', label: 'টিপ' },
  { key: 'backup', icon: '💾', label: 'ব্যাকআপ' }
];

export function initAdminHome({ session, tabs, openModal, showToast, onLogout, onAttendance }) {
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
   * Settings. The same four fields feed every receipt, report, admission form
   * and ID card, so the admin can always see what will be printed.
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

  /**
   * The institute at a glance: only the numbers an owner checks daily stay
   * visible; the rest are one tap away, folded inside the same card.
   */
  const overviewCard = () => {
    const a = analytics();
    const due = dueFees();
    const dueStudents = new Set(due.map((d) => d.studentId)).size;
    const results = db.examResults.list();
    const pcts = results.map((r) => Math.round((Number(r.score) || 0) / (Number(r.total) || 1) * 100));
    const avgResult = pcts.length ? Math.round(pcts.reduce((s, x) => s + x, 0) / pcts.length) : 0;
    const todayClasses = db.routine.list().filter((r) => r.day === DAY_BN[new Date().getDay()]).length;

    const cell = (icon, value, label) => `
      <div class="analytics-cell"><span class="ico">${icon}</span><strong>${value}</strong><span>${label}</span></div>`;

    return `
      <section class="home-section" aria-label="সামগ্রিক অবস্থা">
        <h2 class="sec-title">📊 সামগ্রিক অবস্থা · Overview</h2>
        <div class="hcard overview-card" id="admin-overview">
          <div class="analytics-grid">
            ${cell('👨‍🎓', bn(a.totalStudents), 'মোট শিক্ষার্থী')}
            ${cell('✅', bn(a.activeStudents), 'সক্রিয় শিক্ষার্থী')}
            ${cell('🏫', bn(a.totalClasses), 'মোট ক্লাস')}
            ${cell('👨‍🏫', bn(a.totalTeachers), 'মোট শিক্ষক')}
            ${cell('📅', bn(todayClasses), 'আজকের ক্লাস')}
            ${cell('💰', taka(a.totalDue), 'মোট বকেয়া')}
          </div>
          <details class="mini-details in-card" id="admin-detail-stats">
            <summary>বিস্তারিত পরিসংখ্যান</summary>
            <div class="analytics-grid">
              ${cell('📝', bn(a.upcomingExams), 'মোট পরীক্ষা')}
              ${cell('🏆', bn(results.length), 'পরীক্ষার ফলাফল')}
              ${cell('📈', avgResult ? `${bn(avgResult)}%` : '—', 'গড় ফলাফল')}
              ${cell('⚠️', bn(dueStudents), 'বকেয়া শিক্ষার্থী')}
              ${cell('🧾', bn(db.activityLogs.list().length), 'সাম্প্রতিক কার্যক্রম')}
            </div>
          </details>
        </div>
      </section>`;
  };

  /** Quick actions lead the dashboard (Admin Panel v2). Big, tappable tiles
      for the daily jobs; every button also carries the .chip class so the
      legacy styling and the boot test selector keep working. */
  const quickActions = () => `
    <section class="home-section" aria-label="কুইক অ্যাকশন">
      <h2 class="sec-title">⚡ কুইক অ্যাকশন · Quick Actions</h2>
      <div class="quick-row dash-actions" id="admin-quick">
        ${DASH_ACTIONS.map((q) => `
          <button type="button" class="chip dash-action" data-act="${q.act}">
            <span class="da-ico" aria-hidden="true">${q.icon}</span>
            <span class="da-label">${escapeHtml(q.label)}</span>
            <small class="da-en">${escapeHtml(q.en)}</small>
          </button>`).join('')}
      </div>
    </section>`;

  /** Dues alert: the students owing the most money, one tap away from the
      payment screen. Hidden entirely when nothing is due. */
  const duesCard = () => {
    const dues = dueFees();
    if (!dues.length) return '';
    const byStudent = new Map();
    dues.forEach((due) => {
      const cur = byStudent.get(due.studentId) || { student: due.student, total: 0, months: 0 };
      cur.total += Number(due.remaining) || 0;
      cur.months += 1;
      byStudent.set(due.studentId, cur);
    });
    const top = [...byStudent.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    return `
      <section class="home-section" aria-label="বকেয়া সতর্কতা">
        <h2 class="sec-title">⚠️ বকেয়া সতর্কতা · Dues Alert</h2>
        <div class="hcard dues-card">
          <div class="list">
            ${top.map(({ student, total, months }) => `
              <div class="list-item">
                <div class="li-main">
                  <div class="li-title">${escapeHtml(student?.name || '—')}</div>
                  <div class="li-sub">${escapeHtml(student?.id || '')} · ${bn(months)} মাস বকেয়া</div>
                </div>
                <button type="button" class="btn btn-small btn-success" data-goto="dues">৳${bn(Number(total).toLocaleString('en-US'))} নিন</button>
              </div>`).join('')}
          </div>
        </div>
      </section>`;
  };

  /** One collapsible section per group — minimized until tapped. */
  const fold = (title, innerHtml, id = '') => `
    <details class="mini-details"${id ? ` id="${id}"` : ''}>
      <summary>${title}</summary>
      <div class="mini-body">${innerHtml}</div>
    </details>`;

  const tileGrid = (tiles, gridId = '') =>
    `<div class="feature-grid"${gridId ? ` id="${gridId}"` : ''}>${tiles.map((t) => `
      <button type="button" class="tile" data-goto="${t.key}"><span class="ico">${t.icon}</span>${escapeHtml(t.label)}</button>`).join('')}
    </div>`;

  const featureFolds = () => `
    <section class="home-section" aria-label="সব ফিচার">
      <h2 class="sec-title">🧭 সব ফিচার · All Features</h2>
      ${GROUPS.map((g) => fold(`${g.title}`, tileGrid(g.tiles))).join('')}
      ${fold('✨ আরও ফিচার · More', tileGrid(MORE_ITEMS, 'admin-more-grid'), 'admin-more-sec')}
    </section>`;

  function render() {
    const headerSub = document.getElementById('user-role');
    if (headerSub) headerSub.textContent = orgInfo().name;

    // Dashboard order (Admin Panel v2): quick actions first, then the numbers,
    // the dues alert and the institute card; every feature stays folded below.
    host.innerHTML = `
      ${statusChip()}
      ${quickActions()}
      ${overviewCard()}
      ${duesCard()}
      ${instituteCard()}
      ${featureFolds()}`;
  }

  host.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-goto]');
    if (tile) { goto(tile.dataset.goto); return; }
    const action = e.target.closest('[data-act]');
    if (!action) return;
    const act = action.dataset.act;
    if (act === 'admission') { tabs?.activate?.('students'); openModal?.('student-modal'); }
    else if (act === 'payment') { tabs?.activate?.('dues'); }
    else if (act === 'attendance') { onAttendance?.(); }
    else if (act === 'add-teacher') { tabs?.activate?.('teachers'); openModal?.('teacher-modal'); }
    else if (act === 'create-exam') { tabs?.activate?.('exam'); openModal?.('exam-modal'); }
    else if (act === 'add-question') { tabs?.activate?.('questionbank'); }
    else if (act === 'create-notice') { tabs?.activate?.('notices'); openModal?.('notice-modal'); }
    else if (act === 'more') openMore();
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

  /** Tap on "হোম": fold everything back to the minimal first screen. */
  const showHome = () => {
    host.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
  };

  /** The "সব ফিচার" / "আরও" entry point: unfold the extra features list. */
  const openMore = () => {
    const sec = host.querySelector('#admin-more-sec');
    if (!sec) return;
    sec.open = true;
    sec.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  renderSafe();
  return { render: renderSafe, goto, showHome, openMore };
}
