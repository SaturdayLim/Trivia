/**
 * @file Pure room-schema helpers for the v2 state additions (PRD §2 "Room
 * state additions vs v1"): auto-generated room codes (V2-20), the host PIN
 * (V2-19), the room lifecycle / 24h expiry (V2-20), and the team-turn
 * selection claim (V2-14).
 *
 * Everything here is a deterministic function of its arguments — no sync, no
 * DOM, no clock. Callers pass `now` (from `sync.serverNow()`), and randomness
 * arrives via an injected `rng`, so every rule below is testable without a
 * driver. `src/engine/actions.js` is the only module that writes these shapes
 * into synced state.
 */

// ---------------------------------------------------------------------------
// Room codes (V2-20)
// ---------------------------------------------------------------------------

/**
 * Deliberately missing: 0/O, 1/I/L, 2/Z, 5/S, 8/B. The code gets read aloud
 * across a room and typed on phone keyboards, so visually confusable glyphs
 * cost more than the ~40% smaller alphabet does.
 */
export const ROOM_CODE_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';
export const ROOM_CODE_LENGTH = 4;

/** Digits only: the PIN is typed on a numeric keypad. */
export const HOST_PIN_ALPHABET = '0123456789';
export const HOST_PIN_LENGTH = 4;

/** Rooms expire after this much inactivity (V2-20). Mid-game breaks survive. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function randomString(alphabet, length, rng) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}

/**
 * A fresh room code. Collision handling is the caller's: rooms live at
 * `rooms/<code>`, so `createRoom` must check the code is unclaimed and retry
 * (see `actions.createRoom`) — 25^4 ≈ 390k codes against a one-room-at-a-time
 * scale envelope (V2-18) makes a retry loop the whole story.
 * @param {() => number} [rng]
 * @returns {string}
 */
export function generateRoomCode(rng = Math.random) {
  return randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, rng);
}

/**
 * A fresh host PIN (V2-19). Shown once at room creation with a save prompt.
 * @param {() => number} [rng]
 * @returns {string}
 */
export function generateHostPin(rng = Math.random) {
  return randomString(HOST_PIN_ALPHABET, HOST_PIN_LENGTH, rng);
}

/**
 * Generate a room code nobody is using. The `exists` probe is injected (see
 * `driver-firebase.roomExists`) so this stays testable and driver-agnostic.
 *
 * Why a probe at all, when `connect({create: true})` would happily write over
 * a live room: `set()` on an occupied `rooms/<code>` silently evicts the game
 * being played there. Checking first is the only thing standing between a
 * 1-in-390k collision and a wiped room.
 *
 * @param {(code: string) => Promise<boolean>} exists
 * @param {Object} [opts]
 * @param {() => number} [opts.rng]
 * @param {number} [opts.maxAttempts=8]
 * @returns {Promise<string>}
 * @throws when every attempt collided (a real signal something is wrong, not
 *   bad luck: 8 collisions against a near-empty keyspace can't happen by chance).
 */
export async function pickFreeRoomCode(exists, { rng = Math.random, maxAttempts = 8 } = {}) {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateRoomCode(rng);
    if (!(await exists(code))) return code;
  }
  throw new Error(`stack room: no free room code after ${maxAttempts} attempts`);
}

/**
 * True when `code` could have come out of `generateRoomCode` — used to reject
 * typos at the join screen before a Firebase round trip.
 * @param {string} code
 * @returns {boolean}
 */
export function isValidRoomCode(code) {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}

/**
 * Normalize user-typed input before validating/joining: trim, uppercase, and
 * fold the confusable glyphs the alphabet excludes onto the ones it keeps
 * (someone who hears "O" types O; the code really contains Q or 0-less D).
 * Only the unambiguous folds are applied: O->0 is NOT one of them, because 0
 * isn't in the alphabet either — O simply cannot be part of a valid code.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeRoomCode(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * Constant-time-ish PIN comparison. Not a security boundary (the PIN sits in
 * the room tree, readable by anyone holding the room code — same trust model
 * as the room code itself, see docs/FIREBASE-SETUP.md); this only stops a
 * casual mistype from being accepted and avoids `==` type coercion.
 * @param {?string} stored
 * @param {?string} given
 * @returns {boolean}
 */
export function pinMatches(stored, given) {
  if (typeof stored !== 'string' || typeof given !== 'string') return false;
  // An empty stored PIN means "this room has no PIN", not "the empty PIN opens
  // it" — otherwise a room created with hostPin: '' is claimable by anyone
  // who submits a blank field.
  if (stored.length === 0 || given.length === 0) return false;
  if (stored.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Lifecycle (V2-20)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Lifecycle
 * @property {number} createdAt - epoch ms (server clock).
 * @property {number} lastActivityAt - epoch ms; bumped by every host action.
 */

/**
 * @param {number} now
 * @returns {Lifecycle}
 */
export function initialLifecycle(now) {
  return { createdAt: now, lastActivityAt: now };
}

/** Room status lives at `meta.status`; accept a bare `{status}` too. */
function roomStatus(room) {
  if (!room) return undefined;
  return (room.meta && room.meta.status) ?? room.status;
}

/**
 * A room is expired when the host closed it, or when nothing has happened for
 * `ttlMs`. Note what this does NOT do: an in-progress game with a paused
 * timer is not "activity", but a mid-game break of a few hours still leaves
 * `lastActivityAt` well inside the 24h window (V2-20: "mid-game breaks
 * survive"). A room only ages out when the whole night is over.
 *
 * @param {{meta?: {status?: string}, status?: string, lifecycle?: ?Lifecycle}} room
 *   the room tree (or just its `{status, lifecycle}`).
 * @param {number} now - epoch ms.
 * @param {number} [ttlMs=ROOM_TTL_MS]
 * @returns {boolean}
 */
export function isRoomExpired(room, now, ttlMs = ROOM_TTL_MS) {
  if (!room) return true;
  if (roomStatus(room) === 'closed') return true;
  const last = room.lifecycle && room.lifecycle.lastActivityAt;
  if (typeof last !== 'number') return false; // no lifecycle recorded -> don't reap
  return now - last >= ttlMs;
}

/**
 * Milliseconds until `room` ages out, or `Infinity` when it never will on
 * inactivity alone. Negative once expired. Handy for a lobby countdown.
 * @param {{meta?: {status?: string}, status?: string, lifecycle?: ?Lifecycle}} room
 * @param {number} now
 * @param {number} [ttlMs=ROOM_TTL_MS]
 * @returns {number}
 */
export function msUntilExpiry(room, now, ttlMs = ROOM_TTL_MS) {
  if (!room || roomStatus(room) === 'closed') return -Infinity;
  const last = room.lifecycle && room.lifecycle.lastActivityAt;
  if (typeof last !== 'number') return Infinity;
  return last + ttlMs - now;
}

// ---------------------------------------------------------------------------
// Selection claim (V2-14)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SelectionClaim
 * @property {string} playerId - the teammate who tapped first; holds control.
 * @property {string} teamId - whose turn this claim belongs to; a claim from a
 *   past turn can never gate the current one.
 * @property {'category'|'difficulty'} screen - how far the claimant has got.
 * @property {?string} slug - the Category chosen, once `screen` is 'difficulty'.
 *   The Display needs it: PRD §3.4 shows a difficulty-selection view with that
 *   Category's remaining counts per tier, and no other synced node names the
 *   Category between the claim and the drawn question.
 * @property {number} at - epoch ms.
 */

/** The two screens a claim can be parked on, in order. */
export const CLAIM_SCREENS = ['category', 'difficulty'];

/**
 * @param {string} playerId
 * @param {string} teamId
 * @param {number} now
 * @param {'category'|'difficulty'} [screen='category']
 * @param {?string} [slug=null]
 * @returns {SelectionClaim}
 */
export function makeSelectionClaim(playerId, teamId, now, screen = 'category', slug = null) {
  return { playerId, teamId, screen, slug, at: now };
}

/**
 * Whether `playerId` currently drives the selection UI. A claim held by a
 * *different team* never locks anyone — it's stale state from a previous turn
 * that `advance()` hasn't cleared yet, and treating it as live would freeze
 * the incoming team's selection screen.
 * @param {?SelectionClaim} claim
 * @param {string} playerId
 * @param {string} teamId - the team whose turn it is right now.
 * @returns {boolean}
 */
export function holdsClaim(claim, playerId, teamId) {
  if (!claim || claim.teamId !== teamId) return false;
  return claim.playerId === playerId;
}

/**
 * Whether `playerId`'s selection UI should be locked out: a teammate got there
 * first (V2-14). Players on other teams aren't "locked" — they simply have no
 * selection turn, which the caller distinguishes.
 * @param {?SelectionClaim} claim
 * @param {string} playerId
 * @param {string} teamId - the team whose turn it is right now.
 * @returns {boolean}
 */
export function isLockedOut(claim, playerId, teamId) {
  if (!claim || claim.teamId !== teamId) return false;
  return claim.playerId !== playerId;
}
