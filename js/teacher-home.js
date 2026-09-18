/**
 * Teacher Home — the app-style landing screen of the teacher portal.
 *
 * Same minimal, tidy interface as the admin home:
 *   1. "আজকের সামগ্রিক অবস্থা" — the handful of numbers a teacher checks in
 *      the morning (details folded behind a tap),
 *   2. one row of quick shortcuts, and
 *   3. every information section folded into collapsible panels — minimized
 *      until tapped.
 *
 * The feature/more tile grids were removed on purpose: the top tab bar and
 * bottom navigation already reach every panel, so the tiles only repeated
 * them. Every number is computed from the signed-in teacher's own rows —
 * batches, routine, assignments, exams, results.
 */
import { escapeHtml, safeUrl, mountConnectionStatus } from './app.js';
import {
  db, teacherProfile, teacherStudents, teacherDayClasses, teacherPendingAssignments,
  teacherPendingResults, teacherPerformance, todayTeaching, teacherNextClass,
  activeBanners, timeAgo, getDbStatus, sharedNotices
} from './data.js';

/* Minimal shortcuts — only the most common actions. */
const QUICK_SHORTCUTS = [
  { act: 'give-assignment', icon: '＋', label: 'অ্যাসাইনমেন্ট' },
  { act: 'publish-notice', icon: '＋', label: 'নোটিশ' },
  { act: 'enter-result', icon: '＋', label: 'ফলাফল' }
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

  const overview = () => {
    const t = todayTeaching(name);
    const cell = (icon, value, label) => `
      <div class="analytics-cell"><span class="ico">${icon}</span><strong>${bn(value)}</strong><span>${label}</span></div>`;

    const slot = teacherNextClass(name);
    const cls = teacherProfile(name).classNames[0] || '';
    const slots = teacherDayClasses(name);
    const students = teacherStudents(name).length;
    const details = `
      ${slot ? `
        <div class="h-title">পরবর্তী ক্লাস</div>
        <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(slot.subject)}</span></div>
        ${cls ? `<div class="info-row"><span class="l">ক্লাস</span><span class="v">${escapeHtml(cls)}</span></div>` : ''}
        <div class="info-row"><span class="l">সময়</span><span class="v">${escapeHtml(slot.time)}</span></div>
        <div class="info-row"><span class="l">কক্ষ</span><span class="v">${escapeHtml(slot.room || '—')}</span></div>`
      : '<p>আজ আর কোনো ক্লাস নেই 🎉</p>'}
      <div class="h-title" style="margin-top:.625rem">আজকের ক্লাস</div>
      ${slots.length ? slots.map((s) => `
        <div class="info-row" role="button" tabindex="0" data-goto="routine">
          <span class="l"><strong>${escapeHtml(s.time)}</strong><br><span class="meta">${escapeHtml(s.subject)} · ${escapeHtml(s.room || '')}</span></span>
          <span class="v">${bn(students)} জন</span>
        </div>`).join('') : '<p>আজ কোনো ক্লাস নেই।</p>'}`;

    return `
      <section class="home-section" aria-label="আজকের সামগ্রিক অবস্থা">
        <h2 class="sec-title">📊 আজকের সামগ্রিক অবস্থা</h2>
        <div class="hcard overview-card" id="teaching-hero">
          <div class="analytics-grid">
            ${cell('📚', t.classes, 'আজকের ক্লাস')}
            ${cell('👨‍🎓', t.students, 'শিক্ষার্থী')}
            ${cell('📋', t.assignments, 'অ্যাসাইনমেন্ট বাকি')}
            ${cell('📝', t.exams, 'আসন্ন পরীক্ষা')}
            ${cell('🏆', t.results, 'ফলাফল বাকি')}
          </div>
          <details class="mini-details in-card">
            <summary>আজকের বিস্তারিত</summary>
            ${details}
          </details>
        </div>
      </section>`;
  };

  const quickShortcuts = () => `
    <section class="home-section" aria-label="কুইক শর্টকাট">
      <h2 class="sec-title">⚡ কুইক শর্টকাট</h2>
      <div class="quick-row" id="teacher-quick">
        ${QUICK_SHORTCUTS.map((q) => `<button type="button" class="chip" data-act="${q.act}">${q.icon} ${escapeHtml(q.label)}</button>`).join('')}
      </div>
    </section>`;

  const fold = (title, body) => body.trim() ? `
    <details class="mini-details">
      <summary>${title}</summary>
      <div class="mini-body">${body}</div>
    </details>` : '';

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

  const myClasses = () => {
    const { batches } = teacherProfile(name);
    return `<div class="hcard"><div class="h-title">আমার ক্লাস</div>${
      batches.length ? batches.map((b) => `
        <div class="info-row" role="button" tabindex="0" data-goto="batches">
          <span class="l">${escapeHtml(b.name)}</span><span class="v">${bn(b.students || 0)} জন</span></div>`).join('')
        : '<p>কোনো ক্লাস নির্ধারিত নেই।</p>'}</div>`;
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

  const noticeCard = () => {
    const latest = sharedNotices().slice(-1)[0];
    return `<div class="hcard"><div class="h-title">📢 সর্বশেষ নোটিশ</div>${
      latest ? `<p><strong>${escapeHtml(latest.title)}</strong></p><p class="meta">${escapeHtml(latest.date || '')} · ${escapeHtml(latest.audience || '')}</p>
        <button type="button" class="btn btn-block" data-goto="notice">সব নোটিশ</button>` : '<p>কোনো নোটিশ নেই।</p>'}</div>`;
  };

  const notificationPreview = () => {
    const rows = db.notifications.list().filter((n) => n.target === 'শিক্ষক').slice(-2).reverse();
    return `<div class="hcard"><div class="h-title">🔔 নোটিফিকেশন</div>${
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
        ${b.link ? `<a class="btn btn-small" href="${escapeHtml(safeUrl(b.link))}" target="_blank" rel="noopener">বিস্তারিত</a>` : ''}
      </div>`).join('')}</div></div>`;
  };

  function render() {
    const profile = teacherProfile(name);
    const headerSub = document.getElementById('user-role');
    if (headerSub) {
      headerSub.textContent = [profile.subject, profile.classNames.join(', ')].filter(Boolean).join(' · ') || 'শিক্ষক';
    }
    const folds = [
      fold('✅ অপেক্ষমাণ কাজ', pendingTasks()),
      fold('🧑‍🏫 আমার ক্লাস', myClasses()),
      fold('📈 শিক্ষার্থীর পারফরম্যান্স', performance()),
      fold('📢 নোটিশ ও আপডেট', bannerCard() + noticeCard() + notificationPreview())
    ].join('');

    host.innerHTML = `
      <span class="net-chip" id="teacher-net-chip" role="status" aria-live="polite">…</span>
      ${overview()}
      ${quickShortcuts()}
      <section class="home-section" aria-label="বিস্তারিত তথ্য">
        <h2 class="sec-title">📂 বিস্তারিত (ট্যাপ করে দেখুন)</h2>
        ${folds}
      </section>`;
  }

  host.addEventListener('click', (e) => {
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

  function openMore() {
    const folds = host.querySelectorAll('details.mini-details');
    folds.forEach((d) => { d.open = true; });
    folds[0]?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function showHome() {
    host.querySelectorAll('details[open]').forEach((d) => { d.open = false; });
  }

  renderSafe();
  return { render: renderSafe, goto, openMore, showHome };
}
