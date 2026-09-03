/**
 * ACTIVE PLUS — modern mobile Student Home.
 * Answers: what today? / next class? / next exam? / how am I doing?
 * All data computed live from the layered store; nothing hard-coded.
 */

import { initApp, escapeHtml, showToast, openModal, closeModal, statGrid, renderTable } from './app.js';
import { signOut } from './auth.js';
import {
  db, noticesFor, suggestionsFor, examsFor, examResultFor, scoreExam,
  greetingByHour, studyStreak, todayProgress, nextClass, upcomingExam,
  challengeState, addChallengeProgress, performanceFor, feeStatusFor,
  achievementsFor, unreadNotifications, latestTip, activeBanners,
  recordStudyActivity, newId, todayBn, DAY_BN, homeCards, lastAccessedMaterial
} from './data.js';
import { renderStudentSuggestions, mountExamTaker } from './exams.js';

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
  document.getElementById('student-meta').textContent = me ? `${me.className} · রোল ${me.roll}` : session.detail || '';
  document.getElementById('avatar').textContent = (session.name || 'A').charAt(0);

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

  /* ---------------- Online / offline indicator ---------------- */
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
  });

  /* ---------------- Home content ---------------- */
  const host = document.getElementById('home-content');

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
    const assignments = cards.assignments
      ? db.assignments.list().filter((a) => a.className === student.className) : [];

    const sections = [];

    if (banners.length) {
      sections.push(banners.map((b) => `
      <div class="banner">
        <h3>📢 ${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(b.desc)}</p>
        <button type="button" class="btn btn-small" data-act="banner" data-id="${escapeHtml(b.id)}">${escapeHtml(b.cta || 'দেখুন')}</button>
      </div>`).join(''));
    }

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
        <div class="info-row"><span class="l">📚 ক্লাস</span><span class="v">${bn(progress.classes)}</span></div>
        <div class="info-row"><span class="l">📋 অ্যাসাইনমেন্ট</span><span class="v">${bn(progress.assignments)}</span></div>
        <div class="info-row"><span class="l">📝 পরীক্ষা</span><span class="v">${bn(exam ? 1 : 0)}</span></div>
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
        <button type="button" class="see-more" data-act="seemore">আরও দেখুন ↓</button>
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
      sections.push(exam ? `
      <div class="hcard">
        <div class="h-title">আসন্ন পরীক্ষা</div>
        <div class="big">${escapeHtml(exam.title)}</div>
        <div class="info-row"><span class="l">বিষয়</span><span class="v">${escapeHtml(exam.subject)}</span></div>
        <div class="info-row"><span class="l">প্রশ্ন</span><span class="v">${bn(exam.questions.length)}</span></div>
        <button type="button" class="btn btn-block" data-act="startexam" style="margin-top:.5rem">পরীক্ষা দিন</button>
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
    }

    if (cards.assignments) {
      sections.push(assignments.length ? `
      <div class="hcard">
        <div class="h-title">ঝুলন্ত অ্যাসাইনমেন্ট</div>
        ${assignments.map((a) => `<div class="info-row"><span class="l">📋 ${escapeHtml(a.title)}</span><span class="v">${escapeHtml(a.deadline)}</span></div>`).join('')}
        <button type="button" class="btn btn-secondary btn-block" data-act="assignments" style="margin-top:.5rem">দেখুন</button>
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
          <div class="tile"><span class="ico">#${bn(perf.rank)}</span>র‍্যাঙ্ক</div>
        </div>
        <div class="mini-chart">${perf.series.map((v) => `<div class="bar" style="height:${v}%"></div>`).join('')}</div>
      </div>`);
    }

    sections.push(lastResultHtml());

    if (badges.length) {
      sections.push(`
      <div class="hcard">
        <div class="h-title">অর্জন</div>
        <div class="quick-row">${badges.map((b) => `<div class="tile"><span class="ico">${b.icon}</span>${escapeHtml(b.name)}</div>`).join('')}</div>
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
             <button type="button" class="btn btn-secondary btn-block" data-act="fees" style="margin-top:.5rem">বিস্তারিত</button>`
          : `<p>সব ফি পরিশোধিত ✓</p>`}
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
      <button type="button" class="btn btn-secondary btn-block" data-act="result" style="margin-top:.5rem">ফলাফল দেখুন</button></div>`;
  }

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
    else if (act === 'result') switchView('result');
    else if (act === 'study') switchView('study');
    else if (act === 'seemore' || act === 'classes' || act === 'routine' || act === 'fees' || act === 'notices' || act === 'assignments') { openMore(act === 'seemore' ? null : act); }
    else if (act === 'challenge') doChallenge();
    else if (act === 'material') openMaterial(el.dataset.id);
    else if (act === 'banner') showToast('নোটিশ সেকশনে বিস্তারিত দেখুন।', 'info');
  });

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
    document.getElementById('more-content').innerHTML = `
      <div class="hcard" id="more-assignments"><div class="h-title">অ্যাসাইনমেন্ট</div>${
        db.assignments.list().filter((a) => a.className === student.className).map((a) => `<div class="info-row"><span class="l">${escapeHtml(a.title)}</span><span class="v">${escapeHtml(a.deadline)}</span></div>`).join('') || '<p>কোনো অ্যাসাইনমেন্ট নেই।</p>'}</div>
      <div class="hcard" id="more-routine"><div class="h-title">রুটিন</div>${
        db.routine.list().map((r) => `<div class="info-row"><span class="l">${escapeHtml(r.day)} · ${escapeHtml(r.subject)}</span><span class="v">${escapeHtml(r.time)}</span></div>`).join('') || '<p>রুটিন নেই।</p>'}</div>
      <div class="hcard" id="more-fees"><div class="h-title">ফি</div>${
        db.fees.list().filter((f) => f.studentId === student.id).map((f) => `<div class="info-row"><span class="l">${escapeHtml(f.month)}</span><span class="v ${f.status === 'বকেয়া' ? '' : ''}" style="color:${f.status === 'বকেয়া' ? 'var(--warning)' : 'var(--success)'}">${escapeHtml(f.status)}</span></div>`).join('') || '<p>ফি তথ্য নেই।</p>'}</div>
      <div class="hcard" id="more-notices"><div class="h-title">নোটিশ</div>${
        noticesFor(student).map((n) => `<div class="info-row"><span class="l">${escapeHtml(n.title)}</span></div>`).join('') || '<p>কোনো নোটিশ নেই।</p>'}</div>
      <div class="hcard" id="more-achievements"><div class="h-title">অর্জন</div>${
        achievementsFor(student).map((b) => `<div class="info-row"><span class="l">${b.icon} ${escapeHtml(b.name)}</span></div>`).join('') || '<p>এখনো কোনো ব্যাজ অর্জিত হয়নি।</p>'}</div>
      <div class="hcard" id="more-profile"><div class="h-title">প্রোফাইল</div>
        <div class="info-row"><span class="l">নাম</span><span class="v">${escapeHtml(session.name)}</span></div>
        <div class="info-row"><span class="l">আইডি</span><span class="v">${escapeHtml(student.id)}</span></div>
        <div class="info-row"><span class="l">শ্রেণি</span><span class="v">${escapeHtml(meRow.className || '—')}</span></div>
        <div class="info-row"><span class="l">রোল</span><span class="v">${escapeHtml(meRow.roll || '—')}</span></div>
        <div class="info-row"><span class="l">স্কুল/কলেজ</span><span class="v">${escapeHtml(meRow.school || '—')}</span></div>
        <div class="info-row"><span class="l">অভিভাবক</span><span class="v">${escapeHtml(meRow.phone || '—')}</span></div>
      </div>
      <button type="button" class="btn btn-error btn-block" id="home-logout">লগআউট</button>`;
    document.getElementById('home-logout').addEventListener('click', () => signOut({ redirect: true }));
  }
  function openMore(section) {
    renderMore();
    switchView('more');
    if (section) setTimeout(() => document.getElementById(`more-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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
    mountExamTaker({ listSelector: '#student-exam-list', student });
  }, 300);
}
