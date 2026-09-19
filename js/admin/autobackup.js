/**
 * Admin Panel v2 — scheduled automatic backup (স্বয়ংক্রিয় নিয়মিত ব্যাকআপ).
 *
 * The admin picks a cadence (দৈনিক / সাপ্তাহিক). Every time the panel boots,
 * if the schedule is due, a full JSON backup downloads automatically and the
 * run is logged. The panel is a PWA with no server of its own, so the
 * download-to-device model is the honest one: the file lands where the admin
 * keeps their documents, and the same file restores through the existing
 * upload control right next to this setting.
 *
 * Default is off, so nothing downloads on a fresh install; tests never see a
 * scheduled run either.
 */
import { exportBackup, downloadText, logActivity } from '../data.js';
import { showToast } from '../app.js';

const SETTING_KEY = 'activeplus_autobackup';       // 'off' | 'daily' | 'weekly'
const LAST_KEY = 'activeplus_autobackup_last';     // epoch millis of last run
const INTERVALS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

const readSetting = () => {
  try { return localStorage.getItem(SETTING_KEY) || 'off'; } catch { return 'off'; }
};
const readLast = () => {
  try { return Number(localStorage.getItem(LAST_KEY) || 0); } catch { return 0; }
};

export function mountAutoBackup(session) {
  const select = document.getElementById('autobackup-interval');
  const status = document.getElementById('autobackup-status');
  if (!select) return null;

  const who = { user: session?.name || 'admin', role: session?.role || 'admin' };

  const paint = () => {
    select.value = readSetting();
    if (!status) return;
    const last = readLast();
    status.textContent = readSetting() === 'off'
      ? 'অটো ব্যাকআপ বন্ধ আছে — চালু করলে নির্ধারিত সময় পর পর ব্যাকআপ ফাইল ডাউনলোড হবে।'
      : `সর্বশেষ অটো ব্যাকআপ: ${last ? new Date(last).toLocaleString() : 'এখনো হয়নি'}`;
  };

  select.addEventListener('change', () => {
    try { localStorage.setItem(SETTING_KEY, select.value); } catch { /* full */ }
    logActivity({ ...who, action: 'changed auto-backup schedule', target: select.value });
    showToast(select.value === 'off' ? 'অটো ব্যাকআপ বন্ধ করা হলো।' : 'অটো ব্যাকআপ চালু হয়েছে — পরেরবার সময় হলে ফাইল ডাউনলোড হবে।', 'success');
    paint();
  });

  paint();

  // Scheduled run: only when a cadence is chosen and the interval has passed.
  const cadence = readSetting();
  if (cadence !== 'off' && INTERVALS[cadence] && Date.now() - readLast() >= INTERVALS[cadence]) {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`active-plus-auto-backup-${stamp}.json`, exportBackup(), 'application/json');
      try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* full */ }
      logActivity({ ...who, action: 'automatic backup downloaded', target: cadence });
      showToast('⏰ নির্ধারিত অটো ব্যাকআপ ডাউনলোড হয়েছে।', 'success');
      paint();
    } catch (err) {
      console.warn('[Active Plus] auto backup failed:', err);
    }
  }

  return { paint };
}
