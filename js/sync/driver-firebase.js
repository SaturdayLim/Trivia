/**
 * js/sync/driver-firebase.js
 *
 * Firebase Realtime Database implementation of the sync driver contract
 * documented in adapter.js (`{connect, update, transact, subscribe, presence,
 * offsetProbe, close}`). Same export surface as driver-mock.js — this file is
 * a drop-in swap (see js/main.js's "SWAP POINT" comment).
 *
 * NOTE ON DUPLICATED UTILITIES: like driver-mock.js, this file re-implements
 * its own tiny path helper instead of importing from adapter.js. Drivers must
 * not depend on the generic adapter layer.
 *
 * ---------------------------------------------------------------------------
 * ZERO-DEPENDENCY UNTIL CONNECT
 * ---------------------------------------------------------------------------
 * Importing this module does nothing observable: no network access, no DOM
 * access, no globals touched. The Firebase compat SDK (namespaced builds,
 * NOT ES modules) is loaded lazily, inside connect(), via injected <script>
 * tags pinned to one version. firebase-app-compat.js must finish executing
 * before firebase-database-compat.js runs (the latter registers itself onto
 * the global created by the former), so the two scripts load sequentially.
 * The resulting Firebase App + Database instance is memoized at module scope
 * so multiple rooms/sessions on the same page share one connection.
 *
 * ---------------------------------------------------------------------------
 * CONFIG
 * ---------------------------------------------------------------------------
 * Project config is dynamically imported from './firebase-config.js' (a
 * gitignored file; see firebase-config.example.js + docs/FIREBASE-SETUP.md).
 * If it's missing, we throw a clear setup-pointing error rather than letting
 * a raw module-resolution error surface.
 *
 * ---------------------------------------------------------------------------
 * ROOM TREE + PATHS
 * ---------------------------------------------------------------------------
 * The synced room tree lives at `rooms/<roomCode>` — every adapter path is
 * relative to that ref. `connect({create:true})` writes `initialState` there
 * and resolves immediately; `connect({create:false})` resolves on the first
 * *non-null* `'value'` snapshot, rejecting after 10s if the room never
 * produces one (room not found/unreachable).
 *
 * Presence is deliberately NOT under `rooms/<roomCode>/presence` — that path
 * is inside the subtree the whole-tree root listener (see subscribe() below)
 * watches, so every 5s heartbeat would be indistinguishable from a real game-
 * state change and would re-fire every onChange subscriber in the app. It
 * instead lives at the sibling path `presence/<roomCode>/<clientId>`, so
 * heartbeats never touch — and never churn — the room subscription.
 *
 * ---------------------------------------------------------------------------
 * subscribe(): WHOLE-TREE DIFF
 * ---------------------------------------------------------------------------
 * A single `'value'` listener on the room root delivers
 * `cb({path: '/', value: snapshot.val()})` on every change. This is a
 * path-unfiltered feed exactly like driver-mock's — the adapter does its own
 * path-scoped filtering over the whole tree, so a driver only has to get one
 * listener right instead of a granular per-child fan-out. Firebase also fires
 * `'value'` once immediately on attach with the then-current data; that shows
 * up as one harmless redundant diff (same value that connect() already saw)
 * rather than a real change.
 *
 * ---------------------------------------------------------------------------
 * transact(): RTDB transaction() + null/undefined CONVERSION
 * ---------------------------------------------------------------------------
 * RTDB's own `ref.transaction()` already gives us the optimistic
 * read-modify-write / automatic-retry-on-conflict semantics that
 * driver-mock.js has to hand-roll with propose/expectedValue round trips —
 * so this driver just wraps it. The one impedance mismatch: RTDB represents
 * "nothing here" as `null`, while the adapter contract (and every txnFn
 * written against it) uses `undefined` for "missing" / "abort". We convert
 * on both sides of the call: `null -> undefined` going into txnFn, and
 * `undefined -> undefined` (RTDB's "abort" sentinel — returning `undefined`
 * from the updateFunction cancels the transaction) coming out. A txnFn that
 * legitimately wants to WRITE `null`-as-delete would be indistinguishable
 * from "missing" on read, same as every other driver in this contract.
 *
 * ---------------------------------------------------------------------------
 * presence(): heartbeat + onDisconnect + local roster derivation
 * ---------------------------------------------------------------------------
 * Each client writes `{role, lastSeen: ServerValue.TIMESTAMP}` to its own
 * presence node every 5s and registers `onDisconnect().remove()` so a closed
 * tab/lost connection self-heals without anyone else's help. Every client
 * listens to `child_added`/`child_changed`/`child_removed` on the whole
 * `presence/<roomCode>` node to maintain a local map, and recomputes
 * `connected` (lastSeen within 15s of server-offset-corrected "now") both on
 * every change AND on a 5s sweep timer (so a peer going silent — no event —
 * still ages out visibly).
 *
 * ---------------------------------------------------------------------------
 * offsetProbe(): cached, synchronous
 * ---------------------------------------------------------------------------
 * The contract requires a synchronous read, but Firebase's clock-skew value
 * (`.info/serverTimeOffset`) is only available via an async listener. We
 * subscribe once at connect() time and cache the latest value on the
 * session; offsetProbe() just reads the cache (default 0 until the first
 * callback lands).
 *
 * ---------------------------------------------------------------------------
 * close(): no goOffline()
 * ---------------------------------------------------------------------------
 * Detaches this session's listeners, clears its timers, and proactively
 * removes its own presence node (rather than waiting on the socket to drop
 * for onDisconnect to fire). Deliberately does NOT call
 * `firebase.database().goOffline()` — the underlying App/Database instance
 * is a shared module-level singleton, and other rooms/sessions on the same
 * page may still be using it.
 *
 * ---------------------------------------------------------------------------
 * UNTESTED AGAINST A REAL PROJECT
 * ---------------------------------------------------------------------------
 * No Firebase project exists yet in this workspace, so this driver has only
 * been verified for contract fidelity (shape of calls, path math, the
 * null/undefined conversion, clean Node import with no top-level browser/
 * network access) — not exercised against live RTDB. See docs/FIREBASE-SETUP.md
 * for how to provision a project and tools/sync-test.html for how to exercise
 * it manually once that harness gets a driver picker.
 */

// ---------------------------------------------------------------------------
// Tiny pure path utility (see note above on why this is duplicated)
// ---------------------------------------------------------------------------

/** @param {?string} path @returns {string[]} */
function splitPath(path) {
  if (path == null || path === '/' || path === '') return [];
  return path.split('/').filter((seg) => seg.length > 0);
}

/** @param {Object} rootRef @param {?string} path @returns {Object} a database ref */
function childRef(rootRef, path) {
  const segs = splitPath(path);
  return segs.length === 0 ? rootRef : rootRef.child(segs.join('/'));
}

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

const ROOM_JOIN_TIMEOUT_MS = 10000;
const PRESENCE_HEARTBEAT_MS = 5000;
const PRESENCE_STALE_MS = 15000;

// ---------------------------------------------------------------------------
// Firebase compat SDK loading (browser-only; never touched at module scope)
// ---------------------------------------------------------------------------

const FIREBASE_SDK_VERSION = '10.14.1';
const FIREBASE_SDK_URLS = [
  `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-database-compat.js`,
];

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.getAttribute('data-stack-loaded') === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`stack sync: failed to load ${src}`)));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      script.setAttribute('data-stack-loaded', 'true');
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`stack sync: failed to load Firebase SDK script: ${src}`)));
    document.head.appendChild(script);
  });
}

let sdkPromise = null;
function loadFirebaseSdk() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('stack sync: driver-firebase requires a browser environment'));
  }
  if (window.firebase && window.firebase.database) {
    return Promise.resolve(window.firebase);
  }
  if (!sdkPromise) {
    sdkPromise = FIREBASE_SDK_URLS.reduce((chain, src) => chain.then(() => loadScriptOnce(src)), Promise.resolve())
      .then(() => {
        if (!window.firebase || !window.firebase.database) {
          throw new Error('stack sync: Firebase SDK scripts loaded but window.firebase.database is unavailable');
        }
        return window.firebase;
      })
      .catch((err) => {
        sdkPromise = null; // allow a retry on the next connect() attempt
        throw err;
      });
  }
  return sdkPromise;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

async function loadConfig() {
  let mod;
  try {
    mod = await import('./firebase-config.js');
  } catch {
    throw new Error(
      'stack sync: js/sync/firebase-config.js not found — copy firebase-config.example.js to firebase-config.js — see docs/FIREBASE-SETUP.md'
    );
  }
  const config = mod && mod.default;
  if (!config || typeof config !== 'object' || !config.databaseURL) {
    throw new Error(
      "stack sync: js/sync/firebase-config.js is missing required fields (databaseURL) — copy firebase-config.example.js to firebase-config.js and fill in your project's values — see docs/FIREBASE-SETUP.md"
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// App/Database bootstrap (memoized — shared across every room on this page)
// ---------------------------------------------------------------------------

let appReadyPromise = null;
function ensureApp() {
  if (!appReadyPromise) {
    appReadyPromise = Promise.all([loadConfig(), loadFirebaseSdk()])
      .then(([config, firebase]) => {
        const app = firebase.apps && firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(config);
        const rtdb = firebase.database(app);
        return { firebase, app, rtdb };
      })
      .catch((err) => {
        appReadyPromise = null; // allow a retry once the user fixes config/SDK access
        throw err;
      });
  }
  return appReadyPromise;
}

// ---------------------------------------------------------------------------
// connect() helpers
// ---------------------------------------------------------------------------

function attachOffsetProbe(session) {
  const ref = session.rtdb.ref('.info/serverTimeOffset');
  const handler = (snapshot) => {
    const val = snapshot.val();
    session.offset = typeof val === 'number' ? val : 0;
  };
  ref.on('value', handler);
  session._offsetRef = ref;
  session._offsetHandler = handler;
}

function teardownOffsetProbe(session) {
  if (session._offsetRef && session._offsetHandler) {
    session._offsetRef.off('value', session._offsetHandler);
  }
  session._offsetRef = null;
  session._offsetHandler = null;
}

/** Resolve on the first non-null `'value'` snapshot; reject after `ROOM_JOIN_TIMEOUT_MS`. */
function waitForFirstSnapshot(roomRef, roomCode) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      roomRef.off('value', onValue);
      fn(arg);
    };
    const onValue = (snapshot) => {
      const val = snapshot.val();
      if (val === null) return; // no data yet — keep waiting until the timeout
      finish(resolve, val);
    };
    const onError = (err) => finish(reject, err);
    const timer = setTimeout(() => {
      finish(reject, new Error(`stack sync: room "${roomCode}" not found (no data after ${ROOM_JOIN_TIMEOUT_MS}ms)`));
    }, ROOM_JOIN_TIMEOUT_MS);
    roomRef.on('value', onValue, onError);
  });
}

// ---------------------------------------------------------------------------
// Public driver contract
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {string} params.roomCode
 * @param {string} params.clientId
 * @param {string} params.role
 * @param {boolean} [params.create]
 * @param {any} [params.initialState]
 * @returns {Promise<Object>} an opaque session (exposes `.tree`)
 */
export async function connect({ roomCode, clientId, role, create = false, initialState = null }) {
  if (!roomCode) throw new Error('stack sync: roomCode is required');
  if (!clientId) throw new Error('stack sync: clientId is required');
  if (!role) throw new Error('stack sync: role is required');

  const { firebase, rtdb } = await ensureApp();

  const session = {
    roomCode,
    clientId,
    role,
    firebase,
    rtdb,
    roomRef: rtdb.ref(`rooms/${roomCode}`),
    presenceRootRef: rtdb.ref(`presence/${roomCode}`),
    tree: null,
    offset: 0,
    closed: false,
    _offsetRef: null,
    _offsetHandler: null,
    _roomValueHandler: null,
    _ownPresenceRef: null,
    _presenceHeartbeatTimer: null,
    _presenceSweepTimer: null,
    _presenceListeners: null,
  };

  attachOffsetProbe(session);

  if (create) {
    try {
      const normalized = initialState && typeof initialState === 'object' ? initialState : {};
      await session.roomRef.set(normalized);
      session.tree = normalized;
      return session;
    } catch (err) {
      teardownOffsetProbe(session);
      throw err;
    }
  }

  try {
    session.tree = await waitForFirstSnapshot(session.roomRef, roomCode);
    return session;
  } catch (err) {
    teardownOffsetProbe(session);
    throw err;
  }
}

/**
 * @param {Object} session
 * @param {string} path
 * @param {any} value - `null` deletes (RTDB set(null) already deletes).
 * @returns {Promise<void>}
 */
export async function update(session, path, value) {
  await childRef(session.roomRef, path).set(value);
}

/**
 * @param {Object} session
 * @param {string} path
 * @param {(current: any) => any} txnFn
 * @returns {Promise<{committed: boolean, current: any}>}
 */
export function transact(session, path, txnFn) {
  const ref = childRef(session.roomRef, path);
  return new Promise((resolve, reject) => {
    ref.transaction(
      (current) => {
        // RTDB: null means "nothing here" -> surface as undefined to txnFn.
        const out = txnFn(current === null ? undefined : current);
        // txnFn's undefined ("abort") must stay undefined for RTDB to cancel.
        return out === undefined ? undefined : out;
      },
      (error, committed, snapshot) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ committed: !!committed, current: snapshot ? snapshot.val() : null });
      }
    );
  });
}

/**
 * @param {Object} session
 * @param {(diff: {path: string, value: any}) => void} cb
 * @returns {() => void} unsubscribe
 */
export function subscribe(session, cb) {
  const handler = (snapshot) => {
    if (session.closed) return;
    cb({ path: '/', value: snapshot.val() });
  };
  session.roomRef.on('value', handler);
  session._roomValueHandler = handler;
  return () => {
    session.roomRef.off('value', handler);
    if (session._roomValueHandler === handler) session._roomValueHandler = null;
  };
}

/**
 * @param {Object} session
 * @param {(roster: Array<{clientId: string, role: string, lastSeen: number, connected: boolean}>) => void} cb
 * @returns {() => void} unsubscribe
 */
export function presence(session, cb) {
  const ServerValue = session.firebase.database.ServerValue;
  const ownRef = session.presenceRootRef.child(session.clientId);
  const rosterState = new Map();

  function emit() {
    if (session.closed) return;
    const now = Date.now() + offsetProbe(session);
    const roster = [];
    for (const [id, info] of rosterState) {
      roster.push({
        clientId: id,
        role: info.role,
        lastSeen: info.lastSeen,
        connected: now - info.lastSeen <= PRESENCE_STALE_MS,
      });
    }
    cb(roster);
  }

  const onUpsert = (snapshot) => {
    const val = snapshot.val();
    if (!val) return;
    rosterState.set(snapshot.key, {
      role: val.role || 'unknown',
      lastSeen: typeof val.lastSeen === 'number' ? val.lastSeen : Date.now(),
    });
    emit();
  };
  const onRemove = (snapshot) => {
    rosterState.delete(snapshot.key);
    emit();
  };

  session.presenceRootRef.on('child_added', onUpsert);
  session.presenceRootRef.on('child_changed', onUpsert);
  session.presenceRootRef.on('child_removed', onRemove);

  ownRef.onDisconnect().remove();
  const beat = () => {
    ownRef.set({ role: session.role, lastSeen: ServerValue.TIMESTAMP }).catch(() => {
      /* best-effort heartbeat; a dropped write just makes us look briefly stale */
    });
  };
  beat();
  const heartbeatTimer = setInterval(beat, PRESENCE_HEARTBEAT_MS);
  const sweepTimer = setInterval(emit, PRESENCE_HEARTBEAT_MS);

  session._ownPresenceRef = ownRef;
  session._presenceHeartbeatTimer = heartbeatTimer;
  session._presenceSweepTimer = sweepTimer;
  session._presenceListeners = { onUpsert, onRemove };

  let unsubbed = false;
  return () => {
    if (unsubbed) return;
    unsubbed = true;
    clearInterval(heartbeatTimer);
    clearInterval(sweepTimer);
    session.presenceRootRef.off('child_added', onUpsert);
    session.presenceRootRef.off('child_changed', onUpsert);
    session.presenceRootRef.off('child_removed', onRemove);
    if (session._presenceHeartbeatTimer === heartbeatTimer) session._presenceHeartbeatTimer = null;
    if (session._presenceSweepTimer === sweepTimer) session._presenceSweepTimer = null;
    session._presenceListeners = null;
  };
}

/**
 * Cached, synchronous best-known (serverTime - localTime) estimate in ms.
 * @param {Object} session
 * @returns {number}
 */
export function offsetProbe(session) {
  return typeof session.offset === 'number' ? session.offset : 0;
}

/** @param {Object} session */
export function close(session) {
  if (session.closed) return;
  session.closed = true;

  if (session._roomValueHandler) {
    session.roomRef.off('value', session._roomValueHandler);
    session._roomValueHandler = null;
  }
  if (session._presenceHeartbeatTimer) {
    clearInterval(session._presenceHeartbeatTimer);
    session._presenceHeartbeatTimer = null;
  }
  if (session._presenceSweepTimer) {
    clearInterval(session._presenceSweepTimer);
    session._presenceSweepTimer = null;
  }
  if (session._presenceListeners) {
    session.presenceRootRef.off('child_added', session._presenceListeners.onUpsert);
    session.presenceRootRef.off('child_changed', session._presenceListeners.onUpsert);
    session.presenceRootRef.off('child_removed', session._presenceListeners.onRemove);
    session._presenceListeners = null;
  }
  if (session._ownPresenceRef) {
    try {
      session._ownPresenceRef.onDisconnect().cancel();
    } catch {
      /* best-effort */
    }
    session._ownPresenceRef.remove().catch(() => {});
    session._ownPresenceRef = null;
  }
  teardownOffsetProbe(session);
  // Deliberately NOT calling firebase.database().goOffline(): the App/Database
  // instance is a shared module-level singleton other rooms may still be using.
}
