/**
 * Shared authoring + taking UI for online suggestions and MCQ exams.
 * Teachers and admins author (js/exams.js is mounted on both pages);
 * students take exams and read suggestions (mountExamTaker / suggestion list).
 */

import { db, CLASS_OPTIONS, ALL_CLASSES, todayBn, newId, scoreExam, examResultFor, suggestionsFor, examsFor } from './data.js';
import { escapeHtml, openModal, closeModal, showToast } from './app.js';

export function classOptionsHtml(selected = ALL_CLASSES, { allowAll = true } = {}) {
  const opts = allowAll ? [ALL_CLASSES, ...CLASS_OPTIONS] : [...CLASS_OPTIONS];
  return opts.map((c) => `<option${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}

/* ------------------------------------------------------------------ */
/* Suggestions (authoring, used by teacher + admin)                    */
/* ------------------------------------------------------------------ */
export function mountSuggestionAuthoring({ author }) {
  const list = document.getElementById('suggestion-list');
  const render = () => {
    const rows = db.suggestions.list();
    list.innerHTML = rows.length
      ? rows.map((s) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(s.title)}</div>
            <div class="li-sub">${escapeHtml(s.className)} · ${escapeHtml(s.subject)} · ${escapeHtml(s.author)} · ${escapeHtml(s.date)}</div>
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
    const item = db.suggestions.find(id);
    if (window.confirm(`"${item?.title}" মুছে ফেলবেন?`)) {
      db.suggestions.remove(id);
      showToast('সাজেশন মুছে ফেলা হয়েছে।', 'warning');
      render();
    }
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
    db.suggestions.add({
      id: newId('sug'), title, content,
      className: String(d.get('className')),
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
export function mountExamAuthoring() {
  const list = document.getElementById('exam-list');
  let staged = [];

  const renderStaged = () => {
    const host = document.getElementById('exam-staged');
    host.innerHTML = staged.length
      ? staged.map((q, i) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${i + 1}. ${escapeHtml(q.q)}</div>
            <div class="li-sub">সঠিক উত্তর: ${escapeHtml(q.options[q.answer])}</div>
          </div>
          <button type="button" class="btn btn-small btn-error" data-unstage="${i}">বাদ</button>
        </div>`).join('')
      : '<div class="empty-state">এখনো প্রশ্ন যোগ করা হয়নি।</div>';
  };

  const render = () => {
    const rows = db.exams.list();
    list.innerHTML = rows.length
      ? rows.map((exam) => {
        const taken = db.examResults.list().filter((r) => r.examId === exam.id).length;
        return `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(exam.title)}</div>
            <div class="li-sub">${escapeHtml(exam.className)} · ${escapeHtml(exam.subject)} · ${exam.questions.length}টি প্রশ্ন · ${taken} জন দিয়েছে · ${escapeHtml(exam.author)}</div>
          </div>
          <span class="row-actions">
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
    if (del) {
      const id = del.dataset.deleteExam;
      const exam = db.exams.find(id);
      if (window.confirm(`"${exam?.title}" মুছে ফেলবেন?`)) {
        db.exams.remove(id);
        showToast('পরীক্ষা মুছে ফেলা হয়েছে।', 'warning');
        render();
      }
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
    renderStaged();
    openModal('exam-modal');
  });

  document.getElementById('add-question').addEventListener('click', () => {
    const q = document.getElementById('q-text').value.trim();
    const options = [0, 1, 2, 3].map((i) => document.getElementById(`q-opt${i}`).value.trim());
    const answer = Number(document.getElementById('q-answer').value);
    if (!q) { showToast('প্রশ্ন লিখুন।', 'error'); return; }
    if (options.some((o) => !o)) { showToast('চারটি অপশনই পূরণ করুন।', 'error'); return; }
    staged.push({ q, options, answer });
    document.getElementById('q-text').value = '';
    [0, 1, 2, 3].forEach((i) => { document.getElementById(`q-opt${i}`).value = ''; });
    renderStaged();
  });

  document.getElementById('exam-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    const title = String(d.get('title') || '').trim();
    if (!title) { showToast('পরীক্ষার শিরোনাম দিন।', 'error'); return; }
    if (!staged.length) { showToast('কমপক্ষে একটি প্রশ্ন যোগ করুন।', 'error'); return; }
    db.exams.add({
      id: newId('exam'), title,
      className: String(d.get('className')),
      subject: String(d.get('subject') || '').trim(),
      author: window.__examAuthor || '', date: todayBn(),
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
      ? `<h3>${escapeHtml(exam.title)}</h3>` + results.map((r) => `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(r.studentName)}</div>
            <div class="li-sub">${escapeHtml(r.studentId)} · ${escapeHtml(r.date)}</div>
          </div>
          <span class="badge ${r.score / r.total >= 0.5 ? 'success' : 'warning'}">${r.score}/${r.total}</span>
        </div>`).join('')
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
        <p>${escapeHtml(s.subject)} · ${escapeHtml(s.author)} · ${escapeHtml(s.date)}</p>
        <p style="white-space:pre-wrap;margin-top:.5rem;color:var(--text-light)">${escapeHtml(s.content)}</p>
      </div>`).join('')
    : '<div class="empty-state">আপনার ক্লাসের কোনো সাজেশন নেই।</div>';
}

export function mountExamTaker({ listSelector, student }) {
  const list = document.querySelector(listSelector);

  const render = () => {
    const rows = examsFor(student.className);
    list.innerHTML = rows.length
      ? rows.map((exam) => {
        const done = examResultFor(exam.id, student.id);
        return `
        <div class="list-item">
          <div class="li-main">
            <div class="li-title">${escapeHtml(exam.title)}</div>
            <div class="li-sub">${escapeHtml(exam.subject)} · ${exam.questions.length}টি প্রশ্ন · ${escapeHtml(exam.author)}</div>
          </div>
          ${done
            ? `<span class="badge ${done.score / done.total >= 0.5 ? 'success' : 'warning'}">${done.score}/${done.total}</span>`
            : `<button type="button" class="btn btn-small" data-take="${escapeHtml(exam.id)}">শুরু করুন</button>`}
        </div>`;
      }).join('')
      : '<div class="empty-state">আপনার ক্লাসের কোনো পরীক্ষা নেই।</div>';
  };

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-take]');
    if (!btn) return;
    takeExam(btn.dataset.take);
  });

  function takeExam(examId) {
    const exam = db.exams.find(examId);
    if (!exam) return;
    const player = document.getElementById('exam-player');
    player.hidden = false;
    list.hidden = true;
    player.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(exam.title)}</h3>
        <p>${escapeHtml(exam.subject)} · ${exam.questions.length}টি প্রশ্ন</p>
      </div>
      <form id="exam-take-form">
        ${exam.questions.map((q, qi) => `
          <div class="card">
            <h3>${qi + 1}. ${escapeHtml(q.q)}</h3>
            <div class="role-grid" style="grid-template-columns:1fr 1fr;margin-top:.5rem">
              ${q.options.map((opt, oi) => `
                <label class="role-option">
                  <input type="radio" name="q${qi}" value="${oi}" required>
                  <span>${escapeHtml(opt)}</span>
                </label>`).join('')}
            </div>
          </div>`).join('')}
        <button type="submit" class="btn btn-block">জমা দিন</button>
      </form>`;

    document.getElementById('exam-take-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      const answers = {};
      exam.questions.forEach((_, qi) => { answers[qi] = d.get(`q${qi}`); });
      const { score, total } = scoreExam(exam, answers);
      db.examResults.add({
        id: newId('res'), examId, studentId: student.id, studentName: student.name,
        score, total, date: todayBn()
      });
      player.innerHTML = `
        <div class="card" style="text-align:center">
          <h3>ফলাফল</h3>
          <div class="stat-value ${score / total >= 0.5 ? 'success' : 'warning'}" style="font-size:2rem;margin:.5rem 0">${score}/${total}</div>
          <p>${score / total >= 0.8 ? 'চমৎকার! 🎉' : score / total >= 0.5 ? 'ভালো করেছেন।' : 'আরো অনুশীলন দরকার।'}</p>
          <button type="button" class="btn btn-secondary" id="back-to-exams" style="margin-top:1rem">ফিরে যান</button>
        </div>`;
      document.getElementById('back-to-exams').addEventListener('click', () => {
        player.hidden = true;
        list.hidden = false;
        render();
      });
      showToast(`আপনার স্কোর ${score}/${total}`, score / total >= 0.5 ? 'success' : 'warning');
    });
  }

  render();
}
