/**
 * Admin Panel boot module — the complete wiring of admin.html.
 *
 * This file is the extracted inline module script that used to live inside
 * admin.html. The page now keeps only a tiny inline importer; everything runs
 * from here so the panel can be maintained as real modules (Admin Panel v2
 * restructure). Semantics are unchanged: bootAdminPanel() executes the exact
 * same sequence the inline script did, including the top-level
 * `await seedUsers()` (hence the async function).
 */
      import { initApp, activeTabs, renderTable, statGrid, escapeHtml, openModal, closeModal, showToast, getAuthMode, requireOnline } from '../app.js';
      import { mountCrud } from '../crud.js';
      import { initAdminHome } from '../admin-home.js';
      import { mountInstallButton } from '../install.js';
      import { registerOverlay, noteOverlayOpened, noteOverlayClosed } from '../back-button.js';
      import { seedUsers } from '../auth.js';
      import { db, CLASS_OPTIONS, todayBn, newId, ALL_CLASSES, studentsOfClass, dueFees, dueRemaining, dueMonthKey, sharedNotices, receivePayment, receiveStudentPayments, adminAlerts, homeCards, setHomeCards, setHomeFeatures, performanceFor, getDbStatus, nextStudentId, nextTeacherId, nextReceiptNo, orgInfo, saveOrgInfo, assertCan, formatBnDate, parseBnDateInput, toAsciiDate, formatBnDateTime } from '../data.js';
      import { mountSuggestionAuthoring, mountExamAuthoring, setExamAuthor, classOptionsHtml } from '../exams.js';
      import { mountExtraAdmin } from '../admin-modules.js';
      import { shareReceiptAsImage, renderReceiptCanvas, receiptPreviewDoc, renderIdCardCanvas, renderLedgerCanvases, renderAdmissionFormCanvases, receiptPdfFileName } from '../docs.js';
      import { previewDocument, mountDocumentPreview } from '../preview.js';
      import { canvasesToPdf } from '../pdf.js';
      // Admin Panel v2 components: grouped sidebar, global search,
      // scheduled auto-backup and one-tap CSV exports.
      import { mountAdminSidebar } from './layout.js';
      import { mountGlobalSearch } from './search.js';
      import { mountAutoBackup } from './autobackup.js';
      import { mountAdminExports } from './export-csv.js';
      import { mountStudentAppControl } from './student-app.js';

export async function bootAdminPanel() {

      const session = initApp({ roles: ['admin'] });
      if (!session) throw new Error('guard redirect');

      const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

      /* ------------------------------------------------------------ */
      /* WhatsApp: share the admission info (with the unique ID) to    */
      /* the guardian's number. Uses the wa.me deep link, so no API    */
      /* key or backend is needed — it just opens the chat pre-filled. */
      /* ------------------------------------------------------------ */
      const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
      const waToEn = (s) => String(s || '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
      const waNumber = (phone) => {
        const digits = waToEn(phone).replace(/[^\d]/g, '');
        if (!digits) return '';
        if (digits.startsWith('880')) return digits;
        if (digits.startsWith('0')) return '880' + digits.slice(1);
        if (digits.length === 10) return '880' + digits;
        return digits;
      };
      const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
      const admissionMessage = (st) => {
        const s = db.settings.get();
        const org = s.orgName || 'Active Plus';
        const lines = [
          `প্রিয় অভিভাবক,`,
          ``,
          `${org}-এ আপনার সন্তানের ভর্তি সম্পন্ন হয়েছে।`,
          ``,
          `👤 নাম: ${st.name}`,
          `🆔 স্টুডেন্ট আইডি: ${st.id}`,
          `📚 শ্রেণি: ${st.className || '—'}${st.section ? ` (শাখা ${st.section})` : ''}${st.roll ? ` · রোল: ${st.roll}` : ''}`,
        ];
        if (st.school) lines.push(`🏫 স্কুল/কলেজ: ${st.school}`);
        if (st.guardian) lines.push(`👨‍👩‍👧 অভিভাবক: ${st.guardian}`);
        if (st.admissionDate) lines.push(`📅 ভর্তির তারিখ: ${formatBnDate(st.admissionDate)}`);
        lines.push(``, `ধন্যবাদ।`);
        return lines.join('\n');
      };
      const openWhatsApp = (st) => {
        const phone = st.guardianPhone || st.phone; // the message is for the guardian
        if (!waNumber(phone)) { showToast('মোবাইল নম্বর পাওয়া যায়নি।', 'error'); return; }
        const url = waLink(phone, admissionMessage(st));
        window.open(url, '_blank', 'noopener');
      };

      // Spec 51: never report a saved record that could not be saved.
      const onlineFor = (action) => requireOnline(action, getDbStatus);

      /* ------------------------------------------------------------ */
      /* Report letterhead: logo + organisation identity for every      */
      /* print. Hidden on screen; shown when printing/exporting a PDF.  */
      /* It always carries the institute profile written in Settings:   */
      /* name, address and the "mobile · email" contact line.           */
      /* ------------------------------------------------------------ */
      const ensurePrintHeader = () => {
        const org = orgInfo();
        const orgEl = document.getElementById('ph-org');
        const addrEl = document.getElementById('ph-addr');
        const contactEl = document.getElementById('ph-contact');
        const logoEl = document.querySelector('.print-header img');
        const dateEl = document.getElementById('ph-date');
        if (orgEl) orgEl.textContent = org.name;
        if (addrEl) addrEl.textContent = org.address;
        if (contactEl) contactEl.textContent = org.contactLine;
        if (logoEl) logoEl.src = org.orgLogo || 'assets/logo.png';
        // Every printed sheet carries the Bengali long date (১৬ সেপ্টেম্বর ২০২৬).
        if (dateEl) dateEl.textContent = formatBnDate(todayBn());
      };

      /* ------------------------------------------------------------ */
      /* Icon-based Top Bar: the centre shows the institution logo and  */
      /* name from Settings; the admin identity sits underneath and in */
      /* the profile menu. Display-only — data and logic are untouched. */
      /* ------------------------------------------------------------ */
      const syncTopbar = () => {
        const s = db.settings.get();
        const org = orgInfo();
        const logo = document.getElementById('topbar-logo');
        if (logo) logo.src = s.orgLogo || org.orgLogo || 'assets/logo.png';
        const nameEl = document.getElementById('user-name');
        const roleEl = document.getElementById('user-role');
        if (nameEl) nameEl.textContent = org.name || 'Active Plus';
        if (roleEl) roleEl.textContent = session?.name ? `${session.name} · অ্যাডমিন` : 'অ্যাডমিন প্যানেল';
        const pmName = document.getElementById('pm-name');
        const pmDetail = document.getElementById('pm-detail');
        if (pmName) pmName.textContent = session?.name || 'অ্যাডমিন';
        if (pmDetail) pmDetail.textContent = session?.detail ? `অ্যাডমিন · ${session.detail}` : 'অ্যাডমিন';
      };

      /* ------------------------------------------------------------ */
      /* Dashboard                                                     */
      /* ------------------------------------------------------------ */
      const renderOverview = () => {
        ensurePrintHeader();
        const students = db.students.list();
        const teachers = db.teachers.list();
        const batches = db.batches.list();
        const settings = db.settings.get();
        const batchStudents = batches.reduce((sum, b) => sum + Number(b.students || 0), 0);
        const totalStudents = students.length + batchStudents;
        const fees = db.fees.list();
        const dueCount = dueFees().length;
        const collected = fees.filter((f) => f.status === 'পরিশোধিত').reduce((s, f) => s + Number(f.amount || 0), 0);
        const expected = fees.reduce((s, f) => s + Number(f.amount || 0), 0) + batchStudents * settings.monthlyFee;

        statGrid('#admin-stats', [
          { label: 'মোট শিক্ষার্থী', value: bn(totalStudents), tone: 'accent' },
          { label: 'শিক্ষক', value: bn(teachers.length) },
          { label: 'ব্যাচ', value: bn(batches.length), tone: 'success' },
          { label: 'বকেয়া', value: dueCount ? `${bn(dueCount)} জন` : 'নেই', tone: dueCount ? 'warning' : 'success' }
        ]);

        document.getElementById('income-summary').textContent =
          `সংগৃহীত ৳${bn(collected.toLocaleString('en-US'))} / প্রত্যাশিত ৳${bn(expected.toLocaleString('en-US'))}`;
        document.getElementById('income-bar').style.width = `${expected ? Math.min(100, Math.round((collected / expected) * 100)) : 0}%`;
        // Newest shared notice: personal payment receipts never belong here.
        document.getElementById('latest-notice').textContent = sharedNotices().slice(-1)[0]?.title || '—';
        document.getElementById('student-count').textContent = bn(students.length);
        refreshAdminBell();
      };

      /* ------------------------------------------------------------ */
      /* Students CRUD                                                 */
      /* ------------------------------------------------------------ */
      const classFilter = document.getElementById('class-filter');
      classFilter.innerHTML = classOptionsHtml(ALL_CLASSES);

      /* Student list quick search (দ্রুত সার্চ ও ফিল্টার): name, id, phone,
         guardian, school or roll — combined with the class filter and a sort.
         The global top-bar search pre-fills this input to isolate one student. */
      const studentSearch = document.getElementById('student-search');
      const studentSort = document.getElementById('student-sort');
      const searchClear = document.getElementById('student-search-clear');
      const studentSummary = document.getElementById('student-summary');

      // Admission dates are stored in the canonical Bengali ISO shape, so a
      // plain string compare orders them correctly newest-first.
      const STUDENT_SORTS = {
        name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
        id: (a, b) => String(a.id || '').localeCompare(String(b.id || '')),
        class: (a, b) => String(a.className || '').localeCompare(String(b.className || ''))
          || String(a.roll || '').localeCompare(String(b.roll || '')),
        newest: (a, b) => String(b.admissionDate || '').localeCompare(String(a.admissionDate || ''))
      };

      const toAsciiDigits = (value) => String(value).replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
      const telHref = (value) => {
        const digits = toAsciiDigits(value || '').replace(/[^\d+]/g, '');
        return digits.length >= 6 ? `tel:${digits}` : '';
      };
      // A name may open with a consonant + matra (কো, সু…), so the initial is
      // taken as one grapheme, not one code unit; charAt(0) would print "ক".
      const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('bn', { granularity: 'grapheme' })
        : null;
      const initialOf = (name) => {
        const value = String(name || '').trim();
        if (!value) return '·';
        const first = graphemes ? graphemes.segment(value)[Symbol.iterator]().next().value?.segment : value.charAt(0);
        return first || '·';
      };

      const studentColumns = () => [
        {
          key: 'name', label: 'শিক্ষার্থী',
          render: (row) => {
            const sub = [row.roll ? `রোল ${row.roll}` : '', row.section || ''].filter(Boolean).join(' · ');
            return `<span class="cell-student">
              <span class="cell-avatar" aria-hidden="true">${escapeHtml(initialOf(row.name))}</span>
              <span class="cell-student-text">
                <span class="cell-student-name">${escapeHtml(row.name || '—')}</span>
                ${sub ? `<span class="cell-student-sub">${escapeHtml(sub)}</span>` : ''}
              </span>
            </span>`;
          }
        },
        { key: 'id', label: 'আইডি', render: (row) => `<span class="cell-id">${escapeHtml(row.id)}</span>` },
        { key: 'className', label: 'শ্রেণি', render: (row) => `<span class="badge accent">${escapeHtml(row.className || '—')}</span>` },
        { key: 'school', label: 'স্কুল / কলেজ', render: (row) => escapeHtml(row.school || '—') },
        {
          key: 'phone', label: 'মোবাইল',
          render: (row) => {
            const href = telHref(row.phone);
            const label = escapeHtml(row.phone || '—');
            return href ? `<a class="cell-tel" href="${href}">${label}</a>` : label;
          }
        },
        { key: 'status', label: 'অবস্থা', render: (row) => `<span class="badge ${row.status === 'সক্রিয়' ? 'success' : 'warning'}">${escapeHtml(row.status)}</span>` },
        // Icon-only so the row stops forcing the whole table into a
        // horizontal scroll; the aria-label names the student for readers.
        {
          key: '_actions', label: 'অ্যাকশন',
          render: (row) => {
            const who = escapeHtml(row.name || row.id);
            return `<span class="row-actions">
              <button type="button" class="btn-icon" data-profile-student="${escapeHtml(row.id)}" title="প্রোফাইল" aria-label="${who} — প্রোফাইল">👤</button>
              <button type="button" class="btn-icon is-wa" data-wa-student="${escapeHtml(row.id)}" title="হোয়াটসঅ্যাপ" aria-label="${who} — হোয়াটসঅ্যাপ">💬</button>
              <button type="button" class="btn-icon" data-edit-student="${escapeHtml(row.id)}" title="সম্পাদনা" aria-label="${who} — সম্পাদনা">✎</button>
              <button type="button" class="btn-icon is-danger" data-delete-student="${escapeHtml(row.id)}" title="মুছুন" aria-label="${who} — মুছুন">🗑</button>
            </span>`;
          }
        }
      ];

      const renderStudents = () => {
        const query = (studentSearch?.value || '').trim().toLowerCase();
        const classValue = classFilter.value || ALL_CLASSES;
        const scope = studentsOfClass(classValue);
        const rows = (query
          ? scope.filter((s) => [s.name, s.id, s.phone, s.guardian, s.school, s.roll]
            .some((value) => String(value ?? '').toLowerCase().includes(query)))
          : scope.slice()
        ).sort(STUDENT_SORTS[studentSort?.value] || STUDENT_SORTS.name);

        const filtering = Boolean(query) || classValue !== ALL_CLASSES;
        renderTable('#student-table', studentColumns(), rows,
          filtering
            ? 'এই ফিল্টারে কোনো শিক্ষার্থী নেই — সার্চ বা ক্লাস বদলে দেখুন।'
            : 'এখনো কোনো শিক্ষার্থী ভর্তি হয়নি।');

        // The count span lives inside the summary line, so the whole line is
        // rebuilt at once — setting textContent on the parent would destroy the
        // span that renderOverview() also writes.
        if (studentSummary) {
          const suffix = classValue !== ALL_CLASSES ? ` · ${escapeHtml(classValue)}` : '';
          studentSummary.innerHTML = query
            ? `<span id="student-count">${bn(rows.length)}</span> / ${bn(scope.length)} জন মিলেছে${suffix}`
            : `<span id="student-count">${bn(rows.length)}</span> জন শিক্ষার্থী${suffix}`;
        } else {
          document.getElementById('student-count').textContent = bn(rows.length);
        }
      };

      classFilter.addEventListener('change', renderStudents);
      studentSort?.addEventListener('change', renderStudents);
      // Repainting the whole roster on every keystroke is what made the list
      // feel laggy while typing — wait for a pause, like the CRUD engine does.
      let studentSearchTimer = null;
      studentSearch?.addEventListener('input', () => {
        if (searchClear) searchClear.hidden = !studentSearch.value;
        clearTimeout(studentSearchTimer);
        studentSearchTimer = setTimeout(renderStudents, 160);
      });
      searchClear?.addEventListener('click', () => {
        studentSearch.value = '';
        searchClear.hidden = true;
        studentSearch.focus();
        renderStudents();
      });

      const studentForm = document.getElementById('student-form');
      const classSelect = document.getElementById('student-class');
      classSelect.innerHTML = CLASS_OPTIONS.map((c) => `<option>${c}</option>`).join('');

      // The native date picker stays (it is the fastest way on a phone), but
      // the chosen date is echoed back in the app's Bengali long format.
      const admissionInput = document.getElementById('student-admission');
      const admissionHint = document.getElementById('student-admission-hint');
      const paintAdmissionHint = () => {
        if (!admissionHint || !admissionInput) return;
        const pretty = formatBnDate(admissionInput.value);
        admissionHint.textContent = pretty
          ? `নির্বাচিত তারিখ: ${pretty}`
          : 'তারিখ এভাবে দেখানো হবে: ১৬ সেপ্টেম্বর ২০২৬';
      };
      admissionInput?.addEventListener('change', paintAdmissionHint);
      admissionInput?.addEventListener('input', paintAdmissionHint);

      const openStudentModal = (editId = null) => {
        studentForm.reset();
        document.getElementById('student-edit-id').value = '';
        if (editId) {
          const student = db.students.find(editId);
          if (!student) return;
          document.getElementById('student-modal-title').textContent = 'শিক্ষার্থী সম্পাদনা';
          document.getElementById('student-save').textContent = 'আপডেট করুন';
          document.getElementById('student-id-hint').textContent = `আইডি: ${student.id}`;
          document.getElementById('student-edit-id').value = student.id;
          studentForm.elements.name.value = student.name || '';
          studentForm.elements.school.value = student.school || '';
          studentForm.elements.className.value = student.className || 'নবম';
          studentForm.elements.roll.value = parseInt(student.roll, 10) || 1;
          studentForm.elements.phone.value = student.phone || '';
          studentForm.elements.section.value = student.section || '';
          studentForm.elements.batch.value = student.batch || '';
          studentForm.elements.guardian.value = student.guardian || '';
          studentForm.elements.guardianPhone.value = student.guardianPhone || '';
          studentForm.elements.admissionDate.value = toAsciiDate(student.admissionDate);
          studentForm.elements.photo.value = student.photo || '';
          studentForm.elements.status.value = student.status || 'সক্রিয়';
        } else {
          document.getElementById('student-modal-title').textContent = 'নতুন শিক্ষার্থী ভর্তি';
          document.getElementById('student-save').textContent = 'ভর্তি করুন';
          document.getElementById('student-id-hint').textContent = 'স্টুডেন্ট আইডি স্বয়ংক্রিয়ভাবে তৈরি হবে (বছর-শ্রেণি-ক্রম)· যেমন: ২০২৬ সালে নবম শ্রেণির প্রথম ভর্তি = 2609001';
        }
        paintAdmissionHint();
        openModal('student-modal');
      };

      document.getElementById('open-student-modal').addEventListener('click', () => openStudentModal());

      studentForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!onlineFor('শিক্ষার্থী সংরক্ষণ')) return;
        const data = new FormData(studentForm);
        const editId = String(data.get('editId') || '');
        const className = String(data.get('className'));
        const record = {
          name: String(data.get('name') || '').trim(),
          school: String(data.get('school') || '').trim(),
          className,
          section: String(data.get('section') || '').trim(),
          batch: String(data.get('batch') || '').trim(),
          guardian: String(data.get('guardian') || '').trim(),
          guardianPhone: String(data.get('guardianPhone') || '').trim(),
          admissionDate: parseBnDateInput(data.get('admissionDate')),
          photo: String(data.get('photo') || '').trim(),
          roll: String(data.get('roll')),
          phone: String(data.get('phone') || '').trim(), // never store a dash as a phone number
          status: String(data.get('status'))
        };
        if (!record.name) { showToast('শিক্ষার্থীর নাম আবশ্যক।', 'error'); return; }

        if (editId) {
          db.students.update(editId, record);
          showToast('শিক্ষার্থীর তথ্য আপডেট হয়েছে।', 'success');
          closeModal('student-modal');
          renderStudents();
          renderOverview();
        } else {
          const id = nextStudentId({ year: new Date().getFullYear(), className });
          // Unique ID is mandatory and must never collide with an existing one.
          if (!id) { showToast('শিক্ষার্থীর Unique ID আবশ্যক।', 'error'); return; }
          if (db.students.find(id)) {
            showToast('এই Unique ID ইতোমধ্যে অন্য একজন শিক্ষার্থীর জন্য ব্যবহৃত হয়েছে।', 'error');
            return;
          }
          const saved = { id, ...record };
          db.students.add(saved);
          closeModal('student-modal');
          renderStudents();
          renderOverview();
          showAdmissionDone(saved); // confirm + WhatsApp send with the unique ID
        }
      });

      /* -------- Admission done modal: confirm + WhatsApp share -------- */
      let admissionStudentId = null;
      const showAdmissionDone = (student) => {
        admissionStudentId = student.id;
        const s = db.settings.get();
        const info = (label, value) => `<div class="list-item"><div class="li-main"><div class="li-sub">${escapeHtml(label)}</div><div class="li-title">${escapeHtml(String(value ?? '—'))}</div></div></div>`;
        document.getElementById('admission-summary').innerHTML = `
          <div class="list-item"><div class="li-main"><div class="li-title">${escapeHtml(s.orgName || 'Active Plus')}</div><div class="li-sub">ভর্তি নিশ্চিতকরণ</div></div></div>
          ${info('নাম', student.name)}
          ${info('স্টুডেন্ট আইডি', student.id)}
          ${info('শ্রেণি', `${student.className || '—'}${student.section ? ` · ${student.section}` : ''}${student.roll ? ` · রোল ${student.roll}` : ''}`)}
          ${student.school ? info('স্কুল/কলেজ', student.school) : ''}
          ${student.guardian ? info('অভিভাবক', student.guardian) : ''}
          ${info('অভিভাবকের মোবাইল', student.guardianPhone || student.phone || '—')}`;
        openModal('admission-modal');
      };
      document.getElementById('admission-wa')?.addEventListener('click', () => {
        const st = db.students.find(admissionStudentId);
        if (st) openWhatsApp(st);
      });
      document.getElementById('admission-close')?.addEventListener('click', () => closeModal('admission-modal'));

      /* -------- Printable Admission Form: institution logo + name -------- */
      const fillAdmissionForm = (student) => {
        const s = db.settings.get();
        const logoSrc = s.orgLogo || 'assets/logo.png';
        const contactLine = [s.mobile, s.email, s.website].filter(Boolean).join(' | ');
        const field = (label, value) => `
          <div class="admission-field">
            <div class="af-label">${escapeHtml(label)}</div>
            <div class="af-value">${escapeHtml(String(value ?? '—'))}</div>
          </div>`;
        document.getElementById('admission-form-body').innerHTML = `
          <div class="admission-sheet">
            <div class="af-head">
              <img src="${logoSrc}" alt="" style="width:64px;height:64px;object-fit:contain">
              <div>
                <div class="af-org">${escapeHtml(s.orgName || 'Active Plus')}</div>
                <div class="af-addr">${escapeHtml(s.address || '')}</div>
                <div class="af-addr">${escapeHtml(contactLine)}</div>
                ${s.footerText ? `<div class="af-addr" style="font-style:italic">${escapeHtml(s.footerText)}</div>` : ''}
              </div>
            </div>
            <div class="af-title">ভর্তি ফরম / Admission Form</div>
            <div class="af-grid">
              ${field('শিক্ষার্থীর নাম', student.name)}
              ${field('স্টুডেন্ট আইডি', student.id)}
              ${field('শ্রেণি', student.className || '—')}
              ${field('শাখা (Section)', student.section || '—')}
              ${field('রোল', student.roll || '—')}
              ${field('ব্যাচ', student.batch || '—')}
              ${field('স্কুল / কলেজ', student.school || '—')}
              ${field('অভিভাবকের নাম', student.guardian || '—')}
              ${field('অভিভাবকের মোবাইল', student.guardianPhone || student.phone || '—')}
              ${field('ভর্তির তারিখ', formatBnDate(student.admissionDate) || '—')}
            </div>
            <div class="af-sign">
              <div class="af-sign-col"><div class="af-line"></div><div>অভিভাবকের স্বাক্ষর</div></div>
              <div class="af-sign-col"><div class="af-line"></div><div>প্রতিষ্ঠানের স্বাক্ষর</div></div>
            </div>
          </div>`;
      };
      let admissionFormId = null;
      const openAdmissionForm = (student) => {
        admissionFormId = student.id;
        fillAdmissionForm(student);
        document.body.classList.add('print-admission-form');
        // Only the admission form should print/show — close any other modal
        // (the done confirmation or the profile sheet) that opened it.
        document.querySelectorAll('.modal-overlay.active').forEach((m) => {
          if (m.id !== 'admission-form-modal') closeModal(m.id);
        });
        openModal('admission-form-modal');
      };
      const closeAdmissionForm = () => {
        document.body.classList.remove('print-admission-form');
        closeModal('admission-form-modal');
      };
      document.getElementById('admission-form')?.addEventListener('click', () => {
        const st = db.students.find(admissionStudentId);
        if (st) openAdmissionForm(st);
      });
      document.getElementById('admission-form-close')?.addEventListener('click', closeAdmissionForm);
      document.getElementById('admission-form-pdf')?.addEventListener('click', async () => {
        const st = db.students.find(admissionFormId);
        if (!st) return;
        try {
          const canvases = await renderAdmissionFormCanvases(st, { settings: db.settings.get() });
          await previewDocument({
            title: 'ভর্তি ফরম',
            meta: `${st.name || ''} · ${st.id}`,
            filename: `admission-form-${st.id}.pdf`,
            canvases,
            shareable: canvases.length === 1
          });
        } catch (e) {
          showToast('এডমিশন ফরম তৈরি করা যায়নি।', 'error');
        }
      });

      /* -------- Student profile: ID card, ledger, results (spec 29) -------- */
      let profileStudentId = null;
      const openStudentProfile = (id) => {
        const st = db.students.find(id);
        if (!st) { showToast('শিক্ষার্থী পাওয়া যায়নি।', 'error'); return; }
        profileStudentId = id;
        const settings = db.settings.get();
        const paid = db.payments.list().filter((p) => p.studentId === id);
        const dues = dueFees().filter((d) => d.studentId === id);
        const paidTotal = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
        const dueTotal = dues.reduce((s, d) => s + Number(d.remaining ?? d.amount) || 0, 0);
        const results = db.examResults.list().filter((r) => r.studentId === id);
        const perf = performanceFor(st);
        const row = (label, value) => `<div class="info-row"><span class="l">${escapeHtml(label)}</span><span class="v">${escapeHtml(String(value ?? '—'))}</span></div>`;

        document.getElementById('student-detail-body').innerHTML = `
          <div class="card" data-idcard style="border:2px solid var(--accent);text-align:center">
            <img src="${settings.orgLogo || 'assets/logo.png'}" alt="" class="doc-logo" style="width:56px;height:56px;margin-bottom:.25rem;object-fit:contain">
            <div style="font-size:.75rem;letter-spacing:.06em">${escapeHtml(settings.orgName || 'Active Plus')}</div>
            <div style="font-weight:700;font-size:1.125rem;margin-top:.25rem">${escapeHtml(st.name)}</div>
            <div class="meta">${escapeHtml(st.id)}</div>
            <div class="meta">${escapeHtml(st.className || '')}${st.section ? ` · ${escapeHtml(st.section)}` : ''}${st.roll ? ` · রোল ${escapeHtml(st.roll)}` : ''}</div>
            <div class="meta">${escapeHtml(st.phone || '')}</div>
            <div class="meta">ভর্তি: ${escapeHtml(formatBnDate(st.admissionDate) || '—')}</div>
          </div>

          <h3 style="margin-top:1rem">অভিভাবক তথ্য</h3>
          ${row('অভিভাবক', st.guardian)}${row('অভিভাবকের মোবাইল', st.guardianPhone)}
          ${row('স্কুল / কলেজ', st.school)}${row('ঠিকানা', st.address)}

          <h3 style="margin-top:1rem">ফি লেজার</h3>
          ${row('পরিশোধিত', `৳${bn(paidTotal)}`)}${row('বকেয়া', `৳${bn(dueTotal)}`)}
          ${paid.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>তারিখ</th><th>পরিমাণ</th><th>মাধ্যম</th></tr></thead><tbody>${
            paid.map((p) => `<tr><td>${escapeHtml(formatBnDate(p.date))}</td><td>৳${bn(p.amount || 0)}</td><td>${escapeHtml(p.method || '—')}</td></tr>`).join('')
          }</tbody></table></div>` : '<div class="empty-state">কোনো পেমেন্ট রেকর্ড নেই।</div>'}
          ${dues.length ? `<div class="table-wrap" style="margin-top:.5rem"><table class="table"><thead><tr><th>মাস</th><th>বকেয়া</th></tr></thead><tbody>${
            dues.map((d) => `<tr><td>${escapeHtml(d.month || '')}</td><td>৳${bn(d.amount || 0)}</td></tr>`).join('')
          }</tbody></table></div>` : ''}

          <h3 style="margin-top:1rem">একাডেমিক অগ্রগতি</h3>
          ${perf ? `${row('গড়', perf.avg + '%')}${row('সেরা', perf.best + '%')}${row('টেস্ট', perf.tests)}${row('র‍্যাঙ্ক', '#' + perf.rank)}` : '<p>এখনো কোনো ফলাফল নেই।</p>'}
          ${results.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>পরীক্ষা</th><th>নম্বর</th><th>%</th></tr></thead><tbody>${
            results.map((r) => { const ex = db.exams.find(r.examId); const pc = Math.round(r.score / r.total * 100);
              return `<tr><td>${escapeHtml(ex?.title || r.examId)}</td><td>${escapeHtml(`${r.score}/${r.total}`)}</td><td>${bn(pc)}%</td></tr>`; }).join('')
          }</tbody></table></div>` : ''}`;
        openModal('student-detail-modal');
      };

      document.getElementById('wa-profile')?.addEventListener('click', () => {
        if (!profileStudentId) { showToast('আগে একজন শিক্ষার্থীর প্রোফাইল খুলুন।', 'error'); return; }
        const st = db.students.find(profileStudentId);
        if (st) openWhatsApp(st);
      });
      document.getElementById('admission-form-profile')?.addEventListener('click', () => {
        if (!profileStudentId) { showToast('আগে একজন শিক্ষার্থীর প্রোফাইল খুলুন।', 'error'); return; }
        const st = db.students.find(profileStudentId);
        if (st) openAdmissionForm(st);
      });

      document.getElementById('preview-idcard')?.addEventListener('click', async () => {
        const st = db.students.find(profileStudentId);
        if (!st) { showToast('আগে একজন শিক্ষার্থীর প্রোফাইল খুলুন।', 'error'); return; }
        try {
          const canvas = await renderIdCardCanvas(st, { settings: db.settings.get() });
          await previewDocument({
            title: 'স্টুডেন্ট আইডি কার্ড',
            meta: `${st.name || ''} · ${st.id}`,
            filename: `student-id-card-${st.id}.pdf`,
            canvases: [canvas],
            shareable: true
          });
        } catch (e) {
          showToast('আইডি কার্ড তৈরি করা যায়নি।', 'error');
        }
      });
      document.getElementById('preview-ledger')?.addEventListener('click', async () => {
        const st = db.students.find(profileStudentId);
        if (!st) { showToast('আগে একজন শিক্ষার্থীর প্রোফাইল খুলুন।', 'error'); return; }
        try {
          const canvases = await renderLedgerCanvases(st, { settings: db.settings.get() });
          await previewDocument({
            title: 'ফি লেজার',
            meta: `${st.name || ''} · ${st.id}`,
            filename: `student-ledger-${st.id}.pdf`,
            canvases,
            shareable: canvases.length === 1
          });
        } catch (e) {
          showToast('লেজার তৈরি করা যায়নি।', 'error');
        }
      });

      document.querySelector('#tab-students').addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-edit-student]');
        const delBtn = event.target.closest('[data-delete-student]');
        const profileBtn = event.target.closest('[data-profile-student]');
        const waBtn = event.target.closest('[data-wa-student]');
        if (waBtn) { const st = db.students.find(waBtn.dataset.waStudent); if (st) openWhatsApp(st); return; }
        if (profileBtn) { openStudentProfile(profileBtn.dataset.profileStudent); return; }
        if (editBtn) { openStudentModal(editBtn.dataset.editStudent); return; }
        if (delBtn) {
          const id = delBtn.dataset.deleteStudent;
          if (!onlineFor('শিক্ষার্থী মুছে ফেলা')) return;
          const student = db.students.find(id);
          if (window.confirm(`"${student?.name}" কে মুছে ফেলবেন?`)) {
            db.students.remove(id);
            showToast('শিক্ষার্থী মুছে ফেলা হয়েছে।', 'warning');
            renderStudents();
            renderOverview();
          }
        }
      });

      /* ------------------------------------------------------------ */
      /* Teachers CRUD                                                 */
      /* ------------------------------------------------------------ */
      const renderTeachers = () => {
        renderTable('#teacher-table', [
          { key: 'id', label: 'আইডি', render: (row) => escapeHtml(row.id || '—') },
          { key: 'name', label: 'নাম' },
          { key: 'subject', label: 'বিষয়' },
          { key: 'phone', label: 'মোবাইল' },
          { key: 'classes', label: 'ক্লাস/সপ্তাহ' },
          { key: '_actions', label: 'অ্যাকশন', render: (row) => `
            <span class="row-actions">
              <button type="button" class="btn btn-small btn-secondary" data-edit-teacher="${escapeHtml(row.name)}">সম্পাদনা</button>
              <button type="button" class="btn btn-small btn-error" data-delete-teacher="${escapeHtml(row.name)}">মুছুন</button>
            </span>` }
        ], db.teachers.list());
      };

      const teacherForm = document.getElementById('teacher-form');
      const openTeacherModal = (editName = null) => {
        teacherForm.reset();
        document.getElementById('teacher-edit-name').value = '';
        if (editName) {
          const teacher = db.teachers.find(editName);
          if (!teacher) return;
          document.getElementById('teacher-modal-title').textContent = 'শিক্ষক সম্পাদনা';
          document.getElementById('teacher-save').textContent = 'আপডেট করুন';
          document.getElementById('teacher-edit-name').value = teacher.name;
          teacherForm.elements.name.value = teacher.name || '';
          teacherForm.elements.subject.value = teacher.subject || '';
          teacherForm.elements.classes.value = Number(teacher.classes) || 0;
          teacherForm.elements.phone.value = teacher.phone || '';
        } else {
          document.getElementById('teacher-modal-title').textContent = 'নতুন শিক্ষক';
          document.getElementById('teacher-save').textContent = 'সংরক্ষণ করুন';
        }
        openModal('teacher-modal');
      };

      document.getElementById('open-teacher-modal').addEventListener('click', () => openTeacherModal());

      teacherForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!onlineFor('শিক্ষক সংরক্ষণ')) return;
        const data = new FormData(teacherForm);
        const editName = String(data.get('editName') || '');
        const name = String(data.get('name') || '').trim();
        const subject = String(data.get('subject') || '').trim();
        const classes = Number(data.get('classes')) || 0;
        const phone = String(data.get('phone') || '—').trim();
        if (!name || !subject) { showToast('নাম ও বিষয় দুটোই দিন।', 'error'); return; }
        if (editName) {
          const existing = db.teachers.find(editName);
          // Keep the original id unless the name or mobile changed; fall back to
          // auto-generation if the teacher has no id yet (e.g. seed data).
          const id = (existing?.id && existing.name === name && existing.phone === phone)
            ? existing.id
            : nextTeacherId({ name, phone });
          if (editName !== name && db.teachers.find(name)) { showToast('এই নামে আরেকজন শিক্ষক আছেন।', 'error'); return; }
          db.teachers.remove(editName);
          db.teachers.add({ id, name, subject, classes, phone });
          showToast('শিক্ষকের তথ্য আপডেট হয়েছে।', 'success');
        } else {
          if (db.teachers.find(name)) { showToast('এই নামে শিক্ষক আগে থেকেই আছেন।', 'error'); return; }
          const id = nextTeacherId({ name, phone });
          db.teachers.add({ id, name, subject, classes, phone });
          showToast('শিক্ষক যোগ করা হয়েছে।', 'success');
        }
        closeModal('teacher-modal');
        renderTeachers();
        renderOverview();
      });

      document.querySelector('#tab-teachers').addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-edit-teacher]');
        const delBtn = event.target.closest('[data-delete-teacher]');
        if (editBtn) { openTeacherModal(editBtn.dataset.editTeacher); return; }
        if (delBtn) {
          if (!onlineFor('শিক্ষক মুছে ফেলা')) return;
          const name = delBtn.dataset.deleteTeacher;
          if (window.confirm(`"${name}" কে মুছে ফেলবেন?`)) {
            db.teachers.remove(name);
            showToast('শিক্ষক মুছে ফেলা হয়েছে।', 'warning');
            renderTeachers();
            renderOverview();
          }
        }
      });

      /* ------------------------------------------------------------ */
      /* Notices CRUD                                                  */
      /* ------------------------------------------------------------ */
      const renderNotices = () => {
        const list = db.notices.list();
        document.getElementById('notice-list').innerHTML = list.length
          ? list.map((notice) => `
            <div class="list-item">
              <div class="li-main">
                <div class="li-title">${escapeHtml(notice.title)}</div>
                <div class="li-sub">ক্লাস: ${escapeHtml(notice.className || 'সব')} · ${escapeHtml(formatBnDate(notice.date))} · ${escapeHtml(notice.audience)}</div>
              </div>
              <span class="row-actions">
                <button type="button" class="btn btn-small btn-secondary" data-edit-notice="${escapeHtml(notice.id)}">সম্পাদনা</button>
                <button type="button" class="btn btn-small btn-error" data-delete-notice="${escapeHtml(notice.id)}">মুছুন</button>
              </span>
            </div>`).join('')
          : '<div class="empty-state">কোনো নোটিশ নেই।</div>';
      };

      const noticeForm = document.getElementById('notice-form');
      document.getElementById('notice-class').innerHTML = classOptionsHtml(ALL_CLASSES);
      const openNoticeModal = (editId = null) => {
        noticeForm.reset();
        document.getElementById('notice-edit-index').value = '';
        if (editId) {
          const notice = db.notices.find(editId);
          if (!notice) return;
          document.getElementById('notice-modal-title').textContent = 'নোটিশ সম্পাদনা';
          document.getElementById('notice-save').textContent = 'আপডেট করুন';
          document.getElementById('notice-edit-index').value = notice.id;
          noticeForm.elements.title.value = notice.title || '';
          noticeForm.elements.audience.value = notice.audience || 'সবাই';
          noticeForm.elements.className.value = notice.className || ALL_CLASSES;
        } else {
          document.getElementById('notice-modal-title').textContent = 'নতুন নোটিশ';
          document.getElementById('notice-save').textContent = 'প্রকাশ করুন';
        }
        openModal('notice-modal');
      };

      document.getElementById('open-notice-modal').addEventListener('click', () => openNoticeModal());

      noticeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!onlineFor('নোটিশ সংরক্ষণ')) return;
        const data = new FormData(noticeForm);
        const editId = String(data.get('editIndex') || '');
        const title = String(data.get('title') || '').trim();
        if (!title) { showToast('শিরোনাম লিখুন।', 'error'); return; }
        const className = String(data.get('className') || ALL_CLASSES);
        if (editId) {
          db.notices.update(editId, { title, audience: String(data.get('audience')), className });
          showToast('নোটিশ আপডেট হয়েছে।', 'success');
        } else {
          db.notices.add({ id: newId('n'), title, audience: String(data.get('audience')), className, date: todayBn() });
          showToast('নোটিশ প্রকাশিত হয়েছে।', 'success');
        }
        closeModal('notice-modal');
        renderNotices();
        renderOverview();
      });

      document.querySelector('#tab-notices').addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-edit-notice]');
        const delBtn = event.target.closest('[data-delete-notice]');
        if (editBtn) { openNoticeModal(editBtn.dataset.editNotice); return; }
        if (delBtn) {
          if (!onlineFor('নোটিশ মুছে ফেলা')) return;
          const notice = db.notices.find(delBtn.dataset.deleteNotice);
          if (notice && window.confirm(`"${notice.title}" মুছে ফেলবেন?`)) {
            db.notices.remove(notice.id);
            showToast('নোটিশ মুছে ফেলা হয়েছে।', 'warning');
            renderNotices();
            renderOverview();
          }
        }
      });

      /* ------------------------------------------------------------ */
      /* Dues & Payments — class-first: pick a class, see who owes,   */
      /* collect from a student across months in one go.             */
      /* ------------------------------------------------------------ */
      const duesFilter = { className: ALL_CLASSES, query: '' };

      /** Due fee rows grouped per student (oldest month first), searchable. */
      const duesByStudent = (className, query) => {
        const byStudent = new Map();
        dueFees(className).forEach((fee) => {
          if (!fee.student) return;
          const row = byStudent.get(fee.studentId) || { student: fee.student, months: [], total: 0 };
          row.months.push({ id: fee.id, month: fee.month, remaining: fee.remaining });
          row.total += fee.remaining;
          byStudent.set(fee.studentId, row);
        });
        const q = String(query || '').trim();
        return [...byStudent.values()]
          .map((row) => ({ ...row, months: row.months.slice().sort((a, b) => dueMonthKey(a.month) - dueMonthKey(b.month)) }))
          .filter((row) => !q || row.student.name.includes(q) || String(row.student.id).includes(q))
          .sort((a, b) => b.total - a.total || a.student.name.localeCompare(b.student.name, 'bn'));
      };

      const renderDues = () => {
        // Class chips with per-class due-student counts — one tap scopes everything below.
        document.getElementById('due-class-chips').innerHTML = [ALL_CLASSES, ...CLASS_OPTIONS]
          .map((cls) => {
            const count = new Set(dueFees(cls).map((d) => d.studentId)).size;
            const active = duesFilter.className === cls ? ' active' : '';
            return `<button type="button" class="due-chip${active}" data-dues-class="${escapeHtml(cls)}" aria-pressed="${duesFilter.className === cls}">${escapeHtml(cls)}${cls === ALL_CLASSES ? '' : ' শ্রেণি'} · ${bn(count)}</button>`;
          }).join('');

        // Summary of the selected scope.
        const scoped = dueFees(duesFilter.className);
        const totalDue = scoped.reduce((sum, d) => sum + d.remaining, 0);
        const scopeIds = new Set(studentsOfClass(duesFilter.className).map((s) => s.id));
        const today = todayBn();
        const collectedToday = db.payments.list()
          .filter((p) => p.date === today && scopeIds.has(p.studentId))
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);
        statGrid('#due-summary', [
          { label: 'মোট বকেয়া', value: `৳${bn(totalDue)}`, tone: totalDue ? 'warning' : 'success' },
          { label: 'বকেয়া শিক্ষার্থী', value: `${bn(new Set(scoped.map((d) => d.studentId)).size)} জন` },
          { label: 'আজকের আদায়', value: `৳${bn(collectedToday)}` }
        ]);

        // Student-wise due list (each student once, not once per month).
        const rows = duesByStudent(duesFilter.className, duesFilter.query);
        document.getElementById('due-count').textContent = bn(rows.length);
        const scopeName = duesFilter.className === ALL_CLASSES ? '' : `${duesFilter.className} শ্রেণিতে`;
        renderTable('#due-table', [
          { key: 'student', label: 'শিক্ষার্থী', render: (row) => `<strong>${escapeHtml(row.student.name)}</strong><br><small>${escapeHtml(row.student.id)}</small>` },
          { key: 'className', label: 'শ্রেণি', render: (row) => escapeHtml(row.student.className || '—') },
          { key: 'months', label: 'বকেয়া মাস', render: (row) => row.months.map((m) => `<span class="due-month">${escapeHtml(m.month)} · ৳${bn(m.remaining)}</span>`).join(' ') },
          { key: 'total', label: 'মোট বকেয়া', render: (row) => `<strong class="due-total">৳${bn(row.total)}</strong>` },
          { key: '_pay', label: 'অ্যাকশন', render: (row) => `<button type="button" class="btn btn-small btn-success" data-pay-student="${escapeHtml(row.student.id)}">পেমেন্ট নিন</button>` }
        ], rows, duesFilter.query
          ? (scoped.length ? 'খোঁজের সাথে মিলে এমন বকেয়া নেই।' : `🎉 ${scopeName || 'সব ক্লাসে'} কারও বকেয়া নেই।`)
          : `🎉 ${scopeName || 'কারও'} বকেয়া নেই${scopeName ? '' : ' — সবার ফি পরিশোধিত!'}।`);

        // Recent payments, scoped to the selected class as well.
        const payments = [...db.payments.list()].reverse().filter((p) => scopeIds.has(p.studentId));
        document.getElementById('payment-list').innerHTML = payments.length
          ? payments.slice(0, 8).map((p) => {
            const st = db.students.find(p.studentId);
            return `
            <div class="list-item">
              <div class="li-main">
                <div class="li-title">${escapeHtml(st?.name || p.studentId)}</div>
                <div class="li-sub">${escapeHtml(p.month)} · ৳${bn(p.amount)} · ${escapeHtml(formatBnDate(p.date))}${p.method ? ` · ${escapeHtml(p.method)}` : ''}</div>
                ${p.receiptNo ? `<div class="li-sub">রিসিট ${escapeHtml(p.receiptNo)}</div>` : ''}
              </div>
              <button type="button" class="btn btn-small" data-receipt="${escapeHtml(p.id)}">রিসিট</button>
            </div>`;
          }).join('')
          : '<div class="empty-state">এই ক্লাসে কোনো পেমেন্ট নেই।</div>';
      };

      document.querySelector('#tab-dues').addEventListener('click', (event) => {
        const chip = event.target.closest('[data-dues-class]');
        if (chip) { duesFilter.className = chip.dataset.duesClass; renderDues(); return; }
        const btn = event.target.closest('[data-pay-student]');
        if (btn) { openPaymentModal(btn.dataset.payStudent); return; }
        const receiptBtn = event.target.closest('[data-receipt]');
        if (receiptBtn) { openReceipt(receiptBtn.dataset.receipt); }
      });
      document.getElementById('due-search')?.addEventListener('input', (event) => {
        duesFilter.query = event.target.value;
        renderDues();
      });

      /* -------- Payment capture: one student, one or more months -------- */
      const paymentForm = document.getElementById('payment-form');

      /** Sum of the ticked months' remaining dues. */
      const checkedDueTotal = () => [...document.querySelectorAll('#pay-months [data-pay-month]:checked')]
        .reduce((sum, box) => sum + dueRemaining(db.fees.find(box.value)), 0);
      const syncPayAmount = () => {
        const total = checkedDueTotal();
        const amountInput = document.getElementById('pay-amount');
        amountInput.value = total || '';
        amountInput.max = String(total);
        document.getElementById('pay-amount-hint').textContent = total
          ? `টিক দেওয়া মাসগুলোর বকেয়া ৳${bn(total)} — কম দিলে আগের মাস থেকে ধরে ধরে কাটা হবে।`
          : 'কমপক্ষে একটি মাস টিক দিন।';
      };
      document.getElementById('pay-months')?.addEventListener('change', (event) => {
        if (event.target.matches('[data-pay-month]')) syncPayAmount();
      });

      const openPaymentModal = (studentId) => {
        const student = db.students.find(studentId);
        if (!student) { showToast('শিক্ষার্থী পাওয়া যায়নি।', 'error'); return; }
        const dues = db.fees.list()
          .filter((fee) => fee.studentId === studentId && fee.status === 'বকেয়া' && dueRemaining(fee) > 0)
          .sort((a, b) => dueMonthKey(a.month) - dueMonthKey(b.month));
        if (!dues.length) { showToast('এই শিক্ষার্থীর কোনো বকেয়া নেই।', 'info'); return; }
        document.getElementById('pay-student-id').value = studentId;
        document.getElementById('pay-student').value = `${student.name} (${student.id})${student.className ? ` · ${student.className} শ্রেণি` : ''}`;
        document.getElementById('pay-due-hint').textContent = dues.length > 1
          ? `${bn(dues.length)} মাস বকেয়া — সবগুলো একসাথে বা টিক বদলে কিছু মাসের ফি নেওয়া যাবে।`
          : '১ মাস বকেয়া আছে।';
        document.getElementById('pay-months').innerHTML = dues.map((fee) => `
          <label class="pay-month-row">
            <input type="checkbox" data-pay-month value="${escapeHtml(fee.id)}" checked>
            <span class="pm-name">${escapeHtml(fee.month)}</span>
            <span class="pm-amt">৳${bn(dueRemaining(fee))}</span>
          </label>`).join('');
        // Shown the Bengali long way (১৬ সেপ্টেম্বর ২০২৬), stored canonically.
        document.getElementById('pay-date').value = formatBnDate(todayBn());
        document.getElementById('pay-reference').value = '';
        document.getElementById('pay-remarks').value = '';
        syncPayAmount();
        openModal('payment-modal');
      };

      paymentForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!onlineFor('পেমেন্ট সংরক্ষণ')) return;
        const d = new FormData(paymentForm);
        const studentId = String(d.get('studentId') || '');
        const feeIds = [...document.querySelectorAll('#pay-months [data-pay-month]:checked')].map((box) => String(box.value));
        const amount = Number(d.get('amount'));
        // The date is typed the Bengali long way (১৬ সেপ্টেম্বর ২০২৬) and
        // stored as the canonical Bengali ISO date the rest of the app uses.
        const date = parseBnDateInput(d.get('date'));
        if (!studentId) { showToast('শিক্ষার্থী নির্বাচন করুন।', 'error'); return; }
        if (!feeIds.length) { showToast('কমপক্ষে একটি মাস টিক দিন।', 'error'); return; }
        if (!Number.isFinite(amount) || amount <= 0) { showToast('সঠিক পরিমাণ লিখুন।', 'error'); return; }
        if (!date) { showToast('তারিখটি বোঝা যায়নি। এভাবে লিখুন: ১৬ সেপ্টেম্বর ২০২৬', 'error'); return; }

        // Validate against what is really owed *before* anything is written:
        // the old flow marked the fee পরিশোধিত first and only then copied the
        // typed amount onto the payment, so ৳50 closed a ৳1200 due.
        const owed = feeIds.reduce((sum, id) => sum + dueRemaining(db.fees.find(id)), 0);
        if (owed <= 0) { showToast('নির্বাচিত মাসের বকেয়া ইতিমধ্যে পরিশোধিত।', 'error'); return; }
        if (amount > owed) {
          showToast(`বকেয়ার চেয়ে বেশি নেওয়া যাবে না — টিক দেওয়া মাসে বাকি ৳${bn(owed)}।`, 'error'); return;
        }
        const result = receiveStudentPayments(studentId, feeIds, amount, session.name, {
          date,
          method: String(d.get('method') || 'নগদ'),
          reference: String(d.get('reference') || ''),
          remarks: String(d.get('remarks') || '')
        });
        if (!result) { showToast('পেমেন্ট সংরক্ষণ করা যায়নি — পরিমাণটি বকেয়ার সঙ্গে মেলেনি।', 'error'); return; }
        if (result.remaining > 0 && result.settled < feeIds.length) {
          const leftOver = dueFees(ALL_CLASSES)
            .filter((fee) => fee.studentId === studentId)
            .reduce((sum, fee) => sum + fee.remaining, 0);
          showToast(`আংশিক পেমেন্ট সংরক্ষিত হয়েছে — এই শিক্ষার্থীর বাকি ৳${bn(leftOver)}।`, 'warning');
        }
        closeModal('payment-modal');
        renderDues(); renderStudents(); renderOverview();
        showPaymentSuccess(result.payments.map((p) => p.id), result.total);
      });

      /* -------- Receipt: preview → PDF / image share (no direct print) -------- */
      let currentReceiptId = null;

      const receiptOpts = (paymentId) => {
        const pay = db.payments.find(paymentId);
        if (!pay) return null;
        return { pay, student: db.students.find(pay.studentId) || null, settings: db.settings.get() };
      };

      const openReceipt = async (paymentId) => {
        const opts = receiptOpts(paymentId);
        if (!opts) { showToast('পেমেন্ট পাওয়া যায়নি।', 'error'); return; }
        currentReceiptId = paymentId;
        try {
          const doc = await receiptPreviewDoc(opts.pay, opts);
          await previewDocument(doc);
        } catch (e) {
          showToast('রিসিট তৈরি করা যায়নি।', 'error');
        }
      };

      const shareReceipt = async (paymentId) => {
        const opts = receiptOpts(paymentId);
        if (!opts) { showToast('পেমেন্ট পাওয়া যায়নি।', 'error'); return; }
        try {
          const res = await shareReceiptAsImage(opts.pay, opts);
          if (res.shared) showToast('রিসিট ছবি শেয়ার করা হয়েছে।', 'success');
          else if (res.downloaded) showToast('রিসিট ছবি ডাউনলোড হয়েছে — WhatsApp থেকে শেয়ার করুন।', 'info');
        } catch (e) {
          if (!(e && e.name === 'AbortError')) showToast('রিসিট শেয়ার করা যায়নি।', 'error');
        }
      };

      const downloadReceiptPdf = async (paymentId) => {
        const opts = receiptOpts(paymentId);
        if (!opts) { showToast('পেমেন্ট পাওয়া যায়নি।', 'error'); return; }
        try {
          const canvas = await renderReceiptCanvas(opts.pay, opts);
          await canvasesToPdf([canvas], receiptPdfFileName(opts.pay));
          showToast('রিসিট PDF ডাউনলোড হয়েছে।', 'success');
        } catch (e) {
          showToast('রিসিট ডাউনলোড করা যায়নি।', 'error');
        }
      };

      /* -------- Payment success: view / WhatsApp / download -------- */
      const showPaymentSuccess = (paymentIds, paidTotal) => {
        const ids = (Array.isArray(paymentIds) ? paymentIds : [paymentIds]).filter(Boolean);
        const opts = receiptOpts(ids[0]);
        if (!opts) { showToast('পেমেন্ট পাওয়া যায়নি।', 'error'); return; }
        currentReceiptId = ids[0];
        const { pay, student } = opts;
        const total = Number.isFinite(paidTotal)
          ? paidTotal
          : ids.reduce((sum, id) => sum + Number(db.payments.find(id)?.amount || 0), 0);
        const remainingDue = dueFees(ALL_CLASSES)
          .filter((fee) => fee.studentId === pay.studentId)
          .reduce((sum, fee) => sum + fee.remaining, 0);
        document.getElementById('payment-success-sub').textContent =
          `${student?.name || pay.studentId} · মোট ৳${bn(total)} পরিশোধিত হয়েছে${ids.length > 1 ? ` (${bn(ids.length)} মাস)` : ''}`;
        document.getElementById('payment-success-summary').innerHTML = `
          ${ids.map((id) => {
            const row = db.payments.find(id);
            return `<div class="list-item"><div class="li-main">
              <div class="li-title">${escapeHtml(row?.month || '')} — ৳${bn(row?.amount || 0)}</div>
              <div class="li-sub">রিসিট ${escapeHtml(row?.receiptNo || id)}</div></div>
              <button type="button" class="btn btn-small" data-rcpt="${escapeHtml(id)}">🧾 রিসিট</button></div>`;
          }).join('')}
          <div class="list-item"><div class="li-main"><div class="li-sub">এই শিক্ষার্থীর অবশিষ্ট বকেয়া</div><div class="li-title">${remainingDue > 0 ? `৳${bn(remainingDue)}` : 'নেই'}</div></div></div>`;
        openModal('payment-success-modal');
      };
      document.getElementById('payment-success-summary')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-rcpt]');
        if (btn) { currentReceiptId = btn.dataset.rcpt; openReceipt(btn.dataset.rcpt); }
      });

      document.getElementById('pay-success-view')?.addEventListener('click', () => {
        closeModal('payment-success-modal');
        openReceipt(currentReceiptId);
      });
      document.getElementById('pay-success-whatsapp')?.addEventListener('click', () => shareReceipt(currentReceiptId));
      document.getElementById('pay-success-download')?.addEventListener('click', () => downloadReceiptPdf(currentReceiptId));

      /* ------------------------------------------------------------ */
      /* Suggestions + MCQ authoring (admin)                           */
      /* ------------------------------------------------------------ */
      document.getElementById('sug-class').innerHTML = classOptionsHtml('নবম', { allowAll: false });
      document.getElementById('exam-class').innerHTML = classOptionsHtml('নবম', { allowAll: false });
      setExamAuthor(session.name);
      mountSuggestionAuthoring({ author: session.name, session });
      mountExamAuthoring({ session });

      /* ------------------------------------------------------------ */
      /* Settings                                                      */
      /* ------------------------------------------------------------ */
      /* Institute profile: name, address, mobile and email are written */
      /* here once and reused by every document and portal.             */
      const ORG_INPUTS = {
        orgName: 'set-org', address: 'set-address', mobile: 'set-mobile', email: 'set-email',
        website: 'set-website', footerText: 'set-footer', orgLogo: 'set-logo'
      };
      let pendingLogoDataUrl = null; // holds newly selected logo until save
      const LOGO_PREVIEW_IMG = () => document.getElementById('logo-preview-img');
      const LOGO_PREVIEW_NAME = () => document.getElementById('logo-preview-name');
      const OP_LOGO = () => document.getElementById('op-logo');
      const orgInput = (field) => document.getElementById(ORG_INPUTS[field]);
      const orgValue = (field) => (orgInput(field)?.value || '').trim();

      /** Mirror the institution fields into the letterhead preview while typing. */
      const renderOrgPreview = () => {
        const orgEl = document.getElementById('op-org');
        const addrEl = document.getElementById('op-address');
        const contactEl = document.getElementById('op-contact');
        const footerEl = document.getElementById('op-footer');
        const logoEl = OP_LOGO();
        if (orgEl) orgEl.textContent = orgValue('orgName') || 'প্রতিষ্ঠানের নাম';
        if (addrEl) addrEl.textContent = orgValue('address');
        if (contactEl) {
          // Letterhead contact line = phone + email (matches orgInfo().contactLine);
          // the website, when written, shows on its own in the footer line.
          contactEl.textContent = [orgValue('mobile'), orgValue('email')].filter(Boolean).join(' · ');
        }
        if (footerEl) footerEl.textContent = orgValue('footerText') || '';
        if (logoEl && pendingLogoDataUrl) {
          logoEl.src = pendingLogoDataUrl;
        } else if (logoEl) {
          const s = db.settings.get();
          logoEl.src = s.orgLogo || 'assets/logo.png';
        }
      };

      const renderLogoPreview = () => {
        const s = db.settings.get();
        const img = LOGO_PREVIEW_IMG();
        const nameEl = LOGO_PREVIEW_NAME();
        const current = pendingLogoDataUrl || s.orgLogo;
        if (img) img.src = current || 'assets/logo.png';
        if (nameEl) {
          if (pendingLogoDataUrl) nameEl.textContent = 'নতুন লোগো নির্বাচিত — সংরক্ষণ করলে সব PDF ও WhatsApp ইমেজে ব্যবহার হবে';
          else if (s.orgLogo) nameEl.textContent = 'কাস্টম লোগো সংরক্ষিত — সব PDF ও WhatsApp ইমেজে ব্যবহার হচ্ছে';
          else nameEl.textContent = 'কোনো কাস্টম লোগো নেই — ডিফল্ট লোগো ব্যবহার হবে';
        }
      };

      /** Field-level Bengali errors under the form (and a red outline). */
      const showOrgErrors = (errors = []) => {
        const box = document.getElementById('org-error');
        if (box) {
          box.textContent = errors.map((e) => e.message).join(' ');
          box.classList.toggle('visible', errors.length > 0);
        }
        // Only real inputs get red outline — logo is file input
        ['orgName','address','mobile','email','website','footerText'].forEach((field) => {
          orgInput(field)?.classList.toggle('input-invalid', errors.some((e) => e.field === field));
        });
        if (errors.length) {
          const first = errors[0].field;
          if (ORG_INPUTS[first] && first !== 'orgLogo') orgInput(first)?.focus();
        }
      };

      Object.values(ORG_INPUTS).forEach((id) => {
        const el = document.getElementById(id);
        if (!el || id === 'set-logo') return;
        el?.addEventListener('input', () => { renderOrgPreview(); showOrgErrors([]); });
      });

      // Logo upload: read as data URL, store locally preview
      const logoInput = document.getElementById('set-logo');
      logoInput?.addEventListener('change', () => {
        const file = logoInput.files && logoInput.files[0];
        if (!file) { pendingLogoDataUrl = null; renderLogoPreview(); renderOrgPreview(); return; }
        if (file.size > 2 * 1024 * 1024) {
          showToast('লোগো ফাইলটি খুব বড় — ২MB এর কম ছবি ব্যবহার করুন।', 'error');
          logoInput.value = '';
          pendingLogoDataUrl = null;
          renderLogoPreview();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          pendingLogoDataUrl = reader.result;
          renderLogoPreview();
          renderOrgPreview();
          showToast('লোগো প্রিভিউ প্রস্তুত — সংরক্ষণ করুন।', 'info');
        };
        reader.onerror = () => {
          showToast('লোগো পড়া যায়নি।', 'error');
          pendingLogoDataUrl = null;
        };
        reader.readAsDataURL(file);
      });

      document.getElementById('logo-remove')?.addEventListener('click', () => {
        pendingLogoDataUrl = null;
        if (logoInput) logoInput.value = '';
        // Mark for removal on save
        const s = db.settings.get();
        if (s.orgLogo) {
          pendingLogoDataUrl = '__REMOVE__';
          renderLogoPreview();
          renderOrgPreview();
          showToast('লোগো মুছে ফেলার জন্য সংরক্ষণ করুন।', 'warning');
          // reset the marker after preview so UI shows default, but save will remove
          // Actually keep marker, render will show default if marker is REMOVE
          const img = LOGO_PREVIEW_IMG();
          if (img) img.src = 'assets/logo.png';
          const nameEl = LOGO_PREVIEW_NAME();
          if (nameEl) nameEl.textContent = 'লোগো মুছে ফেলা হবে — সংরক্ষণ করুন';
          const opLogo = OP_LOGO();
          if (opLogo) opLogo.src = 'assets/logo.png';
          pendingLogoDataUrl = '__REMOVE__';
        } else {
          renderLogoPreview();
          renderOrgPreview();
        }
      });

      const renderSettings = () => {
        const settings = db.settings.get();
        orgInput('orgName').value = settings.orgName || '';
        orgInput('address').value = settings.address || '';
        orgInput('mobile').value = settings.mobile || '';
        orgInput('email').value = settings.email || '';
        orgInput('website').value = settings.website || '';
        orgInput('footerText').value = settings.footerText || '';
        pendingLogoDataUrl = null;
        const logoInp = document.getElementById('set-logo');
        if (logoInp) logoInp.value = '';
        showOrgErrors([]);
        renderOrgPreview();
        renderLogoPreview();
        document.getElementById('set-fee').value = settings.monthlyFee ?? 0;
        document.getElementById('set-challenge').value = settings.dailyChallengeTarget ?? 10;
        const editableFields = settings.studentEditableFields || [];
        document.querySelectorAll('#student-editable input').forEach((input) => {
          input.checked = editableFields.includes(input.name.slice(5));
        });
        const enabledFeatures = settings.homeFeatures || [];
        document.querySelectorAll('#home-features input').forEach((input) => {
          input.checked = enabledFeatures.includes(input.name.slice(5));
        });
        const cards = homeCards();
        document.querySelectorAll('#home-cards input[name^="home_"]').forEach((input) => {
          input.checked = cards[input.name.slice(5)] !== false;
        });
        document.getElementById('system-list').innerHTML = [
          ['ডেটা মোড', getAuthMode() === 'firebase' ? 'Firebase (ক্লাউড)' : 'লোকাল (এই ডিভাইস)'],
          ['লগিন করা', session.name],
          ['সেশন শুরু', formatBnDateTime(session.loginTime)]
        ].map(([label, value]) => `
          <div class="list-item">
            <div class="li-main"><div class="li-sub">${escapeHtml(label)}</div><div class="li-title">${escapeHtml(value)}</div></div>
          </div>`).join('');
      };

      document.getElementById('settings-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!onlineFor('সেটিংস সংরক্ষণ')) return;
        try { assertCan(session, 'manageSettings', 'সেটিংস সংরক্ষণ'); }
        catch (err) { showToast(err.message, 'error'); return; }
        const data = new FormData(event.target);

        // The institute profile is validated first: a bad mobile/email must not
        // silently reach a printed receipt, so nothing is saved until it passes.
        // Logo is stored locally and reused automatically for ALL PDFs and WhatsApp images.
        let logoToSave = undefined;
        if (pendingLogoDataUrl === '__REMOVE__') logoToSave = null;
        else if (pendingLogoDataUrl) logoToSave = pendingLogoDataUrl;
        // If no new logo selected, keep existing (undefined = don't touch)

        const org = saveOrgInfo({
          orgName: data.get('orgName'),
          address: data.get('address'),
          mobile: data.get('mobile'),
          email: data.get('email'),
          website: data.get('website'),
          footerText: data.get('footerText'),
          ...(logoToSave !== undefined ? { orgLogo: logoToSave } : {})
        });
        if (!org.ok) {
          showOrgErrors(org.errors);
          showToast(org.errors[0].message, 'error');
          return;
        }
        showOrgErrors([]);
        pendingLogoDataUrl = null;

        db.settings.update({
          monthlyFee: Number(data.get('monthlyFee')) || 0
        });
        db.settings.update({
          dailyChallengeTarget: Math.max(1, Number(data.get('dailyChallengeTarget')) || 10),
          studentEditableFields: [...event.target.querySelectorAll('#student-editable input:checked')]
            .map((input) => input.name.slice(5))
        });
        setHomeFeatures([...event.target.querySelectorAll('#home-features input:checked')].map((i) => i.name.slice(5)));
        setHomeCards(Object.fromEntries(
          [...event.target.querySelectorAll('input[name^="home_"]')]
            .map((input) => [input.name.slice(5), input.checked])
        ));

        // Everything that prints or shows the institute identity picks it up now.
        // All of this stays synchronous: the admin must see the result of the
        // save — refreshed letterhead, home and a confirmation — at once.
        renderSettings();
        ensurePrintHeader();
        renderOverview();
        adminHome?.render?.();
        syncTopbar();
        refreshAdminBell();
        showToast('প্রতিষ্ঠানের তথ্যসহ সেটিংস সংরক্ষিত হয়েছে।', 'success');
        // Then clear the PDF logo cache so future PDFs/WhatsApp images pick up
        // the new logo. Fire-and-forget: pdf.js is already loaded for the
        // documents tab and this must never delay the save confirmation.
        import('../pdf.js').then(({ clearLogoCache }) => clearLogoCache()).catch(() => {});
      });

      document.getElementById('reset-data').addEventListener('click', () => {
        // No demo data to return to: this empties every record collection and
        // keeps only the institute's own settings.
        if (window.confirm('শিক্ষার্থী, শিক্ষক, ফি, পরীক্ষা, নোটিশ — সব রেকর্ড মুছে যাবে। প্রতিষ্ঠানের সেটিংস ও শ্রেণি-বিষয়ের তালিকা থাকবে। মুছে ফেলবেন?')) {
          db.reset();
          renderAll();
          showToast('সব ডেটা মুছে ফেলা হয়েছে।', 'warning');
        }
      });

      /* ------------------------------------------------------------ */
      /* ---- Notification bell: নোটিফিকেশন the admin has not seen ---- */
      /*      (spec 43). Tapping it opens the নোটিফিকেশন panel. The      */
      /*      "seen" mark is kept in this device's localStorage, so     */
      /*      clearing the badge here never flips the shared `read`     */
      /*      flag that the teacher's and the student's badges depend    */
      /*      on.                                                         */
      /* ------------------------------------------------------------ */
      const SEEN_KEY = 'activeplus_notifs_seen';
      const markNotificationsSeen = () => {
        const now = Date.now();
        try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* full */ }
        return now;
      };
      const seenSince = () => {
        const stored = Number(localStorage.getItem(SEEN_KEY));
        // A first visit has nothing "new" — the counter starts right here.
        return stored > 0 ? stored : markNotificationsSeen();
      };
      function refreshAdminBell() {
        const badge = document.getElementById('admin-bell-count');
        const bell = document.getElementById('admin-bell');
        if (!badge || !bell) return;
        const fresh = adminAlerts(seenSince()).length;
        badge.textContent = bn(fresh);
        badge.hidden = fresh === 0;
        bell.setAttribute('aria-label', fresh ? `${bn(fresh)}টি নতুন নোটিফিকেশন` : 'নোটিফিকেশন');
      }
      document.getElementById('admin-bell')?.addEventListener('click', () => {
        markNotificationsSeen();
        activeTabs()?.activate?.('notifications');
        refreshAdminBell();
      });

      const renderAll = () => {
        renderOverview();
        renderStudents();
        renderDues();
        renderTeachers();
        renderNotices();
        renderSettings();
      };

      // Local-mode accounts must exist before the panel paints its user lists
      // (mountUsers() renders them, and it is a few lines below).
      await seedUsers();

      renderAll();
      mountExtraAdmin(session);
      mountDocumentPreview();

      /* ================= Batch management ================= */
      mountCrud({
        container: 'batches-crud', collection: 'batches', keyField: 'name', singular: 'ব্যাচ',
        columns: [
          { key: 'name', label: 'ব্যাচ' }, { key: 'className', label: 'ক্লাস' },
          { key: 'section', label: 'শাখা' }, { key: 'time', label: 'সময়' },
          { key: 'room', label: 'কক্ষ' }, { key: 'teacher', label: 'শিক্ষক' },
          { key: 'studentLimit', label: 'আসন' }, { key: 'status', label: 'অবস্থা' }
        ],
        fields: [
          { name: 'name', label: 'ব্যাচের নাম', required: true },
          { name: 'className', label: 'ক্লাস', type: 'select', options: CLASS_OPTIONS, required: true },
          { name: 'section', label: 'শাখা' },
          { name: 'time', label: 'সময়' },
          { name: 'room', label: 'কক্ষ' },
          { name: 'teacher', label: 'দায়িত্বপ্রাপ্ত শিক্ষক' },
          { name: 'subjects', label: 'বিষয় (কমা দিয়ে)' },
          { name: 'studentLimit', label: 'আসন সংখ্যা', type: 'number' },
          { name: 'status', label: 'অবস্থা', type: 'select', options: ['সক্রিয়', 'বন্ধ'] }
        ],
        searchKeys: ['name', 'className', 'teacher'],
        idPrefix: 'batch'
      });

      /* ================= App-style admin home ================= */
      const tabs = activeTabs();
      const adminHome = initAdminHome({
        session, tabs, openModal, showToast,
        onLogout: () => document.getElementById('logout-btn')?.click(),
        // Dashboard quick action (হাজিরা নিন) reuses the same quick-attendance
        // dialog the ⧺ sheet opens (defined further down; resolved on click).
        onAttendance: () => openAttendanceQuick()
      });
      document.querySelectorAll('.bottom-nav button[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.tab;
          if (key === 'more') { tabs?.activate?.('home'); adminHome?.openMore(); return; }
          tabs?.activate?.(key);
          // Tapping "হোম" always brings back the main dashboard, even when the
          // "আরও" grid is showing.
          if (key === 'home') adminHome?.showHome();
        });
      });
      // Grid navigation (admin home tiles) drives the same tab panels; keep the
      // bottom navigation highlight and the notification bell in sync with it.
      const syncAdminNav = (key) => {
        document.querySelectorAll('.bottom-nav button[data-tab]').forEach((b) => {
          b.setAttribute('aria-current', String(b.dataset.tab === key));
        });
      };
      window.addEventListener('tabchange', (event) => {
        syncAdminNav(event.detail?.tab);
        // Looking at the panel itself counts as reading it — including for a
        // notification the admin has just sent from this very screen.
        if (event.detail?.tab === 'notifications') markNotificationsSeen();
        refreshAdminBell();
      });
      // Initial highlight only; renderOverview() already counted the bell.
      syncAdminNav(tabs?.current);

      /* -------- Admin Panel v2 components --------
         Grouped bilingual sidebar (desktop), global top-bar search,
         scheduled auto-backup and one-tap CSV exports. All of them read the
         same tab router, so phone and desktop stay perfectly in sync. */
      mountAdminSidebar({ session, tabs });
      mountGlobalSearch({ session, tabs });
      mountAutoBackup();
      mountAdminExports();
      /* Student App Control: the live mirror of the student portal. A publish
         there also moves the counts on the dashboard and the students list, so
         both are repainted instead of going stale behind the preview. */
      mountStudentAppControl({
        session, tabs,
        onChange: () => { renderStudents(); renderOverview(); }
      });

      // The home render writes the header too — repaint it as institution-first.
      syncTopbar();

      /* ============ Icon-based shell: profile, Quick Add ============ */
      // The ☰ was removed from the top bar: the "সব ফিচার" shortcut on the
      // home (and the bottom navigation's আরও tab) opens the same feature grid.
      // Top Bar 👤 profile dropdown (profile / settings / logout).
      const profileBtn = document.getElementById('admin-profile-btn');
      const profileMenu = document.getElementById('admin-profile-menu');
      const closeProfileMenu = () => {
        if (!profileMenu || profileMenu.hidden) return;
        profileMenu.hidden = true;
        profileBtn?.setAttribute('aria-expanded', 'false');
        // The Back step the dropdown took is given back, however it closed.
        noteOverlayClosed();
      };
      profileBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = profileMenu.hidden;
        profileMenu.hidden = !willOpen;
        profileBtn.setAttribute('aria-expanded', String(willOpen));
        // The phone's Back closes the open menu before it leaves the panel.
        if (willOpen) noteOverlayOpened();
      });
      // The dropdown is not a .modal-overlay, so it registers as its own layer.
      registerOverlay({
        isOpen: () => Boolean(profileMenu && !profileMenu.hidden),
        close: () => { closeProfileMenu(); return true; }
      });
      document.addEventListener('click', (event) => {
        if (!profileMenu || profileMenu.hidden) return;
        if (event.target.closest('#admin-profile-menu') || event.target.closest('#admin-profile-btn')) return;
        closeProfileMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeProfileMenu();
      });
      document.getElementById('pm-view-profile')?.addEventListener('click', () => {
        closeProfileMenu();
        tabs?.activate?.('profile');
      });
      document.getElementById('pm-settings')?.addEventListener('click', () => {
        closeProfileMenu();
        tabs?.activate?.('settings');
      });
      // Installable PWA: the 📲 row appears only while Chrome offers installation.
      mountInstallButton('#pm-install');
      document.getElementById('pm-install')?.addEventListener('click', closeProfileMenu);

      /* -------- Floating ＋ Quick Add: Admission / Payment / Attendance -------- */
      document.getElementById('quickadd-fab')?.addEventListener('click', () => openModal('quickadd-modal'));
      document.getElementById('qa-admission')?.addEventListener('click', () => {
        closeModal('quickadd-modal');
        tabs?.activate?.('students');
        openModal('student-modal');
      });
      document.getElementById('qa-payment')?.addEventListener('click', () => {
        closeModal('quickadd-modal');
        tabs?.activate?.('dues');
      });
      document.getElementById('qa-attendance')?.addEventListener('click', () => {
        closeModal('quickadd-modal');
        openAttendanceQuick();
      });

      /* -------- Quick attendance: same store + rules as the teacher picker -------- */
      const attQuickClass = document.getElementById('att-quick-class');
      const attQuickList = document.getElementById('attendance-quick-list');
      const attQuickSummary = document.getElementById('attendance-quick-summary');
      if (attQuickClass) attQuickClass.innerHTML = classOptionsHtml(ALL_CLASSES);
      const attQuickFor = (studentId) => db.attendance.find(
        (a) => a.studentId === studentId && a.date === todayBn()
      );
      const renderAttendanceQuick = () => {
        if (!attQuickList) return;
        const rows = studentsOfClass(attQuickClass?.value || ALL_CLASSES);
        let present = 0;
        let absent = 0;
        attQuickList.innerHTML = rows.length ? rows.map((student) => {
          const isPresent = attQuickFor(student.id)?.status !== 'অনুপস্থিত';
          if (isPresent) present += 1; else absent += 1;
          return `
          <div class="list-item">
            <div class="li-main">
              <div class="li-title">${escapeHtml(student.name)}</div>
              <div class="li-sub">${escapeHtml(student.id)} · ${escapeHtml(student.className || '')}${student.roll ? ` · রোল ${escapeHtml(student.roll)}` : ''}</div>
            </div>
            <button type="button" class="btn btn-small ${isPresent ? 'btn-success' : 'btn-error'}" data-att-student="${escapeHtml(student.id)}" aria-pressed="${isPresent}">${isPresent ? 'উপস্থিত' : 'অনুপস্থিত'}</button>
          </div>`;
        }).join('') : '<div class="empty-state">কোনো শিক্ষার্থী নেই।</div>';
        if (attQuickSummary) {
          attQuickSummary.textContent = rows.length
            ? `আজ (${todayBn()}) — ${bn(present)} জন উপস্থিত · ${bn(absent)} জন অনুপস্থিত`
            : 'আজকের উপস্থিতি';
        }
      };
      attQuickClass?.addEventListener('change', renderAttendanceQuick);
      attQuickList?.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-att-student]');
        if (!button) return;
        if (!onlineFor('উপস্থিতি সংরক্ষণ')) return;
        const student = db.students.find(button.dataset.attStudent);
        if (!student) return;
        const present = button.getAttribute('aria-pressed') !== 'true';
        const status = present ? 'উপস্থিত' : 'অনুপস্থিত';
        const existing = attQuickFor(student.id);
        if (existing) db.attendance.update((a) => a === existing, { status });
        else db.attendance.add({ id: newId('att'), studentId: student.id, date: todayBn(), status });
        renderAttendanceQuick();
        showToast(`${student.name} — ${status}`, present ? 'success' : 'warning');
      });
      const openAttendanceQuick = () => {
        renderAttendanceQuick();
        openModal('attendance-quick-modal');
      };
      /* Boot-watchdog marker: the module finished wiring this page. */
      document.body.dataset.boot = 'ok';
}
