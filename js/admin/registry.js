/**
 * Admin Panel v2 — section registry.
 *
 * The single source of truth for every admin section: which group it belongs
 * to, its bilingual label (Bengali first, English alongside), its icon and
 * the permission a role needs to see it. The sidebar, the global search and
 * the role-based visibility rules all read from this one list — adding a
 * section is now a one-line change instead of touching nav markup in three
 * places.
 */
import { can } from '../data.js';

/** Groups, in the order the sidebar shows them. */
export const ADMIN_GROUPS = [
  { id: 'dashboard', icon: '📊', label: 'ড্যাশবোর্ড', en: 'Dashboard' },
  { id: 'people', icon: '👥', label: 'মানুষ', en: 'People' },
  { id: 'academic', icon: '🎓', label: 'একাডেমিক', en: 'Academic' },
  { id: 'exam', icon: '📝', label: 'পরীক্ষা', en: 'Exams' },
  { id: 'finance', icon: '💰', label: 'ফাইন্যান্স', en: 'Finance' },
  { id: 'comms', icon: '📣', label: 'যোগাযোগ', en: 'Communication' },
  { id: 'system', icon: '⚙️', label: 'সিস্টেম', en: 'System' }
];

/**
 * Every admin section. `key` is the tab key (panel id = `tab-<key>`),
 * `perm` is a key from PERMISSIONS in data.js — sections without a `perm`
 * are visible to every signed-in role of this portal, and `alias` lists extra
 * spellings the global search matches (the name users type is not always the
 * label on screen).
 *
 * NOTE: on a phone the grouped sidebar is hidden (css/admin-panel.css, below
 * 1024px) and js/admin-home.js renders the menu instead — so a new section
 * needs a tile there too, or it is desktop-only in practice.
 */
export const ADMIN_SECTIONS = [
  { key: 'home', icon: '🏠', label: 'ড্যাশবোর্ড', en: 'Dashboard', group: 'dashboard' },
  { key: 'overview', icon: '📈', label: 'সংক্ষিপ্ত পরিসংখ্যান', en: 'Overview', group: 'dashboard' },
  // A live window into the student portal: see what a class sees, publish the
  // content behind each card, without leaving the panel.
  {
    key: 'studentapp', icon: '📱', label: 'শিক্ষার্থীর অ্যাপ', en: 'Student App Control',
    group: 'dashboard', perm: 'manageSettings',
    // People ask for it as "student app management", typed in Bengali script —
    // the global search matches these spellings too, not just the label.
    alias: ['স্টুডেন্ট অ্যাপ', 'স্টুডেন্ট এপ', 'student app management', 'শিক্ষার্থীর অ্যাপ ম্যানেজমেন্ট']
  },

  { key: 'students', icon: '👨‍🎓', label: 'শিক্ষার্থী', en: 'Students', group: 'people', perm: 'viewStudents' },
  { key: 'teachers', icon: '👨‍🏫', label: 'শিক্ষক', en: 'Teachers', group: 'people', perm: 'viewTeachers' },

  { key: 'batches', icon: '📚', label: 'ব্যাচ', en: 'Batches', group: 'academic', perm: 'manageBatches' },
  { key: 'classes', icon: '🏫', label: 'ক্লাস', en: 'Classes', group: 'academic', perm: 'manageClasses' },
  { key: 'subjects', icon: '📖', label: 'বিষয়', en: 'Subjects', group: 'academic', perm: 'manageSubjects' },
  { key: 'routine', icon: '📅', label: 'ক্লাস রুটিন', en: 'Routine', group: 'academic', perm: 'manageRoutine' },
  { key: 'materials', icon: '📚', label: 'স্টাডি ম্যাটেরিয়াল', en: 'Materials', group: 'academic', perm: 'manageMaterials' },
  { key: 'assignments', icon: '📋', label: 'অ্যাসাইনমেন্ট', en: 'Assignments', group: 'academic', perm: 'manageAssignments' },
  { key: 'submissions', icon: '✅', label: 'জমাকৃত কাজ', en: 'Submissions', group: 'academic', perm: 'manageAssignments' },

  { key: 'exam', icon: '📝', label: 'MCQ পরীক্ষা', en: 'Exams', group: 'exam', perm: 'manageExams' },
  { key: 'questionbank', icon: '❓', label: 'প্রশ্ন ব্যাংক', en: 'Question Bank', group: 'exam', perm: 'manageQuestions' },
  { key: 'results', icon: '🏆', label: 'ফলাফল', en: 'Results', group: 'exam', perm: 'publishResults' },
  { key: 'suggestion', icon: '✍️', label: 'সাজেশন', en: 'Suggestions', group: 'exam', perm: 'manageExams' },

  { key: 'dues', icon: '💰', label: 'বকেয়া ও পেমেন্ট', en: 'Dues & Payments', group: 'finance', perm: 'viewFinance' },
  { key: 'reports', icon: '📊', label: 'রিপোর্ট সেন্টার', en: 'Reports', group: 'finance', perm: 'viewReports' },

  { key: 'notices', icon: '📢', label: 'নোটিশ বোর্ড', en: 'Notices', group: 'comms', perm: 'manageNotices' },
  { key: 'notifications', icon: '🔔', label: 'নোটিফিকেশন', en: 'Notifications', group: 'comms', perm: 'manageNotifications' },
  { key: 'banners', icon: '🖼️', label: 'ব্যানার', en: 'Banners', group: 'comms', perm: 'manageNotices' },
  { key: 'tips', icon: '💡', label: 'শিক্ষকের টিপ', en: 'Tips', group: 'comms', perm: 'manageNotices' },

  { key: 'users', icon: '🔐', label: 'ইউজার ও অনুমতি', en: 'Users & Roles', group: 'system', perm: 'manageUsers' },
  { key: 'backup', icon: '💾', label: 'ব্যাকআপ ও রিস্টোর', en: 'Backup & Restore', group: 'system', perm: 'backup' },
  { key: 'settings', icon: '⚙️', label: 'সেটিংস', en: 'Settings', group: 'system', perm: 'manageSettings' },
  { key: 'profile', icon: '👤', label: 'অ্যাডমিন প্রোফাইল', en: 'Profile', group: 'system' }
];

export function sectionFor(key) {
  return ADMIN_SECTIONS.find((s) => s.key === key) || null;
}

/**
 * Role-based visibility (spec: রোলভিত্তিক অনুমতি). Admin holds every
 * permission, so today the full list shows; if the admin narrows a role in
 * the permission matrix, sections gated by that permission disappear for it
 * automatically — no nav code changes needed.
 */
export function visibleSections(role) {
  return ADMIN_SECTIONS.filter((s) => !s.perm || can(role, s.perm));
}

export function visibleGroups(role) {
  const sections = visibleSections(role);
  return ADMIN_GROUPS
    .map((group) => ({ ...group, sections: sections.filter((s) => s.group === group.id) }))
    .filter((group) => group.sections.length > 0);
}
