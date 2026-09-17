/**
 * Installable PWA helpers for Active Plus.
 *
 * Captures the browser's `beforeinstallprompt` event so Chrome on Android and
 * Desktop can offer an in-app "Install" button, and exposes whether the app
 * is already running installed (standalone).
 *
 * Importing this module has no side effects: listeners are attached only when
 * initInstall() runs, and every API guards for non-browser contexts (tests)
 * so evaluation here never throws.
 */

let deferredPrompt = null;
const listeners = new Set();
let initialized = false;

const hasWindow = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** True when the app runs installed: standalone window or iOS home-screen webclip. */
export function isStandalone() {
  try {
    if (!hasWindow()) return false;
    if (window.navigator && window.navigator.standalone === true) return true; // iOS webclip
    if (typeof window.matchMedia !== 'function') return false;
    return ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
    );
  } catch (e) {
    return false;
  }
}

/** True once Chrome has offered installation (and the user hasn't decided yet). */
export function isInstallAvailable() {
  return deferredPrompt !== null;
}

/** Runs `fn` now (if install is already offered) and on every offer/decision. */
export function onInstallAvailable(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  if (deferredPrompt) {
    try { fn(); } catch (e) { /* a bad listener must not break install */ }
  }
  return () => { listeners.delete(fn); };
}

const notify = () => {
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* ignore */ }
  });
};

/** Starts capturing the install prompt. Safe to call on every page. */
export function initInstall() {
  if (initialized || !hasWindow()) return false;
  initialized = true;
  try {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // hold it until the user taps our install button
      deferredPrompt = event;
      notify();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      notify();
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Shows the browser's install prompt. Resolves to the user's choice
 * ('accepted' / 'dismissed'), or 'unavailable' when Chrome offers nothing
 * (already installed, unsupported browser, …).
 */
export async function promptInstall() {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  try {
    deferredPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    notify();
    return (choice && choice.outcome) || 'unknown';
  } catch (e) {
    return 'error';
  }
}

/**
 * Wires a hidden install <button>: it appears only while Chrome offers
 * installation and the app isn't installed yet, and hides itself after.
 */
export function mountInstallButton(selector = '#install-btn') {
  if (!hasWindow()) return null;
  initInstall();
  const button = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!button) return null;
  const paint = () => {
    button.hidden = !(isInstallAvailable() && !isStandalone());
  };
  paint();
  onInstallAvailable(paint);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await promptInstall();
    } finally {
      button.disabled = false;
      paint();
    }
  });
  return button;
}
