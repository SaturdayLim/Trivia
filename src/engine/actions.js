/**
 * @file The ONLY layer that touches the sync adapter (PRD §5.1/§5.2). Every
 * export takes `(sync, ...)` and returns a Promise.
 *
 * GM-authority actions resolve `null` (no-op) unless called with
 * `role === 'gm'` — the adapter itself is role-agnostic, so this module is
 * where that authority rule is enforced.
 *
 * Every write is path-scoped and small on purpose, not just by style:
 * `setAtPath` (adapter.js) shallow-copies one level per path segment, so
 * `update('game/round', …)` preserves sibling keys (`game/board`,
 * `game/question`, …) automatically, whereas `update('game', {round: …})`
 * would silently replace — i.e. delete — all of those siblings. The one
 * sanctioned whole-tree write is `createRoomState`, at room creation.
 */

import { getAtPath, splitPath } from '../sync/adapter.js';
import { questionValue, MODES, DEFAULT_ROUNDS } from './scoring.js';
import { advanceTurn, computeOrder } from './scheduler.js';
import { parseRef } from './questions.js';
import { initialLifecycle, makeSelectionClaim, pinMatches } from '../state/room.js';

/**
 * One-shot synchronous read of a synced path. Relies on `sync.onChange`
 * invoking its callback immediately, before returning the unsubscribe
 * function (see adapter.js's `onChange`) — so this never leaves a dangling
 * subscription behind.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} path
 * @returns {any}
 */
function readPath(sync, path) {
  let value;
  sync.onChange(path, (v) => {
    value = v;
  })();
  return value;
}

function removeIdFromTier(board, slug, dif, id) {
  const tier = (board[slug] && board[slug][dif]) || [];
  return { ...board, [slug]: { ...board[slug], [dif]: tier.filter((x) => x !== id) } };
}

function addIdToTier(board, slug, dif, id) {
  const tier = (board[slug] && board[slug][dif]) || [];
  if (tier.includes(id)) return board;
  return { ...board, [slug]: { ...board[slug], [dif]: [...tier, id] } };
}

// ---------------------------------------------------------------------------
// GM-authority actions
// ---------------------------------------------------------------------------

/**
 * Create a room's full state tree (PRD §5.3, plus the v2 additions in stack-v2
 * PRD §2) and write it once.
 *
 * v2 additions, all at the room root so they read as one flat "about this
 * room" block rather than being buried in `game`:
 *   - `hostPin`      — set at creation; `claimHost` requires it (V2-19).
 *   - `lifecycle`    — `{createdAt, lastActivityAt}`; drives 24h expiry (V2-20).
 *   - `selectionClaim` — team-turn first-click lock (V2-14); null when free.
 *
 * `meta.createdAt` from v1 is gone: `lifecycle.createdAt` is now the single
 * source of that truth.
 *
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {Object} opts
 * @param {string} opts.clientId - stamped into `meta.gmClientId`.
 * @param {?string} [opts.hostPin] - from `room.generateHostPin()`; null in the
 *   mock/offline flow where no rejoin story exists.
 * @param {Object} [opts.settings] - partial settings; `rounds` defaults to
 *   `scoring.DEFAULT_ROUNDS`, other fields to PRD §5.3 defaults.
 * @param {Array<{id: string, name: string, color: string, order: number}>} opts.teams
 * @returns {Promise<?Object>} the written tree, or `null` if `role !== 'gm'`.
 */
export async function createRoomState(sync, role, { clientId, settings = {}, teams, hostPin = null }) {
  if (role !== 'gm') return null;
  const now = sync.serverNow();
  const teamsMap = {};
  for (const t of teams) {
    teamsMap[t.id] = { name: t.name, color: t.color, order: t.order, score: 0, players: {} };
  }
  const tree = {
    meta: { gmClientId: clientId, status: 'lobby', registrationLocked: false },
    hostPin,
    lifecycle: initialLifecycle(now),
    selectionClaim: null,
    settings: {
      orderRecalc: settings.orderRecalc || 'perRound',
      tierSize: settings.tierSize || 4,
      // V2-17's per-category N, and the display directory Players and Displays
      // read instead of the Markdown. Both are normally written later by
      // `updateBoardSettings`, but a caller that supplies them at creation must
      // not have them silently dropped by this whitelist.
      tierSizes: settings.tierSizes || {},
      categoryMeta: settings.categoryMeta || {},
      boardSize: settings.boardSize || 10,
      categories: settings.categories || [],
      excludeUsed: settings.excludeUsed !== false,
      rounds: settings.rounds && settings.rounds.length ? settings.rounds : DEFAULT_ROUNDS,
    },
    teams: teamsMap,
    clients: {},
    game: {
      round: 0,
      rotation: 0,
      turnIdx: 0,
      teamOrder: [],
      activeTeam: null,
      tapIn: { openFor: null, winner: null },
      board: {},
      question: null,
      log: [],
    },
  };
  await sync.update('/', tree);
  return tree;
}

// ---------------------------------------------------------------------------
// Lifecycle (V2-20)
// ---------------------------------------------------------------------------

/**
 * Bump `lifecycle.lastActivityAt`, resetting the 24h expiry clock. Deliberately
 * NOT gm-gated: a player joining a team or locking an answer is activity, and a
 * room whose host has gone quiet mid-game must not age out under the players'
 * feet (V2-20: "mid-game breaks survive").
 *
 * Fire-and-forget by design — a dropped touch costs at most a stale
 * `lastActivityAt`, never a wrong game state, so callers shouldn't await it on
 * a hot path.
 *
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @returns {Promise<number>} the timestamp written.
 */
export async function touchActivity(sync) {
  const now = sync.serverNow();
  await sync.update('lifecycle/lastActivityAt', now);
  return now;
}

/**
 * Host: close the room for good (V2-20). Terminal — `isRoomExpired` reports a
 * closed room as expired regardless of its activity clock, so nobody rejoins.
 * @returns {Promise<?{closed: true}>}
 */
export async function closeRoom(sync, role) {
  if (role !== 'gm') return null;
  await sync.update('meta/status', 'closed');
  await touchActivity(sync);
  return { closed: true };
}

/**
 * Host: toggle the shared "Show QR Code" overlay (R7, PRD §8b). Synced, not
 * local UI state, so the SAME toggle that opens the Host's own QR sheet also
 * switches every attached Display to the QR + Room Code view — and back, when
 * the Host closes it.
 * @returns {Promise<?boolean>}
 */
export async function setShowQr(sync, role, active) {
  if (role !== 'gm') return null;
  await sync.update('meta/showQr', !!active);
  return !!active;
}

// ---------------------------------------------------------------------------
// Host PIN + single-host invariant (V2-19)
// ---------------------------------------------------------------------------

/**
 * Take the room's single host seat. Enforces the two halves of V2-19:
 *
 *   1. **PIN.** `pin` must match `hostPin`. Rooms created without a PIN
 *      (mock/offline) refuse every claim rather than accepting any — an absent
 *      PIN is not a blank one.
 *   2. **No second concurrent host.** The seat is `meta.gmClientId`, taken by a
 *      transaction so two devices racing a rejoin can't both win. The claim
 *      succeeds only when the seat is empty, already ours, or its occupant is
 *      provably gone — which this layer cannot know on its own. The caller
 *      passes `hostPresent` (from `sync.onPresence`: is `meta.gmClientId` in
 *      the roster and `connected`?), because presence lives in the driver, not
 *      the room tree.
 *
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {Object} opts
 * @param {string} opts.clientId - the device asking to be host.
 * @param {string} opts.pin
 * @param {boolean} [opts.hostPresent=false] - is the current `meta.gmClientId`
 *   live on the roster right now?
 * @returns {Promise<{committed: boolean, reason?: 'bad-pin'|'host-present'}>}
 */
export async function claimHost(sync, { clientId, pin, hostPresent = false }) {
  const stored = readPath(sync, 'hostPin');
  if (!pinMatches(stored, pin)) return { committed: false, reason: 'bad-pin' };

  const seated = readPath(sync, 'meta/gmClientId');
  if (seated && seated !== clientId && hostPresent) {
    return { committed: false, reason: 'host-present' };
  }

  const { snapshot } = await sync.transact('meta/gmClientId', (cur) => {
    if (cur == null || cur === clientId) return clientId;
    // Racing rejoin: whoever's transaction lands first wins the seat. The
    // loser sees the winner's id here and aborts rather than overwriting it.
    return hostPresent ? undefined : clientId;
  });

  // `committed` isn't the answer on its own. Two devices holding the same PIN
  // can both see an empty seat, and the transaction serializes them: the second
  // commits too, overwriting the first. The seat still holds exactly one id
  // (the invariant V2-19 actually cares about), but the first device must learn
  // it is no longer host. So trust the seat, not the write.
  const seat = getAtPath(snapshot, splitPath('meta/gmClientId'));
  if (seat !== clientId) return { committed: false, reason: 'host-present' };
  await touchActivity(sync);
  return { committed: true };
}

/**
 * Host: vacate the seat (Return to Home), so a later device can claim it with
 * the PIN without waiting for a presence timeout.
 * @returns {Promise<?boolean>}
 */
export async function releaseHost(sync, role, clientId) {
  if (role !== 'gm') return null;
  const seated = readPath(sync, 'meta/gmClientId');
  if (seated !== clientId) return false;
  await sync.update('meta/gmClientId', null);
  return true;
}

// ---------------------------------------------------------------------------
// Selection claim (V2-14)
// ---------------------------------------------------------------------------

/**
 * First teammate to tap a category takes control of the team's selection UI
 * and locks the others out until they press Back (V2-14).
 *
 * Transacts the whole `selectionClaim` node rather than a child of it, for the
 * same reason `claimTapIn` transacts the whole gate: the "is it this team's
 * turn, and is it unclaimed?" check has to be atomic with the claim itself, or
 * two teammates tapping in the same tick can both read "unclaimed" and both win.
 *
 * A claim left behind by a previous turn (different `teamId`) is not honored —
 * it is overwritten. `advance()` should still clear it, but the incoming team's
 * screen must never be held hostage by a stale lock.
 *
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {Object} opts
 * @param {string} opts.playerId
 * @param {string} opts.teamId
 * @param {'category'|'difficulty'} [opts.screen='category']
 * @param {?string} [opts.slug=null] - the chosen Category, once past the grid.
 * @returns {Promise<{committed: boolean, reason?: string, claim?: Object}>}
 */
export async function claimSelection(sync, { playerId, teamId, screen = 'category', slug = null }) {
  const activeTeam = readPath(sync, 'game/activeTeam');
  if (activeTeam !== teamId) return { committed: false, reason: 'not-active-team' };

  const now = sync.serverNow();
  const { committed, snapshot } = await sync.transact('selectionClaim', (cur) => {
    if (cur == null) return makeSelectionClaim(playerId, teamId, now, screen, slug);
    if (cur.teamId !== teamId) return makeSelectionClaim(playerId, teamId, now, screen, slug); // stale turn
    if (cur.playerId === playerId) return { ...cur, screen, slug }; // same claimant moving screens
    return undefined; // a teammate holds it
  });
  const claim = getAtPath(snapshot, splitPath('selectionClaim'));
  return committed ? { committed: true, claim } : { committed: false, reason: 'claimed-by-teammate', claim };
}

/**
 * The claimant pressed Back: release the lock so any teammate may take it.
 * Only the holder can release (a teammate's Back button must not steal it);
 * the host clears claims wholesale via `clearSelectionClaim`.
 * @returns {Promise<{committed: boolean, reason?: string}>}
 */
export async function releaseSelection(sync, { playerId, teamId }) {
  const { committed } = await sync.transact('selectionClaim', (cur) => {
    if (cur == null) return undefined;
    if (cur.playerId !== playerId || cur.teamId !== teamId) return undefined;
    return null;
  });
  return committed ? { committed: true } : { committed: false, reason: 'not-claim-holder' };
}

/**
 * Host: drop any selection claim (turn advanced, question opened, Back at the
 * host level).
 * @returns {Promise<?boolean>}
 */
export async function clearSelectionClaim(sync, role) {
  if (role !== 'gm') return null;
  await sync.update('selectionClaim', null);
  return true;
}

/**
 * Write the drawn board (from `board.buildBoard`) into synced state. Kept as
 * an action so the UI never writes sync paths directly.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {Object<string, {E: string[], M: string[], H: string[]}>} board
 * @returns {Promise<?Object>} the board, or `null` if `role !== 'gm'`.
 */
export async function setBoard(sync, role, board) {
  if (role !== 'gm') return null;
  await sync.update('game/board', board);
  return board;
}

/**
 * Lobby -> playing. Seats round 1 in `registration` order — ALWAYS, per PRD
 * §4.2, regardless of round 0's configured `orderMode`. Does not itself open
 * tap-in; call `openTapIn(sync, role, activeTeam)` next.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @returns {Promise<?{teamOrder: string[], activeTeam: ?string}>}
 */
export async function startGame(sync, role) {
  if (role !== 'gm') return null;
  const teams = readPath(sync, 'teams') || {};
  const teamOrder = computeOrder({ teams, mode: 'registration' });
  const activeTeam = teamOrder[0] ?? null;
  await sync.update('meta/status', 'playing');
  await sync.update('game/round', 0);
  await sync.update('game/rotation', 0);
  await sync.update('game/turnIdx', 0);
  await sync.update('game/teamOrder', teamOrder);
  await sync.update('game/activeTeam', activeTeam);
  return { teamOrder, activeTeam };
}

/**
 * Open the tap-in gate for `nextTeamId` (clears any previous winner).
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {string} nextTeamId
 * @returns {Promise<?{openFor: string}>}
 */
export async function openTapIn(sync, role, nextTeamId) {
  if (role !== 'gm') return null;
  await sync.update('game/tapIn', { openFor: nextTeamId, winner: null });
  return { openFor: nextTeamId };
}

/**
 * The selector's category+difficulty choice becomes the live question.
 * `ref` must already have been drawn (e.g. via `board.drawQuestion`) — this
 * only removes it from the synced board and opens the `selecting` state.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {string} ref - "slug:id", e.g. "movie-night:E1".
 * @param {{q: string, options: string[]}} payloadWithoutAnswer - never
 *   includes `answer`/`fact` (PRD §5.3: the wire never carries them pre-reveal).
 * @param {Object} [selector] - who chose this question (R4, PRD §8b), carried
 *   onto the Question Log at commit; omitted for callers that don't know
 *   (tests, the mid-question fallback paths).
 * @param {?string} [selector.playerId]
 * @param {?string} [selector.teamId]
 * @returns {Promise<?{ref: string, value: number}>}
 */
export async function selectQuestion(sync, role, ref, payloadWithoutAnswer, selector = {}) {
  if (role !== 'gm') return null;
  const { slug, id } = parseRef(ref);
  const dif = id[0];
  const round = readPath(sync, 'game/round');
  const rounds = readPath(sync, 'settings/rounds') || [];
  const roundCfg = rounds[round];
  const value = questionValue(dif, roundCfg);
  const board = readPath(sync, 'game/board') || {};
  await sync.update('game/board', removeIdFromTier(board, slug, dif, id));
  await sync.update('game/question', {
    ref,
    state: 'selecting',
    value,
    openedAt: 0,
    deadline: 0,
    payload: payloadWithoutAnswer,
    locks: {},
    result: null,
    selectedBy: selector.playerId ? { playerId: selector.playerId, teamId: selector.teamId || null } : null,
  });
  return { ref, value };
}

/**
 * Open the question for locking.
 *
 * Clears `game/question/locks` every time, not only on the first open. A
 * (re)open is what "options unlock" (V2-15) means: any lock already on the
 * tree belongs to the window that just ended, and leaving it behind is the
 * root cause behind S4.6's R2 ("Extend Timer does nothing") — `hasExplicitLock`
 * (state/game.js) reads a lock's `at` against the CURRENT deadline, so a
 * leftover auto-lock from the old (smaller) deadline reads as an *explicit*
 * Lock In against the new, later one and the Host's own authority effect
 * reseals the question the instant it reopens. Clearing locks here removes
 * the stale data instead of special-casing the read.
 *
 * Cleared FIRST, before `state`/`deadline` change — each `sync.update` is its
 * own round trip, so another client's subscription can observe them one at a
 * time. Clearing last would open a window where a listener sees the NEW
 * deadline paired with the OLD locks still on the tree — precisely the
 * misreading this fix exists to prevent, just delayed instead of removed.
 * Clearing first means every state a listener can observe pairs a live
 * deadline with locks that are already empty.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {number} deadline - epoch ms, or 0 for no timer.
 * @returns {Promise<?{deadline: number}>}
 */
export async function openQuestion(sync, role, deadline) {
  if (role !== 'gm') return null;
  await sync.update('game/question/locks', {});
  await sync.update('game/question/state', 'open');
  await sync.update('game/question/openedAt', sync.serverNow());
  await sync.update('game/question/deadline', deadline || 0);
  return { deadline: deadline || 0 };
}

/**
 * Host: pull the live question's deadline in to `deadline` WITHOUT clearing
 * locks or changing state (R10's mechanism for "All" mode). When the Selector
 * Locks In during an All Stage, the Host drops the timer so every OTHER Team's
 * device auto-locks its pending selection (V2-15) before the question seals —
 * unlike `openQuestion`, which wipes locks and would throw the Selector's own
 * answer (and everyone else's) away. Refused unless the question is `open`.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {number} deadline - epoch ms.
 * @returns {Promise<?{deadline: number}>}
 */
export async function pullDeadline(sync, role, deadline) {
  if (role !== 'gm') return null;
  if (readPath(sync, 'game/question/state') !== 'open') return null;
  await sync.update('game/question/deadline', deadline || 0);
  return { deadline: deadline || 0 };
}

/**
 * Reveal the correct answer and compute (but do not yet apply) scores via
 * `scoring.MODES[roundCfg.mode].scoreOutcome`. Per PRD §4.7, used-question
 * memory is recorded when a question reaches `revealed` (not at
 * `commitScores`) — `onUsedRef`, if given, is called once with the revealed
 * ref so the caller can pipe it to `storage.recordUsed`. Team totals are
 * NOT updated here (acceptance criterion 12 requires the GM be able to edit
 * deltas before they commit); call `commitScores` to apply them.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {'A'|'B'|'C'|'D'} correct
 * @param {(ref: string) => void} [onUsedRef]
 * @returns {Promise<?{deltas: Object<string, number>}>}
 */
export async function revealQuestion(sync, role, correct, onUsedRef) {
  if (role !== 'gm') return null;
  const question = readPath(sync, 'game/question');
  if (!question) return null;
  const round = readPath(sync, 'game/round');
  const rounds = readPath(sync, 'settings/rounds') || [];
  const roundCfg = rounds[round];
  const selectingTeamId = readPath(sync, 'game/activeTeam');
  const teamIds = Object.keys(readPath(sync, 'teams') || {});
  const { deltas } = MODES[roundCfg.mode].scoreOutcome({
    locks: question.locks || {},
    correct,
    roundCfg,
    selectingTeamId,
    teamIds,
    value: question.value,
  });
  // Result BEFORE state: `state` and `result` are separate paths, so an
  // observer can see one write before the other. Writing the result first means
  // any client that sees `state === 'revealed'` already has the result to
  // render — no window where a screen reads `result.correct` off null.
  await sync.update('game/question/result', { correct, deltas, fact: null });
  await sync.update('game/question/state', 'revealed');
  if (typeof onUsedRef === 'function') onUsedRef(question.ref);
  return { deltas };
}

/**
 * Apply final (possibly GM-overridden) per-team deltas: updates team scores,
 * appends a log entry, and marks the question `scored`.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {?Object<string, number>} [overriddenDeltas] - defaults to the
 *   deltas `revealQuestion` computed (`game/question/result/deltas`).
 * @returns {Promise<?{deltas: Object<string, number>}>}
 */
export async function commitScores(sync, role, overriddenDeltas) {
  if (role !== 'gm') return null;
  const question = readPath(sync, 'game/question');
  if (!question || !question.result) return null;
  const finalDeltas = overriddenDeltas || question.result.deltas || {};
  for (const [teamId, delta] of Object.entries(finalDeltas)) {
    if (!delta) continue;
    await sync.transact(`teams/${teamId}/score`, (cur) => (cur || 0) + delta);
  }
  const round = readPath(sync, 'game/round');
  await sync.transact('game/log', (cur) => [
    ...(cur || []),
    { ref: question.ref, round, deltas: finalDeltas, at: sync.serverNow(), selectedBy: question.selectedBy || null },
  ]);
  await sync.update('game/question/result/deltas', finalDeltas);
  await sync.update('game/question/state', 'scored');
  return { deltas: finalDeltas };
}

/**
 * Abort the current question pre-reveal; its ref returns to the board unused.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @returns {Promise<?{ref: string}>}
 */
export async function skipQuestion(sync, role) {
  if (role !== 'gm') return null;
  const question = readPath(sync, 'game/question');
  if (!question || !question.ref) return null;
  const { slug, id } = parseRef(question.ref);
  const dif = id[0];
  const board = readPath(sync, 'game/board') || {};
  await sync.update('game/board', addIdToTier(board, slug, dif, id));
  await sync.update('game/question', null);
  return { ref: question.ref };
}

/**
 * Advance to the next turn via `scheduler.advanceTurn`, writing the new turn
 * state and opening tap-in for the new active team (or ending the game).
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @returns {Promise<?import('./scheduler.js').NextTurn>}
 */
export async function advance(sync, role) {
  if (role !== 'gm') return null;
  const round = readPath(sync, 'game/round');
  const rotation = readPath(sync, 'game/rotation');
  const turnIdx = readPath(sync, 'game/turnIdx');
  const teamOrder = readPath(sync, 'game/teamOrder') || [];
  const teams = readPath(sync, 'teams') || {};
  const rounds = readPath(sync, 'settings/rounds') || [];
  const orderRecalc = readPath(sync, 'settings/orderRecalc') || 'perRound';

  const next = advanceTurn({ round, rotation, turnIdx, teamOrder, teams }, { rounds, orderRecalc });

  // The finished (scored) question must not linger: requestSelection guards
  // on game/question, so leaving it set would deadlock the next selector.
  await sync.update('game/question', null);
  // Likewise the outgoing team's selection lock (V2-14) — `claimSelection`
  // survives a stale claim, but the UI shouldn't have to.
  await sync.update('selectionClaim', null);

  if (next.phase === 'gameEnd') {
    await sync.update('meta/status', 'ended');
    return next;
  }

  await sync.update('game/round', next.round);
  await sync.update('game/rotation', next.rotation);
  await sync.update('game/turnIdx', next.turnIdx);
  await sync.update('game/teamOrder', next.teamOrder);
  await sync.update('game/activeTeam', next.activeTeam);
  await openTapIn(sync, role, next.activeTeam);
  return next;
}

/**
 * GM: arbitrary score correction/bonus for one team (PRD §4.6, mirrors the
 * v6 bonus column). Applied immediately, independent of any question.
 * @returns {Promise<?{teamId: string, delta: number}>}
 */
export async function adjustScore(sync, role, teamId, delta) {
  if (role !== 'gm') return null;
  if (!delta) return { teamId, delta: 0 };
  await sync.transact(`teams/${teamId}/score`, (cur) => (cur || 0) + delta);
  return { teamId, delta };
}

/**
 * GM: force the current round to end now — jumps to the next round's first
 * turn (order computed by that round's orderMode) and opens tap-in, or ends
 * the game if this was the last round. Any live question is discarded
 * (unscored, not returned to the board — the GM chose to move on).
 * @returns {Promise<?{round: number}|{ended: true}>}
 */
export async function endRound(sync, role) {
  if (role !== 'gm') return null;
  const round = readPath(sync, 'game/round');
  const rounds = readPath(sync, 'settings/rounds') || [];
  const nextRound = (round ?? 0) + 1;
  if (nextRound >= rounds.length) return endGame(sync, role);
  const teams = readPath(sync, 'teams') || {};
  const order = computeOrder({ teams, mode: rounds[nextRound].orderMode || 'registration' });
  await sync.update('game/question', null);
  await sync.update('game/selectIntent', null);
  await sync.update('selectionClaim', null);
  await sync.update('game/round', nextRound);
  await sync.update('game/rotation', 0);
  await sync.update('game/turnIdx', 0);
  await sync.update('game/teamOrder', order);
  await sync.update('game/activeTeam', order[0] ?? null);
  await openTapIn(sync, role, order[0] ?? null);
  return { round: nextRound };
}

/**
 * GM: end the game immediately (final standings = current scores).
 * @returns {Promise<?{ended: true}>}
 */
export async function endGame(sync, role) {
  if (role !== 'gm') return null;
  await sync.update('game/selectIntent', null);
  await sync.update('meta/status', 'ended');
  return { ended: true };
}

/**
 * GM: replace round configuration and/or orderRecalc after room creation.
 * Refused while a question is live (mid-question rule changes would corrupt
 * scoring); between turns/rounds it is safe — the scheduler and scoring read
 * settings fresh on every action.
 * @param {{rounds?: Array<Object>, orderRecalc?: string}} patch
 * @returns {Promise<?{committed: boolean, reason?: string}>}
 */
export async function updateRoundSettings(sync, role, patch) {
  if (role !== 'gm') return null;
  if (readPath(sync, 'game/question')) return { committed: false, reason: 'question-in-progress' };
  if (patch.rounds && patch.rounds.length) await sync.update('settings/rounds', patch.rounds);
  if (patch.orderRecalc) await sync.update('settings/orderRecalc', patch.orderRecalc);
  return { committed: true };
}

/**
 * GM: persist the Category selection (PRD §3.2 step 2) — which Categories are
 * in play, each one's "Questions per Tier" N (V2-17), and the small display
 * directory the Players and Displays need to name and illustrate a Category
 * without fetching all 58 Markdown files onto a phone.
 *
 * Written at Confirm rather than held in the Host's React state, so a Host who
 * refreshes mid-setup comes back to their choices, and so the Display can show
 * "available Categories" before the Game begins.
 *
 * Refused while a question is live, for the same reason `updateRoundSettings`
 * is: the board is drawn from these fields.
 *
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} role
 * @param {Object} patch
 * @param {string[]} [patch.categories] - slugs in play.
 * @param {Object<string, number>} [patch.tierSizes] - per-slug N.
 * @param {Object<string, {name: string, icon: ?string, n: number}>} [patch.categoryMeta]
 * @returns {Promise<?{committed: boolean, reason?: string}>}
 */
export async function updateBoardSettings(sync, role, patch) {
  if (role !== 'gm') return null;
  if (readPath(sync, 'game/question')) return { committed: false, reason: 'question-in-progress' };
  if (patch.categories) await sync.update('settings/categories', patch.categories);
  if (patch.tierSizes) await sync.update('settings/tierSizes', patch.tierSizes);
  if (patch.categoryMeta) await sync.update('settings/categoryMeta', patch.categoryMeta);
  await touchActivity(sync);
  return { committed: true };
}

/**
 * Freeze/unfreeze self-serve registration (players can still join existing
 * teams mid-game per PRD §4.1; this gates team CREATION and renames).
 * @returns {Promise<?boolean>}
 */
export async function lockRegistration(sync, role, locked) {
  if (role !== 'gm') return null;
  await sync.update('meta/registrationLocked', !!locked);
  return !!locked;
}

/**
 * GM edit of a team's display fields (rename / recolor / reorder — order
 * drives round-1 turn order).
 * @param {Object} patch - any of {name, color, order}
 * @returns {Promise<?Object>}
 */
export async function gmUpdateTeam(sync, role, teamId, patch) {
  if (role !== 'gm') return null;
  for (const key of ['name', 'color', 'order']) {
    if (patch[key] !== undefined) await sync.update(`teams/${teamId}/${key}`, patch[key]);
  }
  return patch;
}

/**
 * GM: freeze answering at timer expiry (lockAnswer guards state === 'open',
 * so 'locked' blocks further locks; reveal accepts either state).
 * @returns {Promise<?boolean>}
 */
export async function lockQuestion(sync, role) {
  if (role !== 'gm') return null;
  const state = readPath(sync, 'game/question/state');
  if (state !== 'open') return null;
  await sync.update('game/question/state', 'locked');
  return true;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

/**
 * Announce this client in the room roster (idempotent; call on every join
 * and rejoin so refreshed tabs restore their seat).
 */
export async function registerClient(sync, { clientId, role, name, teamId = null }) {
  await sync.update(`clients/${clientId}`, { role, name, teamId });
}

/**
 * Remove a Player from whatever Team they were previously on (R9, PRD §8b).
 * Shared by `createTeam` and `joinTeam`: neither the UI nor the wire has a
 * distinct "leave" action — Back in the lobby only releases a selection/
 * tap-in claim (V2-14), so a Team switch is a create-or-join that must ALSO
 * clean up the roster it's leaving behind, or the Player is double-counted
 * (`teams/<old>/players/<id>` never goes away on its own).
 *
 * A no-op when there is no previous Team, or the "previous" Team is the one
 * they're switching TO (retyping your own Team's name is not a switch).
 *
 * A Team left with zero players is deleted while the room is still in its
 * `lobby` — an empty tile nobody can revive is clutter, not state worth
 * keeping, and `selectLobby`'s counts derive straight from `teams/*`, so
 * removing the node is what makes them self-correct. Mid-Game the empty Team
 * survives: its score and its seat in `game/teamOrder` are live game state
 * (`scheduler.advanceTurn` still expects to find it), not lobby bookkeeping.
 *
 * `status` is read once, before the transact, the same way every other
 * guard in this file reads a value it doesn't own the write-path for
 * (`claimHost`'s `hostPin`/seat check is the same shape) — a status flip
 * landing inside the transact's retry window is not a case this app
 * protects against anywhere else either.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} playerId
 * @param {string} newTeamId - the Team they're joining now.
 * @returns {Promise<void>}
 */
async function leavePreviousTeam(sync, playerId, newTeamId) {
  const prevTeamId = readPath(sync, `clients/${playerId}/teamId`);
  if (!prevTeamId || prevTeamId === newTeamId) return;
  const status = readPath(sync, 'meta/status') || 'lobby';
  await sync.transact(`teams/${prevTeamId}`, (cur) => {
    if (cur == null || !cur.players || !(playerId in cur.players)) return undefined;
    const players = { ...cur.players };
    delete players[playerId];
    if (Object.keys(players).length === 0 && status === 'lobby') return null;
    return { ...cur, players };
  });
}

/**
 * Create a team (first-write-wins on the id) and seat the creator in it.
 * Refused while registration is locked.
 * @returns {Promise<{committed: boolean, reason?: string}>}
 */
export async function createTeam(sync, { teamId, name, color, order, playerId, playerName }) {
  if (readPath(sync, 'meta/registrationLocked')) return { committed: false, reason: 'registration-locked' };
  const { committed } = await sync.transact(`teams/${teamId}`, (cur) =>
    cur == null ? { name, color, order, score: 0, players: { [playerId]: { name: playerName } } } : undefined
  );
  if (committed) {
    await leavePreviousTeam(sync, playerId, teamId);
    await registerClient(sync, { clientId: playerId, role: 'player', name: playerName, teamId });
  }
  return { committed, reason: committed ? undefined : 'team-id-taken' };
}

/**
 * Join an existing team (allowed mid-game per PRD §4.1).
 * @returns {Promise<{committed: boolean, reason?: string}>}
 */
export async function joinTeam(sync, { teamId, playerId, playerName }) {
  const team = readPath(sync, `teams/${teamId}`);
  if (!team) return { committed: false, reason: 'no-such-team' };
  await sync.update(`teams/${teamId}/players/${playerId}`, { name: playerName });
  await leavePreviousTeam(sync, playerId, teamId);
  await registerClient(sync, { clientId: playerId, role: 'player', name: playerName, teamId });
  return { committed: true };
}

/**
 * The tap-in winner requests a category+difficulty. Players never draw or
 * open questions themselves (GM is the sole authority): this writes an
 * intent the GM client observes (`onChange('game/selectIntent')`), validates,
 * and fulfils via drawQuestion + selectQuestion + openQuestion, then clears.
 * @returns {Promise<{committed: boolean, reason?: string}>}
 */
export async function requestSelection(sync, { playerId, teamId, slug, dif }) {
  const tapIn = readPath(sync, 'game/tapIn');
  if (!tapIn || tapIn.winner !== playerId) return { committed: false, reason: 'not-selector' };
  const activeTeam = readPath(sync, 'game/activeTeam');
  if (activeTeam !== teamId) return { committed: false, reason: 'not-active-team' };
  if (readPath(sync, 'game/question')) return { committed: false, reason: 'question-in-progress' };
  const { committed } = await sync.transact('game/selectIntent', (cur) =>
    cur == null ? { playerId, teamId, slug, dif, at: sync.serverNow() } : undefined
  );
  return { committed, reason: committed ? undefined : 'intent-pending' };
}

/**
 * GM: clear a fulfilled (or rejected) selection intent.
 * @returns {Promise<?boolean>}
 */
export async function clearSelectIntent(sync, role) {
  if (role !== 'gm') return null;
  await sync.update('game/selectIntent', null);
  return true;
}

/**
 * Claim the tap-in for `teamId` (first write wins). No-op unless the gate is
 * currently open for this team.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} teamId
 * @param {string} playerId
 * @returns {Promise<{committed: boolean, winner: ?string}>}
 */
export async function claimTapIn(sync, teamId, playerId) {
  // Transact on the whole gate, not just `winner`: the gate check must be
  // atomic with the claim, or a straggler tap could win a gate the GM has
  // since re-opened for a different team (openTapIn resets winner to null).
  const { committed, snapshot } = await sync.transact('game/tapIn', (cur) =>
    cur && cur.openFor === teamId && cur.winner == null ? { ...cur, winner: playerId } : undefined
  );
  return { committed, winner: getAtPath(snapshot, splitPath('game/tapIn/winner')) ?? null };
}

/**
 * Give the tap-in back (V2-14's Back button). The selection claim and the
 * tap-in gate are two halves of one idea — "which teammate is choosing" — and
 * both have to let go together, or the next teammate to tap would hold the UI
 * claim while `requestSelection` still refused them as `not-selector`.
 *
 * Only the winner may release, and only while the gate is still open for their
 * team: a straggler cannot un-win a gate the GM has re-opened for someone else.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {Object} opts
 * @param {string} opts.teamId
 * @param {string} opts.playerId
 * @returns {Promise<{committed: boolean, reason?: string}>}
 */
export async function releaseTapIn(sync, { teamId, playerId }) {
  const { committed } = await sync.transact('game/tapIn', (cur) =>
    cur && cur.openFor === teamId && cur.winner === playerId ? { ...cur, winner: null } : undefined
  );
  return committed ? { committed: true } : { committed: false, reason: 'not-tapin-winner' };
}

/**
 * Lock `teamId`'s answer (its earliest lock wins; immutable thereafter).
 * Re-asserts mode eligibility (`MODES[mode].mayAnswer`) and, in `contest`
 * mode for a non-selecting team, that `choice` differs from the selector's
 * public lock — defense in depth behind whatever the UI already enforces.
 * @param {import('../sync/adapter.js').SyncHandle} sync
 * @param {string} teamId
 * @param {string} playerId
 * @param {'A'|'B'|'C'|'D'} choice
 * @param {number} serverNow
 * @returns {Promise<{committed: boolean, reason?: string, lock?: Object}>}
 */
export async function lockAnswer(sync, teamId, playerId, choice, serverNow) {
  const question = readPath(sync, 'game/question');
  if (!question || question.state !== 'open') return { committed: false, reason: 'not-open' };

  const round = readPath(sync, 'game/round');
  const rounds = readPath(sync, 'settings/rounds') || [];
  const roundCfg = rounds[round];
  const selectingTeamId = readPath(sync, 'game/activeTeam');
  const teamIds = Object.keys(readPath(sync, 'teams') || {});
  const locks = question.locks || {};

  const mayCtx = { locks, correct: null, roundCfg, selectingTeamId, teamIds, value: question.value };
  if (!MODES[roundCfg.mode].mayAnswer(teamId, mayCtx)) {
    return { committed: false, reason: 'not-eligible' };
  }
  if (roundCfg.mode === 'contest' && teamId !== selectingTeamId) {
    const selectorChoice = locks[selectingTeamId] && locks[selectingTeamId].choice;
    if (selectorChoice != null && choice === selectorChoice) {
      return { committed: false, reason: 'must-differ-from-selector' };
    }
  }

  const path = `game/question/locks/${teamId}`;
  const { committed, snapshot } = await sync.transact(path, (cur) => (cur == null ? { playerId, choice, at: serverNow } : undefined));
  return { committed, lock: getAtPath(snapshot, splitPath(path)) };
}
