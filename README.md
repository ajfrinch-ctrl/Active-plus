# Active Plus — Coaching Management System

A mobile-first Progressive Web App for running a coaching centre, with three
role-based portals (শিক্ষার্থী / শিক্ষক / অ্যাডমিন) behind a single login page.

Works fully in the browser with **no backend** (local mode). When a real
Firebase project is configured it switches to cloud auth + realtime data
automatically.

## Quick start

```bash
# serve the folder (any static server works)
python3 -m http.server 8080        # or: npx serve

# run the test suite (requires: npm install)
npm install
npm test

# regenerate the PWA icons (requires: Pillow)
npm run icons
```

Open `http://localhost:8080` and log in.

## Demo accounts (local mode)

| Role     | Username             | Password      |
| -------- | -------------------- | ------------- |
| Student  | `2026-09-001`        | `Student@123` |
| Teacher  | `teacher@activeplus.edu` | `Teacher@123` |
| Admin    | `admin@activeplus.edu`   | `Admin@123`   |

These accounts are seeded in local mode, so the app can always be signed into
even before Firebase is configured — they are deliberately not printed on the
login screen.

There is **one login form for everyone** — no role picker. `signIn()` detects
the user type from the account itself and the app routes to the matching
portal (শিক্ষার্থী → `student.html`, শিক্ষক → `teacher.html`,
অ্যাডমিন → `admin.html`) automatically.

## Auto-generated IDs

- **Student** — a unique ID is generated automatically on admission as
  `YY + class-number + serial`, e.g. a 2026 admission to নবম (class 09) with
  the 1st serial becomes `2609001`; the next becomes `2609002` and so on. The
  legacy demo ID `2026-09-001` still signs in.
- **Teacher** — auto-generated from the first word of the name plus the last
  two digits of the mobile number, e.g. `রাহেলা আক্তার` + mobile ending `১১`
  → `রাহেলা১১`. If that would collide, a numeric suffix is appended.

## Dates — one format, everywhere

Every date the app *shows* reads **১৬ সেপ্টেম্বর ২০২৬** (Bengali day + Bengali
month name + Bengali year) — on cards, tables, reports, receipts, ledgers, ID
cards, print letterheads and exam lists alike. `formatBnDate()` in `js/data.js`
is the single place that renders a date; `formatBnDateTime()` appends a Bengali
clock (`১৮ সেপ্টেম্বর ২০২৬ · ০৯:১২`) when the record really carries a time.

Dates are **stored** as canonical Bengali ISO (`২০২৬-০৯-১৬`) and **typed in**
however the user likes: `১৬ সেপ্টেম্বর ২০২৬`, `16 September 2026`,
`2026-09-16`, `১৬/০৯/২০২৬` all mean the same day (`parseBnDateInput()`). A date
field is a text box with the `১৬ সেপ্টেম্বর ২০২৬` placeholder and a hint under
it; an unreadable date is refused with a Bengali message instead of being saved
as garbage. Test coverage: `tests/date-format.test.mjs` walks every student /
teacher / admin view and fails on any leftover raw date.

## MCQ exams — paste a paper, get ready questions

The exam builder no longer needs a question typed field by field. The teacher
(or admin) copies a whole paper and pastes it into **📋 প্রশ্ন পেস্ট করুন**; the
questions appear ready to review and publish. The template is printed right
above the paste box (with *টেমপ্লেট বসান* / *টেমপ্লেট কপি* buttons):

```
১. বাংলাদেশের রাজধানী কোনটি?
A) ঢাকা
B) চট্টগ্রাম
C) খুলনা
D) রাজশাহী
উত্তর: A

২. ৫ + ৩ × ২ = কত?
ক) ১০
খ) ১১
গ) ১৬
ঘ) ২০
উত্তর: খ
```

The parser (`parseMcqPaste()`) is deliberately forgiving about how the text was
copied:

| Copied as | Understood |
| --------- | ---------- |
| `A) x` · `A. x` · `(ক) x` · `[খ] x` · `১) x` | option markers, Bengali or English, any bracket style |
| `উত্তর: B` · `সঠিক: খ` · `Answer: d` · `উত্তরঃ (গ)` · `সঠিক উত্তর - ঘ` | the correct answer |
| `১. প্রশ্ন? (ক) ঢাকা (খ) চট্টগ্রাম (গ) খুলনা (ঘ) রাজশাহী` | one line holding the question *and* its options |
| `… (উত্তর: B)` at the end of the question or option line | inline answer |
| `**প্রশ্ন ১. …**`, `# শিরোনাম`, bullet dashes | Word/Docs paste noise |
| `৭. প্রশ্ন?` then `৭) ৩` | a question number and option numbers side by side |
| `D) ৬ উত্তর: খ` | an answer written beside the last option |
| `ব্যাখ্যা: …` | an explanation line, skipped (never a new question) |
| `----` between questions | a separator, skipped |
| a paper title on the first line | dropped with a note, not reported as broken |
| no blank lines anywhere | questions still split correctly |

The template can be inserted into the box, copied to the clipboard, or
**downloaded as a `.txt` file** (`mcq-prashner-template.txt`) to fill in
offline and paste back.

Duplicate and incomplete questions are reported before anything is saved —
nothing is written until *পরীক্ষা প্রকাশ করুন*. Incomplete blocks name the
question number so the teacher knows exactly which one to fix.

Taking an exam: the timer starts the moment the paper opens and is always
visible (`⏱ ২৯:৫৮`, turning amber under a minute and red under 30 seconds),
with one toast at five minutes and another at one minute left.
The sitting is remembered per student + exam, so a reload or a closed tab
resumes the *same* deadline — reopening can never buy extra time. When the
countdown reaches zero the paper **submits itself**, is graded, and the student
sees “⏰ সময় শেষ — স্বয়ংক্রিয়ভাবে জমা হয়েছে” with the full answer review. A
background tab cannot stretch the deadline either: coming back re-checks the
clock at once, because the countdown is computed from the absolute deadline
rather than from elapsed ticks. A student who leaves mid-paper finds the exam
card marked **চলছে · আর ০১:৩০ বাকি** with a *চালিয়ে যান* button, and their saved
answers waiting. One attempt per exam.

### প্রশ্নপত্র ও উত্তরপত্র (print)

Every exam in the teacher/admin list offers two documents built from the pasted
questions:

- **📄 প্রশ্নপত্র** — the printable paper: institution pad, `শ্রেণি · বিষয় · সময় ·
  পূর্ণমান · তারিখ` (Bengali long date), an instruction line, then every question
  with its options laid out in two columns under ক/খ/গ/ঘ markers. Long papers
  flow across A4 pages, each carrying the same pad and footer.
- **🗝️ উত্তরপত্র** — the teacher's copy: a final sheet listing the correct option
  for every question, headed *সঠিক উত্তরপত্র — শিক্ষকের জন্য* and footed with
  *“এই পৃষ্ঠাটি শিক্ষকের জন্য — শিক্ষার্থীদের দেওয়ার আগে সরিয়ে নিন।”* The
  student's paper never contains an answer.

Both open in the shared document preview (teacher portal included) and download
as PDFs — no browser print dialog anywhere.

### Reviewing a finished paper

The chosen answers travel with the result, so a finished paper offers
**উত্তর দেখুন** (question-by-question) long after the sitting ended — from the
exam list or straight from **ফলাফল** in the Result view, where each result row
carries its score, the submission date and its position in that paper. Every
question now prints the right answer next to the student's own, and each row is
marked **✓ সঠিক / ✗ ভুল / — উত্তর দেননি** in words, never by colour alone. The
teacher's result list says which question numbers each student missed.

The running paper shows the time left twice — as a clock and as a progress bar
that turns amber, then red, as the deadline approaches — and still submits
itself when the time is up. A paper can also be **sat offline**: it is graded on
the device straight away, marked *“অফলাইনে জমা, সিঙ্ক বাকি”*, and mirrored as
soon as the network returns.

## Structure

```
index.html          single login — detects the user type and routes to the
                    matching portal (mobile-first)
student.html        student portal — compact app-style Home (hero banner,
                    today's progress, upcoming exam, continue learning, fee)
                    plus Study / Exam / Result / More views, with the calendar
                    and every secondary destination inside More
teacher.html        teacher portal — app-style Home (today's teaching, next
                    class, pending work) plus My Classes, Students, Tasks,
                    Materials, Results, Question Bank, Routine, Batches,
                    Attendance, Notices, Query inbox, Notifications, Profile
admin.html          admin panel (v2) — light-themed dashboard (quick actions,
                    overview, dues alert) plus full CRUD for students,
                    teachers, classes, batches, subjects, exams, question
                    bank, materials, assignments, submissions, routine,
                    results, fees & payments, notices, notifications, the
                    report centre, users & permissions, activity log,
                    institute profile settings, backup/restore (incl.
                    scheduled auto-backup) and Student App Control. Hybrid
                    navigation: grouped bilingual sidebar on desktop, bottom
                    nav + the admin-home tiles on mobile
css/admin-panel.css admin-only light theme, hybrid layout, global search,
                    responsive card tables
css/style.css       single mobile-first stylesheet
js/firebase.js      Firebase integration + offline fallback + toasts
js/auth.js          local sign-in, sessions, route guards
js/app.js           shared shell: header, tabs, tables, modals
js/data.js          persistent data layer (versioned CRUD collections +
                    payments/suggestions/exams/material progress + the
                    institute profile orgInfo/saveOrgInfo + domain helpers such
                    as todayProgress, performanceFor, feeStatusFor)
js/student-home.js  the student Home: sections, bottom navigation, detail views
js/teacher-home.js  the teacher Home: today's teaching hero, feature grid,
                    quick actions, today's classes, next class
js/admin-home.js    the admin dashboard: quick actions first, overview,
                    dues alert, institute card, feature folds
js/admin-modules.js admin widgets: question bank, report centre,
                    users + permission matrix, activity log, backup;
                    re-exports bootAdminPanel for the page shell
js/admin/           Admin Panel v2 components:
                      boot.js      the page's complete wiring (extracted
                                   inline script) — bootAdminPanel()
                      registry.js  every section once: group, bilingual
                                   label, icon, required permission
                      layout.js    grouped sidebar (desktop) kept in sync
                                   with the tab router and the bottom nav
                      search.js    global top-bar search across students,
                                   teachers, batches and panel sections
                      autobackup.js scheduled automatic backup (daily/weekly)
                      export-csv.js one-tap CSV exports (students, dues,
                                   payments)
                      student-app.js Student App Control — a live mirror of the
                                   student portal (class + student scoped, all
                                   five tabs) with the publish switches beside it
js/crud.js          generic CRUD panel builder shared by every collection
js/exams.js         shared suggestion/MCQ authoring + exam-taking UI
js/store.js         layered storage (localStorage + in-memory fallback)
service-worker.js   offline caching (network-first for pages)
manifest.json       PWA manifest
assets/             generated icons (see tools/generate-icons.py)
tests/              Node test suite (`npm test`)
```

## Student Home

The student portal opens on an app-style Home built entirely from the signed-in
student's own records — no hard-coded statistics anywhere:

The Home is deliberately **short**: a picture-led hero, then one card per thing a
student actually acts on. Everything else is one tap away under **আরও**, never
repeated twice.

| Section | Data source |
| ------- | ----------- |
| Hero (banner slides, artwork, teacher's tip as the last slide) | admin-managed `banners` (optional `image`), `tips` |
| আজকের অবস্থা (today's progress %, streak, weekly dots) | `todayProgress`, `studyStreak` |
| আসন্ন পরীক্ষা (subject, date, minutes, question count, full marks, Start) | `examsFor` + `examWindow(exam)` |
| পড়া চালিয়ে যান (resume the last-opened material) | `materials` + `materialProgress`, `lastAccessedMaterial` |
| ফি (due amount, full ledger in আরও → ফি) | that student's `fees` + received `payments` |
| One door to everything else | calendar, routine, assignments, notices, badges, downloads |

Every card answers with the student's own rows only; the data layer filters by
class/batch before anything reaches the UI.

*আরও* holds the **ক্যালেন্ডার** (a Bengali month grid marking class days, exams
and deadlines; tapping a day opens its sheet), the routine, the assignment list
with its submit flow, notices, achievements and certificates, the download
centre, the streak panel, the fee **ledger** (`payments` rows with receipt and
totals), and help.

The Home **top bar** is a single rounded card: avatar, greeting, name and
class/roll, the profile and notification buttons, and a strip with today's date
and the academic session. It carries the connection state itself — the border
(and the ring around the avatar) is **green while online** and amber while
offline, so the old “অনলাইন” chip is gone. Signing in always lands on **Home
first** (`?home=1` on the login handoff, plus the remembered-tab store being
cleared on sign-in); reopening the portal later restores the tab the device was
left on. There is **no ☰ button in any top bar** — the admin's extra features
live behind the **সব ফিচার** tile on the admin home.

> **Security status (read before using real data).** Those filters run *in the
> browser*, and so does the whole database: everything lives in `localStorage` on
> the device. Anyone with DevTools on that device can read or rewrite it, so
> client-side scoping is a UX boundary, not a security one.
> `database.rules.json` is written to enforce the same boundaries server-side but
> is **not effective yet** — see *Configuring Firebase* below.

## Teacher Home

`teacher.html` answers one question: **what do I need to teach or manage
today?** Everything is derived from the signed-in teacher's own assignment
(subject, classes, batches), never from the whole institute.

| Section | Data source |
| ------- | ----------- |
| Today's Teaching (classes, students, pending assignments, upcoming exams, pending results) | `todayTeaching()` over routine/assignments/exams/results |
| Today's classes with time, room and student count | `teacherDayClasses()` |
| Next class (or "no more classes today") | `teacherNextClass()` |
| My Students — search and profile | `teacherStudents()`, restricted to assigned classes |
| Assignments: submit/check counts and marking | `teacherPendingAssignments()`, `submissionsFor()` |
| Exams and result publishing | `teacherExams()`, `teacherPendingResults()` |
| Question bank — paste or Excel/CSV upload | `parseMcqPaste()`, `parseMcqCsv()` |
| Performance of my students | `teacherPerformance()` |

A teacher sees only their own students, cannot delete records, cannot touch
financial data, and cannot change permissions. Every write goes through
`assertCan()` first, so a missing right fails with a Bengali message instead of
silently doing nothing.

## Admin Home

`admin.html` answers: **how is the whole coaching centre performing?** The
Institute Overview is built from `analytics()` and `dueFees()` — total and
active students, teachers, batches, today's and monthly collection, total due,
inactive students, subjects, upcoming exams, pending assignments, published
results — with no hard-coded numbers anywhere.

### Student App Control (2026-09)

Built after auditing what the student portal actually reads. Two of the panel's
existing controls were decorative, and they are now honest instead:

- `settings.homeCards` holds 13 flags, but the student home only gates on six
  (`exam`, `materials`, `fee`, `banners`, `tip`, plus `leaderboard` in the
  result view). The other seven are dead keys. The control panel lists all 13
  and disables the seven with a note saying nothing reads them — a switch that
  changes nothing is worse than no switch.
- `materials.published` was written by the admin UI and displayed as a
  প্রকাশিত/খসড়া badge, but `js/student-home.js` never filtered on it, so a draft
  was visible to students anyway. `classMaterials()` now honours
  `published !== false`, which is what makes publish/hide in the panel mean
  something.
- `passMark` and `negativeMarking` existed in the store, scored every exam, and
  had no control anywhere in the panel; they are editable here now, with range
  validation. (`autoPublishResult`, `notificationsEnabled` and
  `leaderboardEnabled` are read by nothing — left alone rather than wired to a
  half-built feature.)

### Admin Panel v2 restructure (2026-09)

The panel was restructured around a short product questionnaire. What changed:

- **Hybrid navigation** — a grouped sidebar (একাডেমিক / পরীক্ষা / ফাইন্যান্স /
  যোগাযোগ / সিস্টেম) on desktop, the familiar bottom nav on phones. Both are
  rendered from one registry (`js/admin/registry.js`) and stay in sync with the
  tab router. CSS hides the sidebar below 1024px, so on a phone the dashboard
  tiles (`js/admin-home.js`: কুইক অ্যাকশন + সব ফিচার) *are* the menu — every
  registry section needs a tile there or it is desktop-only in practice
  (`tests/admin-navigation.test.mjs` fails the build if one goes missing).
- **Bilingual labels** — Bengali primary with English alongside in the sidebar,
  dashboard and every section title.
- **Light theme** — `css/admin-panel.css` scopes a light palette to
  `body.admin-portal`; the student/teacher portals keep the dark look.
- **Dashboard-first home** — quick actions (ভর্তি / পেমেন্ট / হাজিরা / শিক্ষক /
  পরীক্ষা / নোটিশ / শিক্ষার্থীর অ্যাপ) lead the screen, followed by the overview
  numbers, a dues alert and the institute card.
- **Global search** — the top-bar box finds students, teachers, batches and
  panel sections; picking a student isolates and flashes their row.
- **Student quick search + filters** on the student list itself, plus a sort,
  an in-field clear button, a live `N / M` count and icon row actions — the four
  full-text buttons that used to widen every row are gone.
- **Student App Control** (`শিক্ষার্থীর অ্যাপ`) — a phone-shaped preview of the
  real student portal inside the admin panel, scoped to one class (or one
  student) and switched by the same five bottom tabs. The switches next to it
  write through `setHomeCards` / `setHomeFeatures` / `db.*`, so the preview is
  never a mock, and quick-add forms publish materials, notices, banners, tips
  and suggestions for that class without leaving the screen. Reach it from the
  **শিক্ষার্থীর অ্যাপ** quick action on the dashboard, from **সব ফিচার →
  ম্যানেজমেন্ট**, from the desktop sidebar (ড্যাশবোর্ড group), or by searching
  “স্টুডেন্ট এপ” / “student app”.
- **Role-aware sections** — the registry gates each section on the permission
  matrix, so narrowing a role hides its sections automatically.
- **One-tap exports** — CSV downloads for students, dues and payments; the
  report centre keeps its branded PDF/Excel documents.
- **Scheduled auto-backup** — daily/weekly cadence in the Backup section; the
  backup file downloads automatically when due.
- **Component modules** — the page's giant inline script now lives in
  `js/admin/boot.js` with the layout, search, backup and export components
  beside it; `admin.html` keeps a tiny importer.

Beyond CRUD for every collection, the panel includes:

- **Fees & finance** — collect a due through a payment sheet that captures
  amount, date, method, reference and remarks, generates a receipt number and
  opens the receipt preview (PDF ডাউনলোড / ছবি শেয়ার — the same flow the
  student portal uses to download their receipt). Totals, discounts, paid and
  due are derived.
- **Report Centre** — deliberately small: three groups of icon cards and eight
  documents, no duplicates.
  - *Finance Reports* — Collection (month-wise আদায় summary), Due / Outstanding,
    Student-wise Finance (billed / paid / due per student), Payment History
    (every transaction, newest first).
  - *Student Reports* — Student List, Class-wise List, Active / Inactive List.
  - *Notice Reports* — Notice History.

  One class filter drives all of them. A tap on a card builds the branded
  document and opens the shared preview, which downloads a **PDF** or an
  **Excel (CSV, UTF-8 BOM)** file — the browser print dialog is never opened.
  The exam, result, merit, performance, assignment, material, routine, batch,
  teacher, discount and activity reports, the duplicate due/finance variants and
  the whole analytics chart dashboard were removed on purpose.
- **Student profile sheet** — ID card, fee ledger and results, printable.
- **Printable admission form (PDF)** — the \"ভর্তি সম্পন্ন\" confirmation and the
  student profile sheet both offer an \"এডমিশন ফরম PDF\" button. It renders an
  admission form with the institution logo and full name (from Settings) plus
  the student's details (name, unique ID, class/section/roll/batch, school,
  guardian, mobile, admission date, status) and a signature area, then opens
  the shared document preview so the admin downloads it as a PDF. The document
  reuses the shared letterhead; the logo is drawn once.
- **WhatsApp admission** — after admitting a student the admin gets a
  "ভর্তি সম্পন্ন" confirmation with a one-tap button that opens WhatsApp
  pre-filled with the admission details including the auto-generated unique
  ID, addressed to the guardian's mobile. Each student row and the profile
  sheet also carry a "হোয়াটসঅ্যাপে পাঠান" button (uses the `wa.me` deep link,
  no API key/backend).
- **Users & permissions** — a 24-key permission matrix per role.
- **Activity log** — who did what, when. Ordinary users cannot delete entries.
- **Backup / restore** — export and import with validation and an explicit
  confirmation, never a silent overwrite.

### Permission model

`PERMISSIONS` in `js/data.js` lists 24 granular rights (view/add/edit/delete
students, view/add/edit teachers, manage classes, batches, subjects, exams,
questions, publish results, manage materials, assignments, routine, view
finance, manage payments, view reports, manage notices, notifications, users,
settings, backup). Admins hold all of them; teachers get a teaching-only
subset; students get none.

Rights are enforced at the **data layer** — `can()` and `assertCan()` guard
every write — not merely by hiding buttons. Search is scoped the same way: a
teacher searching never sees another class's students, and a student never sees
anyone but themselves. Both are enforced in browser code, so they protect against
mistakes rather than a determined user with DevTools (see the security note under
*Student Home*).

### Institute profile (Settings)

Settings → **প্রতিষ্ঠানের তথ্য** in `admin.html` is where the coaching centre's own
identity is written and edited:

| Field | Stored as | Validation |
| ----- | --------- | ---------- |
| প্রতিষ্ঠানের নাম | `settings.orgName` | required |
| ঠিকানা | `settings.address` | required |
| মোবাইল নম্বর | `settings.mobile` | required · 11 digits from `01`, `+880` accepted, Bengali digits accepted |
| ইমেইল | `settings.email` | required · `name@domain.tld` |

`orgInfo()` / `saveOrgInfo()` in `js/data.js` own these four values: the form
saves nothing unless every field passes, the failure is reported per field in
Bengali (message under the form, red outline on the offending input, toast),
and every accepted edit is written to the activity log. A live letterhead
preview under the fields mirrors what a document will print as the admin types.

The saved profile is then reused everywhere the institute appears — the print
letterhead (`ph-org` / `ph-addr` / `ph-contact`), receipts, reports, admission
forms, ID cards and fee ledgers (`js/docs.js`), the institute card on the admin
Home (with tap-to-call and tap-to-email links plus an edit shortcut), the login
screen and the student app's Help card. Nothing outside Settings hard-codes the
name, address, mobile or email.

### Admin controls

Settings → Home configuration in `admin.html`:

- **Home cards** — show/hide each Home section (progress, today, classes,
  assignments, exams, materials, results, performance, challenge, leaderboard,
  fee, notices, tips).
- **See More features** — choose which secondary features appear in the See More
  list and the More screen's quick row (question bank, progress, achievements,
  certificates, downloads, teacher query, streak, profile, settings, help). The
  button disappears when the list is empty.
- **Daily challenge target** — questions per day (the progress bar follows it).
- **Fee card** — hide the fee card entirely.
- **Student-editable profile fields** — what a student may change themselves
  (default: mobile number only).

Plus content CRUD: **Teacher's Tips** (with an expiry date), **Home Banners**
(title, link, optional image URL), **Materials** (optional file URL, which turns
the Download Centre entry into a real download), and **Assignment submissions**
to check with feedback.

### Tests

`npm test` runs 226 Node tests: data-layer helpers, the permission matrix, the
student Home rendered in jsdom (every card, empty states, and a dead-button
sweep that clicks every interactive element), real boots of the admin and
teacher portals, every report card (preview, PDF and Excel download, class
filtering), the payment and receipt flow, notification badges, lazy table
pagination, error boundaries with Retry, role-based routing guards, and the full
login → home handoff. The newest files cover the Bengali date format on every
rendered portal view *and* in the generated documents (receipts, reports, ID
cards — the canvases are read back and scanned), the paste-template exam flow
end to end (paste → publish → sit → countdown → auto-submit → review), and the
top bar / entry-home rules, and the printed question paper with its answer key
(the painted sheets are read back string by string).

## Configuring Firebase (optional)

Edit `firebaseConfig` at the top of `js/firebase.js` with your project's keys.
Once the placeholders are replaced the app initialises Firebase Auth + Realtime
Database and signs in against it; until then it runs in local mode so nothing
breaks on GitHub Pages.

### Deploy the security rules

> **Cloud mode is not production-ready yet.** Two things must be fixed first:
>
> 1. Nothing writes `roles/<uid>/role`, which every rule checks — so after
>    `firebase deploy` *all* clients (including the admin) are denied the
>    mirrored store. Bootstrap that node from a trusted place (a Cloud Function
>    or the console) before relying on the rules.
> 2. The client only reads/writes the single `activeplus/data` mirror, so the
>    per-collection rules below are not exercised yet, and a whole-store `set()`
>    means concurrent edits overwrite each other (last write wins).
>
> Until then treat the app as single-device local storage.

`database.rules.json` holds the Realtime Database rules. Deploy them with
`firebase deploy --only database` (or paste them into the console under
Realtime Database → Rules). They deny anonymous access by default and enforce
the same boundaries the UI shows:

- `activeplus/data` (the mirrored store) is **admin-only** — a student client
  cannot pull the whole database.
- `fees/<studentId>` is readable only by that student (plus admin);
  `payments` is admin-only.
- `students/<id>/phone` is the only student-writable profile field unless the
  admin widens `studentEditableFields` in Settings.
- Shared reference data (classes, routine, materials, exams, notices, tips) is
  readable when signed in and never student-writable.

In local mode there is no server to enforce anything, so the data layer
(`js/data.js`) applies the same filters: every home helper takes the signed-in
student and returns only their own rows.

## Notes

- The whole UI is mobile-first: safe-area insets, 44px touch targets, swipeable
  tab bars, tables that scroll inside their own wrapper, and modals that become
  bottom sheets on phones.
- Service worker is network-first for navigation so deploys show up immediately
  while still opening offline from cache.
