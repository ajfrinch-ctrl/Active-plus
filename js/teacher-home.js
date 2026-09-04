/**
 * Teacher Home — the app-style landing screen of the teacher portal.
 *
 * Same visual language as the student home (rounded cards, hero, feature grid,
 * quick actions, bottom navigation, More menu) but the information architecture
 * answers the teacher's question: "What do I need to teach or manage today?"
 *
 * Every number is computed from the signed-in teacher's own rows — batches,
 * routine, assignments, exams, results — so nothing is hard-coded and no
 * teacher ever sees a class they are not assigned to.
 */
import { escapeHtml, mountConnectionStatus } from './app.js';
import {
  db, greetingByHour, todayBn, DAY_BN, newId,
  teacherProfile, teacherStudents, teacherDayClasses, teacherPendingAssignments,
  teacherExams, teacherPendingResults, teacherMaterials, todayTeaching,
  teacherNextClass, teacherPerformance, activeBanners, latestNotifications,
  timeAgo, submissionsFor, logActivity, examWindow, getDbStatus
} from './data.js';

const FEATURES = [
  { key: 'batches', icon: '📚', label: 'আমার ক্লাস' },
  { key: 'students', icon: '👨‍🎓', label: 'শিক্ষার্থী' },
  { key: 'exam', icon: '📝', label: 'পরীক্ষা' },
  { key: 'questions', icon: '❓', label: 'প্রশ্ন ব্যাংক' },
  { key: 'tasks', icon: '📋', label: 'অ্যাসাইনমেন্ট' },
  { key: 'materials', icon: '📖', label: 'ম্যাটেরিয়াল' },
  { key: 'routine', icon: '📅', label: 'রুটিন' },
  { key: 'results', icon: '🏆', label: 'ফলাফল' }
];

const QUICK_ACTIONS = [
  { act: 'new-exam', icon: '＋', label: 'পরীক্ষা তৈরি' },
  { act: 'add-mcq', icon: '＋', label: 'MCQ যোগ' },
  { act: 'give-assignment', icon: '＋', label: 'অ্যাসাইনমেন্ট' },
  { act: 'upload-material', icon: '＋', label: 'ম্যাটেরিয়াল' },
  { act: 'publish-notice', icon: '＋', label: 'নোটিশ' },
  { act: 'enter-result', icon: '＋', label: 'ফলাফল' }
];

const MORE_ITEMS = [
  { key: 'students', icon: '👨‍🎓', label: 'আমার শিক্ষার্থী' },
  { key: 'tasks', icon: '📋', label: 'অ্যাসাইনমেন্ট' },
  { key: 'questions', icon: '❓', label: 'প্রশ্ন ব্যাংক' },
  { key: 'materials', icon: '📖', label: 'স্টাডি ম্যাটেরিয়াল' },
  { key: 'results', icon: '🏆', label: 'ফলাফল' },
  { key: 'routine', icon: '📅', label: 'রুটিন' },
  { key: 'notice', icon: '📢', label: 'নোটিশ' },
  { key: 'queries', icon: '💬', label: 'শিক্ষার্থী প্রশ্ন' },
  { key: 'suggestion', icon: '💡', label: 'সাজেশন' },
  { key: 'attendance', icon: '✅', label: 'উপস্থিতি' },
  { key: 'notifications', icon: '🔔', label: 'নোটিফিকেশন' },
  { key: 'profile', icon: '👤', label: 'প্রোফাইল' },
  { key: 'settings', icon: '⚙️', label: 'সেটিংস' },
  { key: 'help', icon: '❔', label: 'সাহায্য' },
  { key: 'logout', icon: '🚪', label: 'লগআউট' }
];

const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

export function initTeacherHome({ session, tabs, openModal, showToast, onLogout }) {
  const host = document.getElementById('teacher-home');
  if (!host) return null;
  const name = session.name;

  const goto = (key) => {
    if (key === 'logout') { onLogout?.(); return; }
    tabs?.activate?.(key);
    host.closest('.home-shell')?.scrollTo?.({ top: 0 });
  };

  /* -------------------------------------------------------------- */
  /* Sections                                                        */
  /* -------------------------------------------------------------- */
  const hero = () => {
    const t = todayTeaching(name);
    const cell = (icon, value, label) => `
      <div class="tile"><span class="ico">${icon}</span><strong>${bn(value)}</strong><span>${label}</span></div>`;
    return `<div class="hero" id="teaching-hero">
      <div class="h-title">আজকের শিক্ষণ</div>
      <div class="feature-grid four">${cell('📚', t.classes, 'ক্লাস')}${cell('👨‍🎓', t.students, 'শিক্ষার্থী')}${cell('📋', t.assignments, 'অ্যাসাইনমেন্ট')}${cell('📝', t.exams, 'পরীক্ষা')}</div>
      ${t.results ? `<p class="meta">⏳ ${bn(t.results)}টি ফলাফল প্রকাশের অপেক্ষায়</p>` : '<p class="meta">সব ফলাফল প্রকাশিত ✅</p>'}
    </div>`;
  };

  const featureGrid = () => `
    <div class="feature-grid" id="teacher-features">
      ${FEATURES.map((f) => `<button type="button" class="tile" data-goto="${f.key}"><span class="ico">${f.icon}</span>${escapeHtml(f.label)}</button>`).join('')}
    </div>
    <button type="button" class="see-more" id="teacher-see-more">আরও দেখুন ↓</button>`;

  const quickActions = () => `
    <div class="quick-row" id="teacher-quick">
      ${QUICK_ACTIONS.map((q) => `<button type="button" class="chip" data-act="${q.act}">${q.icon} ${escapeHtml(q.label)}</button>`).join('')}
    </div>`;

  const nextClassCard = () => {
    const slot = teacherNextClass(name);
    if (!slot) return `<div class="hcard"><div class="h-title">পরবর্তী ক্লাস</div><p>আজ আর কোনো ক্লাস নেই 🎉</p></div>`;
    const cls = teacherProfile(name).classNames[0] || '';
    return `<div class="hcard"><div class="h-title">পরবর্তী ক্লাস</div>
      <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(slot.subject)}</span></div>
      ${cls ? `<div class="info-row"><span class="l">ক্লাস</span><span class="v">${escapeHtml(cls)}</span></div>` : ''}
      <div class="info-row"><span class="l">সময়</span><span class="v">${escapeHtml(slot.time)}</span></div>
      <div class="info-row"><span class="l">কক্ষ</span><span class="v">${escapeHtml(slot.room || '—')}</span></div>
      <button type="button" class="btn btn-block" data-goto="routine">ক্লাস দেখুন</button></div>`;
  };

  const todayClasses = () => {
    const slots = teacherDayClasses(name);
    const students = teacherStudents(name).length;
    return `<div class="hcard"><div class="h-title">আজকের ক্লাস</div>${
      slots.length ? slots.map((s) => `
        <div class="info-row" role="button" tabindex="0" data-goto="routine">
          <span class="l"><strong>${escapeHtml(s.time)}</strong><br><span class="meta">${escapeHtml(s.subject)} · ${escapeHtml(s.room || '')}</span></span>
          <span class="v">${bn(students)} জন</span>
        </div>`).join('') : '<p>আজ কোনো ক্লাস নেই।</p>'}</div>`;
  };

  const pendingTasks = () => {
    const assignments = teacherPendingAssignments(name);
    const results = teacherPendingResults(name);
    const queries = db.notifications.list().filter((n) => n.target === 'শিক্ষক' && !n.reply).length;
    const row = (icon, label, count, key) => `
      <div class="info-row" role="button" tabindex="0" data-goto="${key}">
        <span class="l">${icon} ${escapeHtml(label)}</span><span class="v">${bn(count)}</span></div>`;
    return `<div class="hcard"><div class="h-title">অপেক্ষমাণ কাজ</div>
      ${row('📋', 'অ্যাসাইনমেন্ট দেখতে হবে', assignments.length, 'tasks')}
      ${row('🏆', 'ফলাফল প্রকাশ করতে হবে', results.length, 'results')}
      ${row('💬', 'শিক্ষার্থী প্রশ্নের উত্তর', queries, 'queries')}</div>`;
  };

  const performance = () => {
    const p = teacherPerformance(name);
    if (!p) return `<div class="hcard"><div class="h-title">শিক্ষার্থীর পারফরম্যান্স</div><p>এখনো কোনো পরীক্ষার ফলাফল নেই।</p></div>`;
    const row = (label, value) => `<div class="info-row"><span class="l">${label}</span><span class="v">${bn(value)}</span></div>`;
    return `<div class="hcard"><div class="h-title">শিক্ষার্থীর পারফরম্যান্স</div>
      ${row('গড় স্কোর', p.avg + '%')}${row('সর্বোচ্চ', p.best + '%')}${row('সর্বনিম্ন', p.lowest + '%')}
      ${row('পাসের হার', p.passRate + '%')}${row('অ্যাসাইনমেন্ট জমা', p.assignmentCompletion + '%')}
      ${row('পরীক্ষায় অংশগ্রহণ', p.examParticipation + '%')}</div>`;
  };

  const myClasses = () => {
    const { batches } = teacherProfile(name);
    return `<div class="hcard"><div class="h-title">আমার ক্লাস</div>${
      batches.length ? batches.map((b) => `
        <div class="info-row" role="button" tabindex="0" data-goto="batches">
          <span class="l">${escapeHtml(b.name)}</span><span class="v">${bn(b.students || 0)} জন</span></div>`).join('')
        : '<p>কোনো ক্লাস নির্ধারিত নেই।</p>'}</div>`;
  };

  const noticeCard = () => {
    const latest = db.notices.list().slice(-1)[0];
    return `<div class="hcard"><div class="h-title">📢 সর্বশেষ নোটিশ</div>${
      latest ? `<p><strong>${escapeHtml(latest.title)}</strong></p><p class="meta">${escapeHtml(latest.date || '')} · ${escapeHtml(latest.audience || '')}</p>
        <button type="button" class="btn btn-block" data-goto="notice">সব নোটিশ</button>` : '<p>কোনো নোটিশ নেই।</p>'}</div>`;
  };

  const notificationPreview = () => {
    const rows = db.notifications.list().filter((n) => n.target === 'শিক্ষক').slice(-2).reverse();
    return `<div class="notif-preview"><div class="h-title">🔔 নোটিফিকেশন</div>${
      rows.length ? rows.map((n) => `<div class="info-row" role="button" tabindex="0" data-goto="queries">
        <span class="l">${escapeHtml(n.title)}</span><span class="v">${escapeHtml(timeAgo(n.createdAt) || n.date || '')}</span></div>`).join('')
        : '<p>কোনো নোটিফিকেশন নেই।</p>'}
      <button type="button" class="btn btn-block" data-goto="notifications">সব দেখুন</button></div>`;
  };

  const bannerCard = () => {
    const banners = activeBanners();
    if (!banners.length) return '';
    return `<div class="carousel"><div class="carousel-track">${banners.map((b) => `
      <div class="banner"${b.image ? ` style="background-image:url('${escapeHtml(b.image)}')"` : ''}>
        <strong>${escapeHtml(b.title)}</strong>${b.subtitle ? `<span>${escapeHtml(b.subtitle)}</span>` : ''}
        ${b.link ? `<a class="btn btn-small" href="${escapeHtml(b.link)}" target="_blank" rel="noopener">বিস্তারিত</a>` : ''}
      </div>`).join('')}</div></div>`;
  };

  const morePanel = () => `
    <div class="feature-grid more-grid" id="teacher-more-grid">
      ${MORE_ITEMS.map((m) => `<button type="button" class="tile" data-goto="${m.key}"><span class="ico">${m.icon}</span>${escapeHtml(m.label)}</button>`).join('')}
    </div>`;

  /* -------------------------------------------------------------- */
  /* Render + wire                                                   */
  /* -------------------------------------------------------------- */
  function render() {
    const profile = teacherProfile(name);
    const headerSub = document.getElementById('user-role');
    if (headerSub) {
      headerSub.textContent = [profile.subject, profile.classNames.join(', ')].filter(Boolean).join(' · ') || 'শিক্ষক';
    }
    host.innerHTML = `
      <div id="teacher-home-content">
        <span class="net-chip" id="teacher-net-chip" role="status" aria-live="polite">…</span>
        ${hero()}
        ${featureGrid()}
        ${quickActions()}
        ${nextClassCard()}
        ${todayClasses()}
        ${pendingTasks()}
        ${myClasses()}
        ${performance()}
        ${bannerCard()}
        ${noticeCard()}
        ${notificationPreview()}
      </div>
      <div id="teacher-more" hidden>${morePanel()}</div>`;
  }

  host.addEventListener('click', (e) => {
    if (e.target.closest('#teacher-see-more')) {
      const more = host.querySelector('#teacher-more');
      const content = host.querySelector('#teacher-home-content');
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
    if (act === 'new-exam' || act === 'enter-result') { tabs?.activate?.('exam'); openModal?.('exam-modal'); }
    else if (act === 'add-mcq') { tabs?.activate?.('exam'); document.getElementById('add-question')?.focus(); }
    else if (act === 'give-assignment') { tabs?.activate?.('tasks'); openModal?.('assignment-modal'); }
    else if (act === 'upload-material') { tabs?.activate?.('materials'); openModal?.('material-modal'); }
    else if (act === 'publish-notice') { tabs?.activate?.('notice'); openModal?.('teacher-notice-modal'); }
  });

  /**
   * Render with a safety net (spec 60): if anything throws, show a friendly
   * message with a Retry action instead of leaving the panel blank, and never
   * surface the technical error to the user.
   */
  function renderSafe() {
    try {
      render();
      mountConnectionStatus('#teacher-net-chip', getDbStatus);
    } catch (err) {
      console.error('[Active Plus] teacher home render failed:', (err && err.stack) || err);
      host.innerHTML = `
        <div class="hcard">
          <div class="h-title">দুঃখিত 😔</div>
          <p>তথ্য লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</p>
          <button type="button" class="btn btn-block" data-retry-home style="margin-top:.75rem">আবার চেষ্টা করুন</button>
        </div>`;
      host.querySelector('[data-retry-home]')?.addEventListener('click', renderSafe);
    }
  }

  /** Open the "See More" grid (used by the bottom navigation). */
  function openMore() {
    const btn = host.querySelector('#teacher-see-more');
    if (btn && host.querySelector('#teacher-more')?.hidden) btn.click();
  }

  renderSafe();
  return { render: renderSafe, goto, openMore };
}
