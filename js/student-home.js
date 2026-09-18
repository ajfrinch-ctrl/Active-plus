/**
 * ACTIVE PLUS — simple Student Home.
 * One place for each fact: what today? next class? next exam? fees?
 * Bottom nav owns the main destinations; the profile menu owns profile/settings/logout.
 */

import { initApp, escapeHtml, safeUrl, showToast, openModal, closeModal, getAuthMode } from './app.js';
import { signOut } from './auth.js';
import {
  db, noticesFor,
  greetingByHour, studyStreak, todayProgress, nextClass, upcomingExam,
  performanceFor, feeStatusFor,
  achievementsFor, unreadNotifications, latestTip, activeBanners,
  recordStudyActivity, todayBn, homeCards, lastAccessedMaterial,
  examWindow, assignmentStatus, dueLabel, latestNotifications, DATA_VERSION, subscribeRemote,
  formatBnDate, orgInfo,
  submitAssignment, markMaterialComplete, completedMaterialIds, materialProgressFor, timeAgo,
  homeFeatures, leaderboard
} from './data.js';
import { renderStudentSuggestions, mountExamTaker } from './exams.js';

/** More-menu items that are not already on the bottom nav or profile menu. */
const MORE_MENU = [
  { act: 'routine', ico: '📅', label: 'রুটিন' },
  { act: 'assignments', ico: '📋', label: 'অ্যাসাইনমেন্ট' },
  { act: 'fees', ico: '💰', label: 'ফি' },
  { act: 'notices', ico: '📢', label: 'নোটিশ' },
  { act: 'achievements', ico: '🏅', label: 'অর্জন' },
  { act: 'certificates', ico: '🎓', label: 'সনদ' },
  { act: 'downloads', ico: '⬇️', label: 'ডাউনলোড' },
  { act: 'streak', ico: '🔥', label: 'স্ট্রিক' },
  { act: 'help', ico: '❓', label: 'সহায়তা' }
];

const FIELD_BN = { phone: 'মোবাইল', guardianPhone: 'অভিভাবকের মোবাইল' };
const STATUS_BN = { pending: 'বাকি', submitted: 'জমা হয়েছে', checked: 'চেক হয়েছে', overdue: 'সময় পার' };
const BN = '০১২৩৪৫৬৭৮৯';
const bn = (n) => String(n).replace(/\d/g, (d) => BN[Number(d)]);

export function initStudentHome() {
  const session = initApp({ roles: ['student'], tabs: false });
  if (!session) return;

  const me = db.students.find(session.username) || null;
  const student = { id: me?.id || session.username, name: session.name, className: me?.className };

  /* ---------- Header identity ---------- */
  document.getElementById('greet').textContent = `${greetingByHour()} 👋`;
  document.getElementById('student-name').textContent = session.name;
  const batch = me?.batch ? ` · ব্যাচ ${me.batch}` : '';
  document.getElementById('student-meta').textContent = me ? `${me.className}${batch} · রোল ${me.roll}` : session.detail || '';
  const todayEl = document.getElementById('today-date');
  if (todayEl) todayEl.textContent = `📅 আজ ${formatBnDate(todayBn())}`;
  const sessionEl = document.getElementById('today-session');
  if (sessionEl) sessionEl.textContent = `শিক্ষাবর্ষ ${orgInfo().academicYear || ''}`.trim();
  const avatar = document.getElementById('avatar');
  if (me?.photo) {
    avatar.innerHTML = `<img src="${escapeHtml(me.photo)}" alt="${escapeHtml(session.name)}">`;
  } else {
    avatar.textContent = (session.name || 'A').charAt(0);
  }

  /* Profile menu: profile / settings / logout — nowhere else. */
  const profileBtn = document.getElementById('profile-btn');
  const profileMenu = document.getElementById('student-profile-menu');
  const pmName = document.getElementById('pm-name');
  const pmDetail = document.getElementById('pm-detail');
  const pmAvatar = document.getElementById('pm-avatar');
  if (pmName) pmName.textContent = session.name;
  if (pmDetail) pmDetail.textContent = me
    ? `${me.className || ''}${me.batch ? ` · ব্যাচ ${me.batch}` : ''}${me.roll ? ` · রোল ${me.roll}` : ''}`.trim()
    : (session.detail || 'শিক্ষার্থী');
  if (pmAvatar) {
    if (me?.photo) pmAvatar.innerHTML = `<img src="${escapeHtml(me.photo)}" alt="">`;
    else pmAvatar.textContent = (session.name || 'A').charAt(0);
  }
  const closeProfileMenu = () => {
    if (!profileMenu || profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileBtn?.setAttribute('aria-expanded', 'false');
  };
  profileBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!profileMenu) { openMore('profile'); return; }
    const willOpen = profileMenu.hidden;
    profileMenu.hidden = !willOpen;
    profileBtn.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', (event) => {
    if (!profileMenu || profileMenu.hidden) return;
    if (event.target.closest('#student-profile-menu') || event.target.closest('#profile-btn')) return;
    closeProfileMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeProfileMenu();
  });
  document.getElementById('pm-view-profile')?.addEventListener('click', () => {
    closeProfileMenu();
    openMore('profile');
  });
  document.getElementById('pm-settings')?.addEventListener('click', () => {
    closeProfileMenu();
    openMore('settings');
  });
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    closeProfileMenu();
    signOut({ redirect: true });
  });

  const bellCount = document.getElementById('bell-count');
  const unread = unreadNotifications(student);
  bellCount.hidden = unread === 0;
  bellCount.textContent = bn(unread);

  /* Detail modal (shared) */
  const detail = document.createElement('div');
  detail.className = 'modal-overlay'; detail.id = 'detail-modal'; detail.setAttribute('aria-hidden', 'true');
  detail.innerHTML = `<div class="modal-content" role="dialog" aria-modal="true">
    <button type="button" class="modal-close" data-close aria-label="বন্ধ করুন">×</button>
    <h2 id="detail-title"></h2><div id="detail-body"></div></div>`;
  document.body.appendChild(detail);
  const showDetail = (title, html) => {
    detail.querySelector('#detail-title').textContent = title;
    detail.querySelector('#detail-body').innerHTML = html;
    openModal('detail-modal');
  };

  subscribeRemote(() => { renderHomeSafe(); });

  const headerBar = document.getElementById('home-header');
  const paintNet = () => {
    if (!headerBar) return;
    const online = navigator.onLine !== false;
    headerBar.dataset.net = online ? 'online' : 'offline';
    headerBar.setAttribute('aria-label', online ? 'সংযোগ: অনলাইন' : 'সংযোগ: অফলাইন — কিছু কাজ করা যাবে না');
    headerBar.classList.toggle('offline', !online);
  };
  paintNet();
  window.addEventListener('online', () => { paintNet(); renderHomeSafe(); });
  window.addEventListener('offline', paintNet);

  /* ---------- Bottom nav ---------- */
  const views = { home: 'view-home', study: 'view-study', exam: 'view-exam', result: 'view-result', more: 'view-more' };
  const switchView = (name) => {
    Object.entries(views).forEach(([k, id]) => { document.getElementById(id).hidden = k !== name; });
    document.querySelectorAll('.bottom-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
    if (name === 'home') renderHomeSafe();
    else if (name === 'exam') refreshExams?.();
    else if (name === 'more') renderMore();
    else if (name === 'study') renderStudy();
    else if (name === 'result') renderResult();
    window.scrollTo({ top: 0 });
  };
  document.querySelector('.bottom-nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) switchView(b.dataset.view);
  });

  /* ---------- Notification centre ---------- */
  document.getElementById('bell').addEventListener('click', () => {
    const rows = noticesFor(student);
    document.getElementById('notif-list').innerHTML = rows.length
      ? rows.map((n) => `<div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(n.title)}</div><div class="li-sub">${escapeHtml(timeAgo(n.createdAt) || formatBnDate(n.date))} · ${escapeHtml(n.audience || '')}</div></div></div>`).join('')
      : '<div class="empty-state">কোনো নোটিফিকেশন নেই।</div>';
    openModal('notif-center');
    db.notifications.list().filter((n) => !n.read && (n.target === 'সবাই' || n.target === 'শিক্ষার্থী'))
      .forEach((n) => db.notifications.update(n.id, { read: true }));
    bellCount.hidden = true;
  });

  const host = document.getElementById('home-content');
  let refreshExams = null;

  const classMaterials = () =>
    db.materials.list().filter((m) => !m.className || m.className === student.className);

  /**
   * Home = glance only. No shortcuts (bottom nav), no folds, no “more features”.
   * Each fact appears once.
   */
  const renderHome = () => {
    const cards = homeCards();
    const progress = todayProgress(student);
    const { streak, week } = studyStreak();
    const next = cards.nextClass ? nextClass() : null;
    const exam = cards.exam ? upcomingExam(student.className) : null;
    const fee = feeStatusFor(student);
    const tip = cards.tip ? latestTip() : null;
    const banners = cards.banners ? activeBanners() : [];
    const resume = cards.materials ? (lastAccessedMaterial() || classMaterials()[0] || null) : null;
    const previewNotes = cards.notices ? latestNotifications(student, 2) : [];
    const assignments = cards.assignments
      ? db.assignments.list().filter((a) => a.className === student.className) : [];
    const pendingAsg = assignments.filter((a) => {
      const st = assignmentStatus(a, student).status;
      return st === 'pending' || st === 'overdue';
    });

    const cell = (icon, value, label) =>
      `<div class="analytics-cell"><span class="ico">${icon}</span><strong>${value}</strong><span>${label}</span></div>`;

    const parts = [];

    /* 1. Notices & tip — under the fixed identity bar */
    const bannerParts = [];
    if (cards.banners && banners.length) {
      bannerParts.push(`
      <div class="carousel">
        <div class="carousel-track" id="banner-track">
          ${banners.map((b) => `
          <div class="banner">
            ${b.image ? `<img src="${escapeHtml(b.image)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:14px;margin-bottom:.5rem">` : ''}
            <h3>📢 ${escapeHtml(b.title)}</h3>
            <p>${escapeHtml(b.desc)}</p>
            <button type="button" class="btn btn-small" data-act="banner" data-id="${escapeHtml(b.id)}">${escapeHtml(b.cta || 'দেখুন')}</button>
          </div>`).join('')}
        </div>
        ${banners.length > 1 ? `<div class="carousel-dots" id="banner-dots">${banners.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      </div>`);
    }
    if (cards.notices && previewNotes.length) {
      bannerParts.push(`
      <div class="notice-banner" id="home-notice-banner">
        <div class="h-title">🔔 নোটিশ</div>
        ${previewNotes.map((n) => `
        <div class="notif-preview">
          <span class="dot"></span>
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(n.title)}</div>
            <div class="meta">${escapeHtml(n.body)} · ${escapeHtml(timeAgo(n.createdAt) || formatBnDate(n.date))}</div>
          </div>
        </div>`).join('')}
        <button type="button" class="btn btn-secondary btn-block" data-act="notif" style="margin-top:.5rem">সব দেখুন</button>
      </div>`);
    }
    if (tip) {
      bannerParts.push(`
      <div class="tip-banner" id="home-tip-banner">
        <div class="h-title">💡 শিক্ষকের টিপ</div>
        <p>"${escapeHtml(tip.text)}"</p>
      </div>`);
    }
    if (bannerParts.length) {
      parts.push(`<section class="home-section home-banners" aria-label="নোটিশ ও টিপ">${bannerParts.join('')}</section>`);
    }

    /* 2. Today's glance */
    if (cards.progress || cards.exam || cards.fee) {
      const cells = [
        ...(cards.progress ? [
          cell('📈', `${bn(progress.pct)}%`, 'আজকের প্রগ্রেস'),
          cell('🔥', bn(streak), 'দিন স্ট্রিক')
        ] : []),
        ...(cards.exam ? [cell('📝', bn(exam ? 1 : 0), 'আসন্ন পরীক্ষা')] : []),
        ...(cards.fee ? [cell('💰', fee.due > 0 ? `৳${bn(fee.due)}` : '✓', 'ফি')] : [])
      ];
      parts.push(`
      <section class="home-section" aria-label="আজকের অবস্থা">
        <h2 class="sec-title">📊 আজকের অবস্থা</h2>
        <div class="hcard overview-card" id="student-overview">
          <div class="analytics-grid">${cells.join('')}</div>
          ${cards.progress ? `
          <div class="progress-bar" style="margin-top:.625rem"><div class="progress-fill" style="width:${progress.pct}%"></div></div>
          <div class="week" style="margin-top:.625rem">${week.map((d) => `<div class="d ${d.done ? 'on' : ''}" role="img" aria-label="${d.day}${d.done ? ' — পড়াশোনা হয়েছে' : ' — পড়াশোনা নেই'}">${d.day}<div class="dot"></div></div>`).join('')}</div>` : ''}
        </div>
      </section>`);
    }

    /* 3. Next class — once */
    if (cards.nextClass) {
      parts.push(next ? `
      <div class="hcard" id="home-next-class">
        <div class="h-title">পরবর্তী ক্লাস</div>
        <div class="big">${escapeHtml(next.item.subject)}</div>
        <div class="info-row"><span class="l">সময়</span><span class="v">${escapeHtml(next.when)} · ${escapeHtml(next.item.time)}</span></div>
        <div class="info-row"><span class="l">শিক্ষক</span><span class="v">${escapeHtml(next.item.teacher)}</span></div>
        <div class="info-row"><span class="l">কক্ষ</span><span class="v">${escapeHtml(next.item.room)}</span></div>
        <button type="button" class="btn btn-secondary btn-block" data-act="routine" style="margin-top:.5rem">পূর্ণ রুটিন</button>
      </div>` : `
      <div class="hcard" id="home-next-class">
        <div class="h-title">পরবর্তী ক্লাস</div>
        <p>আপাতত কোনো ক্লাস নির্ধারিত নেই 🎉</p>
      </div>`);
    }

    /* 4. Continue learning — once (full list lives on Study tab) */
    if (cards.materials) {
      if (resume) {
        const mp = materialProgressFor(student, student.className);
        const doneThis = completedMaterialIds(student).includes(resume.id);
        parts.push(`
        <div class="hcard" id="home-resume">
          <div class="h-title">পড়া চালিয়ে যান</div>
          <div class="big">${escapeHtml(resume.title)}</div>
          <div class="meta">${escapeHtml(resume.subject)} · ${escapeHtml(resume.type || '')}</div>
          <div class="progress-bar" style="margin:.5rem 0"><div class="progress-fill" style="width:${mp.pct}%"></div></div>
          <div class="meta">${doneThis ? 'এই ম্যাটেরিয়াল সম্পন্ন ✓ · ' : ''}${bn(mp.done)} / ${bn(mp.total)} সম্পন্ন (${bn(mp.pct)}%)</div>
          <button type="button" class="btn btn-block" data-act="material" data-id="${escapeHtml(resume.id)}" style="margin-top:.5rem">চালিয়ে যান</button>
        </div>`);
      } else {
        parts.push(`
        <div class="hcard" id="home-resume">
          <div class="h-title">পড়া চালিয়ে যান</div>
          <p>নতুন কিছু শেখা শুরু করুন 📚</p>
          <button type="button" class="btn btn-secondary btn-block" data-act="study" style="margin-top:.5rem">স্টাডি খুলুন</button>
        </div>`);
      }
    }

    /* 5. Upcoming exam — once (list lives on Exam tab) */
    if (cards.exam) {
      if (exam) {
        const win = examWindow(exam);
        parts.push(`
        <div class="hcard" id="home-exam">
          <div class="h-title">আসন্ন পরীক্ষা</div>
          <div class="big">${escapeHtml(exam.title)}</div>
          <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(exam.subject)}</span></div>
          <div class="info-row"><span class="l">তারিখ</span><span class="v">${escapeHtml(formatBnDate(exam.date) || '—')}${exam.time ? ` · ${escapeHtml(exam.time)}` : ''}</span></div>
          <div class="info-row"><span class="l">সময়</span><span class="v">${bn(exam.duration || 0)} মিনিট · ${bn(exam.questions.length)} প্রশ্ন</span></div>
          ${win.canStart
            ? `<button type="button" class="btn btn-block" data-act="startexam" style="margin-top:.5rem">পরীক্ষা শুরু করুন</button>`
            : `<button type="button" class="btn btn-secondary btn-block" data-act="exam" style="margin-top:.5rem">পরীক্ষা দেখুন</button>
               <p class="meta" style="margin-top:.5rem">${escapeHtml(win.state === 'closed' ? 'এই পরীক্ষার সময় শেষ।' : 'পরীক্ষা শুরুর সময় হয়নি।')}</p>`}
        </div>`);
      } else {
        parts.push(`
        <div class="hcard" id="home-exam">
          <div class="h-title">আসন্ন পরীক্ষা</div>
          <p>কোনো পরীক্ষা নির্ধারিত নেই।</p>
        </div>`);
      }
    }

    /* 6. Assignments — up to 3 rows; full list lives in More */
    if (cards.assignments) {
      if (assignments.length) {
        const show = (pendingAsg.length ? pendingAsg : assignments).slice(0, 3);
        parts.push(`
        <div class="hcard" id="home-assignments">
          <div class="h-title">${pendingAsg.length ? 'বাকি অ্যাসাইনমেন্ট' : 'অ্যাসাইনমেন্ট'}</div>
          ${show.map((a) => {
            const st = assignmentStatus(a, student);
            return `<div class="info-row" role="button" tabindex="0" data-act="assignment" data-id="${escapeHtml(a.id)}" style="cursor:pointer">
              <span class="l">📋 ${escapeHtml(a.title)}<br><span class="chip ${st.status}">${STATUS_BN[st.status]}</span></span>
              <span class="v">${escapeHtml(dueLabel(a, student))}</span>
            </div>`;
          }).join('')}
          <button type="button" class="btn btn-secondary btn-block" data-act="assignments" style="margin-top:.5rem">সব দেখুন</button>
        </div>`);
      } else {
        parts.push(`
        <div class="hcard" id="home-assignments">
          <div class="h-title">অ্যাসাইনমেন্ট</div>
          <p>সব শেষ! 🎉</p>
        </div>`);
      }
    }

    /* 7. Latest result — once (full history on Result tab) */
    if (cards.performance || cards.exam) {
      const mine = db.examResults.list().filter((r) => r.studentId === student.id).slice(-1)[0];
      if (mine) {
        const ex = db.exams.find(mine.examId);
        const pct = Math.round(mine.score / mine.total * 100);
        const rank = cards.leaderboard ? performanceFor(student)?.rank : null;
        parts.push(`
        <div class="hcard" id="home-result">
          <div class="h-title">🏆 সাম্প্রতিক ফলাফল</div>
          <div class="big">${escapeHtml(ex?.title || 'পরীক্ষা')}</div>
          <div class="info-row"><span class="l">স্কোর</span><span class="v">${bn(mine.score)}/${bn(mine.total)} (${bn(pct)}%)</span></div>
          ${rank != null ? `<div class="info-row"><span class="l">অবস্থান</span><span class="v">#${bn(rank)}</span></div>
          <div class="info-row"><span class="l">র‍্যাঙ্ক</span><span class="v">#${bn(rank)}</span></div>` : ''}
          <button type="button" class="btn btn-secondary btn-block" data-act="result" style="margin-top:.5rem">ফলাফল দেখুন</button>
        </div>`);
      }
    }

    /* 8. Fee status */
    if (cards.fee) {
      parts.push(fee.due > 0 ? `
      <div class="hcard" id="home-fee">
        <div class="h-title">💰 ফি বকেয়া</div>
        <div class="info-row"><span class="l">বকেয়া</span><span class="v" style="color:var(--warning)">৳${bn(fee.due)}</span></div>
        ${fee.nextDue ? `<div class="info-row"><span class="l">মাস</span><span class="v">${escapeHtml(fee.nextDue.month)}</span></div>` : ''}
        <button type="button" class="btn btn-secondary btn-block" data-act="fees" style="margin-top:.5rem">বিস্তারিত</button>
      </div>` : `
      <div class="hcard" id="home-fee">
        <div class="h-title">💰 ফি</div>
        <p>সব ফি পরিশোধিত ✓</p>
      </div>`);
    }

    host.innerHTML = parts.join('\n');
  };

  const renderHomeSafe = () => {
    try {
      renderHome();
    } catch (err) {
      console.error('[Active Plus] home render failed:', err && err.stack || err);
      host.innerHTML = `
        <div class="hcard">
          <div class="h-title">দুঃখিত 😔</div>
          <p>হোম লোড করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।</p>
          <button type="button" class="btn btn-block" id="home-retry" style="margin-top:.75rem">আবার চেষ্টা করুন</button>
        </div>`;
      host.querySelector('#home-retry')?.addEventListener('click', renderHomeSafe);
      showToast('হোম লোড করা যায়নি।', 'error');
    }
  };

  /* Keyboard parity for role=button rows */
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[role="button"][data-act], [role="button"][data-asg]');
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'exam' || act === 'startexam') {
      if (!navigator.onLine) {
        showToast('অফলাইনে পরীক্ষা দেওয়া যাবে না — ইন্টারনেট সংযোগ ফিরলে আবার চেষ্টা করুন।', 'error');
        return;
      }
      switchView('exam');
      if (act === 'startexam') refreshExams?.start?.();
    } else if (act === 'result' || act === 'progress') switchView('result');
    else if (act === 'review') { switchView('exam'); refreshExams?.review?.(el.dataset.exam); }
    else if (act === 'study' || act === 'downloads') switchView('study');
    else if (['routine', 'fees', 'notices', 'assignments', 'achievements', 'certificates', 'streak', 'profile', 'settings', 'help'].includes(act)) openMore(act);
    else if (act === 'assignment') openAssignment(el.dataset.id);
    else if (act === 'notif') document.getElementById('bell').click();
    else if (act === 'material') openMaterial(el.dataset.id);
    else if (act === 'banner') openBanner(el.dataset.id);
  });

  function openCertificate(badge) {
    if (!badge) return;
    showDetail('🎓 সনদ', `
      <div id="certificate-sheet" style="text-align:center;padding:1rem;border:2px dashed var(--accent);border-radius:16px">
        <img src="assets/logo.png" alt="" class="doc-logo" style="width:64px;height:64px">
        <div style="font-size:.75rem;letter-spacing:.08em">${escapeHtml(db.settings.get().orgName || 'Active Plus')}</div>
        <div style="font-size:1.5rem;margin:.5rem 0">${badge.icon}</div>
        <div style="font-weight:700;font-size:1.125rem">${escapeHtml(badge.name)}</div>
        <p style="margin:.5rem 0">এই সনদ প্রদান করা হলো</p>
        <div style="font-weight:700">${escapeHtml(session.name)}</div>
        <div class="meta">${escapeHtml(student.id)}${me?.className ? ` · ${escapeHtml(me.className)}` : ''}</div>
        <div class="meta" style="margin-top:.75rem">তারিখ: ${escapeHtml(formatBnDate(todayBn()))}</div>
      </div>
      <button type="button" class="btn btn-block" id="print-cert" style="margin-top:.75rem">প্রিন্ট করুন</button>`);
    detail.querySelector('#print-cert')?.addEventListener('click', () => {
      if (typeof window.print === 'function') window.print();
      else showToast('এই ব্রাউজারে প্রিন্ট করা যায়নি।', 'warning');
    });
  }

  function openBanner(id) {
    const b = db.banners.find(id);
    if (!b) return;
    showDetail(b.title, `<p>${escapeHtml(b.desc || '')}</p><p class="meta" style="margin-top:.5rem">${escapeHtml(formatBnDate(b.date))}</p>`);
  }

  function openAssignment(id) {
    const a = db.assignments.find(id);
    if (!a) return;
    const st = assignmentStatus(a, student);
    showDetail(a.title, `
      <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(a.subject)}</span></div>
      <div class="info-row"><span class="l">শিক্ষক</span><span class="v">${escapeHtml(a.teacher || '—')}</span></div>
      <div class="info-row"><span class="l">ডেডলাইন</span><span class="v">${escapeHtml(a.deadline)}</span></div>
      <div class="info-row"><span class="l">অবস্থা</span><span class="v"><span class="chip ${st.status}">${STATUS_BN[st.status]}</span></span></div>
      ${a.marks ? `<div class="info-row"><span class="l">নম্বর</span><span class="v">${bn(a.marks)}</span></div>` : ''}
      <p style="margin-top:.75rem;white-space:pre-wrap">${escapeHtml(a.description || '')}</p>
      ${st.sub?.feedback ? `<p class="meta" style="margin-top:.5rem">শিক্ষকের মন্তব্য: ${escapeHtml(st.sub.feedback)}</p>` : ''}
      ${st.status === 'pending' || st.status === 'overdue' ? `
      <form id="submit-assignment-form" style="margin-top:.75rem">
        <div class="form-group"><label for="submit-note">মন্তব্য / লিংক (ঐচ্ছিক)</label>
          <input id="submit-note" class="form-input" placeholder="যেমন: খাতার ছবি বা লিংক"></div>
        <button type="submit" class="btn btn-block">জমা দিন</button>
      </form>` : `<p class="meta" style="margin-top:.75rem">${st.status === 'checked' ? 'শিক্ষক আপনার কাজ চেক করেছেন ✓' : 'আপনি এটি জমা দিয়েছেন ✓'}</p>`}`);

    const form = detail.querySelector('#submit-assignment-form');
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!navigator.onLine) {
        showToast('অফলাইনে অ্যাসাইনমেন্ট জমা দেওয়া যাবে না।', 'error');
        return;
      }
      const note = String(detail.querySelector('#submit-note')?.value || '').trim();
      submitAssignment(a, { id: student.id, name: session.name }, note);
      closeModal('detail-modal');
      renderHomeSafe();
      showToast('অ্যাসাইনমেন্ট জমা হয়েছে।', 'success');
    });
  }

  function openMaterial(id) {
    const m = db.materials.find(id);
    if (!m) return;
    recordStudyActivity('view', 1, id);
    const isDone = completedMaterialIds(student).includes(m.id);
    showDetail(m.title, `
      <p>${escapeHtml(m.subject)} · ${escapeHtml(m.className)} · ${escapeHtml(formatBnDate(m.date))}</p>
      <p style="white-space:pre-wrap;margin-top:.5rem">${escapeHtml(m.description || '')}</p>
      ${m.link ? `<a class="btn btn-secondary btn-block" href="${escapeHtml(safeUrl(m.link))}" target="_blank" rel="noopener" style="margin-top:.75rem">ফাইল খুলুন / ডাউনলোড</a>` : ''}
      ${isDone
        ? '<p class="meta" style="margin-top:.75rem">আপনি এটি সম্পন্ন করেছেন ✓</p>'
        : '<button type="button" class="btn btn-block" id="mark-complete" style="margin-top:.75rem">সম্পন্ন হিসেবে চিহ্নিত করুন</button>'}`);
    detail.querySelector('#mark-complete')?.addEventListener('click', () => {
      markMaterialComplete(m.id, { id: student.id, name: session.name });
      closeModal('detail-modal');
      renderHomeSafe();
      showToast('ম্যাটেরিয়াল সম্পন্ন হিসেবে যুক্ত হয়েছে।', 'success');
    });
  }

  /* ---------- More: clean menu, one panel at a time ---------- */
  function renderMore(only = null) {
    const meRow = me || {};
    const editable = db.settings.get().studentEditableFields || [];
    const badges = achievementsFor(student);
    const downloadable = classMaterials().filter((m) => (m.type || '').includes('পিডিএফ') || m.file || m.link);
    const streak = studyStreak();
    const enabled = homeFeatures();

    const row = (label, value) =>
      `<div class="info-row"><span class="l">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;

    const menuItems = MORE_MENU.filter((f) => {
      // Core utilities always stay; optional extras follow admin feature flags.
      if (['routine', 'assignments', 'fees', 'notices'].includes(f.act)) return true;
      if (f.act === 'achievements') return enabled.includes('achievements');
      if (f.act === 'certificates') return enabled.includes('certificates');
      if (f.act === 'downloads') return enabled.includes('downloads');
      if (f.act === 'streak') return enabled.includes('streak');
      if (f.act === 'help') return enabled.includes('help');
      return true;
    });

    const panels = {
      assignments: `
      <div class="hcard" id="more-assignments"><div class="h-title">অ্যাসাইনমেন্ট</div>${
        db.assignments.list().filter((a) => a.className === student.className).map((a) => {
          const st = assignmentStatus(a, student);
          return `<div class="info-row" role="button" tabindex="0" data-asg="${escapeHtml(a.id)}" style="cursor:pointer">
            <span class="l">${escapeHtml(a.title)} <span class="chip ${st.status}">${STATUS_BN[st.status]}</span></span>
            <span class="v">${escapeHtml(dueLabel(a, student))}</span></div>`;
        }).join('') || '<p>কোনো অ্যাসাইনমেন্ট নেই।</p>'}</div>`,
      routine: `
      <div class="hcard" id="more-routine"><div class="h-title">রুটিন</div>${
        db.routine.list().map((r) => row(`${r.day} · ${r.subject}`, `${r.time} · ${r.room || ''}`)).join('') || '<p>রুটিন নেই।</p>'}</div>`,
      fees: `
      <div class="hcard" id="more-fees"><div class="h-title">ফি</div>${
        db.fees.list().filter((f) => f.studentId === student.id).map((f) =>
          `<div class="info-row"><span class="l">${escapeHtml(f.month)}</span><span class="v" style="color:${f.status === 'বকেয়া' ? 'var(--warning)' : 'var(--success)'}">${escapeHtml(f.status)} · ৳${bn(f.amount)}</span></div>`).join('') || '<p>ফি তথ্য নেই।</p>'}</div>`,
      notices: `
      <div class="hcard" id="more-notices"><div class="h-title">নোটিশ</div>${
        noticesFor(student).map((n) => row(n.title, formatBnDate(n.date))).join('') || '<p>কোনো নোটিশ নেই।</p>'}</div>`,
      achievements: `
      <div class="hcard" id="more-achievements"><div class="h-title">অর্জন</div>${
        badges.map((b) => row(`${b.icon} ${b.name}`, '')).join('') || '<p>এখনো কোনো ব্যাজ অর্জিত হয়নি।</p>'}</div>`,
      certificates: `
      <div class="hcard" id="more-certificates"><div class="h-title">সনদ</div>${
        badges.length
          ? `<p class="meta">প্রতিটি অর্জিত ব্যাজের জন্য একটি সনদ প্রিন্ট করা যাবে।</p>${badges.map((b, i) => `
            <div class="info-row">
              <span class="l">${b.icon} ${escapeHtml(b.name)}</span>
              <span class="v"><button type="button" class="btn btn-small" data-cert="${i}">সনদ দেখুন</button></span>
            </div>`).join('')}`
          : '<p>সনদের জন্য এখনো কোনো ব্যাজ অর্জিত হয়নি।</p>'}</div>`,
      downloads: `
      <div class="hcard" id="more-downloads"><div class="h-title">ডাউনলোড</div>${
        downloadable.length
          ? downloadable.map((m) => m.link
              ? `<a class="info-row" href="${escapeHtml(safeUrl(m.link))}" target="_blank" rel="noopener" style="text-decoration:none"><span class="l">⬇️ ${escapeHtml(m.title)}</span><span class="v">ডাউনলোড</span></a>`
              : `<div class="info-row" role="button" tabindex="0" data-mat2="${escapeHtml(m.id)}" style="cursor:pointer"><span class="l">📄 ${escapeHtml(m.title)}</span><span class="v">${escapeHtml(m.type || '')}</span></div>`).join('')
          : '<p>আপনার ক্লাসের জন্য ডাউনলোডযোগ্য ফাইল নেই।</p>'}</div>`,
      streak: `
      <div class="hcard" id="more-streak"><div class="h-title">স্টাডি স্ট্রিক</div>
        <div class="info-row"><span class="l">🔥 ধারাবাহিক দিন</span><span class="v">${bn(streak.streak)}</span></div>
        <div class="week" style="margin-top:.5rem">${streak.week.map((d) => `<div class="d ${d.done ? 'on' : ''}" role="img" aria-label="${d.day}${d.done ? ' — পড়াশোনা হয়েছে' : ' — পড়াশোনা নেই'}">${d.day}<div class="dot"></div></div>`).join('')}</div>
        <p class="meta" style="margin-top:.5rem">প্রতিদিন পড়াশোনা করলে স্ট্রিক বাড়ে।</p></div>`,
      profile: `
      <div class="hcard" id="more-profile"><div class="h-title">প্রোফাইল</div>
        ${meRow.photo ? `<img src="${escapeHtml(meRow.photo)}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin-bottom:.75rem">` : ''}
        ${row('নাম', session.name)}
        ${row('শিক্ষার্থী আইডি', student.id)}
        ${row('শ্রেণি', meRow.className || '—')}
        ${row('শাখা', meRow.section || '—')}
        ${row('রোল', meRow.roll || '—')}
        ${row('ব্যাচ', meRow.batch || '—')}
        ${row('স্কুল/কলেজ', meRow.school || '—')}
        ${row('অভিভাবক', meRow.guardian || '—')}
        ${row('অভিভাবকের মোবাইল', meRow.guardianPhone || '—')}
        ${row('ভর্তির তারিখ', formatBnDate(meRow.admissionDate) || '—')}
        ${row('অবস্থা', meRow.status || '—')}
        <form id="profile-edit-form" style="margin-top:.75rem">
          ${editable.map((f) => `<div class="form-group"><label for="pf-${escapeHtml(f)}">${escapeHtml(FIELD_BN[f] || f)} (সম্পাদনাযোগ্য)</label><input id="pf-${escapeHtml(f)}" name="${escapeHtml(f)}" class="form-input" value="${escapeHtml(meRow[f] || '')}"></div>`).join('')}
          ${editable.length ? `<button type="submit" class="btn btn-block">প্রোফাইল আপডেট করুন</button>` : `<p class="meta">প্রোফাইল সম্পাদনার অনুমতি অ্যাডমিন দেননি।</p>`}
        </form></div>`,
      settings: `
      <div class="hcard" id="more-settings"><div class="h-title">সেটিংস</div>
        ${row('ডেটা মোড', getAuthMode() === 'firebase' ? 'Firebase (ক্লাউড)' : 'লোকাল (এই ডিভাইস)')}
        ${row('অ্যাপ ভার্সন', `v${DATA_VERSION}`)}
        <button type="button" class="btn btn-secondary btn-block" id="clear-cache" style="margin-top:.75rem">অ্যাপ ক্যাশ রিফ্রেশ করুন</button>
      </div>`,
      help: `
      <div class="hcard" id="more-help"><div class="h-title">সহায়তা</div>
        ${row('প্রতিষ্ঠান', db.settings.get().orgName || 'Active Plus')}
        ${row('মোবাইল', db.settings.get().mobile || '—')}
        ${row('ইমেইল', db.settings.get().email || '—')}
        <p class="meta" style="margin-top:.5rem">সমস্যা হলে উপরের নম্বরে যোগাযোগ করুন।</p></div>`
    };

    const moreHost = document.getElementById('more-content');
    const focused = Boolean(only) && panels[only];

    if (focused) {
      moreHost.innerHTML = `
        <button type="button" class="btn btn-secondary btn-block" id="more-back" style="margin-bottom:.75rem">← ফিরে যান</button>
        ${panels[only]}`;
    } else {
      /* Clean menu — no dump of every card, no second shortcut row. */
      moreHost.innerHTML = `
        <div class="hcard" id="more-menu">
          <div class="h-title">আরও</div>
          <div class="more-list">
            ${menuItems.map((f) => `
              <button type="button" class="more-item" data-act="${f.act}">
                <span class="ico" aria-hidden="true">${f.ico}</span>
                <span class="label">${escapeHtml(f.label)}</span>
                <span class="chev" aria-hidden="true">›</span>
              </button>`).join('')}
          </div>
        </div>`;
    }

    document.getElementById('more-back')?.addEventListener('click', () => renderMore());

    document.getElementById('clear-cache')?.addEventListener('click', async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        const reg = await navigator.serviceWorker?.getRegistration?.();
        await reg?.update();
        showToast('ক্যাশ রিফ্রেশ হয়েছে।', 'success');
      } catch (err) {
        showToast('ক্যাশ রিফ্রেশ করা যায়নি।', 'error');
      }
    });

    moreHost.onclick = (e) => {
      const asg = e.target.closest('[data-asg]');
      if (asg) { openAssignment(asg.dataset.asg); return; }
      const mat = e.target.closest('[data-mat2]');
      if (mat) { openMaterial(mat.dataset.mat2); return; }
      const cert = e.target.closest('[data-cert]');
      if (cert) { openCertificate(badges[Number(cert.dataset.cert)]); return; }
      const tileEl = e.target.closest('[data-act]');
      if (!tileEl) return;
      openMore(tileEl.dataset.act);
    };

    const editForm = document.getElementById('profile-edit-form');
    editForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!navigator.onLine) {
        showToast('অফলাইনে প্রোফাইল আপডেট করা যাবে না।', 'error');
        return;
      }
      const patch = {};
      editable.forEach((f) => {
        const input = editForm.querySelector(`input[name="${f}"]`);
        const value = String(input?.value || '').trim();
        if (value) patch[f] = value;
      });
      if (!Object.keys(patch).length) { showToast('কোনো পরিবর্তন নেই।', 'info'); return; }
      db.students.update(student.id, patch);
      showToast('প্রোফাইল আপডেট হয়েছে।', 'success');
      renderMore(only);
    });
  }

  function openMore(section) {
    switchView('more');
    if (section) renderMore(section);
  }

  /* ---------- Study / Exam / Result ---------- */
  function renderStudy() {
    const mats = classMaterials();
    document.getElementById('material-list').innerHTML = mats.length
      ? mats.map((m) => `<div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(m.title)}</div><div class="li-sub">${escapeHtml(m.subject)} · ${escapeHtml(m.type || '')} · ${escapeHtml(formatBnDate(m.date))}</div></div>
        <button type="button" class="btn btn-small" data-mat="${escapeHtml(m.id)}">খুলুন</button></div>`).join('')
      : '<div class="empty-state">কোনো ম্যাটেরিয়াল নেই।</div>';
    document.getElementById('material-list').onclick = (e) => {
      const b = e.target.closest('[data-mat]');
      if (b) openMaterial(b.dataset.mat);
    };
    renderStudentSuggestions('#student-suggestion-list', student.className);
  }

  document.getElementById('result-content').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'review') {
      switchView('exam');
      refreshExams?.review?.(el.dataset.exam);
    }
  });

  function renderResult() {
    const perf = performanceFor(student);
    const mine = db.examResults.list().filter((r) => r.studentId === student.id);
    document.getElementById('result-content').innerHTML = `
      ${perf ? `<div class="hcard"><div class="h-title">সারসংক্ষেপ</div>
        <div class="info-row"><span class="l">গড়</span><span class="v">${bn(perf.avg)}%</span></div>
        <div class="info-row"><span class="l">সেরা</span><span class="v">${bn(perf.best)}%</span></div>
        <div class="info-row"><span class="l">টেস্ট</span><span class="v">${bn(perf.tests)}</span></div>
        <div class="info-row"><span class="l">র‍্যাঙ্ক</span><span class="v">#${bn(perf.rank)}</span></div></div>` : ''}
      <div class="hcard"><div class="h-title">সব ফলাফল</div>${
        mine.length ? mine.map((r) => {
          const ex = db.exams.find(r.examId);
          const pct = Math.round(r.score / r.total * 100);
          const reviewable = Array.isArray(r.answers) && ex;
          const when = formatBnDate(r.date);
          return `<div class="info-row"><span class="l">${escapeHtml(ex?.title || '')}${when ? `<br><small class="meta">জমা: ${escapeHtml(when)}</small>` : ''}</span>
            <span class="v">${bn(pct)}%${reviewable ? ` <button type="button" class="btn btn-small btn-secondary" data-act="review" data-exam="${escapeHtml(r.examId)}">উত্তর</button>` : ''}</span></div>`;
        }).join('') : '<p>কোনো ফলাফল নেই।</p>'}</div>
      ${leaderboardCard()}`;
  }

  function leaderboardCard() {
    const settings = db.settings.get();
    if (!(settings.leaderboard ?? settings.homeCards?.leaderboard)) return '';
    const mine = leaderboard().filter((r) => r.className === student.className);
    if (!mine.length) return '';
    const top = mine.slice(0, 5);
    const myRow = mine.find((r) => r.studentId === student.id);
    return `<div class="hcard"><div class="h-title">🏆 ক্লাস লিডারবোর্ড</div>
      <p class="meta">${escapeHtml(student.className)} — পরীক্ষার শতাংশ অনুযায়ী</p>
      ${top.map((r) => `<div class="info-row${r.studentId === student.id ? ' me' : ''}">
        <span class="l">${bn(r.position)}. ${escapeHtml(r.studentName)}</span>
        <span class="v">${bn(r.pct)}%</span></div>`).join('')}
      ${myRow && myRow.position > 5 ? `<div class="info-row me"><span class="l">${bn(myRow.position)}. ${escapeHtml(myRow.studentName)} (আপনি)</span><span class="v">${bn(myRow.pct)}%</span></div>` : ''}</div>`;
  }

  setTimeout(() => {
    document.getElementById('home-skeleton').hidden = true;
    host.hidden = false;
    renderHomeSafe();
    refreshExams = mountExamTaker({ listSelector: '#student-exam-list', student });
  }, 300);
}
