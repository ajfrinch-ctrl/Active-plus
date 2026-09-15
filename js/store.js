/**
 * Layered key/value storage shared by auth.js and data.js.
 *
 * localStorage first; when it is blocked (sandboxed preview iframes, strict
 * private browsing) everything transparently falls back to an in-memory Map
 * so the app keeps working for the current page load.
 */

const memoryStore = new Map();

/* Modules that cache parsed values on top of this store must drop those caches
   when the underlying layer is reset, or they keep serving another window's data. */
const resetHooks = new Set();

/** Register a callback fired whenever the storage layer is reset. */
export function onStoreReset(hook) {
  if (typeof hook === 'function') resetHooks.add(hook);
  return () => resetHooks.delete(hook);
}

export function storeGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch (e) { /* storage blocked — fall through to memory */ }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

/**
 * Writes a value. Returns true only when the write reached localStorage —
 * a false return means the value lives in memory for this page load only
 * (storage blocked, private mode, or the quota is full). Callers that promise
 * the user "saved" must check this (spec 51: never report a save that failed).
 */
export function storeSet(key, value) {
  memoryStore.set(key, String(value));
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false; // blocked or QuotaExceededError — reported, never swallowed
  }
}

export function storeRemove(key) {
  memoryStore.delete(key);
  try { window.localStorage.removeItem(key); } catch (e) { /* blocked */ }
}

export function readJSON(key, fallback) {
  const raw = storeGet(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

export function writeJSON(key, value) {
  return storeSet(key, JSON.stringify(value));
}

/** Test hook: clears the in-memory layer (browser page loads start fresh). */
export function _clearMemoryStore() {
  memoryStore.clear();
  resetHooks.forEach((hook) => {
    try { hook(); } catch (e) { /* a broken cache hook must not block the reset */ }
  });
}
