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

The login screen lists these with a one-tap "ব্যবহার করুন" fill button, so the
app can always be signed into even before Firebase is configured.

## Structure

```
index.html          login + role selector (mobile-first)
student.html        student portal (routine, attendance, results, fees, profile)
teacher.html        teacher portal (batches, attendance, add-batch modal)
admin.html          admin panel — full CRUD: admission (school/college name),
                    class filter, dues & payment collection (sends a notice to
                    the student on payment), teacher/notice CRUD, institution
                    settings, data reset, suggestion + MCQ authoring
teacher.html        teacher portal — class-targeted notices, suggestions,
                    MCQ exam builder + results, batches, attendance
student.html        student portal — routine, attendance, results, fees,
                    class/personal notices, suggestions, take MCQ exams
css/style.css       single mobile-first stylesheet
js/firebase.js      Firebase integration + offline fallback + toasts
js/auth.js          local sign-in, sessions, route guards
js/app.js           shared shell: header, tabs, tables, modals
js/data.js          persistent data layer (versioned CRUD collections +
                    payments/suggestions/exams + domain helpers)
js/exams.js         shared suggestion/MCQ authoring + exam-taking UI
js/store.js         layered storage (localStorage + in-memory fallback)
service-worker.js   offline caching (network-first for pages)
manifest.json       PWA manifest
assets/             generated icons (see tools/generate-icons.py)
tests/              Node test suite (`npm test`)
```

## Configuring Firebase (optional)

Edit `firebaseConfig` at the top of `js/firebase.js` with your project's keys.
Once the placeholders are replaced the app initialises Firebase Auth + Realtime
Database and signs in against it; until then it runs in local mode so nothing
breaks on GitHub Pages.

### Deploy the security rules

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
