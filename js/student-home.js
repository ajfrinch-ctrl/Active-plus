/**
 * ACTIVE PLUS — modern mobile Student Home.
 * Answers: what today? / next class? / next exam? / how am I doing?
 * All data computed live from the layered store; nothing hard-coded.
 */

import { initApp, escapeHtml, showToast, openModal, closeModal, getAuthMode } from './app.js';
import { signOut } from './auth.js';
import {
  db, noticesFor, suggestionsFor, examsFor, examResultFor, scoreExam,
  greetingByHour, studyStreak, todayProgress, nextClass, upcomingExam,
  challengeState, addChallengeProgress, performanceFor, feeStatusFor,
  achievementsFor, unreadNotifications, latestTip, activeBanners,
  recordStudyActivity, newId, todayBn, DAY_BN, homeCards, lastAccessedMaterial,
  examWindow, assignmentStatus, dueLabel, latestNotifications, DATA_VERSION, subscribeRemote,
  submitAssignment
} from './data.js';
import { renderStudentSuggestions, mountExamTaker } from './exams.js';

/** Secondary features revealed by "See More" — configurable, nothing dead. */
const MORE_FEATURES = [
  { act: 'questionbank', ico: '🧩', label: 'প্রশ্ন ব্যাংক' },
  { act: 'progress', ico: '📈', label: 'আমার প্রগ্রেস' },
  { act: 'achievements', ico: '🏅', label: 'অর্জন' },
  { act: 'certificates', ico: '🎓', label: 'সনদ' },
  { act: 'downloads', ico: '⬇️', label: 'ডাউনলোড' },
  { act: 'query', ico: '✉️', label: 'শিক্ষক প্রশ্ন' },
  { act: 'streak', ico: '🔥', label: 'স্ট্রিক' },
  { act: 'profile', ico: '👤', label: 'প্রোফাইল' },
  { act: 'settings', ico: '⚙️', label: 'সেটিংস' },
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

  /* Header */
  document.getElementById('greet').textContent = `${greetingByHour()} 👋`;
  document.getElementById('student-name').textContent = session.name;
  const batch = me?.batch ? ` · ব্যাচ ${me.batch}` : '';
  document.getElementById('student-meta').textContent = me ? `${me.className}${batch} · রোল ${me.roll}` : session.detail || '';
  const avatar = document.getElementById('avatar');
  if (me?.photo) {
    avatar.innerHTML = `<img src="${escapeHtml(me.photo)}" alt="${escapeHtml(session.name)}">`;
  } else {
    avatar.textContent = (session.name || 'A').charAt(0);
  }
  document.getElementById('profile-btn')?.addEventListener('click', () => openMore('profile'));

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

  /* Live data: when Firebase backs the store, re-render on remote changes. */
  subscribeRemote(() => { renderHomeSafe(); });


  const netChip = document.getElementById('net-chip');
  const paintNet = () => {
    if (!netChip) return;
    const online = navigator.onLine;
    netChip.textContent = online ? 'অনলাইন' : 'অফলাইন';
    netChip.classList.toggle('off', !online);
  };
  paintNet();
  window.addEventListener('online', () => { paintNet(); renderHomeSafe(); });
  window.addEventListener('offline', paintNet);

  /* ---------------- Bottom nav ---------------- */
  const views = { home: 'view-home', study: 'view-study', exam: 'view-exam', result: 'view-result', more: 'view-more' };
  const switchView = (name) => {
    Object.entries(views).forEach(([k, id]) => { document.getElementById(id).hidden = k !== name; });
    document.querySelectorAll('.bottom-nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === name)));
    // Render lazily so the data shown is always current.
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

  /* ---------------- Notification center ---------------- */
  document.getElementById('bell').addEventListener('click', () => {
    const rows = noticesFor(student);
    document.getElementById('notif-list').innerHTML = rows.length
      ? rows.map((n) => `<div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(n.title)}</div><div class="li-sub">${escapeHtml(n.date)} · ${escapeHtml(n.audience)}</div></div></div>`).join('')
      : '<div class="empty-state">কোনো নোটিফিকেশন নেই।</div>';
    openModal('notif-center');
    db.notifications.list().filter((n) => !n.read && (n.target === 'সবাই' || n.target === 'শিক্ষার্থী'))
      .forEach((n) => db.notifications.update(n.id, { read: true }));
    bellCount.hidden = true;
  });

  /* ---------------- Home content ---------------- */
  const host = document.getElementById('home-content');
  let refreshExams = null;

  const renderHome = () => {
    const cards = homeCards();
    const progress = todayProgress(student);
    const { streak, week } = studyStreak();
    const next = cards.nextClass ? nextClass() : null;
    const exam = cards.exam ? upcomingExam(student.className) : null;
    const challenge = challengeState();
    const perf = cards.performance ? performanceFor(student) : null;
    const fee = feeStatusFor(student);
    const badges = cards.achievements ? achievementsFor(student) : [];
    const tip = cards.tip ? latestTip() : null;
    const banners = cards.banners ? activeBanners() : [];
    const allMaterials = cards.materials ? suggestionsMaterials() : [];
    const resume = cards.materials ? (lastAccessedMaterial() || allMaterials[0] || null) : null;
    const materials = allMaterials;
    const previewNotes = cards.notices ? latestNotifications(student, 2) : [];
    const assignments = cards.assignments
      ? db.assignments.list().filter((a) => a.className === student.className) : [];

    const sections = [];

    const bannerHtml = banners.length ? `
      <div class="carousel">
        <div class="carousel-track" id="banner-track">
          ${banners.map((b) => `
          <div class="banner">
            <h3>📢 ${escapeHtml(b.title)}</h3>
            <p>${escapeHtml(b.desc)}</p>
            <button type="button" class="btn btn-small" data-act="banner" data-id="${escapeHtml(b.id)}">${escapeHtml(b.cta || 'দেখুন')}</button>
          </div>`).join('')}
        </div>
        ${banners.length > 1 ? `<div class="carousel-dots" id="banner-dots">${banners.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      </div>` : '';

    if (cards.progress) {
      sections.push(`
      <div class="hcard hero">
        <div class="h-title">আজকের প্রগ্রেস</div>
        <div class="row">
          <div><div class="pct">${bn(progress.pct)}%</div><div class="meta">${bn(progress.done)} / ${bn(progress.total)} সম্পন্ন</div></div>
          <span class="streak-chip">🔥 ${bn(streak)} দিন স্ট্রিক</span>
        </div>
        <div class="progress-bar" style="margin-top:.625rem"><div class="progress-fill" style="width:${progress.pct}%"></div></div>
        <div class="week">${week.map((d) => `<div class="d ${d.done ? 'on' : ''}">${d.day}<div class="dot"></div></div>`).join('')}</div>
      </div>

      <div class="hcard">
        <div class="h-title">আজ</div>
        <div class="info-row" role="button" tabindex="0" data-act="routine" style="cursor:pointer"><span class="l">📚 ক্লাস</span><span class="v">${bn(progress.classes)}</span></div>
        <div class="info-row" role="button" tabindex="0" data-act="assignments" style="cursor:pointer"><span class="l">📋 অ্যাসাইনমেন্ট</span><span class="v">${bn(progress.assignments)}</span></div>
        <div class="info-row" role="button" tabindex="0" data-act="exam" style="cursor:pointer"><span class="l">📝 পরীক্ষা</span><span class="v">${bn(exam ? 1 : 0)}</span></div>
      </div>`);
    }

    sections.push(`
      <div class="hcard">
        <div class="feature-grid">
          ${tile('classes', '📚', 'ক্লাস')}
          ${tile('exam', '📝', 'পরীক্ষা', exam ? '১' : '')}
          ${tile('result', '🏆', 'ফলাফল')}
          ${tile('study', '📖', 'ম্যাটেরিয়াল')}
          ${tile('assignments', '📋', 'অ্যাসাইনমেন্ট', assignments.length ? bn(assignments.length) : '')}
          ${tile('routine', '📅', 'রুটিন')}
          ${tile('fees', '💰', 'ফি', fee.due ? 'বকেয়া' : '')}
          ${tile('notices', '📢', 'নোটিশ')}
        </div>
        <button type="button" class="see-more" data-act="seemore" aria-expanded="false" aria-controls="more-features">আরও দেখুন ↓</button>
        <div class="feature-grid more-grid" id="more-features" hidden style="margin-top:.625rem">
          ${MORE_FEATURES.map((f) => tile(f.act, f.ico, f.label)).join('')}
        </div>
      </div>`);

    if (cards.nextClass) {
      sections.push(next ? `
      <div class="hcard">
        <div class="h-title">পরবর্তী ক্লাস</div>
        <div class="big">${escapeHtml(next.item.subject)}</div>
        <div class="info-row"><span class="l">সময়</span><span class="v">${escapeHtml(next.when)} · ${escapeHtml(next.item.time)}</span></div>
        <div class="info-row"><span class="l">শিক্ষক</span><span class="v">${escapeHtml(next.item.teacher)}</span></div>
        <div class="info-row"><span class="l">কক্ষ</span><span class="v">${escapeHtml(next.item.room)}</span></div>
        <button type="button" class="btn btn-secondary btn-block" data-act="routine" style="margin-top:.5rem">রুটিন দেখুন</button>
      </div>` : `
      <div class="hcard">
        <div class="h-title">পরবর্তী ক্লাস</div>
        <p>আপাতত কোনো ক্লাস নির্ধারিত নেই 🎉</p>
      </div>`);
    }

    if (cards.exam) {
      const win = examWindow(exam);
      sections.push(exam ? `
      <div class="hcard">
        <div class="h-title">আসন্ন পরীক্ষা</div>
        <div class="big">${escapeHtml(exam.title)}</div>
        <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(exam.subject)}</span></div>
        <div class="info-row"><span class="l">তারিখ</span><span class="v">${escapeHtml(exam.date || '—')}${exam.time ? ` · ${escapeHtml(exam.time)}` : ''}</span></div>
        <div class="info-row"><span class="l">সময়</span><span class="v">${bn(exam.duration || 0)} মিনিট</span></div>
        <div class="info-row"><span class="l">প্রশ্ন</span><span class="v">${bn(exam.questions.length)}</span></div>
        ${win.canStart
          ? `<button type="button" class="btn btn-block" data-act="startexam" style="margin-top:.5rem">পরীক্ষা শুরু করুন</button>`
          : `<button type="button" class="btn btn-secondary btn-block" data-act="exam" style="margin-top:.5rem">পরীক্ষা দেখুন</button>
             <p class="meta" style="margin-top:.5rem">${escapeHtml(win.state === 'closed' ? 'এই পরীক্ষার সময় শেষ।' : 'পরীক্ষা শুরুর সময় হয়নি।')}</p>`}
      </div>` : `
      <div class="hcard">
        <div class="h-title">আসন্ন পরীক্ষা</div>
        <p>কোনো পরীক্ষা নির্ধারিত নেই।</p>
      </div>`);
    }

    if (cards.challenge) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">🔥 ডেইলি চ্যালেঞ্জ</div>
        <p>${challenge.done >= challenge.target ? '🎉 চ্যালেঞ্জ সম্পূর্ণ!' : `আজ ${bn(challenge.target)}টি MCQ উত্তর দিন`}</p>
        <div class="progress-bar" style="margin:.5rem 0"><div class="progress-fill" style="width:${Math.round((challenge.done / challenge.target) * 100)}%"></div></div>
        <div class="meta">${bn(challenge.done)} / ${bn(challenge.target)}</div>
        ${challenge.done < challenge.target ? `<button type="button" class="btn btn-block" data-act="challenge" style="margin-top:.5rem">চ্যালেঞ্জ শুরু</button>` : ''}
      </div>`);
    }

    if (resume) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">পড়া চালিয়ে যান</div>
        <div class="big">${escapeHtml(resume.title)}</div>
        <div class="meta">${escapeHtml(resume.subject)} · ${escapeHtml(resume.type || '')}</div>
        <button type="button" class="btn btn-secondary btn-block" data-act="material" data-id="${escapeHtml(resume.id)}" style="margin-top:.5rem">চালিয়ে যান</button>
      </div>`);
    } else if (cards.materials) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">পড়া চালিয়ে যান</div>
        <p>নতুন কিছু শেখা শুরু করুন 📚</p>
        <button type="button" class="btn btn-secondary btn-block" data-act="study" style="margin-top:.5rem">ম্যাটেরিয়াল দেখুন</button>
      </div>`);
    }

    if (cards.materials && materials.length) {
      const recent = [...materials].slice(-3).reverse();
      sections.push(`
      <div class="hcard">
        <div class="h-title">স্টাডি ম্যাটেরিয়াল</div>
        ${recent.map((m) => `<div class="info-row" role="button" tabindex="0" data-act="material" data-id="${escapeHtml(m.id)}" style="cursor:pointer">
          <span class="l">📖 ${escapeHtml(m.title)}<br><span class="meta">${escapeHtml(m.subject)} · ${escapeHtml(m.type || '')}</span></span>
          <span class="v">${escapeHtml(m.date)}</span></div>`).join('')}
        <button type="button" class="btn btn-secondary btn-block" data-act="study" style="margin-top:.5rem">সব ম্যাটেরিয়াল</button>
      </div>`);
    }

    if (cards.assignments) {
      const asgRows = assignments.map((a) => {
        const st = assignmentStatus(a, student);
        return `<div class="info-row" role="button" tabindex="0" data-act="assignment" data-id="${escapeHtml(a.id)}" style="cursor:pointer">
          <span class="l">📋 ${escapeHtml(a.title)}<br><span class="chip ${st.status}">${STATUS_BN[st.status]}</span></span>
          <span class="v">${escapeHtml(dueLabel(a, student))}</span>
        </div>`;
      }).join('');
      sections.push(assignments.length ? `
      <div class="hcard">
        <div class="h-title">অ্যাসাইনমেন্ট</div>
        ${asgRows}
        <button type="button" class="btn btn-secondary btn-block" data-act="assignments" style="margin-top:.5rem">সব দেখুন</button>
      </div>` : `
      <div class="hcard">
        <div class="h-title">অ্যাসাইনমেন্ট</div>
        <p>সব শেষ! 🎉</p>
      </div>`);
    }

    if (perf) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">আমার পারফরম্যান্স</div>
        <div class="feature-grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="tile"><span class="ico">${bn(perf.avg)}%</span>গড়</div>
          <div class="tile"><span class="ico">${bn(perf.best)}%</span>সেরা</div>
          <div class="tile"><span class="ico">${bn(perf.tests)}</span>টেস্ট</div>
          ${cards.leaderboard ? `<div class="tile"><span class="ico">#${bn(perf.rank)}</span>র‍্যাঙ্ক</div>` : ''}
        </div>
        <div class="mini-chart">${perf.series.map((v) => `<div class="bar" style="height:${v}%"></div>`).join('')}</div>
        <button type="button" class="btn btn-secondary btn-block" data-act="result" style="margin-top:.5rem">পুরো প্রগ্রেস দেখুন</button>
      </div>`);
    }

    sections.push(lastResultHtml());
    if (bannerHtml) sections.push(bannerHtml);

    if (badges.length) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">অর্জন</div>
        <div class="quick-row">${badges.map((b) => `<div class="tile"><span class="ico">${b.icon}</span>${escapeHtml(b.name)}</div>`).join('')}</div>
        <button type="button" class="btn btn-secondary btn-block" data-act="achievements" style="margin-top:.5rem">সব অর্জন দেখুন</button>
      </div>`);
    }

    if (cards.fee) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">💰 ফি স্ট্যাটাস</div>
        ${fee.due > 0
          ? `<div class="info-row"><span class="l">মোট</span><span class="v">৳${bn(fee.total)}</span></div>
             <div class="info-row"><span class="l">পরিশোধিত</span><span class="v">৳${bn(fee.paid)}</span></div>
             <div class="info-row"><span class="l">বকেয়া</span><span class="v" style="color:var(--warning)">৳${bn(fee.due)}</span></div>
             ${fee.nextDue ? `<div class="info-row"><span class="l">পরবর্তী পেমেন্ট</span><span class="v">${escapeHtml(fee.nextDue.month)}</span></div>` : ''}
             <button type="button" class="btn btn-secondary btn-block" data-act="fees" style="margin-top:.5rem">বিস্তারিত</button>`
          : `<p>সব ফি পরিশোধিত ✓</p>`}
      </div>`);
    }

    if (cards.notices && previewNotes.length) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">🔔 নোটিফিকেশন</div>
        ${previewNotes.map((n) => `
        <div class="notif-preview">
          <span class="dot"></span>
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(n.title)}</div>
            <div class="meta">${escapeHtml(n.body)} · ${escapeHtml(n.date)}</div>
          </div>
        </div>`).join('')}
        <button type="button" class="btn btn-secondary btn-block" data-act="notif" style="margin-top:.5rem">সব দেখুন</button>
      </div>`);
    }

    if (tip) {
      sections.push(`<div class="hcard"><div class="h-title">💡 শিক্ষকের টিপ</div><p>"${escapeHtml(tip.text)}"</p></div>`);
    }

    sections.push(`
      <div class="hcard">
        <div class="h-title">কুইক ফিচার</div>
        <div class="quick-row">
          ${tile('study', '📚', 'স্টাডি')}
          ${tile('exam', '📝', 'পরীক্ষা')}
          ${tile('result', '🏆', 'ফলাফল')}
          ${tile('routine', '📅', 'রুটিন')}
          ${tile('assignments', '📋', 'অ্যাসাইনমেন্ট')}
        </div>
      </div>`);

    host.innerHTML = sections.join('\n');
  };

  /** Friendly error state with retry — never a blank screen. */
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

  function tile(act, ico, label, badge = '') {
    return `<button type="button" class="tile" data-act="${act}">${badge ? `<span class="fb">${escapeHtml(badge)}</span>` : ''}<span class="ico">${ico}</span>${escapeHtml(label)}</button>`;
  }
  function suggestionsMaterials() {
    return db.materials.list().filter((m) => !m.className || m.className === student.className);
  }
  function lastResultHtml() {
    const mine = db.examResults.list().filter((r) => r.studentId === student.id).slice(-1)[0];
    if (!mine) return `<div class="hcard"><div class="h-title">🏆 সাম্প্রতিক ফলাফল</div><p>এখনো কোনো ফলাফল প্রকাশিত হয়নি।</p></div>`;
    const exam = db.exams.find(mine.examId);
    const pct = Math.round(mine.score / mine.total * 100);
    return `<div class="hcard"><div class="h-title">🏆 সাম্প্রতিক ফলাফল</div>
      <div class="big">${escapeHtml(exam?.title || 'পরীক্ষা')}</div>
      <div class="info-row"><span class="l">স্কোর</span><span class="v">${bn(mine.score)}/${bn(mine.total)} (${bn(pct)}%)</span></div>
      ${homeCards().leaderboard && performanceFor(student) ? `<div class="info-row"><span class="l">অবস্থান</span><span class="v">#${bn(performanceFor(student).rank)}</span></div>` : ''}
      <button type="button" class="btn btn-secondary btn-block" data-act="result" style="margin-top:.5rem">ফলাফল দেখুন</button></div>`;
  }

  /* Keyboard parity: rows marked role="button" must work with Enter/Space. */
  const keyboardActivate = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[role="button"][data-act], [role="button"][data-asg]');
    if (!row) return;
    e.preventDefault();
    row.click();
  };
  host.addEventListener('keydown', keyboardActivate);

  /* ---------------- Home actions ---------------- */
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
    }
    else if (act === 'result' || act === 'progress') switchView('result');
    else if (act === 'study' || act === 'questionbank' || act === 'downloads') switchView('study');
    else if (act === 'seemore') {
      const box = host.querySelector('#more-features');
      const open = box && !box.hidden;
      if (box) box.hidden = open;
      el.setAttribute('aria-expanded', String(!open));
      el.textContent = open ? 'আরও দেখুন ↓' : 'কম দেখুন ↑';
    }
    else if (['classes', 'routine', 'fees', 'notices', 'assignments', 'achievements', 'certificates', 'query', 'streak', 'profile', 'settings', 'help'].includes(act)) openMore(act);
    else if (act === 'challenge') doChallenge();
    else if (act === 'assignment') openAssignment(el.dataset.id);
    else if (act === 'notif') { document.getElementById('bell').click(); }
    else if (act === 'material') openMaterial(el.dataset.id);
    else if (act === 'banner') openBanner(el.dataset.id);
  });

  function openBanner(id) {
    const b = db.banners.find(id);
    if (!b) return;
    showDetail(b.title, `<p>${escapeHtml(b.desc || '')}</p><p class="meta" style="margin-top:.5rem">${escapeHtml(b.date || '')}</p>`);
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
    showDetail(m.title, `<p>${escapeHtml(m.subject)} · ${escapeHtml(m.className)} · ${escapeHtml(m.date)}</p><p style="white-space:pre-wrap;margin-top:.5rem">${escapeHtml(m.description || '')}</p>`);
  }

  function doChallenge() {
    const pool = examsFor(student.className).flatMap((ex) => ex.questions);
    if (!pool.length) { showToast('চ্যালেঞ্জের জন্য প্রশ্ন নেই।', 'error'); return; }
    const q = pool[Math.floor(Math.random() * pool.length)];
    showDetail('🔥 ডেইলি চ্যালেঞ্জ', `
      <p style="font-weight:600">${escapeHtml(q.q)}</p>
      <div class="role-grid" style="grid-template-columns:1fr;margin-top:.5rem">
        ${q.options.map((o, i) => `<button type="button" class="role-option" data-opt="${i}"><span>${escapeHtml(o)}</span></button>`).join('')}
      </div>`);
    detail.querySelector('#detail-body').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-opt]');
      if (!b) return;
      addChallengeProgress(1);
      recordStudyActivity('mcq', 1);
      closeModal('detail-modal');
      showToast(Number(b.dataset.opt) === q.answer ? 'সঠিক! 🔥' : 'ভুল — আবার চেষ্টা করুন।', Number(b.dataset.opt) === q.answer ? 'success' : 'warning');
      renderHomeSafe();
    }, { once: true });
  }

  /* ---------------- More view ---------------- */
  function renderMore() {
    const meRow = me || {};
    const editable = db.settings.get().studentEditableFields || [];
    const badges = achievementsFor(student);
    const myMaterials = db.materials.list().filter((m) => !m.className || m.className === student.className);
    const downloadable = myMaterials.filter((m) => (m.type || '').includes('পিডিএফ') || m.file);
    const streak = studyStreak();
    const queries = db.notifications.list().filter((n) => n.target === 'শিক্ষক' && n.studentId === student.id);

    const row = (label, value) => `<div class="info-row"><span class="l">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;

    document.getElementById('more-content').innerHTML = `
      <div class="hcard"><div class="h-title">দ্রুত যায়</div>
        <div class="quick-row">
          ${MORE_FEATURES.map((f) => tile(f.act, f.ico, f.label)).join('')}
        </div>
      </div>

      <div class="hcard" id="more-assignments"><div class="h-title">অ্যাসাইনমেন্ট</div>${
        db.assignments.list().filter((a) => a.className === student.className).map((a) => {
          const st = assignmentStatus(a, student);
          return `<div class="info-row" role="button" tabindex="0" data-asg="${escapeHtml(a.id)}" style="cursor:pointer">
            <span class="l">${escapeHtml(a.title)} <span class="chip ${st.status}">${STATUS_BN[st.status]}</span></span>
            <span class="v">${escapeHtml(dueLabel(a, student))}</span></div>`;
        }).join('') || '<p>কোনো অ্যাসাইনমেন্ট নেই।</p>'}</div>

      <div class="hcard" id="more-routine"><div class="h-title">রুটিন</div>${
        db.routine.list().map((r) => row(`${r.day} · ${r.subject}`, `${r.time} · ${r.room || ''}`)).join('') || '<p>রুটিন নেই।</p>'}</div>

      <div class="hcard" id="more-fees"><div class="h-title">ফি</div>${
        db.fees.list().filter((f) => f.studentId === student.id).map((f) =>
          `<div class="info-row"><span class="l">${escapeHtml(f.month)}</span><span class="v" style="color:${f.status === 'বকেয়া' ? 'var(--warning)' : 'var(--success)'}">${escapeHtml(f.status)} · ৳${bn(f.amount)}</span></div>`).join('') || '<p>ফি তথ্য নেই।</p>'}</div>

      <div class="hcard" id="more-notices"><div class="h-title">নোটিশ</div>${
        noticesFor(student).map((n) => row(n.title, n.date)).join('') || '<p>কোনো নোটিশ নেই।</p>'}</div>

      <div class="hcard" id="more-achievements"><div class="h-title">অর্জন</div>${
        badges.map((b) => row(`${b.icon} ${b.name}`, '')).join('') || '<p>এখনো কোনো ব্যাজ অর্জিত হয়নি।</p>'}</div>

      <div class="hcard" id="more-certificates"><div class="h-title">সনদ</div>${
        badges.length
          ? `<p class="meta">অর্জিত ব্যাজগুলোই আপনার সনদ। প্রতিটি ব্যাজের বিবরণ:</p>${badges.map((b) => row(`${b.icon} ${b.name}`, 'অর্জিত')).join('')}`
          : '<p>সনদের জন্য এখনো কোনো ব্যাজ অর্জিত হয়নি।</p>'}</div>

      <div class="hcard" id="more-downloads"><div class="h-title">ডাউনলোড সেন্টার</div>${
        downloadable.length
          ? downloadable.map((m) => `<div class="info-row" role="button" tabindex="0" data-mat2="${escapeHtml(m.id)}" style="cursor:pointer"><span class="l">⬇️ ${escapeHtml(m.title)}</span><span class="v">${escapeHtml(m.type || '')}</span></div>`).join('')
          : '<p>আপনার ক্লাসের জন্য ডাউনলোডযোগ্য ফাইল নেই।</p>'}</div>

      <div class="hcard" id="more-streak"><div class="h-title">স্টাডি স্ট্রিক</div>
        <div class="info-row"><span class="l">🔥 ধারাবাহিক দিন</span><span class="v">${bn(streak.streak)}</span></div>
        <div class="week" style="margin-top:.5rem">${streak.week.map((d) => `<div class="d ${d.done ? 'on' : ''}">${d.day}<div class="dot"></div></div>`).join('')}</div>
        <p class="meta" style="margin-top:.5rem">প্রতিদিন পড়াশোনা বা MCQ দিলে স্ট্রিক বাড়ে।</p></div>

      <div class="hcard" id="more-query"><div class="h-title">শিক্ষক প্রশ্ন</div>
        ${queries.length ? queries.map((q) => `
          ${row(q.title, q.date)}
          ${q.reply ? `<div class="alert alert-success" style="margin:.25rem 0 .75rem">শিক্ষকের উত্তর: ${escapeHtml(q.reply)}</div>` : '<p class="meta" style="margin:.25rem 0 .75rem">উত্তরের অপেক্ষায়…</p>'}`).join('') : '<p>আপনি এখনো কোনো প্রশ্ন পাঠাননি।</p>'}
        <form id="query-form" style="margin-top:.75rem">
          <div class="form-group"><label for="query-text">আপনার প্রশ্ন</label>
            <textarea id="query-text" class="form-input" rows="3" required placeholder="যে বিষয়ে জানতে চান লিখুন…"></textarea></div>
          <button type="submit" class="btn btn-block">শিক্ষককে পাঠান</button>
        </form></div>

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
        ${row('ভর্তির তারিখ', meRow.admissionDate || '—')}
        ${row('অবস্থা', meRow.status || '—')}
        <form id="profile-edit-form" style="margin-top:.75rem">
          ${editable.map((f) => `<div class="form-group"><label for="pf-${escapeHtml(f)}">${escapeHtml(FIELD_BN[f] || f)} (সম্পাদনাযোগ্য)</label><input id="pf-${escapeHtml(f)}" name="${escapeHtml(f)}" class="form-input" value="${escapeHtml(meRow[f] || '')}"></div>`).join('')}
          ${editable.length ? `<button type="submit" class="btn btn-block">প্রোফাইল আপডেট করুন</button>` : `<p class="meta">প্রোফাইল সম্পাদনার অনুমতি অ্যাডমিন দেননি।</p>`}
        </form></div>

      <div class="hcard" id="more-settings"><div class="h-title">সেটিংস</div>
        ${row('ডেটা মোড', getAuthMode() === 'firebase' ? 'Firebase (ক্লাউড)' : 'লোকাল (এই ডিভাইস)')}
        ${row('অ্যাপ ভার্সন', `v${DATA_VERSION}`)}
        ${row('সংযোগ', navigator.onLine ? 'অনলাইন' : 'অফলাইন')}
        <button type="button" class="btn btn-secondary btn-block" id="clear-cache" style="margin-top:.75rem">অ্যাপ ক্যাশ রিফ্রেশ করুন</button>
      </div>

      <div class="hcard" id="more-help"><div class="h-title">সহায়তা</div>
        ${row('প্রতিষ্ঠান', db.settings.get().orgName || 'Active Plus')}
        ${row('মোবাইল', db.settings.get().mobile || '—')}
        ${row('ইমেইল', db.settings.get().email || '—')}
        <p class="meta" style="margin-top:.5rem">সমস্যা হলে উপরের নম্বরে যোগাযোগ করুন অথবা শিক্ষক প্রশ্ন পাঠান।</p></div>

      <button type="button" class="btn btn-error btn-block" id="home-logout">লগআউট</button>`;

    document.getElementById('home-logout').addEventListener('click', () => signOut({ redirect: true }));

    document.getElementById('clear-cache').addEventListener('click', async () => {
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

    const moreHost = document.getElementById('more-content');
    moreHost.addEventListener('click', (e) => {
      const asg = e.target.closest('[data-asg]');
      if (asg) { openAssignment(asg.dataset.asg); return; }
      const mat = e.target.closest('[data-mat2]');
      if (mat) { openMaterial(mat.dataset.mat2); return; }
      const tileEl = e.target.closest('[data-act]');
      if (!tileEl) return;
      const act = tileEl.dataset.act;
      if (['study', 'questionbank', 'downloads', 'result', 'progress', 'exam'].includes(act)) switchView(
        act === 'study' || act === 'questionbank' || act === 'downloads' ? 'study'
          : act === 'result' || act === 'progress' ? 'result' : 'exam');
      else if (act === 'notif') document.getElementById('bell').click();
      else openMore(act === 'seemore' ? null : act);
    });

    document.getElementById('query-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = String(document.getElementById('query-text').value || '').trim();
      if (!text) return;
      if (!navigator.onLine) {
        showToast('অফলাইনে প্রশ্ন পাঠানো যাবে না।', 'error');
        return;
      }
      db.notifications.add({
        id: newId('ntf'), type: 'শিক্ষক প্রশ্ন', title: text, target: 'শিক্ষক',
        studentId: student.id, studentName: session.name, date: todayBn(), read: false
      });
      document.getElementById('query-text').value = '';
      renderMore();
      showToast('প্রশ্ন শিক্ষকের কাছে পাঠানো হয়েছে।', 'success');
    });

    const editForm = document.getElementById('profile-edit-form');
    editForm.addEventListener('submit', (e) => {
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
      renderMore();
    });
  }

  function openMore(section) {
    renderMore();
    switchView('more');
    if (section) setTimeout(() => document.getElementById(`more-${section}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 60);
  }

  /* ---------------- Study / Exam / Result views ---------------- */
  function renderStudy() {
    const mats = db.materials.list().filter((m) => !m.className || m.className === student.className);
    document.getElementById('material-list').innerHTML = mats.length
      ? mats.map((m) => `<div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(m.title)}</div><div class="li-sub">${escapeHtml(m.subject)} · ${escapeHtml(m.type || '')} · ${escapeHtml(m.date)}</div></div>
        <button type="button" class="btn btn-small" data-mat="${escapeHtml(m.id)}">খুলুন</button></div>`).join('')
      : '<div class="empty-state">কোনো ম্যাটেরিয়াল নেই।</div>';
    document.getElementById('material-list').onclick = (e) => {
      const b = e.target.closest('[data-mat]');
      if (b) openMaterial(b.dataset.mat);
    };
    renderStudentSuggestions('#student-suggestion-list', student.className);
  }

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
        mine.length ? mine.map((r) => { const ex = db.exams.find(r.examId); const pct = Math.round(r.score / r.total * 100);
          return `<div class="info-row"><span class="l">${escapeHtml(ex?.title || '')}</span><span class="v">${bn(pct)}%</span></div>`; }).join('') : '<p>কোনো ফলাফল নেই।</p>'}</div>`;
  }

  /* ---------------- Boot with skeleton ---------------- */
  setTimeout(() => {
    document.getElementById('home-skeleton').hidden = true;
    host.hidden = false;
    renderHomeSafe();
    refreshExams = mountExamTaker({ listSelector: '#student-exam-list', student });
  }, 300);
}
