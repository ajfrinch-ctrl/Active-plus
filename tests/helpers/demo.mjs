/**
 * Shared test setup: putting the demo institute into the store.
 *
 * `js/data.js` seeds an EMPTY store — the app ships with no sample people — so
 * any test that clicks through "a coaching centre with data in it" asks for the
 * fixture explicitly. `loadDemoData()` writes the demo records; `loadDemo()`
 * additionally opens the three sign-in accounts the portals are tested with.
 * Both are safe to call as many times as you like: they start from a reset.
 */
import { loadDemoData } from '../../js/demo-data.js';

export { loadDemoData };

/** Accounts beyond the single admin the app hands its installer. */
export const DEMO_ACCOUNTS = [
  {
    username: 'teacher@activeplus.edu',
    password: 'Teacher@123',
    role: 'teacher',
    name: 'রাহেলা আক্তার',
    detail: 'পদার্থবিজ্ঞান'
  },
  {
    username: '2026-09-001',
    password: 'Student@123',
    role: 'student',
    name: 'আরিয়ান হাসান',
    detail: 'নবম শ্রেণি · রোল ০১'
  }
];

/** The demo records *and* the admin/teacher/student accounts that sign in with them. */
export async function loadDemo() {
  loadDemoData();
  const { seedUsers, createLocalAccount } = await import('../../js/auth.js');
  await seedUsers({ force: true });
  for (const account of DEMO_ACCOUNTS) {
    try {
      await createLocalAccount(account);
    } catch (error) {
      // A fixture run twice must not fail on the accounts it just made.
      if (error?.code !== 'username-taken') throw error;
    }
  }
}
