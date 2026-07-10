/**
 * @file Per-device, per-room identity so a refresh resumes instead of
 * re-registering (PRD §6: "Refresh-resume for all three roles").
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOESN'T JUST USE localStorage
 * ---------------------------------------------------------------------------
 * A client id and a room identity have to be scoped to "one participant". On
 * real devices that is the browser profile, so localStorage is exactly right,
 * and it survives the phone being closed and reopened.
 *
 * The mock driver breaks that assumption on purpose: V2-21 wants a whole Game
 * playable in several TABS of one browser. Those tabs share one localStorage.
 * Keyed there, every tab would read back the same `stack-client-id` and the
 * same `stack-identity-<room>` — so the second player to open a tab would be
 * silently mistaken for the first, join their team, and inherit their seat.
 *
 * So the storage is chosen by driver, not hardcoded:
 *   - Firebase  -> localStorage.   One participant = one browser profile.
 *                                  Survives a full close-and-reopen.
 *   - Mock      -> sessionStorage. One participant = one tab.
 *                                  Survives F5 (which is what resume means
 *                                  here); a closed tab is a player who left.
 *
 * The host PIN follows the same rule for the same reason.
 */

import { isMockDriver } from './driver.js';

const CLIENT_ID_KEY = 'stack-client-id';
const IDENTITY_PREFIX = 'stack-identity-';
const PIN_PREFIX = 'stack-hostpin-';

/** The storage this session's participants live in. See the note above. */
function store() {
  try {
    return isMockDriver() ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function get(key) {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(key, value) {
  try {
    store()?.setItem(key, value);
  } catch {
    /* private browsing / storage full — degrade to in-memory for this page */
  }
}

function remove(key) {
  try {
    store()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

function genClientId() {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * This participant's stable client id, created on first call. Falls back to a
 * fresh unpersisted id when storage is unavailable — usable for this page load,
 * just not across a refresh.
 * @returns {string}
 */
export function getOrCreateClientId() {
  const existing = get(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = genClientId();
  set(CLIENT_ID_KEY, id);
  return id;
}

/**
 * @typedef {Object} Identity
 * @property {string} role - wire role: 'gm' | 'player' | 'display'.
 * @property {string} playerId
 * @property {?string} teamId
 * @property {?string} name
 */

/**
 * Remember this participant's seat in `roomCode`, so a refresh rejoins silently.
 * @param {string} roomCode
 * @param {Identity} identity
 */
export function saveIdentity(roomCode, identity) {
  set(IDENTITY_PREFIX + roomCode, JSON.stringify(identity));
}

/**
 * @param {string} roomCode
 * @returns {?Identity} null when absent, unreadable, or storage unavailable.
 */
export function loadIdentity(roomCode) {
  const raw = get(IDENTITY_PREFIX + roomCode);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Remember the host PIN for `roomCode` on this device only, so the host's own
 * refresh doesn't stop to ask for a secret they've already proven they hold.
 * Any OTHER device must type it — that is the point of having one (V2-19).
 * @param {string} roomCode
 * @param {?string} pin
 */
export function saveHostPin(roomCode, pin) {
  if (pin) set(PIN_PREFIX + roomCode, pin);
  else remove(PIN_PREFIX + roomCode);
}

/**
 * @param {string} roomCode
 * @returns {?string}
 */
export function loadHostPin(roomCode) {
  return get(PIN_PREFIX + roomCode);
}

/**
 * Forget everything about `roomCode` for this participant (Exit / Close Room).
 * @param {string} roomCode
 */
export function forgetRoom(roomCode) {
  remove(IDENTITY_PREFIX + roomCode);
  remove(PIN_PREFIX + roomCode);
}
