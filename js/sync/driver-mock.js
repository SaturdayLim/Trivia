/**
 * js/sync/driver-mock.js
 *
 * Same-device, multi-tab implementation of the sync driver contract documented
 * in adapter.js (`{connect, update, transact, subscribe, presence, offsetProbe,
 * close}`). No network, no Firebase — built for offline play/testing with
 * every role open in its own browser tab.
 *
 * Transport: a `BroadcastChannel` named `stack-<roomCode>`, one per room.
 * Durability: the full room tree is persisted to
 * `localStorage["stack-room-<roomCode>"]` as `{tree, revision, ts}`,
 * written ONLY by the serializer (see below) — never by a plain client.
 *
 * NOTE ON DUPLICATED UTILITIES: this file re-implements the same small path /
 * clone helpers found in adapter.js instead of importing them. That's
 * deliberate: drivers are meant to be swappable (driver-firebase.js implements
 * the identical contract over Firebase RTDB) and independently testable, so a
 * driver must not depend on the generic adapter layer.
 *
 * ---------------------------------------------------------------------------
 * SERIALIZATION MODEL
 * ---------------------------------------------------------------------------
 * Exactly one tab is the "serializer": the tab that created the room
 * (`connect({create: true, role: 'gm', ...})`). All mutations from every tab
 * — including the serializer's own — are funneled through one synchronous
 * decision function per request (`decidePropose` for `transact`, a plain
 * `setAtPath` for `update`). "Synchronous" is the whole safety argument: a
 * request is either a same-process direct call (the serializer acting on its
 * own behalf) or a `BroadcastChannel` message-event callback (a remote tab's
 * request) — either way it runs to completion with no `await` in between
 * reading the current tree and applying the change, so two requests can never
 * interleave. Requests are therefore atomic and strictly ordered by the
 * order the serializer's event loop actually executes them in — its true
 * "arrival order," which is the only order that can be authoritative in a
 * system with multiple independent senders and no global clock.
 *
 * `transact(path, txnFn)` cannot ship `txnFn` itself to the serializer
 * (functions aren't structured-cloneable, so they can't cross a
 * `BroadcastChannel`). Instead this is optimistic concurrency control: the
 * caller evaluates `txnFn` locally against the value it last saw
 * (`expectedValue`) to produce `proposedValue`, and ships both. The
 * serializer commits only if `expectedValue` still matches its real current
 * value at that path (deep-equal); otherwise it reports the real current
 * value back ('stale') and the caller's `transact()` loop recomputes `txnFn`
 * against it and retries — this is what gives first-write-wins races exactly
 * one winner. A `txnFn` that returns `undefined` (abort) still round-trips
 * once, so an abort decision is never taken against a locally-stale read
 * without confirming it against the serializer's true current value first.
 *
 * ---------------------------------------------------------------------------
 * RECOVERY: GM TAB REFRESH
 * ---------------------------------------------------------------------------
 * A page refresh doesn't run any teardown code in the old tab, so recovery
 * cannot be a handoff — it's a timeout-based takeover driven entirely by the
 * *new* tab's `connect()` call:
 *
 *   1. Any joiner (`create: false`, any role) broadcasts a snapshot-request
 *      and waits up to 1s for a `snapshot-response`.
 *   2. If nothing answers within 1s, the joiner falls back to whatever is in
 *      `localStorage["stack-room-<roomCode>"]` (this counts as "a snapshot
 *      arriving" for adapter.js's `createSync` contract).
 *   3. If the joiner's `role === 'gm'`, it goes further: it *becomes* the new
 *      serializer (adopts the persisted tree, or an empty one if there was
 *      never a persisted snapshot) and resumes serving requests. This is
 *      unconditional on role/timing — the driver does not attempt to verify
 *      the reconnecting GM is "the same" GM as before (no such identity
 *      concept exists at this layer; that's the app's job).
 *   4. Non-GM joiners in the same silent-channel situation adopt the
 *      localStorage snapshot read-only and keep quietly re-requesting a live
 *      snapshot every ~3s (bounded retries) in case a serializer appears.
 *
 * Meanwhile, any `update`/`transact` call already in flight from a surviving
 * tab when the GM disappears has no one to answer it: the request is resent
 * every 500ms until either a (possibly new) serializer answers, or 10s total
 * have elapsed, at which point the call rejects. This is why a killed GM (no
 * refresh, no recovery) surfaces as player write-errors after ~10s rather
 * than a silent hang.
 *
 * KNOWN LIMITATIONS (acceptable for a same-device dev/test driver):
 *  - Split-brain guard is best-effort only: if two 'gm'-role tabs both time
 *    out and self-promote at nearly the same instant, each will demote itself
 *    back to a client as soon as it *hears* the other's broadcast — but there
 *    is no true leader election, so a pathological simultaneous-refresh case
 *    could still cause a brief double-serve. Not exercised by the manual test
 *    checklist (which uses exactly one GM tab).
 *  - Presence is computed centrally by the serializer; if the serializer
 *    itself vanishes, surviving tabs keep the last roster it ever broadcast
 *    (still showing it "connected") until a new serializer starts up and
 *    broadcasts a fresh one. Write timeouts still correctly surface in the
 *    meantime — only the roster *display* is stale.
 *  - State must be JSON-serializable (persisted via `JSON.stringify`).
 *  - Scoped to one browser origin (BroadcastChannel + localStorage are
 *    same-origin), which matches "same device" by construction.
 */

// ---------------------------------------------------------------------------
// Tiny pure utilities (see note above on why these are duplicated)
// ---------------------------------------------------------------------------

/** @param {?string} path @returns {string[]} */
function splitPath(path) {
  if (path == null || path === '/' || path === '') return [];
  return path.split('/').filter((seg) => seg.length > 0);
}

/** @param {any} tree @param {string[]} segs @returns {any} */
function getAtPath(tree, segs) {
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

/** @param {any} value @returns {any} */
function clone(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Immutable set; `value === null` deletes. @returns {any} a new tree */
function setAtPath(tree, segs, value) {
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

/** Structural equality over JSON-safe values. */
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
  }
  return true;
}

let idCounter = 0;
function genId() {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Pure CAS decision — the heart of first-write-wins (kept side-effect-free so
// it's trivially unit-testable in isolation from BroadcastChannel/timers)
// ---------------------------------------------------------------------------

/**
 * @param {any} tree
 * @param {string[]} segs
 * @param {any} expectedValue
 * @param {any} proposedValue - undefined means "abort if expectedValue holds"
 * @returns {{status: 'committed'|'aborted'|'stale', current: any}}
 */
function decidePropose(tree, segs, expectedValue, proposedValue) {
  const current = getAtPath(tree, segs);
  if (!deepEqual(current, expectedValue)) return { status: 'stale', current };
  if (proposedValue === undefined) return { status: 'aborted', current };
  return { status: 'committed', current: proposedValue };
}

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 2000;
const DISCONNECT_MS = 6000;
const GM_RECOVERY_WAIT_MS = 1000;
const REQUEST_RETRY_MS = 500;
const REQUEST_TIMEOUT_MS = 10000;
const BACKGROUND_RESYNC_MS = 3000;
const BACKGROUND_RESYNC_MAX_TRIES = 10;

function channelName(roomCode) {
  return `stack-${roomCode}`;
}
function storageKey(roomCode) {
  return `stack-room-${roomCode}`;
}

function readSnapshot(roomCode) {
  try {
    const raw = localStorage.getItem(storageKey(roomCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistSnapshot(session) {
  try {
    localStorage.setItem(
      storageKey(session.roomCode),
      JSON.stringify({ tree: session.tree, revision: session.revision, ts: Date.now() })
    );
  } catch {
    // storage unavailable/full — degrade to in-memory only, still correct
    // for the lifetime of the tabs that are open.
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function setActiveHandler(session, fn) {
  if (session._handler) session.channel.removeEventListener('message', session._handler);
  session._handler = fn;
  session.channel.addEventListener('message', fn);
}

function adoptSnapshot(session, tree, revision) {
  session.tree = clone(tree ?? {});
  session.revision = typeof revision === 'number' ? revision : session.revision;
  for (const cb of session.diffSubs) cb({ path: '/', value: clone(session.tree) });
}

function applyLocalDiff(session, path, value, revision) {
  if (typeof revision === 'number') {
    if (revision <= session.revision) return; // dedup: already applied (e.g. own diff echoed back)
    session.revision = revision;
  }
  session.tree = setAtPath(session.tree, splitPath(path), value);
  for (const cb of session.diffSubs) cb({ path, value: clone(value) });
}

function touchPresence(session, id, role) {
  const existing = session.presenceMap.get(id);
  session.presenceMap.set(id, {
    role: role || existing?.role || 'unknown',
    lastSeen: Date.now(),
    connected: true,
  });
}

function computeRoster(session) {
  return [...session.presenceMap.entries()].map(([clientId, info]) => ({
    clientId,
    role: info.role,
    lastSeen: info.lastSeen,
    connected: info.connected,
  }));
}

function sweepAndBroadcastPresence(session) {
  const now = Date.now();
  touchPresence(session, session.clientId, session.role);
  for (const info of session.presenceMap.values()) {
    info.connected = now - info.lastSeen <= DISCONNECT_MS;
  }
  const roster = computeRoster(session);
  try {
    session.channel.postMessage({ type: 'roster', roster, ts: now, by: session.clientId });
  } catch {
    /* channel closed */
  }
  for (const cb of session.presenceSubs) cb(clone(roster));
}

/** Apply an unconditional write or a committed propose; persist + broadcast + notify self. */
function applyAndBroadcast(session, path, value, requestId, from) {
  session.revision += 1;
  const ts = Date.now();
  session.tree = setAtPath(session.tree, splitPath(path), value);
  persistSnapshot(session);
  const msg = { type: 'diff', path, value: clone(value), ts, revision: session.revision, requestId, from, by: session.clientId };
  try {
    session.channel.postMessage(msg);
  } catch {
    /* channel closed */
  }
  for (const cb of session.diffSubs) cb({ path, value: clone(value) });
}

function becomeSerializer(session) {
  session.isSerializer = true;
  persistSnapshot(session);
  setActiveHandler(session, (ev) => handleAsSerializer(session, ev));
  session.sweepTimer = setInterval(() => sweepAndBroadcastPresence(session), HEARTBEAT_MS);
  sweepAndBroadcastPresence(session);
}

function demoteToClient(session) {
  if (!session.isSerializer) return;
  session.isSerializer = false;
  if (session.sweepTimer) {
    clearInterval(session.sweepTimer);
    session.sweepTimer = null;
  }
  startClient(session);
  // Resync against whichever serializer is actually authoritative now.
  raceSnapshotResponse(session, REQUEST_RETRY_MS).then((resp) => {
    if (resp && !session.closed) adoptSnapshot(session, resp.tree, resp.revision);
  });
}

function startClient(session) {
  session.isSerializer = false;
  setActiveHandler(session, (ev) => handleAsClient(session, ev));
  const beat = () => {
    try {
      session.channel.postMessage({ type: 'heartbeat', from: session.clientId, role: session.role, ts: Date.now() });
    } catch {
      /* channel closed */
    }
  };
  beat();
  session.heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
}

function startBackgroundResync(session) {
  let attempts = 0;
  session.resyncTimer = setInterval(() => {
    attempts += 1;
    if (session.closed || session.isSerializer || attempts > BACKGROUND_RESYNC_MAX_TRIES) {
      clearInterval(session.resyncTimer);
      session.resyncTimer = null;
      return;
    }
    raceSnapshotResponse(session, BACKGROUND_RESYNC_MS - 200).then((resp) => {
      if (resp) {
        adoptSnapshot(session, resp.tree, resp.revision);
        clearInterval(session.resyncTimer);
        session.resyncTimer = null;
      }
    });
  }, BACKGROUND_RESYNC_MS);
}

/** One snapshot-request/response round trip with its own temporary listener. */
function raceSnapshotResponse(session, timeoutMs) {
  const requestId = genId();
  const { channel, clientId, role } = session;
  return new Promise((resolve) => {
    let done = false;
    function onMsg(ev) {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'snapshot-response' && msg.to === clientId && msg.requestId === requestId) {
        if (done) return;
        done = true;
        channel.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(msg);
      }
    }
    channel.addEventListener('message', onMsg);
    try {
      channel.postMessage({ type: 'snapshot-request', requestId, from: clientId, role });
    } catch {
      /* channel closed */
    }
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      channel.removeEventListener('message', onMsg);
      resolve(null);
    }, timeoutMs);
  });
}

/** Send a request and keep resending until answered or REQUEST_TIMEOUT_MS elapses. */
function sendWithRetry(session, msg, { retryMs = REQUEST_RETRY_MS, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const requestId = msg.requestId;
    const startedAt = Date.now();
    let timer = null;
    function cleanup() {
      if (timer) clearInterval(timer);
      session.pending.delete(requestId);
    }
    session.pending.set(requestId, {
      resolve: (v) => {
        cleanup();
        resolve(v);
      },
      reject: (e) => {
        cleanup();
        reject(e);
      },
    });
    const send = () => {
      try {
        session.channel.postMessage(msg);
      } catch {
        /* channel closed; loop below will time out and reject */
      }
    };
    send();
    timer = setInterval(() => {
      const pending = session.pending.get(requestId);
      if (!pending) return; // already settled
      if (session.closed) {
        pending.reject(new Error('stack sync: session closed'));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        pending.reject(
          new Error(
            `stack sync: no response from room authority after ${timeoutMs}ms (type=${msg.type}${msg.path ? ' path=' + msg.path : ''})`
          )
        );
        return;
      }
      send();
    }, retryMs);
  });
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

/**
 * At-least-once delivery guard: a client resends 'write'/'propose' every
 * 500ms until answered, so a slow (but alive) serializer can receive the
 * same request twice. Re-applying a duplicate could resurrect an old value
 * over a newer concurrent write. Track handled requestIds (bounded).
 * @returns {boolean} true if this requestId was already handled
 */
function alreadyHandled(session, requestId) {
  if (!requestId) return false;
  if (session.seenRequests.has(requestId)) return true;
  session.seenRequests.add(requestId);
  if (session.seenRequests.size > 1000) {
    const it = session.seenRequests.values();
    for (let i = 0; i < 500; i++) session.seenRequests.delete(it.next().value);
  }
  return false;
}

function handleAsSerializer(session, ev) {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'snapshot-request':
      touchPresence(session, msg.from, msg.role);
      try {
        session.channel.postMessage({
          type: 'snapshot-response',
          requestId: msg.requestId,
          to: msg.from,
          tree: clone(session.tree),
          revision: session.revision,
          roster: computeRoster(session),
          ts: Date.now(),
          by: session.clientId,
        });
      } catch {
        /* channel closed */
      }
      break;
    case 'write':
      touchPresence(session, msg.from, msg.role);
      if (alreadyHandled(session, msg.requestId)) break; // answer already in flight
      applyAndBroadcast(session, msg.path, msg.value, msg.requestId, msg.from);
      break;
    case 'propose': {
      touchPresence(session, msg.from, msg.role);
      if (alreadyHandled(session, msg.requestId)) break; // answer already in flight
      const decision = decidePropose(session.tree, splitPath(msg.path), msg.expectedValue, msg.proposedValue);
      if (decision.status === 'committed') {
        applyAndBroadcast(session, msg.path, decision.current, msg.requestId, msg.from);
      } else {
        try {
          session.channel.postMessage({
            type: 'propose-result',
            requestId: msg.requestId,
            to: msg.from,
            status: decision.status,
            current: clone(decision.current),
            ts: Date.now(),
            by: session.clientId,
          });
        } catch {
          /* channel closed */
        }
      }
      break;
    }
    case 'heartbeat':
      touchPresence(session, msg.from, msg.role);
      break;
    case 'bye':
      if (session.presenceMap.has(msg.from)) {
        session.presenceMap.get(msg.from).connected = false;
      }
      break;
    case 'diff':
    case 'roster':
    case 'snapshot-response':
    case 'propose-result':
      // Another serializer is authoring the room (split-brain, e.g. two 'gm'
      // tabs timing out at once) — back off instead of fighting over authority.
      if (msg.by && msg.by !== session.clientId) demoteToClient(session);
      break;
    default:
      break;
  }
}

function handleAsClient(session, ev) {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'diff': {
      applyLocalDiff(session, msg.path, msg.value, msg.revision);
      if (msg.requestId) {
        const pending = session.pending.get(msg.requestId);
        if (pending) pending.resolve({ status: 'committed', current: clone(msg.value) });
      }
      break;
    }
    case 'propose-result': {
      if (msg.to !== session.clientId) break;
      const pending = session.pending.get(msg.requestId);
      if (pending) pending.resolve({ status: msg.status, current: clone(msg.current) });
      break;
    }
    case 'roster':
      for (const cb of session.presenceSubs) cb(clone(msg.roster));
      break;
    default:
      break; // snapshot-response for post-connect requests is handled by the
    // temporary listeners in raceSnapshotResponse, not here.
  }
}

// ---------------------------------------------------------------------------
// Public driver contract
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {string} params.roomCode
 * @param {string} params.clientId
 * @param {string} params.role
 * @param {boolean} params.create
 * @param {any} params.initialState
 * @returns {Promise<Object>} an opaque session (must expose `.tree`)
 */
export async function connect({ roomCode, clientId, role, create = false, initialState = null }) {
  if (!roomCode) throw new Error('stack sync: roomCode is required');
  if (!clientId) throw new Error('stack sync: clientId is required');
  if (!role) throw new Error('stack sync: role is required');

  const channel = new BroadcastChannel(channelName(roomCode));
  const session = {
    roomCode,
    clientId,
    role,
    channel,
    tree: {},
    revision: 0,
    isSerializer: false,
    presenceMap: new Map(),
    seenRequests: new Set(),
    pending: new Map(),
    diffSubs: new Set(),
    presenceSubs: new Set(),
    heartbeatTimer: null,
    sweepTimer: null,
    resyncTimer: null,
    closed: false,
    _handler: null,
  };

  if (create) {
    adoptSnapshot(session, initialState && typeof initialState === 'object' ? initialState : {}, 0);
    becomeSerializer(session);
    return session;
  }

  // --- joiner path ---------------------------------------------------------
  const startedAt = Date.now();
  let resp = await raceSnapshotResponse(session, GM_RECOVERY_WAIT_MS);

  if (!resp) {
    const persisted = readSnapshot(roomCode);
    if (persisted) {
      adoptSnapshot(session, persisted.tree, persisted.revision);
      if (role === 'gm') {
        becomeSerializer(session);
      } else {
        startClient(session);
        startBackgroundResync(session);
      }
      return session;
    }
    if (role === 'gm') {
      // Nothing to recover (fresh room code reused as a rejoin) — still
      // resume authority per spec; tree stays empty until the app writes to it.
      becomeSerializer(session);
      return session;
    }
    // No live serializer, nothing persisted: keep asking until the shared
    // request budget is exhausted, then give up.
    while (!resp && Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
      resp = await raceSnapshotResponse(session, REQUEST_RETRY_MS);
    }
    if (!resp) {
      channel.close();
      throw new Error(`stack sync: room "${roomCode}" not found or unreachable`);
    }
  }

  adoptSnapshot(session, resp.tree, resp.revision);
  startClient(session);
  return session;
}

/**
 * @param {Object} session
 * @param {string} path
 * @param {any} value
 * @returns {Promise<void>}
 */
export async function update(session, path, value) {
  if (session.isSerializer) {
    applyAndBroadcast(session, path, value, genId(), session.clientId);
    return;
  }
  const requestId = genId();
  await sendWithRetry(session, { type: 'write', requestId, from: session.clientId, role: session.role, path, value });
}

/**
 * @param {Object} session
 * @param {string} path
 * @param {(current: any) => any} txnFn
 * @returns {Promise<{committed: boolean, current: any}>}
 */
export async function transact(session, path, txnFn) {
  const segs = splitPath(path);

  if (session.isSerializer) {
    // Synchronous and single-threaded: nothing can interleave between this
    // read and its apply, so this is race-free without a network round trip.
    const base = getAtPath(session.tree, segs);
    const proposed = txnFn(clone(base));
    if (proposed === undefined) return { committed: false, current: clone(base) };
    applyAndBroadcast(session, path, proposed, genId(), session.clientId);
    return { committed: true, current: clone(proposed) };
  }

  let base = getAtPath(session.tree, segs);
  for (;;) {
    const proposed = txnFn(clone(base));
    const requestId = genId();
    const res = await sendWithRetry(session, {
      type: 'propose',
      requestId,
      from: session.clientId,
      role: session.role,
      path,
      expectedValue: clone(base),
      proposedValue: proposed === undefined ? undefined : clone(proposed),
    });
    if (res.status === 'committed') return { committed: true, current: res.current };
    if (res.status === 'aborted') return { committed: false, current: res.current };
    base = res.current; // 'stale' — the authority's real value; retry txnFn against it
  }
}

/**
 * @param {Object} session
 * @param {(diff: {path: string, value: any}) => void} cb
 * @returns {() => void} unsubscribe
 */
export function subscribe(session, cb) {
  session.diffSubs.add(cb);
  return () => session.diffSubs.delete(cb);
}

/**
 * @param {Object} session
 * @param {(roster: Array<{clientId: string, role: string, lastSeen: number, connected: boolean}>) => void} cb
 * @returns {() => void} unsubscribe
 */
export function presence(session, cb) {
  session.presenceSubs.add(cb);
  return () => session.presenceSubs.delete(cb);
}

/**
 * Same-device driver: no clock skew between tabs.
 * @param {Object} _session
 * @returns {number}
 */
export function offsetProbe(_session) {
  return 0;
}

/** @param {Object} session */
export function close(session) {
  if (session.closed) return;
  session.closed = true;
  if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
  if (session.sweepTimer) clearInterval(session.sweepTimer);
  if (session.resyncTimer) clearInterval(session.resyncTimer);
  for (const pending of session.pending.values()) pending.reject(new Error('stack sync: session closed'));
  session.pending.clear();
  try {
    session.channel.postMessage({ type: 'bye', from: session.clientId });
  } catch {
    /* channel already unusable */
  }
  if (session._handler) session.channel.removeEventListener('message', session._handler);
  session.channel.close();
  session.diffSubs.clear();
  session.presenceSubs.clear();
}
