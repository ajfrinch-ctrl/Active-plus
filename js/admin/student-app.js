/**
 * Student App Control — অ্যাডমিন → শিক্ষার্থীর অ্যাপ
 *
 * The rest of the panel edits collections blind: an admin marks a material
 * "খসড়া" or unticks a home card and has no way to see what that did — they
 * would have to sign in as a student. This section is a live mirror of the
 * student portal for one chosen class: the same five bottom tabs, the same
 * cards, fed by the same data.js selectors the student app itself uses, with
 * the publish switches and quick-add forms right beside it.
 *
 * Two rules keep it honest:
 *
 *   1. Nothing here is a mock. Every pixel of the preview reads the live
 *      store, so what the admin sees is what that student will see.
 *   2. Only switches the student app really reads are offered as switches.
 *      Of the 13 homeCards flags exactly 6 gate something today (exam,
 *      materials, fee, banners, tip, leaderboard); the other 7 are keys no
 *      screen consumes. Saying so beats shipping a checkbox that lies.
 *
 * Writes go through the app's own APIs (db.*, setHomeCards, setHomeFeatures)
 * and then fire `admin:data-changed`, so the CRUD tables on the other tabs
 * repaint instead of showing a stale list.
 */
import {
  db, ALL_CLASSES, studentsOfClass, newId, todayBn, formatBnDate,
  homeCards, setHomeCards, homeFeatures, setHomeFeatures,
  upcomingExam, examsFor, examWindow, feeStatusFor, latestTip, activeBanners,
  performanceFor, can, logActivity, getDbStatus
} from '../data.js';
import { escapeHtml, showToast, requireOnline } from '../app.js';

const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

const SCOPE_KEY = 'activeplus_studentapp_scope';

/** The student portal's bottom navigation — the preview's tab bar. */
const VIEWS = [
  { id: 'home', icon: '🏠', label: 'হোম' },
  { id: 'study', icon: '📚', label: 'স্টাডি' },
  { id: 'exam', icon: '📝', label: 'পরীক্ষা' },
  { id: 'result', icon: '🏆', label: 'ফলাফল' },
  { id: 'more', icon: '⋯', label: 'আরও' }
];

/**
 * Every flag in settings.homeCards, with what the student app really does with
 * it. `live` keys gate a screen; the rest are listed read-only so the admin
 * learns the truth instead of toggling a dead key.
 */
const CARD_FACTS = [
  { key: 'exam', live: true, where: 'home', note: '“আসন্ন পরীক্ষা” কার্ড' },
  { key: 'materials', live: true, where: 'home', note: '“পড়া চালিয়ে যান” + স্টাডি লিস্ট' },
  { key: 'fee', live: true, where: 'home', note: 'ফি / বকেয়ার লাইন' },
  { key: 'banners', live: true, where: 'home', note: 'হোমের হিরো ক্যারোসেল' },
  { key: 'tip', live: true, where: 'home', note: 'ক্যারোসেলের শেষ স্লাইডে শিক্ষকের টিপ' },
  { key: 'leaderboard', live: true, where: 'result', note: 'ফলাফল ভিউয়ের মেরিট লিস্ট' },
  { key: 'progress', live: false, note: 'স্টুডেন্ট অ্যাপে আলাদা প্রগ্রেস কার্ড নেই — ফলাফল ভিউই প্রগ্রেস দেখায়' },
  { key: 'nextClass', live: false, note: 'রুটিন “আরও → রুটিন”-এ আছে, হোমে কার্ড নেই' },
  { key: 'assignments', live: false, note: '“আরও → অ্যাসাইনমেন্ট” সবসময় দেখায়', jump: 'assignments' },
  { key: 'performance', live: false, note: 'ফলাফল ভিউয়ের সারসংক্ষেপেই আছে' },
  { key: 'achievements', live: false, note: '“আরও” ফিচার ফ্ল্যাগ দিয়ে নিয়ন্ত্রণ হয়', jump: 'settings' },
  { key: 'notices', live: false, note: '“আরও → নোটিশ” সবসময় দেখায়', jump: 'notices' },
  { key: 'challenge', live: false, note: 'ডেইলি চ্যালেঞ্জের UI স্টুডেন্ট অ্যাপে এখনো তৈরি হয়নি' }
];

/**
 * Settings that change what the student sees but had no control anywhere in
 * the panel (they were only editable by hand-editing the JSON store).
 */
const SCORE_SETTINGS = [
  { key: 'passMark', label: 'পাসের নম্বর (%)', min: 0, max: 100, step: 1,
    hint: 'ফলাফলে “পাশ/ফেল” এই শতাংশ থেকেই হিসাব হয়' },
  { key: 'negativeMarking', label: 'প্রতি ভুল উত্তরে কাটে (নম্বর)', min: 0, max: 10, step: 0.25,
    hint: 'MCQ স্কোরিং — ০ মানে নেগেটিভ মার্কিং নেই' }
];

/** The "আরও" menu, mirroring MORE_MENU in js/student-home.js. */
const MORE_MENU = [
  { act: 'calendar', icon: '🗓️', label: 'ক্যালেন্ডার', always: true },
  { act: 'routine', icon: '📅', label: 'রুটিন', always: true },
  { act: 'assignments', icon: '📋', label: 'অ্যাসাইনমেন্ট', always: true },
  { act: 'fees', icon: '💰', label: 'ফি', always: true },
  { act: 'notices', icon: '📢', label: 'নোটিশ', always: true },
  { act: 'achievements', icon: '🏅', label: 'অর্জন', flag: 'achievements' },
  { act: 'certificates', icon: '🎓', label: 'সনদ', flag: 'certificates' },
  { act: 'downloads', icon: '⬇️', label: 'ডাউনলোড', flag: 'downloads' },
  { act: 'help', icon: '❓', label: 'সহায়তা', flag: 'help' }
];

/** The labels the settings checkboxes use, so both screens name the same card. */
const HOME_CARD_LABELS = {
  progress: 'আজকের প্রগ্রেস', nextClass: 'পরবর্তী ক্লাস', exam: 'আসন্ন পরীক্ষা',
  challenge: 'ডেইলি চ্যালেঞ্জ', materials: 'স্টাডি ম্যাটেরিয়াল', assignments: 'অ্যাসাইনমেন্ট',
  performance: 'পারফরম্যান্স', achievements: 'অর্জন', fee: 'ফি স্ট্যাটাস',
  banners: 'ব্যানার', tip: 'শিক্ষকের টিপ', notices: 'নোটিশ', leaderboard: 'লিডারবোর্ড'
};

/** Quick-add forms: the 2-4 fields that make a record visible to students. */
const QUICK_ADD = {
  materials: {
    singular: 'ম্যাটেরিয়াল', perm: 'manageMaterials',
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'subject', label: 'বিষয়', required: true },
      { name: 'type', label: 'ধরন', type: 'select', options: ['নোট', 'সাজেশন', 'প্রশ্নপত্র', 'মডেল টেস্ট', 'পিডিএফ'] },
      { name: 'link', label: 'ফাইল লিংক (ঐচ্ছিক)' }
    ],
    build: (v, scope, session) => ({
      id: newId('mat'), title: v.title, subject: v.subject, type: v.type,
      link: v.link, className: scope.className, by: session?.name || 'অ্যাডমিন',
      date: todayBn(), published: true
    })
  },
  notices: {
    singular: 'নোটিশ', perm: 'manageNotices',
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'audience', label: 'কার জন্য', type: 'select', options: ['শিক্ষার্থী', 'সবাই', 'অভিভাবক'] }
    ],
    build: (v, scope) => ({ id: newId('n'), title: v.title, audience: v.audience, className: scope.className, date: todayBn() })
  },
  banners: {
    singular: 'ব্যানার', perm: 'manageNotices',
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'desc', label: 'বিবরণ', type: 'textarea' },
      { name: 'cta', label: 'বাটনের টেক্সট' }
    ],
    build: (v) => ({ id: newId('ban'), title: v.title, desc: v.desc, cta: v.cta || 'দেখুন', active: true, date: todayBn() })
  },
  tips: {
    singular: 'টিপ', perm: 'manageNotices',
    fields: [{ name: 'text', label: 'শিক্ষকের টিপ', type: 'textarea', required: true }],
    build: (v, scope, session) => ({ id: newId('tip'), text: v.text, active: true, by: session?.name || 'অ্যাডমিন', date: todayBn() })
  },
  suggestions: {
    singular: 'সাজেশন', perm: 'manageMaterials',
    fields: [
      { name: 'title', label: 'শিরোনাম', required: true },
      { name: 'subject', label: 'বিষয়', required: true },
      { name: 'content', label: 'কী পড়বে', type: 'textarea' }
    ],
    build: (v, scope, session) => ({
      id: newId('sug'), title: v.title, subject: v.subject, content: v.content,
      className: scope.className, author: session?.name || 'অ্যাডমিন', date: todayBn()
    })
  }
};

export function mountStudentAppControl({ session, tabs, onChange } = {}) {
  const panel = document.getElementById('tab-studentapp');
  if (!panel) return null;

  const classSelect = document.getElementById('sa-class');
  const studentSelect = document.getElementById('sa-student');
  const screen = document.getElementById('sa-screen');
  const nav = document.getElementById('sa-nav');
  const editor = document.getElementById('sa-editor');
  const summary = document.getElementById('sa-summary');

  let scope = { className: ALL_CLASSES, studentId: '', view: 'home' };
  try { scope = { ...scope, ...JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') }; } catch (e) { /* fresh device */ }
  const remember = () => { try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch (e) { /* private mode */ } };

  /* ------------------------------------------------------------------ */
  /* Scope helpers                                                       */
  /* ------------------------------------------------------------------ */
  const classStudents = () => (scope.className === ALL_CLASSES ? db.students.list() : studentsOfClass(scope.className));

  /** The student whose app is being previewed (never null if the class has any). */
  const previewStudent = () => classStudents().find((s) => s.id === scope.studentId) || classStudents()[0] || null;

  /** Same rule the student app uses, published included — that is the point. */
  const materialsFor = (className) => db.materials.list()
    .filter((m) => m.published !== false && (!m.className || m.className === className));

  const inScope = (row) => scope.className === ALL_CLASSES || !row.className || row.className === scope.className;

  const writable = (perm, action) => {
    if (!requireOnline(action, getDbStatus)) return false;
    if (!can(session?.role, perm)) {
      showToast(`“${perm}” অনুমতি না থাকায় এটি সংরক্ষণ করা যায়নি।`, 'error');
      return false;
    }
    return true;
  };

  const afterWrite = (action, target) => {
    logActivity({ user: session?.name, role: session?.role, action, target });
    // One event does the repainting: this panel hears it too (it renders only
    // while visible), and so does every CRUD table on the other tabs.
    window.dispatchEvent(new window.Event('admin:data-changed'));
    onChange && onChange();
  };

  /* ------------------------------------------------------------------ */
  /* Preview: the phone screen                                           */
  /* ------------------------------------------------------------------ */
  const head = (student) => {
    const settings = db.settings.get();
    const who = student ? `${student.name}` : (scope.className === ALL_CLASSES ? 'সব শিক্ষার্থী' : `${scope.className} · শিক্ষার্থী নেই`);
    const meta = student
      ? `${student.className || '—'}${student.section ? ` · ${student.section}` : ''}${student.roll ? ` · রোল ${student.roll}` : ''}`
      : 'এই ক্লাসে এখনো কেউ ভর্তি হয়নি';
    return `
      <div class="sa-head">
        <div class="sa-org">${escapeHtml(settings.orgName || 'Active Plus')}</div>
        <div class="sa-who">${escapeHtml(who)}</div>
        <div class="sa-meta">${escapeHtml(meta)}</div>
      </div>`;
  };

  const card = (title, body, extraClass = '') => `
    <div class="hcard ${extraClass}">
      <div class="h-title">${escapeHtml(title)}</div>
      ${body}
    </div>`;

  const infoRow = (label, value) => `<div class="info-row"><span class="l">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;

  const viewHome = (student, cards) => {
    const parts = [];
    const banners = cards.banners ? activeBanners() : [];
    const tip = cards.tip ? latestTip() : null;

    if (banners.length || tip) {
      const slides = banners.map((b) => `
        <div class="sa-slide">
          <span class="sa-kicker">📢 ঘোষণা</span>
          <strong>${escapeHtml(b.title)}</strong>
          ${b.desc ? `<p>${escapeHtml(b.desc)}</p>` : ''}
          ${b.cta ? `<span class="sa-cta">${escapeHtml(b.cta)}</span>` : ''}
        </div>`).join('');
      const tipSlide = tip ? `<div class="sa-slide sa-slide-tip"><span class="sa-kicker">💡 শিক্ষকের টিপ</span><p>${escapeHtml(tip.text)}</p></div>` : '';
      parts.push(card('🎠 হোম হিরো · ব্যানার ও টিপ', `<div class="sa-slides">${slides}${tipSlide}</div>`, 'sa-hero-card'));
    }

    if (!cards.banners && !cards.tip) {
      parts.push(`<p class="sa-off">ব্যানার ও টিপ দুটোই বন্ধ — শিক্ষার্থীর হোমে এই অংশটা আসবেই না।</p>`);
    }

    if (cards.exam) {
      const exam = upcomingExam(student?.className);
      parts.push(exam ? card('📝 আসন্ন পরীক্ষা', `
        <div class="big">${escapeHtml(exam.title)}</div>
        ${infoRow('বিষয়', exam.subject || '—')}
        ${infoRow('তারিখ', formatBnDate(exam.date) || '—')}
        ${infoRow('সময়', `${bn(exam.duration || 0)} মিনিট · ${bn((exam.questions || []).length)}টি প্রশ্ন`)}
      `, 'hcard-exam') : card('📝 আসন্ন পরীক্ষা', '<p>কোনো পরীক্ষা নির্ধারিত নেই।</p>'));
    }

    if (cards.materials) {
      const mats = student ? materialsFor(student.className) : [];
      parts.push(mats.length ? card('📚 পড়া চালিয়ে যান', `
        <div class="big">${escapeHtml(mats[0].title)}</div>
        <p class="sa-dim">${escapeHtml(mats[0].subject)} · ${escapeHtml(mats[0].type || '')} · ${bn(mats.length)}টি মোট</p>
      `, 'hcard-study') : card('📚 পড়া চালিয়ে যান', `<p>${bn(0)}টি প্রকাশিত ম্যাটেরিয়াল — এই ক্লাসের জন্য কিছু ছাপেনি।</p>`));
    }

    if (cards.fee && student) {
      const fee = feeStatusFor(student);
      parts.push(card('💰 ফি', fee.due > 0
        ? `<div class="info-row"><span class="l">বকেয়া</span><span class="v sa-danger">৳${bn(fee.due)}</span></div>${fee.nextDue ? infoRow('মাস', fee.nextDue.month) : ''}`
        : '<p>সব ফি পরিশোধিত ✓</p>', 'hcard-fee'));
    }

    return parts.join('') || '<p class="sa-off">এই ক্লাসের শিক্ষার্থীর হোমে দেখানোর মতো কিছুই নেই।</p>';
  };

  const viewStudy = (student) => {
    const mats = student ? materialsFor(student.className) : [];
    const sugs = db.suggestions.list().filter((s) => inScope(s));
    const drafts = (student ? db.materials.list().filter((m) => m.published === false && (!m.className || m.className === student.className)) : []).length;
    return `
      ${card('📚 স্টাডি ম্যাটেরিয়াল', mats.length
        ? `<ul class="sa-list">${mats.slice(0, 6).map((m) => `<li><strong>${escapeHtml(m.title)}</strong><span>${escapeHtml(m.subject)} · ${escapeHtml(m.type || '')}</span></li>`).join('')}</ul>${mats.length > 6 ? `<p class="sa-dim">+ আরও ${bn(mats.length - 6)}টি</p>` : ''}`
        : '<p>এই ক্লাসের জন্য কোনো প্রকাশিত ম্যাটেরিয়াল নেই।</p>')}
      ${card('✍️ সাজেশন', sugs.length
        ? `<ul class="sa-list">${sugs.slice(0, 4).map((s) => `<li><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.subject || '')}</span></li>`).join('')}</ul>`
        : '<p>কোনো সাজেশন প্রকাশিত নেই।</p>')}
      ${drafts ? `<p class="sa-warn">⚠️ ${bn(drafts)}টি ম্যাটেরিয়াল খসড়া — প্রকাশ না করলে শিক্ষার্থী দেখবে না।</p>` : ''}`;
  };

  const viewExam = (student) => {
    const exams = (student ? examsFor(student.className) : db.exams.list()).filter(inScope);
    if (!exams.length) return card('📝 MCQ পরীক্ষা', '<p>এই ক্লাসের জন্য কোনো পরীক্ষা নেই।</p>');
    return card('📝 MCQ পরীক্ষা', `<ul class="sa-list">${exams.slice(0, 6).map((e) => {
      const win = examWindow(e) || { state: 'active', label: '' };
      return `<li><strong>${escapeHtml(e.title)}</strong><span>${escapeHtml(e.subject || '')} · ${escapeHtml(win.label || '')}</span></li>`;
    }).join('')}</ul>${exams.length > 6 ? `<p class="sa-dim">+ আরও ${bn(exams.length - 6)}টি</p>` : ''}`);
  };

  const viewResult = (student) => {
    const cards = homeCards();
    const perf = student ? performanceFor(student) : null;
    const pass = Number(db.settings.get().passMark) || 0;
    return `
      ${perf ? card('📈 সারসংক্ষেপ', `${infoRow('গড়', `${bn(perf.avg)}%`)}${infoRow('সেরা', `${bn(perf.best)}%`)}${infoRow('টেস্ট', bn(perf.tests))}${infoRow('র‍্যাঙ্ক', `#${escapeHtml(String(perf.rank))}`)}`) : card('📈 সারসংক্ষেপ', '<p>এখনো কোনো ফলাফল প্রকাশ হয়নি।</p>')}
      ${cards.leaderboard ? card('🏆 মেরিট লিস্ট', `<p>${escapeHtml(student?.className || scope.className)} · ${bn(classStudents().length)} জন শিক্ষার্থী</p>`) : '<p class="sa-off">মেরিট লিস্ট বন্ধ — শিক্ষার্থী র‍্যাঙ্ক দেখবে না।</p>'}
      ${card('✅ পাশের মান', infoRow('ন্যূনতম', `${bn(pass)}%`))}`;
  };

  const viewMore = () => {
    const enabled = homeFeatures();
    const items = MORE_MENU.filter((f) => !f.flag || enabled.includes(f.flag));
    const hidden = MORE_MENU.filter((f) => f.flag && !enabled.includes(f.flag));
    return `
      <div class="sa-menu">${items.map((f) => `
        <div class="sa-menu-item"><span class="ico" aria-hidden="true">${f.icon}</span><span>${escapeHtml(f.label)}</span></div>`).join('')}</div>
      ${hidden.length ? `<p class="sa-dim">লুকানো: ${hidden.map((f) => escapeHtml(f.label)).join(', ')}</p>` : ''}`;
  };

  const renderScreen = () => {
    if (!screen) return;
    const student = previewStudent();
    const cards = homeCards();
    const body = {
      home: () => viewHome(student, cards),
      study: () => viewStudy(student),
      exam: () => viewExam(student),
      result: () => viewResult(student),
      more: () => viewMore()
    }[scope.view]();
    screen.innerHTML = `${head(student)}<div class="sa-body">${body}</div>`;
    if (nav) {
      nav.innerHTML = VIEWS.map((v) => `
        <button type="button" class="sa-navbtn${v.id === scope.view ? ' on' : ''}" data-sa-view="${v.id}"
                aria-current="${v.id === scope.view ? 'page' : 'false'}">
          <span class="ico" aria-hidden="true">${v.icon}</span>${escapeHtml(v.label)}
        </button>`).join('');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Editor: the controls for the active view                            */
  /* ------------------------------------------------------------------ */
  // The visible words live beside the switch, not inside its <label>, so the
  // input carries its own accessible name or a reader announces "unlabeled".
  const toggle = (name, on, label, { disabled = false, id = '' } = {}) => `
    <label class="sa-switch${disabled ? ' is-locked' : ''}">
      <input type="checkbox" data-sa-set="${name}" aria-label="${escapeHtml(label)}"
             ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}${id ? ` id="${id}"` : ''}>
      <span class="sa-track" aria-hidden="true"></span>
    </label>`;

  const homeCardsEditor = () => {
    const cards = homeCards();
    const rows = CARD_FACTS.map((fact) => {
      const on = Boolean(cards[fact.key]);
      const meta = fact.live
        ? escapeHtml(fact.note)
        : `<span class="sa-dead">স্টুডেন্ট অ্যাপ এই সুইচ পড়ে না</span> · ${escapeHtml(fact.note)}${fact.jump ? ` <button type="button" class="link-btn" data-sa-jump="${fact.jump}">→ ${escapeHtml(fact.jump)} ট্যাব</button>` : ''}`;
      return `
        <li class="sa-row${fact.live ? '' : ' is-dead'}">
          <div class="sa-row-main">
            <strong>${escapeHtml(HOME_CARD_LABELS[fact.key] || fact.key)}</strong>
            <span>${meta}</span>
          </div>
          ${toggle(`card:${fact.key}`, on, `${HOME_CARD_LABELS[fact.key] || fact.key} হোমে দেখানো`,
            { disabled: !fact.live, id: `sa-card-${fact.key}` })}
        </li>`;
    }).join('');
    return `
      <section class="sa-block">
        <h3>হোমের কার্ড <small>setting: homeCards</small></h3>
        <ul class="sa-rows">${rows}</ul>
        <p class="sa-hint">বন্ধ করলে কার্ডটা শিক্ষার্থীর হোম থেকে মুহূর্তেই উঠে যায় — বাঁ পাশের প্রিভিউতে সেটাই দেখা যাচ্ছে।</p>
      </section>`;
  };

  const scoringEditor = () => {
    const settings = db.settings.get();
    const rows = SCORE_SETTINGS.map((f) => `
      <div class="form-group">
        <label for="sa-set-${f.key}">${escapeHtml(f.label)}</label>
        <input class="form-input" id="sa-set-${f.key}" data-sa-setting="${f.key}" type="number"
               min="${f.min}" max="${f.max}" step="${f.step}" value="${escapeHtml(String(settings[f.key] ?? ''))}">
        <small class="form-hint">${escapeHtml(f.hint)}</small>
      </div>`).join('');
    return `
      <section class="sa-block">
        <h3>স্কোরিং <small>যেটা আগে কোথাও বদলানো যেত না</small></h3>
        <div class="sa-settings">${rows}</div>
      </section>`;
  };

  const contentRows = (collection, kind, { publishField = null, activeField = null }) => {
    const rows = db[collection].list().filter(inScope).slice(0, 8);
    if (!rows.length) return `<li class="sa-row is-empty"><span>এখনো কিছু নেই — নিচের ফর্ম থেকে যোগ করুন।</span></li>`;
    return rows.map((row) => {
      const title = row.title || row.text || row.name || row.id;
      const metaBits = [];
      if (row.subject) metaBits.push(row.subject);
      if (row.audience) metaBits.push(row.audience);
      if (row.type) metaBits.push(row.type);
      if (row.date) metaBits.push(formatBnDate(row.date) || row.date);
      const flagField = publishField || activeField;
      const on = flagField ? row[flagField] !== false : true;
      return `
        <li class="sa-row">
          <div class="sa-row-main">
            <strong>${escapeHtml(String(title))}</strong>
            <span>${escapeHtml(metaBits.filter(Boolean).join(' · ') || '—')}</span>
          </div>
          ${flagField ? toggle(`${kind}:${flagField}:${row.id}`, on,
            `${title} — ${flagField === 'published' ? 'প্রকাশিত' : 'সক্রিয়'}`) : ''}
          <button type="button" class="btn-icon" data-sa-del="${kind}:${row.id}" title="মুছুন" aria-label="${escapeHtml(String(title))} — মুছুন">🗑</button>
        </li>`;
    }).join('');
  };

  const quickForm = (kind) => {
    const spec = QUICK_ADD[kind];
    if (!spec) return '';
    const fields = spec.fields.map((f) => {
      const id = `saq-${kind}-${f.name}`;
      const label = `<label for="${id}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>`;
      if (f.type === 'select') {
        return `<div class="form-group">${label}<select class="form-input form-select" id="${id}" name="${f.name}">${f.options.map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select></div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="form-group">${label}<textarea class="form-input form-textarea" id="${id}" name="${f.name}" rows="2"></textarea></div>`;
      }
      return `<div class="form-group">${label}<input class="form-input" id="${id}" name="${f.name}" type="text"></div>`;
    }).join('');
    return `
      <form class="sa-quick" data-sa-add="${kind}">
        <h4>＋ ${escapeHtml(spec.singular)} যোগ করুন${scope.className !== ALL_CLASSES ? ` · ${escapeHtml(scope.className)}` : ''}</h4>
        <div class="sa-quick-fields">${fields}</div>
        <button type="submit" class="btn btn-small">সংরক্ষণ ও প্রকাশ</button>
      </form>`;
  };

  const featureEditor = () => {
    const enabled = homeFeatures();
    const rows = MORE_MENU.filter((f) => f.flag).map((f) => `
      <li class="sa-row">
        <div class="sa-row-main"><strong>${escapeHtml(f.label)}</strong><span>“আরও” মেনুতে ${f.flag} টাইল</span></div>
        ${toggle(`feat:${f.flag}`, enabled.includes(f.flag), `${f.label} — “আরও” মেনুতে`,
          { id: `sa-feat-${f.flag}` })}
      </li>`).join('');
    const always = MORE_MENU.filter((f) => !f.flag).map((f) => escapeHtml(f.label)).join(', ');
    return `
      <section class="sa-block">
        <h3>“আরও” মেনু <small>settings: homeFeatures</small></h3>
        <ul class="sa-rows">${rows}</ul>
        <p class="sa-hint">সবসময় থাকে: ${always} — এগুলো অ্যাডমিন থেকে লুকানো যায় না।</p>
      </section>`;
  };

  const renderEditor = () => {
    if (!editor) return;
    const blocks = {
      home: () => `${homeCardsEditor()}
        <section class="sa-block">
          <h3>হোমে যা দেখায়</h3>
          <ul class="sa-rows">${contentRows('notices', 'notice', {})}</ul>
          ${quickForm('notices')}
        </section>
        <section class="sa-block">
          <h3>ব্যানার ও টিপ</h3>
          <ul class="sa-rows">${contentRows('banners', 'banner', { activeField: 'active' })}</ul>
          <ul class="sa-rows">${contentRows('tips', 'tip', { activeField: 'active' })}</ul>
          ${quickForm('banners')}
          ${quickForm('tips')}
        </section>
        ${scoringEditor()}`,
      study: () => `
        <section class="sa-block">
          <h3>স্টাডি ম্যাটেরিয়াল <small>“প্রকাশিত” টিক দিলেই শিক্ষার্থী দেখবে</small></h3>
          <ul class="sa-rows">${contentRows('materials', 'material', { publishField: 'published' })}</ul>
          ${quickForm('materials')}
        </section>
        <section class="sa-block">
          <h3>সাজেশন</h3>
          <ul class="sa-rows">${contentRows('suggestions', 'suggestion', {})}</ul>
          ${quickForm('suggestions')}
        </section>`,
      exam: () => {
        const exams = db.exams.list().filter(inScope);
        return `
          <section class="sa-block">
            <h3>পরীক্ষার উইন্ডো <small>শিক্ষার্থী এখানেই শুরু করতে পারবে</small></h3>
            <ul class="sa-rows">${exams.length ? exams.slice(0, 8).map((e) => {
              const win = examWindow(e) || { state: 'active', label: 'চলছে' };
              const tone = win.state === 'active' ? 'success' : 'warning';
              return `
                <li class="sa-row">
                  <div class="sa-row-main">
                    <strong>${escapeHtml(e.title)}</strong>
                    <span>${bn((e.questions || []).length)}টি প্রশ্ন · ${escapeHtml(formatBnDate(e.startDate) || '—')} → ${escapeHtml(formatBnDate(e.endDate) || '—')}</span>
                  </div>
                  <span class="badge ${tone}">${escapeHtml(win.label || win.state)}</span>
                </li>`;
            }).join('') : '<li class="sa-row is-empty"><span>কোনো পরীক্ষা নেই।</span></li>'}</ul>
            <p class="sa-hint"><button type="button" class="link-btn" data-sa-jump="exam">→ MCQ পরীক্ষা তৈরির ফর্মে যান</button></p>
          </section>
          ${scoringEditor()}`;
      },
      result: () => {
        const cards = homeCards();
        return `
          <section class="sa-block">
            <h3>ফলাফল ভিউ</h3>
            <ul class="sa-rows">
              <li class="sa-row">
                <div class="sa-row-main"><strong>মেরিট লিস্ট দেখানো</strong><span>ফলাফল ভিউয়ের র‍্যাঙ্ক টেবিল</span></div>
                ${toggle('card:leaderboard', Boolean(cards.leaderboard), 'মেরিট লিস্ট দেখানো')}
              </li>
              <li class="sa-row">
                <div class="sa-row-main"><strong>সব ফলাফল প্রকাশ</strong><span>${bn(db.examResults.list().filter((r) => r.published !== false).length)} / ${bn(db.examResults.list().length)}টি প্রকাশিত</span></div>
                <button type="button" class="link-btn" data-sa-jump="results">→ ফলাফল ট্যাব</button>
              </li>
            </ul>
          </section>
          ${scoringEditor()}`;
      },
      more: () => featureEditor()
    };
    editor.innerHTML = (blocks[scope.view] || blocks.home)();
  };

  const renderSummary = () => {
    if (!summary) return;
    const student = previewStudent();
    const view = (VIEWS.find((v) => v.id === scope.view) || VIEWS[0]).label;
    const cards = homeCards();
    const on = CARD_FACTS.filter((f) => f.live && cards[f.key]).length;
    summary.textContent = `${scope.className} · ${student ? `${student.name}` : 'শিক্ষার্থী নেই'} · ${view} ভিউ · চালু কার্ড ${bn(on)}/${bn(CARD_FACTS.filter((f) => f.live).length)}`;
  };

  function render() {
    if (classSelect && classSelect.value !== scope.className) {
      classSelect.innerHTML = [ALL_CLASSES, ...db.classes.list().filter((c) => c.active !== false).map((c) => c.name)]
        .map((c) => `<option${c === scope.className ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    }
    if (studentSelect) {
      const list = classStudents();
      studentSelect.innerHTML = list.length
        ? list.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === (previewStudent()?.id || '') ? ' selected' : ''}>${escapeHtml(`${s.name}${s.roll ? ` · রোল ${s.roll}` : ''}`)}</option>`).join('')
        : '<option value="">— শিক্ষার্থী নেই —</option>';
      studentSelect.disabled = !list.length;
    }
    renderScreen();
    renderEditor();
    renderSummary();
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  const setCard = (key, on) => {
    if (!requireOnline('হোম কার্ড বদল', getDbStatus)) return;
    setHomeCards({ [key]: on });
    const label = HOME_CARD_LABELS[key] || key;
    afterWrite(on ? 'enabled home card' : 'disabled home card', `${label} (শিক্ষার্থীর হোম)`);
    showToast(`${label} ${on ? 'চালু' : 'বন্ধ'} — শিক্ষার্থীর হোম এখন তাই দেখাচ্ছে।`, 'success');
  };

  const setFeature = (flag, on) => {
    if (!requireOnline('ফিচার বদল', getDbStatus)) return;
    const enabled = new Set(homeFeatures());
    if (on) enabled.add(flag); else enabled.delete(flag);
    setHomeFeatures([...enabled]);
    afterWrite(on ? 'enabled app feature' : 'disabled app feature', `${flag} (আরও মেনু)`);
  };

  const saveSetting = (key, raw) => {
    if (!requireOnline('সেটিংস সংরক্ষণ', getDbStatus)) { render(); return; }
    const field = SCORE_SETTINGS.find((f) => f.key === key);
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < field.min || value > field.max) {
      showToast(`“${field.label}” ${bn(field.min)}–${bn(field.max)} এর মধ্যে লিখুন।`, 'error');
      render();
      return;
    }
    db.settings.update({ [key]: value });
    afterWrite('updated setting', `${key} = ${value}`);
    showToast('সেটিংস সংরক্ষিত — নতুন ফলাফলেই এটা লাগু হবে।', 'success');
  };

  const toggleRow = (spec, on) => {
    const [kind, field, id] = spec.split(':');
    const collection = { material: 'materials', notice: 'notices', banner: 'banners', tip: 'tips' }[kind];
    if (!collection) return;
    if (!writable(kind === 'material' ? 'manageMaterials' : 'manageNotices', 'প্রকাশ বদল')) return;
    db[collection].update(id, { [field]: on });
    afterWrite(on ? 'published' : 'unpublished', `${collection} ${id}`);
    showToast(on ? 'প্রকাশিত — শিক্ষার্থী এখন দেখতে পাবে।' : 'লুকানো — শিক্ষার্থীর স্ক্রিন থেকে উঠে গেছে।', on ? 'success' : 'warning');
  };

  const removeRow = (spec) => {
    const [kind, id] = spec.split(':');
    const collection = { material: 'materials', notice: 'notices', banner: 'banners', tip: 'tips', suggestion: 'suggestions' }[kind];
    if (!collection) return;
    if (!writable(kind === 'material' || kind === 'suggestion' ? 'manageMaterials' : 'manageNotices', 'মুছে ফেলা')) return;
    if (!window.confirm('শিক্ষার্থীর অ্যাপ থেকেও এটি উঠে যাবে। মুছে ফেলবেন?')) return;
    db[collection].remove(id);
    afterWrite('deleted', `${collection} ${id}`);
    showToast('মুছে ফেলা হয়েছে।', 'warning');
  };

  panel.addEventListener('change', (event) => {
    const box = event.target.closest('[data-sa-set]');
    if (box) {
      const name = box.dataset.saSet;
      if (name.startsWith('card:')) setCard(name.slice(5), box.checked);
      else if (name.startsWith('feat:')) setFeature(name.slice(5), box.checked);
      else if (name.includes(':')) toggleRow(name, box.checked);
      return;
    }
    const setting = event.target.closest('[data-sa-setting]');
    if (setting) saveSetting(setting.dataset.saSetting, setting.value);
  });

  panel.addEventListener('click', (event) => {
    const viewBtn = event.target.closest('[data-sa-view]');
    if (viewBtn) {
      scope.view = viewBtn.dataset.saView;
      remember();
      render();
      return;
    }
    const jump = event.target.closest('[data-sa-jump]');
    if (jump) { tabs?.activate?.(jump.dataset.saJump); return; }
    const del = event.target.closest('[data-sa-del]');
    if (del) removeRow(del.dataset.saDel);
  });

  panel.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-sa-add]');
    if (!form) return;
    event.preventDefault();
    const kind = form.dataset.saAdd;
    const spec = QUICK_ADD[kind];
    if (!spec) return;
    if (!writable(spec.perm, `${spec.singular} সংরক্ষণ`)) return;
    const data = new FormData(form);
    const values = {};
    spec.fields.forEach((f) => { values[f.name] = String(data.get(f.name) || '').trim(); });
    const missing = spec.fields.find((f) => f.required && !values[f.name]);
    if (missing) { showToast(`“${missing.label}” পূরণ করুন।`, 'error'); return; }
    const record = spec.build(values, scope, session);
    db[kind].add(record);
    form.reset();
    afterWrite('added', `${spec.singular} ${record.id}`);
    showToast(`${spec.singular} যোগ হয়েছে — প্রিভিউতে দেখুন।`, 'success');
  });

  classSelect?.addEventListener('change', () => {
    scope.className = classSelect.value || ALL_CLASSES;
    scope.studentId = '';
    remember();
    render();
  });
  studentSelect?.addEventListener('change', () => {
    scope.studentId = studentSelect.value;
    remember();
    render();
  });

  // Another tab (or the students list) changed something the preview shows.
  window.addEventListener('admin:data-changed', () => { if (!panel.hidden) render(); });

  render();
  return { render, scope: () => ({ ...scope }) };
}
