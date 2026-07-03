/**
 * @file Local persistence for the Stack trivia app: client identity, per-room
 * identity (for silent rejoin), and cross-session used-question memory (PRD
 * §4.7/§5.4). Every call is wrapped in try/catch so private-browsing or
 * storage-disabled environments degrade to no-ops/defaults instead of
 * throwing into caller code.
 */

const CLIENT_ID_KEY = 'stack-client-id';
const IDENTITY_PREFIX = 'stack-identity-';
const USED_KEY = 'stack-used-questions';
const EXCLUDE_KEY = 'stack-exclude-used';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function genClientId() {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * This browser's stable client id, creating and persisting one on first
 * call. Falls back to a fresh (unpersisted) id if storage is unavailable —
 * still usable for the current session, just won't survive a refresh.
 * @returns {string}
 */
export function getOrCreateClientId() {
  const existing = safeGet(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = genClientId();
  safeSet(CLIENT_ID_KEY, id);
  return id;
}

/**
 * @typedef {Object} Identity
 * @property {string} role
 * @property {?string} teamId
 * @property {?string} playerId
 * @property {?string} name
 */

/**
 * Persist this client's identity for a room, so a refresh/reconnect can
 * rejoin silently (PRD §5.4).
 * @param {string} roomCode
 * @param {Identity} identity
 */
export function saveIdentity(roomCode, identity) {
  safeSet(IDENTITY_PREFIX + roomCode, JSON.stringify(identity));
}

/**
 * @param {string} roomCode
 * @returns {?Identity} null when absent, unreadable, or storage unavailable.
 */
export function loadIdentity(roomCode) {
  const raw = safeGet(IDENTITY_PREFIX + roomCode);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readUsedSet() {
  const raw = safeGet(USED_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeUsedSet(set) {
  safeSet(USED_KEY, JSON.stringify([...set]));
}

/**
 * @returns {string[]} every question ref ("slug:id") recorded as used,
 *   across sessions/nights.
 */
export function loadUsed() {
  return [...readUsedSet()];
}

/**
 * Merge `refs` into the persisted used-question set. Per PRD §4.7 the caller
 * should invoke this when a question reaches `revealed`
 * (`actions.revealQuestion`'s `onUsedRef` hook).
 * @param {string[]} refs
 */
export function recordUsed(refs) {
  const set = readUsedSet();
  for (const ref of refs) set.add(ref);
  writeUsedSet(set);
}

/** Clear all persisted used-question memory (the setup screen's "reset"). */
export function resetUsed() {
  safeRemove(USED_KEY);
}

/**
 * Get or set the "exclude previously used" setup toggle (persisted; default
 * true). Pass no argument to read; pass a boolean to set and persist it.
 * @param {boolean} [value]
 * @returns {boolean}
 */
export function excludeUsedToggle(value) {
  if (typeof value === 'boolean') {
    safeSet(EXCLUDE_KEY, value ? '1' : '0');
    return value;
  }
  const raw = safeGet(EXCLUDE_KEY);
  return raw === null ? true : raw === '1';
}
