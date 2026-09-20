/**
 * BackButtonController — the app's back button, class-based.
 *
 * The complaint this fixes: *"ব্যাক বটম ক্লিক করলে এপ্স থেকে বের হয়ে যাচ্ছে"* —
 * tapping Back threw the student out of the installed app instead of returning
 * to the screen they were just on. The reason: every screen in the portals is
 * painted in place (bottom-nav views, আরও panels, detail sheets, modals), so
 * nothing was ever written to the browser history. The phone's Back had nothing
 * to go back *to*, and the PWA task simply closed.
 *
 * So every screen is now a real history entry, and Back walks that list:
 *
 *   1. a sheet (modal) is open   → Back closes the sheet, the screen stays,
 *   2. screens are stacked       → Back returns to the previous screen,
 *   3. only the root is left     → the first Back just warns
 *                                  ("আবার ব্যাক চাপুন"); the second one is handed
 *                                  to the browser, which is what closes the app.
 *
 * Tapping হোম makes Home the root again (`root()`), so the stack can never grow
 * without limit during a long session.
 *
 * In-app back buttons (← ফিরে যান, উত্তরপত্র থেকে ফেরা …) go through
 * `attachBackButton()`: a short press is one screen back, **pressing and holding
 * exits the app** — exactly the gesture the owner asked for. (The hardware Back
 * key itself cannot be "held" from a web page — Android keeps that gesture for
 * the system — which is why the root screen asks for a second press instead.)
 *
 * Nothing here assumes a browser: every history/DOM call is guarded, so the
 * module is safe to import from the Node/jsdom test suite.
 */

/* How long a press must be held before it means "exit the app". */
export const DEFAULT_HOLD_MS = 700;
/* How long the "press Back again to exit" warning stays valid. */
export const EXIT_ARM_MS = 2500;
/* Screens kept on the stack. Beyond this, a new screen replaces the top one,
   so a long session cannot turn Back into a long walk. */
export const MAX_DEPTH = 12;
/* What the root screen says instead of closing the app straight away. */
export const EXIT_WARNING_BN =
  'আপনি অ্যাপের মূল স্ক্রিনে আছেন। বের হতে আবার ব্যাক চাপুন — অথবা অ্যাপের ভেতরের ব্যাক বাটন চেপে ধরে রাখুন।';

/** The controller of the current page (one per portal). */
let instance = null;

/** The live controller, or null when this page has none (Node, plain pages). */
export function activeBackController() {
  return instance;
}

const isDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const safe = (fn) => {
  try { return fn(); } catch (e) { return null; }
};

/* ------------------------------------------------------------------ */
/* Sheets (modals)                                                      */
/*                                                                      */
/* app.js installs its own modal machinery, so a sheet closed by Back    */
/* releases its focus trap, opener focus and scroll lock exactly like a  */
/* × press would.                                                        */
/* ------------------------------------------------------------------ */
let modalBridge = null;

/** `setModalBridge({ list(): Element[], closeTop(): boolean })` — app.js only. */
export function setModalBridge(bridge) {
  modalBridge = bridge && typeof bridge.closeTop === 'function' ? bridge : null;
  return modalBridge;
}

/** Every sheet that is open right now, topmost last. */
function openModalOverlays() {
  if (modalBridge?.list) {
    const rows = safe(() => modalBridge.list());
    if (Array.isArray(rows)) return rows;
  }
  if (!isDom()) return [];
  const rows = safe(() => Array.from(document.querySelectorAll('.modal-overlay.active')));
  return Array.isArray(rows) ? rows : [];
}

/** Closes the topmost sheet, through the app's own closeModal when available. */
function closeTopModalElement() {
  if (modalBridge?.closeTop) return safe(() => modalBridge.closeTop()) === true;
  const top = openModalOverlays().slice(-1)[0];
  if (!top) return false;
  top.classList.remove('active');
  top.setAttribute('aria-hidden', 'true');
  if (!isDom()) return true;
  safe(() => {
    if (!document.querySelector('.modal-overlay.active')) {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    }
  });
  return true;
}

/** app.js `openModal()` → the sheet becomes a step of its own. */
export function noteModalOpened() {
  return instance ? instance.pushSheetStep() : false;
}

/**
 * app.js `closeModal()` → however the sheet was closed (×, backdrop, Escape, a
 * saved form), the history entry it added is given back, so the stack and the
 * address bar can never drift apart.
 */
export function noteModalClosed() {
  return instance ? instance.syncSheetSteps() : false;
}

/**
 * Registers a dismissible layer that is *not* a `.modal-overlay` sheet — the
 * profile dropdowns, for example — so the phone's Back closes it too.
 * `{ isOpen(): boolean, close(): boolean }`.
 */
export function registerOverlay(overlay) {
  if (!instance) return null;
  return instance.registerOverlay(overlay);
}

/** A layer opened outside app.js (a dropdown) still costs one Back step. */
export function noteOverlayOpened() {
  return instance ? instance.pushSheetStep() : false;
}

/** …and gives it back when it closes by any other means. */
export function noteOverlayClosed() {
  return instance ? instance.syncSheetSteps() : false;
}

/** Closes the topmost open sheet. Returns true when one was closed. */
export function closeTopModal() {
  if (!instance) return closeTopModalElement();
  return instance.closeTopSheet({ rewind: true });
}

/**
 * Wires one in-app back button:
 *
 *   • short press / click / Enter → `onShort()` (one screen back)
 *   • press and hold (`holdMs`)   → `onHold()`  (exit the app)
 *   • Escape                      → `onShort()`
 *
 * While it is held the button carries `data-back-hold` and <body> carries
 * `.back-hold`, so CSS can show the gesture; the browser's own long-press menu
 * is suppressed so holding never opens "Open in new tab".
 */
export function attachBackButton(el, {
  onShort = null,
  onHold = null,
  holdMs = DEFAULT_HOLD_MS
} = {}) {
  if (!el || typeof el.addEventListener !== 'function') return null;
  const short = () => { if (typeof onShort === 'function') onShort(); };
  const hold = () => { if (typeof onHold === 'function') onHold(); else short(); };

  let timer = null;
  let fired = false;
  let holding = false;

  const paintHold = (on) => {
    holding = on;
    if (on) el.dataset.backHold = 'true';
    else delete el.dataset.backHold;
    if (isDom()) safe(() => document.body.classList.toggle('back-hold', on));
  };

  const startHold = () => {
    fired = false;
    paintHold(true);
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      paintHold(false);
      if (isDom() && navigator.vibrate) safe(() => navigator.vibrate(28));
      hold();
    }, holdMs);
    /* A pending timer must never hold the Node/jsdom test process open. */
    if (timer && typeof timer.unref === 'function') timer.unref();
  };

  const cancelHold = () => {
    clearTimeout(timer);
    timer = null;
    if (holding) paintHold(false);
  };

  el.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return; // not the primary button
    startHold();
  });
  /* Releasing before the hold is up leaves the click below to do the back step. */
  el.addEventListener('pointerup', cancelHold);
  el.addEventListener('pointercancel', cancelHold);
  el.addEventListener('lostpointercapture', cancelHold);
  /* The short press rides on `click`, so it works for a finger, a mouse, a
     keyboard and a programmatic el.click() alike. A hold that already fired
     swallows the click the browser sends on release. */
  el.addEventListener('click', (event) => {
    cancelHold();
    if (fired) {
      fired = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    short();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelHold(); short(); return; }
    /* Holding Enter/Space down repeats keydown — that is the hold gesture. */
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) startHold();
  });
  el.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') cancelHold();
  });
  el.addEventListener('contextmenu', (event) => {
    if (holding) event.preventDefault();
  });

  return { cancel: cancelHold };
}

export class BackButtonController {
  /**
   * @param {object} options
   * @param {(route:string, info:{fromBack:boolean}) => void} options.route
   *        Paints `route`. Called for every Back step and for a restored route.
   * @param {() => void} [options.onExit]   What "exit the app" means here.
   * @param {(message:string, kind?:string, ms?:number) => void} [options.toast]
   * @param {number} [options.exitArmMs]    Warning window for the second Back.
   * @param {boolean} [options.useHash=true] Keep the current route in the URL.
   * @param {number} [options.maxDepth]     Screens kept before replacing.
   */
  constructor({
    route = null,
    onExit = null,
    toast = null,
    exitArmMs = EXIT_ARM_MS,
    useHash = true,
    maxDepth = MAX_DEPTH
  } = {}) {
    this.routeHandler = typeof route === 'function' ? route : null;
    this.onExit = typeof onExit === 'function' ? onExit : null;
    this.toast = typeof toast === 'function' ? toast : null;
    this.exitArmMs = Math.max(500, Number(exitArmMs) || EXIT_ARM_MS);
    this.useHash = useHash !== false;
    this.maxDepth = Math.max(2, Number(maxDepth) || MAX_DEPTH);

    /** @type {{id:string, modal?:boolean}[]} */
    this.stack = [];
    /** Dismissible layers that are not `.modal-overlay` sheets (dropdowns). */
    this.overlays = [];
    /** History entries this controller added and has not walked back over. */
    this.pushed = 0;
    this.started = false;
    this.destroyed = false;
    this.armedUntil = 0;
    this.exitCalls = 0;
    this.modalOpen = false;
    this.rootRoute = '';         // the screen the root sentinel is restored to
    this._selfClosing = false;   // true while *we* are closing a sheet
    this._suspendUntil = 0;
    this._pending = 0;           // history traversals we started ourselves
    this._popListener = (event) => this._onPopState(event);
    this._hashListener = () => this._onHashChange();

    /* One controller owns a page's Back button. */
    if (instance && instance !== this) instance.destroy();
    instance = this;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  /** Starts listening to the browser's Back. Idempotent. */
  start() {
    if (this.started || this.destroyed || !isDom()) return this;
    this.started = true;
    window.addEventListener('popstate', this._popListener);
    window.addEventListener('hashchange', this._hashListener);
    return this;
  }

  /** Stops listening and forgets the stack (a new controller takes over). */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (instance === this) instance = null;
    if (!isDom()) return;
    window.removeEventListener('popstate', this._popListener);
    window.removeEventListener('hashchange', this._hashListener);
  }

  /* ------------------------------------------------------------------ */
  /* Reading the stack                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * The route of the current screen — the topmost step that is not a sheet, so
   * an open রিসিট/নোটিশ sheet never hides which screen the student is on.
   * Null at the root.
   */
  get top() {
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      if (!this.stack[i].modal) return this.stack[i].id;
    }
    return null;
  }

  get current() { return this.top; }

  /** How many screens (sheets not counted) are on the stack. */
  get depth() { return this.stack.filter((s) => !s.modal).length; }

  /** True when a sheet step is on top of the stack. */
  get modalOnTop() {
    const step = this.stack[this.stack.length - 1];
    return Boolean(step && step.modal);
  }

  /* ------------------------------------------------------------------ */
  /* Writing the stack                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Opens a new screen *on top of* the current one — Back returns here.
   * Past `maxDepth` screens it replaces the top instead, so Back can never
   * become a long walk through a whole session.
   */
  push(route, { url = true } = {}) {
    if (this.destroyed || !isDom()) return false;
    const id = String(route || '').trim();
    if (!id) return false;
    const top = this.stack[this.stack.length - 1];
    if (top && !top.modal && top.id === id) return false; // already there
    if (this.depth >= this.maxDepth) return this.replace(id, { url });

    this.stack.push({ id });
    this.armedUntil = 0;
    /* `n` is how many of our own entries sit below this one — the browser hands
       it back on every traversal, so the stack can never drift from history. */
    if (this._write(url ? this._hashFor(id) : null, { ap: 'step', r: id, n: this.pushed + 1 })) this.pushed += 1;
    return true;
  }

  /**
   * Swaps the screen on top without adding a step — moving sideways between two
   * panels of the same destination (আরও → ফি → আরও → রুটিন).
   */
  replace(route, { url = true } = {}) {
    if (this.destroyed || !isDom()) return false;
    const id = String(route || '').trim();
    if (!id) return false;
    const top = this.stack[this.stack.length - 1];
    if (top && !top.modal && top.id === id) return false;
    /* Never replace a sheet step — the sheet would vanish from the history. */
    if (top && top.modal) return this.push(id, { url });
    if (!this.stack.length) return this.push(id, { url });
    this.stack[this.stack.length - 1] = { id };
    this.armedUntil = 0;
    this._replaceUrl(url ? this._hashFor(id) : null, { ap: 'step', r: id, n: this.pushed });
    return true;
  }

  /**
   * Makes `route` the root of the app again — this is what tapping হোম does.
   *
   * The walk is given up, but the entries it already added are left where they
   * are (walking history back is asynchronous and would race the next tap).
   * What matters is that **one entry of ours stays ahead of the page's first
   * one**: that is the entry the first Back press consumes, so the press can
   * never be the one that closes the installed app.
   */
  root(route = '') {
    if (this.destroyed || !isDom()) return false;
    const id = String(route || '').trim();
    this.stack = id ? [{ id }] : [];
    this.rootRoute = id;
    this.armedUntil = 0;
    this.modalOpen = false;
    const hash = id ? this._hashFor(id) : '';
    if (this.pushed < 1) {
      /* One entry of ours must sit between the page's first entry and the
         student, otherwise the very first Back press is the browser's own and
         the installed app closes — the bug this whole module exists for. */
      if (this._write(hash, { ap: 'root', r: id, n: 1 })) this.pushed = 1;
    } else {
      this._replaceUrl(hash, { ap: 'root', r: id, n: this.pushed });
    }
    return true;
  }

  /**
   * One step back, from inside the app. Returns the route now on top, `null`
   * when that landed on the root, or `false` when there was nothing to do.
   */
  back() {
    if (this.destroyed || !isDom()) return false;
    if (!this.stack.length) return false;
    this.stack.pop();
    const top = this.stack[this.stack.length - 1];
    this.armedUntil = 0;
    this._rewind(1);
    if (top && !top.modal) {
      this._emit(top.id, true);
      return top.id;
    }
    this.warnExit();
    return null;
  }

  /** Drops every screen: the next Back is the browser's own. */
  reset() { return this.root(''); }

  /* ------------------------------------------------------------------ */
  /* Sheets (modals) as steps of their own                               */
  /* ------------------------------------------------------------------ */

  /** Adds a layer the Back button must close before it leaves a screen. */
  registerOverlay(overlay) {
    if (!overlay || typeof overlay.isOpen !== 'function' || typeof overlay.close !== 'function') return null;
    this.overlays.push(overlay);
    return overlay;
  }

  /** How many dismissible layers are open right now (sheets + dropdowns). */
  openLayers() {
    let n = openModalOverlays().length;
    this.overlays.forEach((layer) => { if (safe(() => layer.isOpen()) === true) n += 1; });
    return n;
  }

  /** app.js `openModal()` / an opened dropdown → one sheet step + one entry. */
  pushSheetStep() {
    if (this.destroyed || !isDom() || this._selfClosing) return false;
    const open = this.openLayers();
    if (this.stack.filter((s) => s.modal).length >= open) return false;
    this.stack.push({ id: `sheet:${open}`, modal: true });
    if (this._write(null, { ap: 'sheet', n: this.pushed + 1 })) this.pushed += 1;
    this.modalOpen = true;
    return true;
  }

  /**
   * Closes the topmost sheet and drops its step.
   * `rewind: true` also gives back the history entry (an in-app ← press);
   * `rewind: false` is for the browser's Back, which already moved.
   */
  closeTopSheet({ rewind = true } = {}) {
    if (this.destroyed) return false;
    this._selfClosing = true;
    let closed = false;
    try {
      /* The topmost layer wins: an open dropdown sits above any sheet. */
      for (let i = this.overlays.length - 1; i >= 0 && !closed; i -= 1) {
        if (safe(() => this.overlays[i].isOpen()) === true) closed = safe(() => this.overlays[i].close()) === true;
      }
      if (!closed) closed = closeTopModalElement();
    } finally { this._selfClosing = false; }
    if (!closed) return false;
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      if (this.stack[i].modal) { this.stack.splice(i, 1); break; }
    }
    this.modalOpen = this.openLayers() > 0;
    if (rewind) this._rewind(1);
    else this.pushed = Math.max(0, this.pushed - 1);
    return true;
  }

  /**
   * Drops the sheet steps whose layers are no longer open and rewinds the
   * history entries they added — called by app.js `closeModal()` and by the
   * dropdowns registered through `registerOverlay()`.
   */
  syncSheetSteps() {
    if (this.destroyed || !isDom() || this._selfClosing) return false;
    const open = this.openLayers();
    let steps = this.stack.filter((s) => s.modal).length;
    this.modalOpen = open > 0;
    if (steps <= open) return false;
    const drop = steps - open;
    for (let i = this.stack.length - 1; i >= 0 && steps > open; i -= 1) {
      if (this.stack[i].modal) { this.stack.splice(i, 1); steps -= 1; }
    }
    this._rewind(drop);
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Restore / deep link                                                 */
  /* ------------------------------------------------------------------ */

  /** The route written in the address bar right now ('' when there is none). */
  get hashRoute() {
    if (!isDom()) return '';
    const hash = String(window.location.hash || '');
    return hash.startsWith('#') ? hash.slice(1) : '';
  }

  /**
   * Adopts the route already in the address bar (a re-opened tab, a shared
   * link) as the current screen; `startRoute` is the root when there is none.
   */
  applyHash(startRoute = '') {
    this.start();
    const hash = this.hashRoute;
    /* The login handoff leaves `#s=<token>` behind — that is not a screen. */
    const isHandoff = !hash || /(?:^|&)s=/.test(hash);
    if (!this.useHash || isHandoff) {
      this.root(startRoute);
      return this.top;
    }
    /* A screen named in the address bar becomes the root of this session. */
    this.root(hash);
    return hash;
  }

  /* ------------------------------------------------------------------ */
  /* The Back button itself                                              */
  /* ------------------------------------------------------------------ */

  /**
   * One Back press from inside the app (an in-app ← button). The browser's own
   * Back arrives through popstate instead, so a step is never popped twice.
   * Returns `'sheet' | 'route' | 'confirm' | 'exit'`.
   */
  handleBack() {
    if (this.destroyed) return 'exit';

    /* 1. A sheet or dropdown is open → close it, stay on the screen behind. */
    if (this.openLayers() && this.closeTopSheet({ rewind: true })) return 'sheet';
    if (this.modalOnTop) this.syncSheetSteps();

    /* 2. A screen is stacked → return to it. */
    if (this.stack.length) {
      this.stack.pop();
      const top = this.stack[this.stack.length - 1];
      this.armedUntil = 0;
      this._rewind(1);
      if (top && !top.modal) { this._emit(top.id, true); return 'route'; }
      this.warnExit();
      return 'confirm';
    }

    /* 3. Root: the first Back warns, the second one leaves. */
    if (Date.now() < this.armedUntil) {
      this.armedUntil = 0;
      this.exit();
      return 'exit';
    }
    this.warnExit();
    return 'confirm';
  }

  /**
   * Leaves the app. The root entry this page added is stepped over as well, so
   * the browser's own Back happens — in an installed PWA that closes the task.
   */
  exit() {
    this.exitCalls += 1;
    this.armedUntil = 0;
    if (this.onExit) { this.onExit(); return true; }
    if (!isDom()) return false;
    this._suspend(1);
    /* Every entry this page added, plus the one we are standing on: the browser
       then does its own Back, which is what closes an installed app. */
    this._go(-(this.pushed + 1));
    this.pushed = 0;
    return true;
  }

  /** Wires an in-app back button: tap = one screen back, hold = exit. */
  attachBackButton(el, options = {}) {
    return attachBackButton(el, {
      onShort: () => this.handleBack(),
      onHold: () => this.exit(),
      ...options
    });
  }

  /** "আবার ব্যাক চাপলে অ্যাপ বন্ধ হবে" — armed for `exitArmMs`. */
  warnExit() {
    this.armedUntil = Date.now() + this.exitArmMs;
    if (this.toast) this.toast(EXIT_WARNING_BN, 'info', this.exitArmMs);
    return this.armedUntil;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  _emit(route, fromBack) {
    if (!this.routeHandler) return;
    try { this.routeHandler(String(route), { fromBack: Boolean(fromBack) }); } catch (e) {
      console.error('[Active Plus] back route failed:', (e && e.stack) || e);
    }
  }

  _hashFor(route) {
    const clean = String(route || '').replace(/^#/, '');
    return clean ? `#${clean}` : '';
  }

  _suspended() { return this._pending > 0 && Date.now() < this._suspendUntil; }

  /**
   * Swallow the popstate our own history.go() is about to fire. One traversal
   * is one event, even for go(-3) — but two separate calls (Escape closing two
   * stacked sheets) queue two, so they are counted, not timed out blindly.
   */
  _suspend(count = 1, ms = 800) {
    this._pending += Math.max(1, count);
    this._suspendUntil = Date.now() + ms;
    if (isDom()) {
      safe(() => setTimeout(() => { this._pending = 0; this._suspendUntil = 0; }, ms + 80)?.unref?.());
    }
  }

  /** Walks history back over `n` of our own entries. */
  _rewind(n) {
    const steps = Math.max(0, Math.min(Number(n) || 0, this.pushed));
    this.pushed -= steps;
    if (!steps || !isDom()) return false;
    this._suspend(1);
    return this._go(-steps);
  }

  _write(hash, state) {
    if (!isDom() || !window.history?.pushState) return false;
    return safe(() => {
      if (hash === null) window.history.pushState(state, '');
      else window.history.pushState(state, '', hash);
      return true;
    }) === true;
  }

  _replaceUrl(hash, state) {
    if (!isDom() || !window.history?.replaceState) return false;
    return safe(() => {
      if (hash === null) window.history.replaceState(state, '');
      else window.history.replaceState(state, '', hash || window.location.pathname + window.location.search);
      return true;
    }) === true;
  }

  _go(delta) {
    if (!isDom() || !window.history || !delta) return false;
    return safe(() => { window.history.go(delta); return true; }) === true;
  }

  /** The browser's Back (or Forward) landed on us. */
  _onPopState(event) {
    if (this.destroyed) return;
    /* The popstate our own history.go() promised: swallow it (one per
       traversal) so it is never mistaken for the student's press. */
    if (this._suspended()) {
      this._pending -= 1;
      if (this._pending <= 0) { this._pending = 0; this._suspendUntil = 0; }
      return;
    }

    const state = (event && event.state) || (isDom() ? window.history?.state : null) || null;
    /* Every entry we wrote carries `n` — how many of our own entries sit below
       it. Reading it back makes the stack self-correcting: even a press we
       missed (a suspended event, a restored tab) cannot leave us out of step. */
    this.pushed = Math.max(0, Number(state?.n) || 0);

    const route = state && state.ap !== 'sheet' && typeof state.r === 'string' && state.r
      ? state.r
      : null;

    if (route) {
      /* We know exactly which screen the browser landed on. */
      this._dropSheets();
      let at = -1;
      for (let i = this.stack.length - 1; i >= 0; i -= 1) {
        if (!this.stack[i].modal && this.stack[i].id === route) { at = i; break; }
      }
      this.stack = at >= 0 ? this.stack.slice(0, at + 1) : [{ id: route }];
      this.armedUntil = 0;
      this._emit(route, true);
      return;
    }

    if (state && state.ap === 'sheet') {
      /* A Forward press onto a sheet entry: nothing sane to restore, so the
         sheet stays closed and the screen below it is repainted. */
      this._dropSheets();
      const under = this.top;
      this.stack = this.stack.filter((step) => !step.modal);
      if (under) this._emit(under, true);
      return;
    }

    /* The page's own first entry: the app has nothing left to go back to. This
       is the press that used to close the app without a word. */
    this._dropSheets();
    this.stack = [];
    this.modalOpen = false;

    if (Date.now() < this.armedUntil) {
      /* The student was warned a moment ago and pressed again — they mean it. */
      this.armedUntil = 0;
      this.exit();
      return;
    }
    this.warnExit();
    /* Put an entry of ours back, so this warning is what the root always costs
       and the *next* press is the one that leaves. */
    const home = this.rootRoute;
    if (this._write(this._hashFor(home), { ap: 'root', r: home, n: 1 })) {
      this.pushed = 1;
      this.stack = home ? [{ id: home }] : [];
    }
  }

  /**
   * Closes every open sheet without touching the history — used when the
   * browser has already moved us somewhere else.
   */
  _dropSheets() {
    this._selfClosing = true;
    try {
      let guard = 0;
      while (this.openLayers() && guard < 12) {
        guard += 1;
        let closed = false;
        for (let i = this.overlays.length - 1; i >= 0 && !closed; i -= 1) {
          if (safe(() => this.overlays[i].isOpen()) === true) closed = safe(() => this.overlays[i].close()) === true;
        }
        if (!closed && !closeTopModalElement()) break;
      }
    } finally { this._selfClosing = false; }
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      if (this.stack[i].modal) this.stack.splice(i, 1);
    }
    this.modalOpen = false;
  }

  /** Somebody edited the fragment by hand — read it as a screen change. */
  _onHashChange() {
    if (this.destroyed || this._suspended() || !this.useHash) return;
    const hash = this.hashRoute;
    if (!hash || this.top === hash) return;
    this.replace(hash);
    this._emit(hash, false);
  }
}

/**
 * For a page with no screen stack of its own (the login page): Back warns once
 * and only the second press leaves.
 */
export function mountExitGuard({ toast = null, onExit = null } = {}) {
  if (!isDom()) return null;
  const controller = new BackButtonController({ toast, onExit });
  controller.start();
  controller.reset();
  return controller;
}
