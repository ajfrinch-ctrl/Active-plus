/**
 * Student-side display preferences + small delightful effects.
 *
 * Preferences live on the device (localStorage), not in the shared database:
 * they describe how THIS student wants THIS phone to look and sound, they are
 * not part of the student's record. Three of them today:
 *
 *   digits — 'bn' (বাংলা ১২৩) or 'en' (English 123)
 *   sound  — exam countdown beeps on/off
 *   font   — 'sm' | 'md' | 'lg' interface text size
 *
 * The digit choice is applied through data.js's setDigitMode() so every shared
 * formatter (toBnDigits, formatBnDate…) follows it automatically.
 */

import { setDigitMode } from './data.js';

const KEY = 'activeplus_student_prefs';
const DEFAULTS = { digits: 'bn', sound: true, font: 'md' };

export function getPrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      digits: parsed.digits === 'en' ? 'en' : 'bn',
      sound: parsed.sound !== false,
      font: ['sm', 'md', 'lg'].includes(parsed.font) ? parsed.font : 'md'
    };
  } catch (e) {
    return { ...DEFAULTS }; // blocked/corrupt storage must never break the page
  }
}

/** Persists one preference and applies its visible effect immediately. */
export function setPref(key, value) {
  const next = { ...getPrefs(), [key]: value };
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
  applyPrefs();
  return next;
}

/** Applies every stored preference to the live page (called once on boot). */
export function applyPrefs() {
  const prefs = getPrefs();
  setDigitMode(prefs.digits);
  const body = typeof document !== 'undefined' ? document.body : null;
  if (body) {
    body.classList.toggle('pref-font-sm', prefs.font === 'sm');
    body.classList.toggle('pref-font-lg', prefs.font === 'lg');
  }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Soft beeps for the exam countdown — WebAudio, no asset downloads.   */
/* ------------------------------------------------------------------ */

let actx = null;

/** One short, gentle tone. Silent whenever sound is off or audio is unavailable. */
export function beep(freq = 880, dur = 0.14, when = 0) {
  if (!getPrefs().sound) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = actx || new AC();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    const t0 = actx.currentTime + when;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio device — stay silent */ }
}

/** ৫ মিনিট বাকি — two bright pips. */
export const beepWarn5 = () => { beep(880, 0.14, 0); beep(880, 0.14, 0.22); };
/** ১ মিনিট বাকি — three quicker pips. */
export const beepWarn1 = () => { beep(660, 0.13, 0); beep(660, 0.13, 0.2); beep(660, 0.13, 0.4); };
/** সময় শেষ / স্বয়ংক্রিয় জমা — one calm low tone. */
export const beepTimeUp = () => beep(440, 0.4, 0);

/* ------------------------------------------------------------------ */
/* Confetti for a good result — pure DOM/CSS, removes itself.          */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'];

export function confettiBurst(host, count = 44) {
  if (!host || reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('i');
    const size = 6 + Math.round(Math.random() * 6);
    bit.style.cssText = [
      `left:${(Math.random() * 100).toFixed(1)}%`,
      `width:${size}px`,
      `height:${Math.round(size * 0.6)}px`,
      `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
      `animation-delay:${(Math.random() * 0.45).toFixed(2)}s`,
      `animation-duration:${(2.1 + Math.random() * 1.2).toFixed(2)}s`,
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`,
      `--drift:${Math.round(Math.random() * 140 - 70)}px`
    ].join(';');
    layer.appendChild(bit);
  }
  host.appendChild(layer);
  const t = setTimeout(() => layer.remove(), 3600);
  t.unref?.(); // Node/jsdom: a stray timer must never hold the process open
}
