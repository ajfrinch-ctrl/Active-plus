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

## Structure

```
index.html          single login — detects the user type and routes to the
                    matching portal (mobile-first)
student.html        student portal — app-style Home (today's progress, next
                    class/exam, daily challenge, materials, assignments,
                    performance, fees, tips, banners) plus Study / Exam /
                    Result / More views
teacher.html        teacher portal — app-style Home (today's teaching, next
                    class, pending work) plus My Classes, Students, Tasks,
                    Materials, Results, Question Bank, Routine, Batches,
                    Attendance, Notices, Query inbox, Notifications, Profile
admin.html          admin panel — app-style Home (institute overview, recent
                    activity) plus full CRUD for students, teachers, classes,
                    batches, subjects, exams, question bank, materials,
                    assignments, submissions, routine, results, fees &
                    payments, notices, notifications, the report centre,
                    users & permissions, activity log, institute profile
                    settings, backup/restore
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
js/admin-home.js    the admin Home: institute overview, feature grid, quick
                    actions, recent activity
js/admin-modules.js admin widgets: question bank, report centre,
                    users + permission matrix, activity log, backup
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

| Section | Data source |
| ------- | ----------- |
| Today's Progress (done/total, %, streak) | today's routine + assignments, `activityLogs` |
| Today summary | routine, assignments, exams, pending items |
| Next class / Upcoming exam | `routine` by class & weekday, `examWindow(exam)` |
| Daily challenge | `settings.dailyChallengeTarget` MCQs, progress persisted |
| Study streak + weekly calendar | `studyActivity` / `activityLogs` |
| Continue Learning + Study Material | `materials` for the student's class, `materialProgress` |
| Pending assignments (submit flow) | `assignments` + `submissions` |
| My Performance + mini chart | that student's own `examResults` |
| Latest result, Achievements | `examResults`, badges earned from real data |
| Fee status | that student's `fees` row + `payments` |
| Notices, Teacher's Tip, banners | admin-managed `notices`, `tips`, `banners` |

Every card answers with the student's own rows only; the data layer filters by
class/batch before anything reaches the UI.

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

Beyond CRUD for every collection, the panel includes:

- **Fees & finance** — collect a due through a payment sheet that captures
  amount, date, method, reference and remarks, generates a receipt number and
  opens a printable receipt. Totals, discounts, paid and due are derived.
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

`npm test` runs 189 Node tests: data-layer helpers, the permission matrix, the
student Home rendered in jsdom (every card, empty states, and a dead-button
sweep that clicks every interactive element), real boots of the admin and
teacher portals, every report card (preview, PDF and Excel download, class
filtering), the payment and receipt flow, notification badges, lazy table
pagination, error boundaries with Retry, role-based routing guards, and the full
login → home handoff.

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
