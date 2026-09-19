/**
 * Shared authoring + taking UI for online suggestions and MCQ exams.
 * Teachers and admins author (js/exams.js is mounted on both pages);
 * students take exams and read suggestions (mountExamTaker / suggestion list).
 */

import {
  db, CLASS_OPTIONS, ALL_CLASSES, todayBn, newId, scoreExam, examResultFor, suggestionsFor,
  examsFor, recordStudyActivity, examWindow, getDbStatus, assertCan, teacherCanAccessClass,
  parseMcqPaste, parseBnDateInput, formatBnDate, MCQ_TEMPLATE, MCQ_PASTE_RULES, downloadText,
  examFullMarks, toBnDigits
} from './data.js';
import { escapeHtml, openModal, closeModal, showToast, requireOnline } from './app.js';
import { previewDocument } from './preview.js';
import { renderQuestionPaperCanvases } from './docs.js';
import { beepWarn5, beepWarn1, beepTimeUp, confettiBurst } from './student-prefs.js';

// Spec 51: never report a saved record that could not be saved.
const onlineFor = (action) => requireOnline(action, getDbStatus);

export function classOptionsHtml(selected = ALL_CLASSES, { allowAll = true } = {}) {
  const opts = allowAll ? [ALL_CLASSES, ...CLASS_OPTIONS] : [...CLASS_OPTIONS];
  return opts.map((c) => `<option${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

/* ------------------------------------------------------------------ */
/* Suggestions (authoring, used by teacher + admin)                    */
/* ------------------------------------------------------------------ */
export function mountSuggestionAuthoring({ author, session = null }) {
  const list = document.getElementById('suggestion-list');
  const render = () => {
    // Newest 50; every student suggestion lands here forever (spec 62).
    const rows = db.suggestions.list().slice(0, 50);
    list.innerHTML = rows.length
      ? rows.map((s) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(s.title)}</div>
            <div class="li-sub">${escapeHtml(s.className)} · ${escapeHtml(s.subject)} · ${escapeHtml(s.author)} · ${escapeHtml(formatBnDate(s.date))}</div>
            <div class="li-sub" style="white-space:pre-wrap;margin-top:.25rem">${escapeHtml(s.content)}</div>
          </div>
          <button type="button" class="btn btn-small btn-error" data-delete-suggestion="${escapeHtml(s.id)}">মুছুন</button>
        </div>`).join('')
      : '<div class="empty-state">কোনো সাজেশন নেই।</div>';
  };

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-suggestion]');
    if (!btn) return;
    const id = btn.dataset.deleteSuggestion;
    if (!onlineFor('সাজেশন মুছে ফেলা')) return;
    const item = db.suggestions.find(id);
    const title = item?.title || 'এই সাজেশন';
    if (!window.confirm(`"${title}" সাজেশনটি মুছে ফেলতে চান?\n\nএই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`)) return;
    db.suggestions.remove(id);
    showToast('সাজেশন মুছে ফেলা হয়েছে।', 'warning');
    render();
  });

  document.getElementById('open-suggestion-modal').addEventListener('click', () => {
    document.getElementById('suggestion-form').reset();
    openModal('suggestion-modal');
  });

  document.getElementById('suggestion-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const title = String(d.get('title') || '').trim();
    const content = String(d.get('content') || '').trim();
    if (!title || !content) { showToast('শিরোনাম ও বিষয়বস্তু দুটোই দিন।', 'error'); return; }
    const className = String(d.get('className'));
    if (!onlineFor('সাজেশন সংরক্ষণ')) return;
    // Enforced here, not just by narrowing the picker (spec 8).
    try { assertCan(session, 'manageQuestions', 'সাজেশন প্রকাশ'); }
    catch (err) { showToast(err.message, 'error'); return; }
    if (session && !teacherCanAccessClass(session, className)) {
      showToast('অনুমোদিত ক্লাস নয়।', 'error'); return;
    }
    db.suggestions.add({
      id: newId('sug'), title, content,
      className,
      subject: String(d.get('subject') || '').trim(),
      author, date: todayBn()
    });
    closeModal('suggestion-modal');
    render();
    showToast('সাজেশন প্রকাশিত হয়েছে।', 'success');
  });

  render();
}

/* ------------------------------------------------------------------ */
/* MCQ exams (authoring, used by teacher + admin)                      */

/* ------------------------------------------------------------------ */
/* MCQ exams (authoring, used by teacher + admin)                      */
/*                                                                     */
/* Questions are authored by pasting a whole paper into the template —  */
/* the teacher copies the paper from anywhere (Word, Messenger, a       */
/* book PDF) and the app splits it into ready MCQs. One by one typing   */
/* stays available, folded away, for the odd single question.           */
/* ------------------------------------------------------------------ */
export function mountExamAuthoring({ session = null } = {}) {
  const list = document.getElementById('exam-list');
  const pasteBox = document.getElementById('exam-paste');
  const reportBox = document.getElementById('exam-parse-report');
  let staged = [];

  const bn = (n) => String(n ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

  // The rules live next to the template in data.js, so the two can never drift.
  const rulesEl = document.getElementById('exam-paste-rules');
  if (rulesEl) rulesEl.textContent = MCQ_PASTE_RULES;

  const renderStaged = () => {
    const host = document.getElementById('exam-staged');
    const count = document.getElementById('exam-question-count');
    if (count) {
      count.textContent = staged.length
        ? `${bn(staged.length)}টি প্রশ্ন প্রস্তুত`
        : 'এখনো কোনো প্রশ্ন যোগ করা হয়নি';
    }
    host.innerHTML = staged.length
      ? staged.map((q, i) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${bn(i + 1)}. ${escapeHtml(q.q)}</div>
            <div class="li-sub">${q.options.map((o, oi) => `${oi === q.answer ? '✅' : '○'} ${escapeHtml(o)}`).join(' &nbsp; ')}</div>
          </div>
          <button type="button" class="btn btn-small btn-error" data-unstage="${i}" aria-label="প্রশ্ন বাদ দিন">বাদ</button>
        </div>`).join('')
      : '<div class="empty-state">টেমপ্লেট অনুযায়ী প্রশ্ন পেস্ট করলে এখানে তৈরি হয়ে দেখা যাবে।</div>';
  };

  /** Opens the printable paper (or the teacher's answer key) in the preview. */
  const openPaper = async (examId, withAnswers) => {
    const exam = db.exams.find(examId);
    if (!exam) return;
    if (!(exam.questions || []).length) {
      showToast('এই পরীক্ষায় এখনো কোনো প্রশ্ন যোগ করা হয়নি।', 'error');
      return;
    }
    try {
      const canvases = await renderQuestionPaperCanvases(exam, {
        settings: db.settings.get(),
        withAnswers,
        generatedBy: session?.name || null
      });
      await previewDocument({
        title: withAnswers ? 'সঠিক উত্তরপত্র' : 'প্রশ্নপত্র',
        meta: `${exam.title} · ${exam.className}${exam.subject ? ` · ${exam.subject}` : ''} · ${formatBnDate(exam.date)}`,
        filename: `${exam.id}-${withAnswers ? 'answer-key' : 'question-paper'}.pdf`,
        canvases
      });
    } catch (err) {
      showToast('প্রশ্নপত্র তৈরি করা যায়নি — আবার চেষ্টা করুন।', 'error');
    }
  };

  const render = () => {
    const rows = db.exams.list();
    list.innerHTML = rows.length
      ? rows.map((exam) => {
        const taken = db.examResults.list().filter((r) => r.examId === exam.id).length;
        const win = examWindow(exam);
        return `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(exam.title)}</div>
            <div class="li-sub">${escapeHtml(exam.className)} · ${escapeHtml(exam.subject)} · ${bn(exam.questions.length)}টি প্রশ্ন · ${bn(taken)} জন দিয়েছে · ${escapeHtml(exam.author)}</div>
            <div class="li-sub">📅 ${escapeHtml(formatBnDate(exam.date))} · ⏱ ${bn(exam.duration || 30)} মিনিট · ${escapeHtml(win ? win.label : '')}</div>
          </div>
          <span class="row-actions">
            <button type="button" class="btn btn-small btn-secondary" data-paper="${escapeHtml(exam.id)}">📄 প্রশ্নপত্র</button>
            <button type="button" class="btn btn-small btn-secondary" data-key="${escapeHtml(exam.id)}">🗝️ উত্তরপত্র</button>
            <button type="button" class="btn btn-small btn-secondary" data-results="${escapeHtml(exam.id)}">ফলাফল</button>
            <button type="button" class="btn btn-small btn-error" data-delete-exam="${escapeHtml(exam.id)}">মুছুন</button>
          </span>
        </div>`;
      }).join('')
      : '<div class="empty-state">কোনো পরীক্ষা নেই।</div>';
  };

  list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-delete-exam]');
    const res = e.target.closest('[data-results]');
    const paper = e.target.closest('[data-paper]');
    const key = e.target.closest('[data-key]');
    if (paper) { openPaper(paper.dataset.paper, false); return; }
    if (key) { openPaper(key.dataset.key, true); return; }
    if (del) {
      const id = del.dataset.deleteExam;
      if (!onlineFor('পরীক্ষা মুছে ফেলা')) return;
      const exam = db.exams.find(id);
      const title = exam?.title || 'এই পরীক্ষা';
      if (!window.confirm(`"${title}" পরীক্ষাটি মুছে ফেলতে চান?\n\nএই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।`)) return;
      db.exams.remove(id);
      showToast('পরীক্ষা মুছে ফেলা হয়েছে।', 'warning');
      render();
    } else if (res) {
      showResults(res.dataset.results);
    }
  });

  document.getElementById('exam-staged').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unstage]');
    if (!btn) return;
    staged.splice(Number(btn.dataset.unstage), 1);
    renderStaged();
  });

  document.getElementById('open-exam-modal').addEventListener('click', () => {
    document.getElementById('exam-form').reset();
    staged = [];
    if (pasteBox) pasteBox.value = '';
    if (reportBox) reportBox.innerHTML = '';
    // The template is shown as text as well, so it can be copied by hand on a
    // desk that has no clipboard access, and the configured default duration
    // (Settings) is what the teacher starts from.
    const shown = document.getElementById('exam-template-view');
    if (shown) shown.textContent = MCQ_TEMPLATE;
    const duration = document.getElementById('exam-duration');
    if (duration) duration.value = String(Number(db.settings.get().defaultExamDuration) || 30);
    renderStaged();
    openModal('exam-modal');
  });

  /* ---------------- Paste → ready questions ---------------- */

  /** Reads the paste box, stages everything valid and reports what it found. */
  const parsePaste = ({ quiet = false } = {}) => {
    if (!pasteBox) return;
    const text = pasteBox.value;
    if (!text.trim()) {
      if (!quiet) showToast('আগে প্রশ্ন পেস্ট করুন।', 'error');
      return;
    }
    const { questions, errors, duplicates, ignored } = parseMcqPaste(text);
    const known = new Set(staged.map((q) => q.q.replace(/\s+/g, ' ').trim()));
    const fresh = questions.filter((q) => !known.has(q.q.replace(/\s+/g, ' ').trim()));
    staged = [...staged, ...fresh];
    renderStaged();

    const already = questions.length - fresh.length;
    reportBox.innerHTML = [
      fresh.length
        ? `<div class="alert alert-success">✅ ${bn(fresh.length)}টি প্রশ্ন তৈরি হয়েছে। নিচে দেখে নিয়ে “পরীক্ষা প্রকাশ করুন” চাপুন।</div>`
        : '',
      already > 0 ? `<div class="alert alert-warning">${bn(already)}টি প্রশ্ন আগেই যোগ করা ছিল — বাদ দেওয়া হয়েছে।</div>` : '',
      duplicates.length ? `<div class="alert alert-warning">${bn(duplicates.length)}টি প্রশ্ন পেস্টের ভেতরেই দুইবার ছিল — একবার নেওয়া হয়েছে।</div>` : '',
      // A copied paper usually starts with its own title; say so instead of
      // letting the teacher wonder where that line went.
      (ignored || []).length ? `<div class="alert alert-info">প্রশ্নপত্রের শিরোনাম মনে হওয়ায় বাদ দেওয়া হয়েছে: ${ignored.map(escapeHtml).join(' · ')}</div>` : '',
      errors.length ? `<div class="alert alert-error">⚠️ ${bn(errors.length)}টি প্রশ্ন অসম্পূর্ণ:<br>${errors.map(escapeHtml).join('<br>')}</div>` : ''
    ].join('');

    if (!quiet && !fresh.length && !already) showToast('কোনো বৈধ প্রশ্ন পাওয়া যায়নি — টেমপ্লেট দেখে আবার চেষ্টা করুন।', 'error');
    else if (!quiet && fresh.length) showToast(`${bn(fresh.length)}টি প্রশ্ন তৈরি হয়েছে।`, 'success');
  };

  document.getElementById('exam-parse')?.addEventListener('click', () => parsePaste());

  // Pasting is the whole point: parse as soon as the text lands (and while
  // it is being corrected), so the teacher sees the questions appear.
  let parseTimer = null;
  const scheduleParse = () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      if (pasteBox && pasteBox.value.trim()) parsePaste({ quiet: true });
    }, 500);
  };
  pasteBox?.addEventListener('paste', scheduleParse);
  pasteBox?.addEventListener('input', scheduleParse);

  document.getElementById('exam-template')?.addEventListener('click', () => {
    if (!pasteBox) return;
    if (pasteBox.value.trim() && !window.confirm('টেমপ্লেট বসালে বর্তমান লেখা মুছে যাবে। চালিয়ে যাবেন?')) return;
    pasteBox.value = MCQ_TEMPLATE;
    pasteBox.focus();
    showToast('টেমপ্লেট বসানো হয়েছে — নিজের প্রশ্ন দিয়ে বদলে নিন।', 'info');
  });

  // A teacher can also keep the template as a file and paste questions into it
  // offline, then paste the whole thing back.
  document.getElementById('exam-download-template')?.addEventListener('click', () => {
    downloadText('mcq-prashner-template.txt', `${MCQ_TEMPLATE}\n`);
    showToast('টেমপ্লেট ফাইল ডাউনলোড হয়েছে — এতে প্রশ্ন বসিয়ে আবার পেস্ট করুন।', 'success');
  });

  document.getElementById('exam-copy-template')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MCQ_TEMPLATE);
      showToast('টেমপ্লেট কপি হয়েছে।', 'success');
    } catch (err) {
      if (pasteBox) pasteBox.value = MCQ_TEMPLATE;
      showToast('কপি করা যায়নি — টেমপ্লেটটি পেস্ট বক্সে বসানো হয়েছে।', 'warning');
    }
  });

  /* ---------------- One by one (optional, folded away) ---------------- */
  document.getElementById('add-question')?.addEventListener('click', () => {
    const q = document.getElementById('q-text').value.trim();
    const options = [0, 1, 2, 3].map((i) => document.getElementById(`q-opt${i}`).value.trim());
    const answer = Number(document.getElementById('q-answer').value);
    if (!q) { showToast('প্রশ্ন লিখুন।', 'error'); return; }
    if (options.some((o) => !o)) { showToast('চারটি অপশনই পূরণ করুন।', 'error'); return; }
    staged.push({ q, options, answer });
    document.getElementById('q-text').value = '';
    [0, 1, 2, 3].forEach((i) => { document.getElementById(`q-opt${i}`).value = ''; });
    renderStaged();
    showToast('প্রশ্ন যোগ হয়েছে।', 'success');
  });

  document.getElementById('exam-form').addEventListener('submit', (e) => {
    e.preventDefault();
    // Anything typed but not yet parsed is picked up on save — a teacher who
    // pasted and hit Publish straight away still gets a complete paper.
    if (pasteBox && pasteBox.value.trim() && !staged.length) parsePaste({ quiet: true });
    const d = new FormData(e.target);
    const title = String(d.get('title') || '').trim();
    if (!title) { showToast('পরীক্ষার শিরোনাম দিন।', 'error'); return; }
    if (!staged.length) { showToast('কমপক্ষে একটি প্রশ্ন যোগ করুন — টেমপ্লেট দেখে পেস্ট করুন।', 'error'); return; }
    const className = String(d.get('className'));
    if (!onlineFor('পরীক্ষা সংরক্ষণ')) return;
    // A hand-edited select must not reach a class outside the assignment (spec 8).
    try { assertCan(session, 'manageExams', 'পরীক্ষা তৈরি'); }
    catch (err) { showToast(err.message, 'error'); return; }
    if (session && !teacherCanAccessClass(session, className)) {
      showToast('অনুমোদিত ক্লাস নয়।', 'error'); return;
    }
    const duration = Number(d.get('duration')) || Number(db.settings.get().defaultExamDuration) || 30;
    const dateInput = String(d.get('date') || '').trim();
    const toStored = (value) => parseBnDateInput(value);
    const startDate = toStored(String(d.get('startDate') || '').trim());
    const endDate = toStored(String(d.get('endDate') || '').trim());
    db.exams.add({
      id: newId('exam'), title,
      className,
      subject: String(d.get('subject') || '').trim(),
      author: window.__examAuthor || '',
      date: toStored(dateInput) || todayBn(),
      time: String(d.get('time') || '').trim(),
      duration,
      startDate,
      endDate,
      questions: staged
    });
    closeModal('exam-modal');
    render();
    showToast('পরীক্ষা প্রকাশিত হয়েছে।', 'success');
  });

  function showResults(examId) {
    const exam = db.exams.find(examId);
    const results = db.examResults.list().filter((r) => r.examId === examId);
    const host = document.getElementById('exam-results');
    host.innerHTML = results.length
      ? `<h3>${escapeHtml(exam.title)}</h3>` + results.map((r) => {
        const answers = Array.isArray(r.answers) ? r.answers : null;
        const wrong = answers
          ? answers.map((given, qi) => (given === null || Number(given) !== Number(exam.questions[qi]?.answer) ? qi + 1 : 0)).filter(Boolean)
          : [];
        const auto = r.autoSubmitted ? ' · ⏰ স্বয়ংক্রিয়ভাবে জমা' : '';
        return `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(r.studentName)}</div>
            <div class="li-sub">${escapeHtml(r.studentId)} · ${escapeHtml(formatBnDate(r.date))}${auto}</div>
            ${answers ? `<div class="li-sub">ভুল হয়েছে: ${wrong.length ? wrong.map((n) => bn(n)).join(', ') + ` নম্বর প্রশ্নে` : 'একটিও নয় ✅'}</div>` : ''}
          </div>
          <span class="badge ${r.score / r.total >= 0.5 ? 'success' : 'warning'}">${bn(r.score)}/${bn(r.total)}</span>
        </div>`;
      }).join('')
      : `<h3>${escapeHtml(exam?.title || '')}</h3><div class="empty-state">এখনো কেউ পরীক্ষা দেয়নি।</div>`;
    openModal('exam-results-modal');
  }

  renderStaged();
  render();
}

export function setExamAuthor(name) {
  window.__examAuthor = name;
}

/* ------------------------------------------------------------------ */
/* Student: read suggestions + take exams                              */
/* ------------------------------------------------------------------ */
export function renderStudentSuggestions(selector, className) {
  const host = document.querySelector(selector);
  const rows = suggestionsFor(className);
  host.innerHTML = rows.length
    ? rows.map((s) => `
      <div class="card">
        <h3>${escapeHtml(s.title)}</h3>
        <p>${escapeHtml(s.subject)} · ${escapeHtml(s.author)} · ${escapeHtml(formatBnDate(s.date))}</p>
        <p style="white-space:pre-wrap;margin-top:.5rem;color:var(--text-light)">${escapeHtml(s.content)}</p>
      </div>`).join('')
    : '<div class="empty-state">আপনার ক্লাসের কোনো সাজেশন নেই।</div>';
}

export function mountExamTaker({ listSelector, student }) {
  const list = document.querySelector(listSelector);
  const player = document.getElementById('exam-player');
  /* Digits follow the student's Settings → সংখ্যা preference (toBnDigits). */
  const bn = toBnDigits;
  let ticker = null;
  let onScreen = false;

  /* ------------------------------------------------------------------ */
  /* The running paper is remembered per student+exam, so closing the tab */
  /* or reloading cannot hand out a fresh timer.                          */
  /* ------------------------------------------------------------------ */
  const sessionKey = (examId) => `activeplus_exam_${student.id}_${examId}`;
  const memorySessions = new Map();

  const saveSession = (examId, data) => {
    memorySessions.set(sessionKey(examId), data);
    try { window.localStorage.setItem(sessionKey(examId), JSON.stringify(data)); } catch (e) { /* storage blocked */ }
  };
  const loadSession = (examId) => {
    try {
      const raw = window.localStorage.getItem(sessionKey(examId));
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage blocked */ }
    return memorySessions.get(sessionKey(examId)) || null;
  };
  const clearSession = (examId) => {
    memorySessions.delete(sessionKey(examId));
    try { window.localStorage.removeItem(sessionKey(examId)); } catch (e) { /* ignore */ }
  };

  const stopTimer = () => { if (ticker) { clearInterval(ticker); ticker = null; } };
  const showList = (message, type = 'warning') => {
    stopTimer();
    onScreen = false;
    player.hidden = true;
    player.innerHTML = '';
    list.hidden = false;
    if (message) showToast(message, type);
    render();
  };

  /** '২৯:৫৮' left on a sitting that is already running, or '' when none is. */
  const remainingLabel = (exam) => {
    const session = loadSession(exam.id);
    if (!session || !session.deadline) return '';
    const left = session.deadline - Date.now();
    if (left <= 0) return 'সময় শেষ';
    const totalSec = Math.floor(left / 1000);
    return `${bn(String(Math.floor(totalSec / 60)).padStart(2, '0'))}:${bn(String(totalSec % 60).padStart(2, '0'))}`;
  };

  /* One glance tells the story of the card: done / live / open / later / over. */
  const statusChip = ({ done, running, win }) => {
    const chip = (cls, icon, label) =>
      `<span class="exam-status ${cls}">${icon} ${label}</span>`;
    if (done) return chip('st-done', '✅', 'দেওয়া হয়েছে');
    if (running && running !== 'সময় শেষ') return chip('st-live', '⏱', 'চলছে');
    if (win && win.canStart) return chip('st-open', '🟢', 'এখন দেওয়া যাবে');
    if (win && win.state === 'closed') return chip('st-closed', '⛔', 'সময় শেষ');
    return chip('st-wait', '⏳', 'শুরু হয়নি');
  };

  const render = () => {
    const rows = examsFor(student.className);
    list.innerHTML = rows.length
      ? rows.map((exam) => {
        const done = examResultFor(exam.id, student.id);
        const win = examWindow(exam);
        const running = done ? '' : remainingLabel(exam);
        const marks = examFullMarks(exam);
        const donePct = done && done.total ? Math.round((done.score / done.total) * 100) : 0;
        return `
        <div class="list-item">
          <div class="li-main">
            ${statusChip({ done, running, win })}
            <div class="li-title">${escapeHtml(exam.title)}</div>
            <div class="li-sub">${escapeHtml(exam.subject)} · ⏱ ${bn(exam.duration || 30)} মিনিট · ${escapeHtml(exam.author)}</div>
            <div class="li-sub">📝 ${bn(marks)}টি প্রশ্ন · পূর্ণমান ${bn(marks)}${db.settings.get().negativeMarking ? ` · নেগেটিভ ${bn(db.settings.get().negativeMarking)}` : ''}</div>
            <div class="li-sub">📅 ${escapeHtml(formatBnDate(exam.date))}${exam.time ? ` · ${escapeHtml(exam.time)}` : ''}${win && win.state === 'active' ? '' : ` · ${escapeHtml(win ? win.label : '')}`}</div>
            ${done ? `<div class="li-sub exam-done">✅ আপনার আগের চেষ্টা: ${bn(done.score)}/${bn(done.total)} (${bn(donePct)}%)${done.date ? ` · ${escapeHtml(formatBnDate(done.date))}` : ''}${done.pendingSync ? ' · অফলাইনে জমা, সিঙ্ক বাকি' : ''}</div>` : ''}
            ${running ? `<div class="li-sub exam-running">⏱ ${running === 'সময় শেষ' ? 'সময় শেষ — খুললেই জমা হবে' : `চলছে · আর ${escapeHtml(running)} বাকি`}</div>` : ''}
          </div>
          ${done
            ? `<span class="row-actions">
                 <span class="badge ${donePct >= 50 ? 'success' : 'warning'}">${bn(done.score)}/${bn(done.total)}</span>
                 ${Array.isArray(done.answers) ? `<button type="button" class="btn btn-small btn-secondary" data-review="${escapeHtml(exam.id)}">উত্তর দেখুন</button>` : ''}
               </span>`
            : (win && win.canStart
              ? `<button type="button" class="btn btn-small${running ? ' btn-secondary' : ''}" data-take="${escapeHtml(exam.id)}">${running && running !== 'সময় শেষ' ? 'চালিয়ে যান' : 'শুরু করুন'}</button>`
              : `<span class="badge warning">${escapeHtml(win && win.state === 'closed' ? 'সময় শেষ' : 'শুরু হয়নি')}</span>`)}
        </div>`;
      }).join('')
      : '<div class="empty-state">আপনার ক্লাসের কোনো পরীক্ষা নেই।</div>';
  };

  /** Opens the same review screen later, from the stored result. */
  function showReview(examId) {
    const exam = db.exams.find(examId);
    const result = examResultFor(examId, student.id);
    if (!exam || !result) return;
    const answers = Array.isArray(result.answers) ? result.answers : null;
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    onScreen = true;
    list.hidden = true;
    player.hidden = false;
    player.innerHTML = `
      <div class="hcard exam-result" style="text-align:center">
        <div class="h-title" style="justify-content:center">📝 উত্তরপত্র — ${escapeHtml(exam.title)}</div>
        <div class="exam-score">${bn(result.score)}/${bn(result.total)}</div>
        <div class="exam-pct">${bn(pct)}%</div>
        <p class="meta">জমা দেওয়ার তারিখ: ${escapeHtml(formatBnDate(result.date))}${result.autoSubmitted ? ' · স্বয়ংক্রিয়ভাবে জমা' : ''}${result.pendingSync ? ' · অফলাইনে জমা, সিঙ্ক বাকি' : ''}</p>
      </div>
      ${answers ? `<details class="mini-details" open><summary>📝 সঠিক উত্তর দেখুন</summary>
        <div class="mini-body">${reviewHtml(exam, answers)}</div></details>`
        : '<div class="alert alert-info">এই পরীক্ষার উত্তরগুলো সংরক্ষিত হয়নি — শুধু ফলাফল আছে।</div>'}
      <button type="button" class="btn btn-block" id="back-to-exams">ফিরে যান</button>`;
    player.querySelector('#back-to-exams').addEventListener('click', () => showList('', 'info'));
  }

  list.addEventListener('click', (e) => {
    const review = e.target.closest('[data-review]');
    if (review) { showReview(review.dataset.review); return; }
    const btn = e.target.closest('[data-take]');
    if (!btn) return;
    takeExam(btn.dataset.take);
  });

    /** Question-by-question review: what the student chose against the answer. */
  const reviewHtml = (exam, chosen) => exam.questions.map((q, qi) => {
    const given = chosen ? chosen[qi] : null;
    const answered = given !== null && given !== undefined && given !== '';
    const right = answered && Number(given) === Number(q.answer);
    const correct = q.options[q.answer] || '';
    // The verdict is written out, never carried by colour alone (a red row
    // means nothing to a colour-blind student or a screen reader).
    const verdict = right ? '✓ সঠিক' : (answered ? '✗ ভুল' : '— উত্তর দেননি');
    return `<div class="exam-review ${right ? 'ok' : 'bad'}">
      <div class="li-title">${bn(qi + 1)}. ${escapeHtml(q.q)}</div>
      <div class="exam-verdict ${right ? 'ok' : 'bad'}">${verdict}</div>
      <div class="li-sub">আপনার উত্তর: ${answered ? escapeHtml(q.options[Number(given)] || '') : '<i>দেননি</i>'}</div>
      <div class="li-sub">সঠিক উত্তর: <b>${escapeHtml(correct)}</b></div>
    </div>`;
  }).join('');

  /** Exam duration in ms — an exam can never be posted with 0 minutes. */
  const durationMs = (exam) => Math.max(1, Number(exam.duration) || 30) * 60000;

  function startExam(examId) {
    const exam = db.exams.find(examId);
    if (!exam) return;
    // Hiding the Start button is only paint. Guard the data path as well, so a
    // closed window cannot be sat and a retake cannot add a second result.
    const win = examWindow(exam);
    if (win && !win.canStart) { showList('এই পরীক্ষার সময় শেষ বা এখনো শুরু হয়নি।'); return; }
    if (examResultFor(examId, student.id)) { showList('আপনি এই পরীক্ষাটি আগেই দিয়েছেন।'); return; }
    if (exam.questions.length === 0) { showList('এই পরীক্ষায় এখনো কোনো প্রশ্ন যোগ করা হয়নি।'); return; }

    const total = exam.questions.length;
    // An interrupted sitting keeps its original deadline — reopening the exam
    // can never buy extra time. Once that deadline has passed the paper is
    // submitted with the answers that were saved.
    const saved = loadSession(examId);
    const deadline = saved?.deadline ? saved.deadline : Date.now() + durationMs(exam);
    const answers = saved?.answers || {};

    onScreen = true;
    list.hidden = true;
    player.hidden = false;
    /* Every question on one scrollable page: the palette dots stay as quick
       jumps (and as the answered checklist), the submit button is pinned to
       the bottom of the screen so it is never out of reach. */
    player.innerHTML = `
      <div class="exam-topbar">
        <span class="exam-timer" id="exam-timer" role="timer" aria-label="বাকি সময়">⏱ --:--</span>
        <span class="exam-count" id="exam-count">উত্তর ${bn(0)} / ${bn(total)}</span>
      </div>
      <div class="exam-timebar" id="exam-timebar" role="progressbar" aria-label="সময়ের অগ্রগতি"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i id="exam-time-fill" style="width:100%"></i></div>
      <div class="exam-bar" aria-hidden="true"><i id="exam-bar-fill" style="width:0%"></i></div>
      <div class="alert alert-info" id="exam-notice">${exam.questions.length}টি প্রশ্ন · সময় ${bn(exam.duration || 30)} মিনিট। সময় শেষ হলে উত্তরপত্র স্বয়ংক্রিয়ভাবে জমা হয়ে যাবে।</div>
      <form id="exam-take-form" novalidate>
        <div class="exam-palette" id="exam-palette">
          ${exam.questions.map((_, qi) => `<button type="button" class="exam-dot" data-goto="${qi}" aria-label="প্রশ্ন ${bn(qi + 1)}-এ যান">${bn(qi + 1)}</button>`).join('')}
        </div>
        ${exam.questions.map((q, qi) => `
          <div class="exam-q hcard" data-q="${qi}">
            <div class="h-title">প্রশ্ন ${bn(qi + 1)} / ${bn(total)}</div>
            <p class="exam-q-text">${escapeHtml(q.q)}</p>
            <div class="role-grid" style="grid-template-columns:1fr;margin-top:.5rem">
              ${q.options.filter(Boolean).map((opt, oi) => `
                <label class="role-option exam-option">
                  <input type="radio" name="q${qi}" value="${oi}"${String(answers[qi]) === String(oi) ? ' checked' : ''}>
                  <span><b>${'কখগঘ'[oi] || oi + 1}.</b> ${escapeHtml(opt)}</span>
                </label>`).join('')}
            </div>
          </div>`).join('')}
        <div class="exam-submit-zone">
          <button type="submit" class="btn btn-block" id="exam-submit">উত্তরপত্র জমা দিন</button>
        </div>
      </form>`;

    const form = player.querySelector('#exam-take-form');
    const timerEl = player.querySelector('#exam-timer');

    const paintProgress = () => {
      const answered = form.querySelectorAll('input[type="radio"]:checked').length;
      const fill = player.querySelector('#exam-bar-fill');
      if (fill) fill.style.width = `${Math.round((answered / total) * 100)}%`;
      const count = player.querySelector('#exam-count');
      if (count) count.textContent = `উত্তর ${bn(answered)} / ${bn(total)}`;
      player.querySelectorAll('.exam-dot').forEach((dot) => {
        const qi = Number(dot.dataset.goto);
        const chosen = form.querySelector(`input[name="q${qi}"]:checked`);
        dot.classList.toggle('done', Boolean(chosen));
      });
    };

    /** A palette dot scrolls straight to its question on the one-page paper. */
    const goTo = (index) => {
      const target = player.querySelector(`.exam-q[data-q="${Math.max(0, Math.min(total - 1, index))}"]`);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    };

    const persist = () => {
      const snapshot = {};
      exam.questions.forEach((_, qi) => {
        const chosen = form.querySelector(`input[name="q${qi}"]:checked`);
        if (chosen) snapshot[qi] = chosen.value;
      });
      saveSession(examId, { deadline, answers: snapshot, startedAt: saved?.startedAt || Date.now() });
    };

    form.addEventListener('change', () => { persist(); paintProgress(); });

    // Palette dots are jumps, never submits: explicit type="button" controls
    // whose clicks stay inside the paper.
    player.querySelectorAll('.exam-dot[data-goto]').forEach((dot) => {
      dot.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(Number(dot.dataset.goto));
      });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // A paper is graded and stored locally either way, so an offline student
      // is never blocked: the result is queued and mirrored when the net is back.
      submit(false);
    });

    /** Grades the paper, stores the result and shows the review. */
    const submit = (auto) => {
      if (!onScreen) return;
      stopTimer();
      stopWatching();
      onScreen = false;
      const chosen = {};
      exam.questions.forEach((_, qi) => {
        const input = form.querySelector(`input[name="q${qi}"]:checked`);
        chosen[qi] = input ? input.value : null;
      });
      const { score, total: max } = scoreExam(exam, chosen);
      const offline = navigator.onLine === false;
      recordStudyActivity('mcq', exam.questions.length); // feeds streak + achievements
      if (!examResultFor(examId, student.id)) {
        db.examResults.add({
          id: newId('res'), examId, studentId: student.id, studentName: student.name,
          score, total: max, date: todayBn(), autoSubmitted: Boolean(auto),
          // Offline papers wait for the network instead of being refused.
          pendingSync: offline,
          // Kept so the paper can be reviewed later — by the student, and by
          // the teacher who wants to see which questions went wrong.
          answers: exam.questions.map((_, qi) => (chosen[qi] === null || chosen[qi] === '' ? null : Number(chosen[qi])))
        });
      }
      clearSession(examId);
      const pct = max ? Math.round((score / max) * 100) : 0;
      const answered = Object.values(chosen).filter((v) => v !== null && v !== '').length;
      player.innerHTML = `
        <div class="hcard exam-result" style="text-align:center">
          <div class="h-title" style="justify-content:center">${auto ? '⏰ সময় শেষ — স্বয়ংক্রিয়ভাবে জমা হয়েছে' : '✅ উত্তরপত্র জমা হয়েছে'}</div>
          <div class="exam-score">${bn(score)}/${bn(max)}</div>
          <div class="exam-pct">${bn(pct)}%</div>
          <p>${pct >= 80 ? 'চমৎকার! 🎉' : pct >= 50 ? 'ভালো করেছেন।' : 'আরো অনুশীলন দরকার।'}</p>
          <div class="info-row"><span class="l">সঠিক</span><span class="v">${bn(score)}</span></div>
          <div class="info-row"><span class="l">ভুল</span><span class="v">${bn(answered - score)}</span></div>
          <div class="info-row"><span class="l">উত্তর দেননি</span><span class="v">${bn(max - answered)}</span></div>
          <div class="info-row"><span class="l">সময় লেগেছে</span><span class="v">${bn(Math.max(1, Math.round((Date.now() - (deadline - durationMs(exam))) / 60000)))} মিনিট</span></div>
        </div>
        ${offline ? '<div class="alert alert-warning">📶 অফলাইনে জমা হয়েছে — এই ডিভাইসে সংরক্ষিত আছে। ইন্টারনেট ফিরলে স্বয়ংক্রিয়ভাবে সিঙ্ক হয়ে যাবে।</div>' : ''}
        <details class="mini-details" open>
          <summary>📝 সঠিক উত্তর দেখুন</summary>
          <div class="mini-body">${reviewHtml(exam, chosen)}</div>
        </details>
        <button type="button" class="btn btn-block" id="back-to-exams">ফিরে যান</button>`;
      player.querySelector('#back-to-exams').addEventListener('click', () => showList('', 'info'));
      /* A pass deserves confetti; a timed-out paper just gets the calm tone. */
      if (auto) beepTimeUp();
      else if (pct >= 50) confettiBurst(player);
      // Keep the (hidden) exam list in step with the result just stored, so
      // returning to it can never offer the same paper again.
      render();
      showToast(auto ? 'সময় শেষ — উত্তরপত্র জমা হয়েছে।' : `আপনার স্কোর ${bn(score)}/${bn(max)}`, auto ? 'warning' : (pct >= 50 ? 'success' : 'warning'));
    };

    const warned = { five: false, one: false };
    /** Paints the time left as a bar as well as a clock (spec: টাইমার প্রগ্রেস বার). */
    const paintTimeLeft = (left) => {
      const pctLeft = Math.max(0, Math.min(100, (left / durationMs(exam)) * 100));
      const fill = player.querySelector('#exam-time-fill');
      if (fill) fill.style.width = `${pctLeft}%`;
      const bar = player.querySelector('#exam-timebar');
      if (bar) {
        bar.setAttribute('aria-valuenow', String(Math.round(pctLeft)));
        bar.classList.toggle('warn', pctLeft <= 25);
        bar.classList.toggle('danger', pctLeft <= 10);
      }
    };

    const tick = () => {
      const left = deadline - Date.now();
      if (left <= 0) {
        paintTimeLeft(0);
        timerEl.textContent = '⏱ ০০:০০';
        submit(true);                 // time up → auto submit
        return;
      }
      const totalSec = Math.floor(left / 1000);
      const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      timerEl.textContent = `⏱ ${bn(mins)}:${bn(secs)}`;
      timerEl.classList.toggle('warn', left <= 60000);
      timerEl.classList.toggle('danger', left <= 30000);
      paintTimeLeft(left);
      // Warn once on the way down — by toast AND by a soft beep (Settings →
      // সাউন্ড can silence the beep) — so the ending is never a surprise.
      if (!warned.five && left <= 300000) { warned.five = true; showToast('⏰ আর ৫ মিনিট বাকি।', 'info'); beepWarn5(); }
      if (!warned.one && left <= 60000) { warned.one = true; showToast('⏰ আর ১ মিনিট বাকি — উত্তরপত্র জমা দিন।', 'warning'); beepWarn1(); }
    };

    /* A background tab throttles timers, so on coming back the clock is
       re-checked at once — the paper still ends exactly on its deadline. */
    const onVisible = () => { if (!document.hidden && onScreen) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    const stopWatching = () => document.removeEventListener('visibilitychange', onVisible);

    // Answers already given (after a reload) are restored, then the countdown
    // resumes from the original deadline.
    persist();
    paintProgress();
    stopTimer();
    tick();
    ticker = setInterval(tick, 1000);
    ticker?.unref?.();   // Node/jsdom: a pending timer must never hold the process
  }

  function takeExam(examId) {
    if (!db.exams.find(examId)) return;
    startExam(examId);
  }

  render();
  // The home's "পরীক্ষা শুরু করুন" uses this to open the paper straight away.
  render.start = (examId) => {
    const exams = examsFor(student.className);
    const target = examId || exams.find((e) => examWindow(e)?.canStart && !examResultFor(e.id, student.id))?.id;
    if (target) takeExam(target);
  };
  render.stop = stopTimer;
  // The Result view can open a past paper's review through this.
  render.review = (examId) => showReview(examId);
  return render;
}
