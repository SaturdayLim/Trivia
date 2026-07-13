/**
 * @file Pure derivation of "what is happening in this Game right now, and what
 * may I do about it" — the model behind the Host live loop, the Player's
 * selector/answer screens, and the read-only Display (PRD §3.2–§3.4).
 *
 * The same discipline as `lobby.js`: no React, no sync, no clock. Every screen
 * asks this module a question and renders the answer, so the rules that decide
 * who may tap what are unit tests rather than click-throughs. The one thing
 * callers must supply is `now` (from `sync.serverNow()`), never `Date.now()` —
 * the timer is a shared deadline on a server clock, not a local countdown.
 */

import { MODES, questionValue } from '../engine/scoring.js';
import { parseRef } from '../engine/questions.js';
import { holdsClaim, isLockedOut } from './room.js';
import { normalizeStage, normalizeStages, contestantsOf, everyoneAnswers } from './stages.js';

/** Difficulty semantics from PRD §7. Green / Yellow / Red, everywhere. */
export const DIFFICULTIES = [
  { value: 'E', label: 'Easy', points: 1, tint: '#4ADE80' },
  { value: 'M', label: 'Medium', points: 2, tint: '#FACC15' },
  { value: 'H', label: 'Hard', points: 3, tint: '#F87171' },
];

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

/**
 * How long after the deadline the Host waits before sealing the question
 * (`lockQuestion`).
 *
 * V2-15 says an option a player has *selected* but not Locked In is locked in
 * for them when the timer expires. Only that player's device knows their
 * pending selection, so it is their device that writes the lock, at the
 * deadline. PRD §6 budgets ≤1s for that write to reach the Host. Sealing the
 * question the instant the deadline passes would race those in-flight locks and
 * throw away exactly the answers V2-15 promises to keep; this grace window is
 * that budget, made explicit.
 */
export const LOCK_GRACE_MS = 1500;

/** @param {string} dif @returns {{value: string, label: string, points: number, tint: string}} */
export function difficulty(dif) {
  return DIFFICULTIES.find((d) => d.value === dif) || DIFFICULTIES[0];
}

/** The difficulty tier of a question ref ("marvel:M3" -> "M"). */
export function difficultyOf(ref) {
  if (!ref) return null;
  const { id } = parseRef(ref);
  return id[0];
}

/** The category slug of a question ref. */
export function slugOf(ref) {
  return ref ? parseRef(ref).slug : null;
}

/**
 * How many questions remain on the board for `slug`, per tier. Drives the
 * Player's difficulty grid (unavailable tiers disabled) and the Display's
 * difficulty-selection view (PRD §3.3/§3.4).
 * @param {?Object} board
 * @param {string} slug
 * @returns {{E: number, M: number, H: number, total: number}}
 */
export function tierCounts(board, slug) {
  const tiers = (board && board[slug]) || {};
  const counts = { E: 0, M: 0, H: 0, total: 0 };
  for (const d of ['E', 'M', 'H']) {
    counts[d] = ((tiers[d] || []).length) | 0;
    counts.total += counts[d];
  }
  return counts;
}

/**
 * Categories still holding at least one question, in the Host's chosen order.
 * A Category the board has run dry disappears from the Player's grid rather
 * than sitting there refusing taps.
 * @param {?Object} board
 * @param {string[]} order - `settings.categories`.
 * @returns {string[]}
 */
export function liveSlugs(board, order) {
  return (order || []).filter((slug) => tierCounts(board, slug).total > 0);
}

/** A team's display name, falling back to its id rather than to nothing. */
export function teamName(room, teamId) {
  if (!teamId) return null;
  const team = room && room.teams && room.teams[teamId];
  return (team && team.name) || teamId;
}

/** The name of a player, wherever they are seated. */
export function playerName(room, playerId) {
  if (!playerId) return null;
  const client = room && room.clients && room.clients[playerId];
  if (client && client.name) return client.name;
  for (const team of Object.values((room && room.teams) || {})) {
    const p = team.players && team.players[playerId];
    if (p && p.name) return p.name;
  }
  return 'A Player';
}

/**
 * The three states a Team's delta can be in (V2-11, R3). A one-tap segmented
 * control replaces v1's tap-to-cycle button: all three states are visible at
 * once, so choosing one is a single, unambiguous tap.
 */
export const DELTA_SIGNS = [
  { value: 'plus', label: 'Plus', symbol: '+' },
  { value: 'nil', label: 'Nothing', symbol: '0' },
  { value: 'minus', label: 'Minus', symbol: '−' },
];

/**
 * Which of the three states a delta is currently in.
 * @param {number} delta
 * @returns {'plus'|'nil'|'minus'}
 */
export function signOfDelta(delta) {
  if (delta > 0) return 'plus';
  if (delta < 0) return 'minus';
  return 'nil';
}

/**
 * The delta a chosen sign resolves to. The magnitude is always the question's
 * value: a Host awarding points to a Team that never locked (a verbal answer,
 * a judgement call) means the full value, and V2-12 fixes the penalty at the
 * same magnitude.
 * @param {'plus'|'nil'|'minus'} sign
 * @param {number} value - `question.value`, multiplier already applied.
 * @returns {number}
 */
export function deltaForSign(sign, value) {
  if (sign === 'plus') return value;
  if (sign === 'minus') return -value;
  return 0;
}

/**
 * The deltas the Host starts from after a reveal: whatever the engine scored
 * (V2-11 — "auto-scored default pre-filled"), with every Team present so the
 * toggles render a full row.
 * @param {?Object} question
 * @param {string[]} teamIds
 * @returns {Object<string, number>}
 */
export function initialDeltas(question, teamIds) {
  const scored = (question && question.result && question.result.deltas) || {};
  const out = {};
  for (const id of teamIds) out[id] = typeof scored[id] === 'number' ? scored[id] : 0;
  return out;
}

/**
 * May `teamId` lock an answer to the live question? Delegates to the round
 * mode's own rule (`scoring.MODES[mode].mayAnswer`) rather than re-deriving
 * "selector only" from the Contestants setting, so the UI and the write-path
 * guard in `lockAnswer` can never disagree.
 * @param {?Object} room
 * @param {?string} teamId
 * @returns {boolean}
 */
export function mayAnswer(room, teamId) {
  const question = room && room.game && room.game.question;
  if (!question || !teamId) return false;
  const stage = stageOf(room);
  const mode = MODES[stage.mode];
  if (!mode) return false;
  return mode.mayAnswer(teamId, {
    locks: question.locks || {},
    correct: null,
    roundCfg: stage,
    selectingTeamId: room.game.activeTeam,
    teamIds: Object.keys(room.teams || {}),
    value: question.value,
  });
}

/** The Stage currently being played, normalized (never undefined). */
export function stageOf(room) {
  const rounds = (room && room.settings && room.settings.rounds) || [];
  const idx = (room && room.game && room.game.round) || 0;
  return normalizeStage(rounds[idx]);
}

/**
 * What a question is worth right now. `question.value` is written at selection
 * and is authoritative; this recomputes it only when there is no question yet
 * (the Player's difficulty grid, which shows what each tier would be worth).
 * @param {?Object} room
 * @param {string} dif
 * @returns {number}
 */
export function valueOf(room, dif) {
  return questionValue(dif, stageOf(room));
}

/**
 * @typedef {Object} GameView
 * @property {string} status - meta.status.
 * @property {boolean} playing
 * @property {boolean} ended
 * @property {number} stageIdx - 0-based; `stageNumber` is the human one.
 * @property {number} stageNumber
 * @property {Object} stage - normalized RoundConfig.
 * @property {Object[]} stages - all four, normalized.
 * @property {number} rotation - 0-based.
 * @property {number} rotationNumber
 * @property {?string} activeTeam
 * @property {?string} activeTeamName
 * @property {string[]} teamOrder
 * @property {?Object} question - the raw synced node.
 * @property {?string} qState - 'selecting' | 'open' | 'locked' | 'revealed' | 'scored'.
 * @property {?string} ref
 * @property {?string} slug - the live question's Category.
 * @property {?string} dif
 * @property {number} value
 * @property {number} deadline - epoch ms; 0 when the Stage has no timer.
 * @property {Object<string, Object>} locks
 * @property {?Object} result - `{correct, deltas}` once revealed.
 * @property {Object} board
 * @property {?Object} claim - the selection claim (V2-14).
 * @property {?string} selectorId - the teammate driving the selection.
 * @property {?string} selectorName
 * @property {Object[]} log - question log entries, newest last.
 * @property {Object} categoryMeta
 * @property {string[]} categories - slugs in play.
 * @property {'selector'|'all'|'fastest'} contestants - this Stage's Contestants setting.
 * @property {boolean} allContest - every Team may answer this Stage (All or Fastest Fingers).
 * @property {?string} selectorChoice - the selecting Team's locked letter, or
 *   null. The Display highlights only this pre-reveal (R11).
 */

/**
 * The whole live-game view, from the room tree alone.
 * @param {?Object} room
 * @returns {GameView}
 */
export function selectGame(room) {
  const game = (room && room.game) || {};
  const settings = (room && room.settings) || {};
  const question = game.question || null;
  const stage = stageOf(room);
  const ref = question ? question.ref : null;
  const selectorId = (game.tapIn && game.tapIn.winner) || (game.selectIntent && game.selectIntent.playerId) || null;
  const locks = (question && question.locks) || {};
  const selectorLock = game.activeTeam ? locks[game.activeTeam] : null;

  return {
    status: (room && room.meta && room.meta.status) || 'lobby',
    playing: (room && room.meta && room.meta.status) === 'playing',
    ended: (room && room.meta && room.meta.status) === 'ended',
    stageIdx: game.round || 0,
    stageNumber: (game.round || 0) + 1,
    stage,
    stages: normalizeStages(settings.rounds),
    rotation: game.rotation || 0,
    rotationNumber: (game.rotation || 0) + 1,
    activeTeam: game.activeTeam || null,
    activeTeamName: teamName(room, game.activeTeam),
    teamOrder: game.teamOrder || [],
    question,
    qState: question ? question.state : null,
    ref,
    slug: slugOf(ref),
    dif: difficultyOf(ref),
    value: question ? question.value : 0,
    deadline: (question && question.deadline) || 0,
    locks,
    result: (question && question.result) || null,
    board: game.board || {},
    claim: room ? room.selectionClaim || null : null,
    selectorId,
    selectorName: playerName(room, selectorId),
    log: game.log || [],
    categoryMeta: settings.categoryMeta || {},
    categories: settings.categories || [],
    contestants: contestantsOf(stage),
    allContest: everyoneAnswers(stage),
    selectorChoice: selectorLock ? selectorLock.choice : null,
  };
}

/**
 * The Player's own slice: everything the answer/selection screens branch on.
 * Split from `selectGame` because the Display has no identity and the Host's
 * identity is a seat, not a Team.
 *
 * @param {?Object} room
 * @param {Object} me
 * @param {string} me.playerId
 * @param {?string} me.teamId
 * @returns {Object}
 */
export function selectMe(room, { playerId, teamId }) {
  const g = selectGame(room);
  const claim = g.claim;
  const isActiveTeam = Boolean(teamId && g.activeTeam === teamId);
  const myLock = (teamId && g.locks[teamId]) || null;

  return {
    teamId,
    teamName: teamName(room, teamId),
    isActiveTeam,
    // V2-14. Both are false for a player whose team isn't up: they aren't
    // "locked out", they simply have no selection turn — different screens.
    holdsClaim: isActiveTeam && holdsClaim(claim, playerId, teamId),
    lockedOut: isActiveTeam && isLockedOut(claim, playerId, teamId),
    isSelector: g.selectorId === playerId,
    mayAnswer: mayAnswer(room, teamId),
    myLock,
    hasLocked: Boolean(myLock),
    // V2-16: a Team that never locked is not disqualified — it scored 0, and no
    // penalty applies. The distinction only exists so the screen can say so.
    missedIt: Boolean(!myLock && (g.qState === 'locked' || g.qState === 'revealed' || g.qState === 'scored')),
  };
}

/**
 * Seconds left on the shared deadline, floored at 0. `null` when the Stage runs
 * without a timer, which reads differently on screen than "0 seconds left".
 * @param {number} deadline - epoch ms.
 * @param {number} now - `sync.serverNow()`.
 * @returns {?number}
 */
export function secondsLeft(deadline, now) {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Has the Host's grace window closed on an expired question? Only then does the
 * Host seal it — see `LOCK_GRACE_MS`.
 * @param {number} deadline
 * @param {number} now
 * @returns {boolean}
 */
export function pastGrace(deadline, now) {
  return Boolean(deadline) && now >= deadline + LOCK_GRACE_MS;
}

/**
 * A lock that arrived before the deadline is an *explicit* Lock In, and V2-15
 * says it drops the timer to zero and locks everyone else out. A lock that
 * arrives at or after the deadline is a client auto-locking its pending
 * selection, and must not take the other Teams' answers down with it.
 * @param {Object<string, Object>} locks
 * @param {number} deadline - 0 for an untimed Stage, where every lock is explicit.
 * @returns {boolean}
 */
export function hasExplicitLock(locks, deadline) {
  const entries = Object.values(locks || {});
  if (entries.length === 0) return false;
  if (!deadline) return true;
  return entries.some((lock) => typeof lock.at === 'number' && lock.at < deadline);
}

/** Is one specific lock an explicit Lock In (before the deadline)? */
function lockIsExplicit(lock, deadline) {
  if (!lock) return false;
  return !deadline || (typeof lock.at === 'number' && lock.at < deadline);
}

/**
 * Which end-of-question mechanism an explicit Lock In should trigger under this
 * Stage's Contestants mode (V2-15/V2-26). The Host authority loop calls this to
 * decide whether to seal the question now or pull the timer in.
 *
 *   - `'seal'` — seal the question immediately. Selector Only (the selector's
 *      lock) and Fastest Fingers (the first Team's lock, R13) both end on the
 *      spot; nobody else's pending selection is captured.
 *   - `'pull'` — "All" mode (R10): ONLY the *Selector's* explicit lock ends it,
 *      and it does so by pulling the deadline in, so every other Team's pending
 *      selection auto-locks (V2-15) before the seal. A non-selecting Team's lock
 *      does NOT end the question — it only locks that Team.
 *   - `null`   — no explicit lock has ended the question yet.
 *
 * @param {Object} p
 * @param {Object<string, Object>} p.locks
 * @param {number} p.deadline - 0 for an untimed Stage (every lock is explicit).
 * @param {'selector'|'all'|'fastest'} p.contestants
 * @param {?string} p.selectingTeamId
 * @returns {'seal'|'pull'|null}
 */
export function lockEnding({ locks, deadline, contestants, selectingTeamId }) {
  if (contestants === 'fastest') return hasExplicitLock(locks, deadline) ? 'seal' : null;
  const sel = selectingTeamId && locks ? locks[selectingTeamId] : null;
  if (!lockIsExplicit(sel, deadline)) return null;
  return contestants === 'all' ? 'pull' : 'seal';
}

/**
 * One Question Log row (PRD §3.1 peripheral), from a `game.log` entry. Players
 * and Displays never load the Markdown, so the row is built from the ref, the
 * Category directory, and the deltas — no question text, which is the honest
 * amount of information the wire carries.
 *
 * `entry.selectedBy` (R4, PRD §8b) names who chose the question — written once
 * at selection (`actions.selectQuestion`) and carried onto the log entry at
 * commit, since by commit time the live selector state has already moved on
 * to the next turn.
 * @param {Object} entry - `{ref, round, deltas, at, selectedBy?}`
 * @param {Object} room
 * @returns {Object}
 */
export function logRow(entry, room) {
  const g = selectGame(room);
  const slug = slugOf(entry.ref);
  const dif = difficultyOf(entry.ref);
  const meta = g.categoryMeta[slug];
  return {
    ref: entry.ref,
    at: entry.at,
    stageNumber: (entry.round || 0) + 1,
    categoryName: (meta && meta.name) || slug,
    difficulty: difficulty(dif),
    selectedBy: entry.selectedBy
      ? { name: playerName(room, entry.selectedBy.playerId), team: teamName(room, entry.selectedBy.teamId) }
      : null,
    scores: Object.entries(entry.deltas || {})
      .filter(([, d]) => d !== 0)
      .map(([teamId, delta]) => ({ teamId, name: teamName(room, teamId), delta }))
      .sort((a, b) => b.delta - a.delta),
  };
}

/**
 * Final standings (PRD §3.4's ended state): teams by score, ties by
 * registration order — the same rule the scheduler uses (V2-10).
 * @param {?Object} room
 * @returns {Array<{teamId: string, name: string, color: string, score: number, rank: number}>}
 */
export function standings(room) {
  const teams = Object.entries((room && room.teams) || {}).map(([teamId, t]) => ({
    teamId,
    name: t.name || teamId,
    color: t.color || '#FFE600',
    score: t.score || 0,
    order: typeof t.order === 'number' ? t.order : 0,
  }));
  teams.sort((a, b) => b.score - a.score || a.order - b.order);
  let rank = 0;
  let lastScore = null;
  return teams.map((t, i) => {
    if (t.score !== lastScore) {
      rank = i + 1;
      lastScore = t.score;
    }
    return { ...t, rank };
  });
}
