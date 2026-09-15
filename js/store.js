/**
 * Layered key/value storage shared by auth.js and data.js.
 *
 * localStorage first; when it is blocked (sandboxed preview iframes, strict
 * private browsing) everything transparently falls back to an in-memory Map
 * so the app keeps working for the current page load.
 */

const memoryStore = new Map();

export function storeGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch (e) { /* storage blocked — fall through to memory */ }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

export function storeSet(key, value) {
  memoryStore.set(key, String(value));
  try { window.localStorage.setItem(key, value); } catch (e) { /* blocked */ }
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
  storeSet(key, JSON.stringify(value));
  return true;
}

/** Test hook: clears the in-memory layer (browser page loads start fresh). */
export function _clearMemoryStore() {
  memoryStore.clear();
}
