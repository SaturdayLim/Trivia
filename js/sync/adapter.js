/**
 * js/sync/adapter.js
 *
 * Driver-agnostic realtime sync layer for the Stack trivia app. Exposes a small
 * set of async primitives (update / transact / onChange / onPresence / serverNow
 * / close) over an arbitrary JSON room tree, backed by a pluggable "driver"
 * (see driver-mock.js for the same-device reference implementation; a future
 * driver-firebase.js implements the identical contract over Firebase RTDB).
 *
 * ---------------------------------------------------------------------------
 * DRIVER CONTRACT
 * ---------------------------------------------------------------------------
 * A driver is a plain ES module (or object) exporting exactly these functions
 * (matches PRD §5.2's `{connect, update, transact, subscribe, presence,
 * offsetProbe}`, plus `close` added here for symmetric teardown):
 *
 *   connect({roomCode, clientId, role, create, initialState}) -> Promise<Session>
 *     - `create: true`  -> caller is the room creator (GM). Driver writes
 *       `initialState` as the room tree and resolves immediately.
 *     - `create: false` -> caller is joining. Driver MUST NOT resolve until a
 *       real snapshot of the room is available (either fetched live, or — for
 *       drivers that support it — recovered from a durable local fallback).
 *     - Resolves to an opaque `Session` value. The adapter treats it as a
 *       black box except for one required field: `session.tree` (the initial
 *       full room state at resolve time, a plain JSON-serializable object).
 *       Everything else is driver-private; the adapter never reaches into it.
 *     - Rejects if the room cannot be reached and cannot be recovered.
 *
 *   update(session, path, value) -> Promise<void>
 *     - Unconditional set at `path` (see path syntax below); `value === null`
 *       deletes the key. Resolves once the write is durably applied by the
 *       room's authority. Callers may treat this as fire-and-forget (ignore
 *       the returned promise) or await/catch it to detect connectivity loss.
 *
 *   transact(session, path, txnFn) -> Promise<{committed: boolean, current: any}>
 *     - Optimistic-concurrency read-modify-write. `txnFn` is a pure function
 *       of the current value at `path`; it runs LOCALLY (never serialized
 *       across the wire — functions can't cross a BroadcastChannel/socket),
 *       possibly more than once if another writer races it. Driver
 *       implementations must guarantee the LAST invocation of `txnFn` before
 *       resolving was evaluated against a value that really was, at some
 *       point, the authority's current value for that path (no false aborts
 *       from stale local caches). `txnFn(current) => undefined` aborts.
 *
 *   subscribe(session, cb) -> unsubscribe()
 *     - Delivers every applied change as `cb({path, value})`, path-unfiltered
 *       (whole-tree diff feed). The adapter itself does path-scoped filtering
 *       and clone-on-delivery for `onChange` — kept out of the driver so the
 *       filtering logic is one small pure function, unit-testable without a
 *       driver at all.
 *
 *   presence(session, cb) -> unsubscribe()
 *     - Delivers roster updates as `cb(rosterArray)`, where each entry is
 *       `{clientId, role, lastSeen, connected}`.
 *
 *   offsetProbe(session) -> number
 *     - Synchronous best-known (serverTime - localTime) estimate in ms. Same-
 *       device drivers (driver-mock) return 0. `serverNow()` = Date.now() +
 *       offsetProbe(session).
 *
 *   close(session) -> void
 *     - Releases driver resources (sockets/channels/timers). Not part of the
 *       PRD's 6-name summary list but required for correct teardown; treated
 *       as optional (feature-detected) so a minimal driver still works.
 *
 * PATH SYNTAX: slash-separated object-key segments, e.g. "game/tapIn/winner".
 * "/" (or "" or null) addresses the whole tree. There is no array-index
 * addressing contract; arrays are opaque leaf values you set/replace wholesale.
 *
 * CLONING: every value handed to a caller callback (onChange, onPresence) or
 * returned in a resolved promise (transact's `snapshot`) is a deep clone —
 * callers can never mutate adapter-internal state by mutating a callback arg.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} PresenceEntry
 * @property {string} clientId
 * @property {string} role
 * @property {number} lastSeen - epoch ms of the last heartbeat/activity seen.
 * @property {boolean} connected - false once the authority hasn't heard from
 *   this client for longer than the driver's disconnect window.
 */

/**
 * @typedef {Object} TransactResult
 * @property {boolean} committed - true if txnFn's non-undefined return value
 *   was applied.
 * @property {any} snapshot - deep clone of the WHOLE room tree immediately
 *   after this call settles (reflects the winning value whether or not this
 *   call itself committed).
 */

/**
 * @typedef {Object} SyncHandle
 * @property {(path: string, value: any) => Promise<void>} update
 * @property {(path: string, txnFn: (current: any) => any) => Promise<TransactResult>} transact
 * @property {(path: string, cb: (value: any) => void) => (() => void)} onChange
 * @property {(cb: (roster: PresenceEntry[]) => void) => (() => void)} onPresence
 * @property {() => number} serverNow
 * @property {() => void} close
 */

/**
 * Split a slash-separated path into segments. "/", "", null and undefined all
 * mean "whole tree" (empty segment array).
 * @param {?string} path
 * @returns {string[]}
 */
export function splitPath(path) {
  if (path == null || path === '/' || path === '') return [];
  return path.split('/').filter((seg) => seg.length > 0);
}

/**
 * Read the value at `segs` inside `tree`. Returns undefined if any segment is
 * missing or the walk hits a non-object.
 * @param {any} tree
 * @param {string[]} segs
 * @returns {any}
 */
export function getAtPath(tree, segs) {
  let cur = tree;
  for (const seg of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Deep clone a JSON-safe value. Prefers structuredClone; falls back to a
 * JSON round-trip (older environments). undefined passes through unchanged.
 * @param {any} value
 * @returns {any}
 */
export function clone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Immutably set `value` at `segs` inside `tree`, creating intermediate plain
 * objects as needed. `value === null` deletes the key (or, at the root,
 * resets the whole tree to `{}`). Never mutates `tree`.
 * @param {any} tree
 * @param {string[]} segs
 * @param {any} value
 * @returns {any} a new tree
 */
export function setAtPath(tree, segs, value) {
  if (segs.length === 0) {
    return value === null ? {} : clone(value);
  }
  const root = isPlainObject(tree) ? { ...tree } : {};
  let node = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i];
    const existing = node[key];
    node[key] = isPlainObject(existing) ? { ...existing } : {};
    node = node[key];
  }
  const lastKey = segs[segs.length - 1];
  if (value === null) {
    delete node[lastKey];
  } else {
    node[lastKey] = clone(value);
  }
  return root;
}

/**
 * True if a change at `diffSegs` could affect the value observed at
 * `subSegs` — i.e. one path is a prefix of (or equal to) the other. Pure and
 * driver-agnostic; used to fan a whole-tree diff stream out to path-scoped
 * onChange subscribers.
 * @param {string[]} diffSegs
 * @param {string[]} subSegs
 * @returns {boolean}
 */
export function pathAffects(diffSegs, subSegs) {
  const len = Math.min(diffSegs.length, subSegs.length);
  for (let i = 0; i < len; i++) {
    if (diffSegs[i] !== subSegs[i]) return false;
  }
  return true;
}

/**
 * Create a realtime sync handle for one room, backed by `driver`.
 *
 * @param {Object} opts
 * @param {Object} opts.driver - a module/object implementing the driver
 *   contract documented above (e.g. `import * as driverMock from
 *   './driver-mock.js'`).
 * @param {string} opts.roomCode
 * @param {string} opts.clientId - stable identity for this tab/device;
 *   callers are responsible for persisting/reusing it across reconnects.
 * @param {string} opts.role - e.g. 'gm' | 'player' | 'display'.
 * @param {boolean} [opts.create=false] - true to create the room (GM only).
 * @param {any} [opts.initialState=null] - room tree to write when create=true.
 * @returns {Promise<SyncHandle>}
 */
export async function createSync({
  driver,
  roomCode,
  clientId,
  role,
  create = false,
  initialState = null,
}) {
  if (!driver) throw new Error('stack sync: driver is required');
  if (!roomCode) throw new Error('stack sync: roomCode is required');
  if (!clientId) throw new Error('stack sync: clientId is required');
  if (!role) throw new Error('stack sync: role is required');

  const session = await driver.connect({ roomCode, clientId, role, create, initialState });

  /** @type {any} local mirror of the room tree, kept in sync via diffs */
  let cache = clone(session.tree ?? {});
  /** @type {Set<{segs: string[], cb: (value: any) => void}>} */
  const changeSubs = new Set();
  /** @type {Set<(roster: PresenceEntry[]) => void>} */
  const presenceSubs = new Set();
  /** @type {?PresenceEntry[]} */
  let lastRoster = null;
  let closed = false;

  const unsubDiff = driver.subscribe(session, (diff) => {
    if (closed) return;
    const diffSegs = splitPath(diff.path);
    cache = setAtPath(cache, diffSegs, diff.value);
    for (const sub of changeSubs) {
      if (pathAffects(diffSegs, sub.segs)) {
        sub.cb(clone(getAtPath(cache, sub.segs)));
      }
    }
  });

  const unsubPresence = driver.presence(session, (roster) => {
    if (closed) return;
    lastRoster = roster;
    for (const cb of presenceSubs) cb(clone(roster));
  });

  /**
   * Set a subtree. `value === null` deletes it. Safe to ignore the returned
   * promise (fire-and-forget); await/catch it to detect a request that could
   * not reach the room's authority within the driver's retry window.
   * @param {string} path
   * @param {any} value
   * @returns {Promise<void>}
   */
  async function update(path, value) {
    return driver.update(session, path, value);
  }

  /**
   * Atomic read-modify-write at `path`. `txnFn(current)` returns the new
   * value to commit, or `undefined` to abort. Serialized by the room's
   * authority: concurrent transacts on the same path never both commit.
   * @param {string} path
   * @param {(current: any) => any} txnFn
   * @returns {Promise<TransactResult>}
   */
  async function transact(path, txnFn) {
    const result = await driver.transact(session, path, txnFn);
    return { committed: !!result.committed, snapshot: clone(cache) };
  }

  /**
   * Subscribe to a subtree. Fires immediately with the current (cloned)
   * value, then again on every change that could affect it. `'/'` subscribes
   * to the whole tree.
   * @param {string} path
   * @param {(value: any) => void} cb
   * @returns {() => void} unsubscribe
   */
  function onChange(path, cb) {
    const entry = { segs: splitPath(path), cb };
    changeSubs.add(entry);
    cb(clone(getAtPath(cache, entry.segs)));
    return () => changeSubs.delete(entry);
  }

  /**
   * Subscribe to the connection roster. Fires immediately with the last
   * known roster (once available), then on every update.
   * @param {(roster: PresenceEntry[]) => void} cb
   * @returns {() => void} unsubscribe
   */
  function onPresence(cb) {
    presenceSubs.add(cb);
    if (lastRoster) cb(clone(lastRoster));
    return () => presenceSubs.delete(cb);
  }

  /**
   * Best current estimate of server epoch time in ms.
   * @returns {number}
   */
  function serverNow() {
    return Date.now() + (typeof driver.offsetProbe === 'function' ? driver.offsetProbe(session) : 0);
  }

  /** Tear down this sync handle and release driver resources. */
  function close() {
    if (closed) return;
    closed = true;
    unsubDiff();
    unsubPresence();
    changeSubs.clear();
    presenceSubs.clear();
    if (typeof driver.close === 'function') driver.close(session);
  }

  return { update, transact, onChange, onPresence, serverNow, close };
}
