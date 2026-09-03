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
student.html        student portal (routine, attendance, results, fees)
teacher.html        teacher portal (batches, attendance, add-batch modal)
admin.html          admin panel (dashboard, students, teachers, notices)
css/style.css       single mobile-first stylesheet
js/firebase.js      Firebase integration + offline fallback + toasts
js/auth.js          local sign-in, sessions, route guards
js/app.js           shared shell: header, tabs, tables, modals, demo data
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

## Notes

- The whole UI is mobile-first: safe-area insets, 44px touch targets, swipeable
  tab bars, tables that scroll inside their own wrapper, and modals that become
  bottom sheets on phones.
- Service worker is network-first for navigation so deploys show up immediately
  while still opening offline from cache.
