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
/** @typedef {'community'|'exclusive'|'contest'|'suddendeath'|'selectorOnly'|'all'|'fastest'} RoundModeName */
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

// ---------------------------------------------------------------------------
// v2 Contestants modes (V2-26, trial-round R10/R13). These carry the amended
// scoring the trial round LOCKED, and are kept separate from the four v1 modes
// above — which the regression suite (tests/full-game.test.mjs) pins — so the
// engine's old behaviour is untouched. In EVERY v2 mode the *selecting* team
// must answer and takes the no-answer penalty when Penalty is On; a
// *non-selecting* team is scored only if it answers and is penalty-exempt on
// silence. The three modes differ only in who may answer and how the question
// ends (enforced by the Host loop + `state/game.js`'s `lockEnding`).
// ---------------------------------------------------------------------------

/** A team that locked: +value if right, else the wrong-answer penalty (0 when Off). */
function answeredDelta(lock, correct, value, penaltyMode) {
  return lock.choice === correct ? value : -penaltyAmount(value, penaltyMode);
}

// Selector Only — only the selecting team may ever lock. It is the one team
// that must answer, so its silence is the no-answer penalty; no other team scores.
function selectorOnlyScoreOutcome(ctx) {
  const { locks, correct, roundCfg, selectingTeamId, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  const sel = locks[selectingTeamId];
  deltas[selectingTeamId] = sel
    ? answeredDelta(sel, correct, value, roundCfg.penalty)
    : -penaltyAmount(value, roundCfg.penalty);
  return { deltas };
}

// All — every team may answer up to the Selector's lock-in (R10). Each locked
// team scores; a non-selecting team that never locked is exempt (0); the
// selecting team that never locked takes the no-answer penalty.
function allScoreOutcome(ctx) {
  const { locks, correct, roundCfg, selectingTeamId, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  for (const teamId of teamIds) {
    const lock = locks[teamId];
    if (lock) deltas[teamId] = answeredDelta(lock, correct, value, roundCfg.penalty);
    else if (teamId === selectingTeamId) deltas[teamId] = -penaltyAmount(value, roundCfg.penalty);
  }
  return { deltas };
}

// Fastest Fingers — the first team to answer (ties allowed) ends the question;
// every locked team is resolved. If NO team answered at all, the selecting team
// takes the no-answer penalty (R13). If someone answered but the selector was
// not among them, the selector is NOT penalized — it was raced, not silent.
function fastestScoreOutcome(ctx) {
  const { locks, correct, roundCfg, selectingTeamId, teamIds, value } = ctx;
  const deltas = zeroDeltas(teamIds);
  let anyLock = false;
  for (const teamId of teamIds) {
    const lock = locks[teamId];
    if (lock) {
      anyLock = true;
      deltas[teamId] = answeredDelta(lock, correct, value, roundCfg.penalty);
    }
  }
  if (!anyLock) deltas[selectingTeamId] = -penaltyAmount(value, roundCfg.penalty);
  return { deltas };
}

/** @type {Object<RoundModeName, RoundMode>} */
export const MODES = {
  community: { mayAnswer: allTeamsMayAnswer, scoreOutcome: allTeamsScoreOutcome },
  suddendeath: { mayAnswer: allTeamsMayAnswer, scoreOutcome: allTeamsScoreOutcome },
  exclusive: { mayAnswer: exclusiveMayAnswer, scoreOutcome: exclusiveScoreOutcome },
  contest: { mayAnswer: contestMayAnswer, scoreOutcome: contestScoreOutcome },
  // v2 Contestants modes (V2-26). selectorOnly reuses exclusive's eligibility
  // rule; all/fastest let every team answer.
  selectorOnly: { mayAnswer: exclusiveMayAnswer, scoreOutcome: selectorOnlyScoreOutcome },
  all: { mayAnswer: allTeamsMayAnswer, scoreOutcome: allScoreOutcome },
  fastest: { mayAnswer: allTeamsMayAnswer, scoreOutcome: fastestScoreOutcome },
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
