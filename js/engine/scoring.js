/**
 * @file Pure scoring engine for Stack trivia rounds (PRD §4.6, RULES-v6 §C).
 * No DOM, no sync — every export is a small deterministic function of its
 * arguments. Round modes are implemented behind a strategy interface
 * (`mayAnswer` / `scoreOutcome`) so new variants drop in without touching
 * callers (PRD §4.4).
 */

/** @typedef {'E'|'M'|'H'} Difficulty */
/** @typedef {'on'|'off'|'half'} PenaltyMode */
/** @typedef {'registration'|'winnerFirst'|'loserFirst'} OrderMode */
/** @typedef {'community'|'exclusive'|'contest'|'suddendeath'} RoundModeName */
/** @typedef {'A'|'B'|'C'|'D'} Choice */

/**
 * @typedef {Object} RoundConfig
 * @property {RoundModeName} mode
 * @property {number} rotations
 * @property {number} multiplier
 * @property {PenaltyMode} penalty
 * @property {OrderMode} orderMode
 * @property {number} timerSec
 */

/**
 * @typedef {Object} Lock
 * @property {string} playerId
 * @property {Choice} choice
 * @property {number} at
 */

/**
 * @typedef {Object} ModeContext
 * @property {Object<string, Lock>} locks - keyed by teamId; a team with no
 *   lock is simply absent (undefined/null are treated alike).
 * @property {?Choice} correct - correct option letter; null when only
 *   `mayAnswer` is being consulted pre-reveal.
 * @property {RoundConfig} roundCfg
 * @property {string} selectingTeamId
 * @property {string[]} teamIds - every team in the game (deltas must cover all).
 * @property {number} value - the question's point value
 *   (`questionValue(dif, roundCfg)`). Precomputed by the caller: neither
 *   `mayAnswer` nor `scoreOutcome` is handed the difficulty directly, so this
 *   field is the resolved ambiguity that lets `scoreOutcome` compute deltas.
 */

/**
 * @typedef {Object} RoundMode
 * @property {(teamId: string, ctx: ModeContext) => boolean} mayAnswer
 * @property {(ctx: ModeContext) => {deltas: Object<string, number>}} scoreOutcome
 */

const DIFFICULTY_BASE = { E: 1, M: 2, H: 3 };

/**
 * Question point value: difficulty base (E=1, M=2, H=3) × round multiplier.
 * @param {Difficulty} dif
 * @param {RoundConfig} roundCfg
 * @returns {number}
 */
export function questionValue(dif, roundCfg) {
  const base = DIFFICULTY_BASE[dif];
  if (base == null) throw new Error(`stack scoring: unknown difficulty "${dif}"`);
  return base * roundCfg.multiplier;
}

/**
 * Wrong-answer penalty magnitude (a non-negative amount to SUBTRACT) for a
 * question worth `value`, under `penaltyMode`.
 * @param {number} value
 * @param {PenaltyMode} penaltyMode
 * @returns {number}
 */
export function penaltyAmount(value, penaltyMode) {
  if (penaltyMode === 'on') return value;
  if (penaltyMode === 'half') return Math.ceil(value / 2);
  if (penaltyMode === 'off') return 0;
  throw new Error(`stack scoring: unknown penalty mode "${penaltyMode}"`);
}

/** @returns {Object<string, number>} every teamId mapped to 0 */
function zeroDeltas(teamIds) {
  const deltas = {};
  for (const id of teamIds) deltas[id] = 0;
  return deltas;
}

/** A team's earliest-lock outcome under the standard +value / -penalty rule. */
function lockedDelta(lock, correct, value, penaltyMode) {
  if (!lock) return 0;
  return lock.choice === correct ? value : -penaltyAmount(value, penaltyMode);
}

// ---------------------------------------------------------------------------
// community / suddendeath — every team may answer; each team's earliest lock
// scores independently; unlocked teams score 0 (never penalized).
// ---------------------------------------------------------------------------

function allTeamsMayAnswer() {
  return true;
}

function allTeamsScoreOutcome(ctx) {
  const { locks, correct, roundCfg, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  for (const teamId of teamIds) {
    deltas[teamId] = lockedDelta(locks[teamId], correct, value, roundCfg.penalty);
  }
  return { deltas };
}

// ---------------------------------------------------------------------------
// exclusive — only the selecting team may ever lock; scored the same formula.
// ---------------------------------------------------------------------------

function exclusiveMayAnswer(teamId, ctx) {
  return teamId === ctx.selectingTeamId;
}

function exclusiveScoreOutcome(ctx) {
  const { locks, correct, roundCfg, selectingTeamId, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  deltas[selectingTeamId] = lockedDelta(locks[selectingTeamId], correct, value, roundCfg.penalty);
  return { deltas };
}

// ---------------------------------------------------------------------------
// contest — selector answers penalty-EXEMPT (wrong = 0, never a subtraction);
// every OTHER locked team is a "contestor" resolved symmetrically at full
// value (+value / -value), ignoring roundCfg.penalty entirely.
// ---------------------------------------------------------------------------

function contestMayAnswer(teamId, ctx) {
  if (teamId === ctx.selectingTeamId) return true;
  return ctx.locks[ctx.selectingTeamId] != null; // contestors need the selector's public lock first
}

function contestScoreOutcome(ctx) {
  const { locks, correct, selectingTeamId, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  const selectorLock = locks[selectingTeamId];
  deltas[selectingTeamId] = selectorLock && selectorLock.choice === correct ? value : 0;
  for (const teamId of teamIds) {
    if (teamId === selectingTeamId) continue;
    const lock = locks[teamId];
    if (!lock) continue; // never contested = 0
    deltas[teamId] = lock.choice === correct ? value : -value;
  }
  return { deltas };
}

/** @type {Object<RoundModeName, RoundMode>} */
export const MODES = {
  community: { mayAnswer: allTeamsMayAnswer, scoreOutcome: allTeamsScoreOutcome },
  suddendeath: { mayAnswer: allTeamsMayAnswer, scoreOutcome: allTeamsScoreOutcome },
  exclusive: { mayAnswer: exclusiveMayAnswer, scoreOutcome: exclusiveScoreOutcome },
  contest: { mayAnswer: contestMayAnswer, scoreOutcome: contestScoreOutcome },
};

/**
 * The four v6 stages in order, with their PRD §4.2 defaults. GM may
 * add/remove/reorder/edit rounds starting from this array.
 * NOTE: `contest`'s `penalty` field is a placeholder ('off') — contest's
 * `scoreOutcome` never reads `roundCfg.penalty` (selector is exempt,
 * contestors always risk the full value), but the room schema requires every
 * round to carry an on/off/half value, so one must be picked.
 * @type {RoundConfig[]}
 */
export const DEFAULT_ROUNDS = [
  { mode: 'community', rotations: 3, multiplier: 1, penalty: 'off', orderMode: 'registration', timerSec: 0 },
  { mode: 'exclusive', rotations: 3, multiplier: 1, penalty: 'on', orderMode: 'winnerFirst', timerSec: 0 },
  { mode: 'contest', rotations: 1, multiplier: 1, penalty: 'off', orderMode: 'loserFirst', timerSec: 0 },
  { mode: 'suddendeath', rotations: 1, multiplier: 2, penalty: 'on', orderMode: 'loserFirst', timerSec: 0 },
];
