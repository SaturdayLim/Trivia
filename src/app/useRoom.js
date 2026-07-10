/**
 * @file React binding for one room: connect, mirror the tree, mirror presence.
 * The ONLY place the app calls `createSync`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WHOLE TREE
 * ---------------------------------------------------------------------------
 * `sync.onChange('/')` hands back a deep clone of the entire room on every
 * change, and this hook drops it straight into one `useState`. At the scale
 * v2 targets (V2-18: ≤30 players, ≤30 teams, one room) that tree is a few KB,
 * and one state atom means no screen can ever render a torn mix of old teams
 * and new scores. Path-scoped subscriptions would save nothing worth the
 * consistency.
 *
 * ---------------------------------------------------------------------------
 * NO DEAD "CONNECTING…" (v1 defect #1)
 * ---------------------------------------------------------------------------
 * `adapter.onChange` fires synchronously with the current value before it
 * returns, so `room` is populated in the same tick `createSync` resolves —
 * there is no window where we are connected but have nothing to draw. The
 * `connecting` phase covers only the real network wait, and it ends in exactly
 * one of `ready` / `error`, never in a placeholder that outlives the game.
 *
 * ---------------------------------------------------------------------------
 * STRICTMODE
 * ---------------------------------------------------------------------------
 * React 19 StrictMode mounts effects twice in development. The effect below is
 * therefore written to be re-entrant: a `cancelled` flag stops the first (torn
 * down) attempt from publishing state or leaking a session, and every session
 * it opens it also closes. Room *creation* deliberately does not live here —
 * it's an imperative action in `createRoom.js` — so a double-mount can never
 * write a room tree twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSync } from '../sync/adapter.js';
import { loadDriver } from './driver.js';
import { getOrCreateClientId } from './identity.js';
import { selectLobby } from '../state/lobby.js';
import { isRoomExpired } from '../state/room.js';

/**
 * @typedef {Object} RoomConnection
 * @property {'connecting'|'ready'|'error'} phase
 * @property {?Error} error
 * @property {?import('../sync/adapter.js').SyncHandle} sync
 * @property {?Object} room - the whole room tree.
 * @property {Array<Object>} roster - presence entries.
 * @property {string} clientId
 * @property {boolean} expired - closed, or 24h idle (V2-20).
 * @property {() => void} retry
 */

/**
 * Connect to `roomCode` as `role` and stay subscribed for the component's life.
 *
 * @param {?string} roomCode - null/'' parks the hook in `connecting` without
 *   touching the network (the screen is still deciding what room to join).
 * @param {string} role - wire role: 'gm' | 'player' | 'display'.
 * @returns {RoomConnection}
 */
export function useRoom(roomCode, role) {
  const [phase, setPhase] = useState('connecting');
  const [error, setError] = useState(null);
  const [room, setRoom] = useState(null);
  const [roster, setRoster] = useState([]);
  const [attempt, setAttempt] = useState(0);
  const syncRef = useRef(null);
  const clientId = useMemo(() => getOrCreateClientId(), []);

  const retry = useCallback(() => {
    setPhase('connecting');
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!roomCode) return undefined;

    let cancelled = false;
    let session = null;
    let unsubs = [];

    setPhase('connecting');
    setError(null);

    (async () => {
      try {
        const driver = await loadDriver();
        const sync = await createSync({ driver, roomCode, clientId, role, create: false });
        if (cancelled) {
          sync.close();
          return;
        }
        session = sync;
        syncRef.current = sync;

        // Fires immediately with the current tree — `room` is never null in the
        // `ready` phase, which is what kills the placeholder.
        unsubs.push(sync.onChange('/', (tree) => setRoom(tree ?? null)));
        unsubs.push(sync.onPresence((entries) => setRoster(entries)));

        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      for (const un of unsubs) un();
      unsubs = [];
      if (session) session.close();
      if (syncRef.current === session) syncRef.current = null;
    };
  }, [roomCode, role, clientId, attempt]);

  const expired = useMemo(() => {
    if (phase !== 'ready' || !room) return false;
    return isRoomExpired(room, Date.now());
  }, [phase, room]);

  return { phase, error, sync: syncRef.current, room, roster, clientId, expired, retry };
}

/**
 * The shared waiting-lobby model (PRD §3.1) — the same object on the host's
 * phone, every player's phone, and the display.
 * @param {?Object} room
 * @param {Array<Object>} roster
 * @returns {import('../state/lobby.js').Lobby}
 */
export function useLobby(room, roster) {
  return useMemo(() => selectLobby(room, roster), [room, roster]);
}
