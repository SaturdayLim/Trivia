/**
 * @file Pure turn/round scheduler for Stack trivia games (PRD §4.2). No DOM,
 * no sync — `computeOrder`/`advanceTurn` are deterministic functions of their
 * arguments; `js/engine/actions.js` is the only module that wires their
 * output into synced room state.
 */

/** @typedef {'registration'|'winnerFirst'|'loserFirst'} OrderMode */

/**
 * @typedef {Object} TeamStanding
 * @property {number} order - lobby/registration order (lower = earlier).
 * @property {number} score - cumulative score, used for winner/loserFirst sort.
 */

/**
 * Sort team ids per `mode`. Ties always break by ascending registration
 * `order` (PRD §4.2), for both winnerFirst and loserFirst.
 * @param {Object} opts
 * @param {Object<string, TeamStanding>} opts.teams - keyed by teamId.
 * @param {OrderMode} opts.mode
 * @returns {string[]} teamIds in play order.
 */
export function computeOrder({ teams, mode }) {
  const ids = Object.keys(teams);
  const byRegistration = (a, b) => teams[a].order - teams[b].order;
  const comparators = {
    registration: byRegistration,
    winnerFirst: (a, b) => teams[b].score - teams[a].score || byRegistration(a, b),
    loserFirst: (a, b) => teams[a].score - teams[b].score || byRegistration(a, b),
  };
  const cmp = comparators[mode];
  if (!cmp) throw new Error(`stack scheduler: unknown orderMode "${mode}"`);
  return ids.sort(cmp);
}

/**
 * @typedef {Object} GameTurnState
 * @property {number} round - 0-based index into settings.rounds.
 * @property {number} rotation - 0-based rotation within the current round.
 * @property {number} turnIdx - 0-based index into teamOrder.
 * @property {string[]} teamOrder
 * @property {Object<string, TeamStanding>} teams - current scores, consulted
 *   whenever this step triggers an order recompute.
 */

/**
 * @typedef {Object} SchedulerSettings
 * @property {Array<{rotations: number, orderMode: OrderMode}>} rounds
 * @property {'perRound'|'perRotation'} orderRecalc
 */

/**
 * @typedef {Object} NextTurn
 * @property {number} round
 * @property {number} rotation
 * @property {number} turnIdx
 * @property {string[]} teamOrder
 * @property {?string} activeTeam - null only when phase is 'gameEnd'.
 * @property {'tapIn'|'roundEnd'|'gameEnd'} phase
 */

/**
 * Compute the next turn after the active team's turn finishes. Pure: reads
 * only its two arguments, never touches sync.
 *
 * Round 1 (index 0)'s *initial* order is NOT this function's concern — per
 * PRD §4.2 it is always `registration`, seeded once by `actions.startGame`.
 * `advanceTurn` only ever transitions from round `r` to round `r+1` (so
 * `r+1 >= 1`), which is why the round-complete branch below is free to always
 * honor the new round's configured `orderMode`.
 *
 * @param {GameTurnState} game
 * @param {SchedulerSettings} settings
 * @returns {NextTurn}
 */
export function advanceTurn(game, settings) {
  const { round, rotation, turnIdx, teamOrder, teams } = game;
  const { rounds, orderRecalc } = settings;
  const turnIdxNext = turnIdx + 1;

  if (turnIdxNext < teamOrder.length) {
    // Still mid-rotation: just move to the next team in the held order.
    return { round, rotation, turnIdx: turnIdxNext, teamOrder, activeTeam: teamOrder[turnIdxNext], phase: 'tapIn' };
  }

  // Rotation complete: every team has taken exactly one turn.
  const rotationNext = rotation + 1;
  const roundCfg = rounds[round];

  if (rotationNext < roundCfg.rotations) {
    const order = orderRecalc === 'perRotation' ? computeOrder({ teams, mode: roundCfg.orderMode }) : teamOrder;
    return { round, rotation: rotationNext, turnIdx: 0, teamOrder: order, activeTeam: order[0], phase: 'tapIn' };
  }

  // Round complete too.
  const roundNext = round + 1;
  if (roundNext >= rounds.length) {
    // Freeze at the last real state — nothing left to play.
    return { round, rotation, turnIdx, teamOrder, activeTeam: null, phase: 'gameEnd' };
  }
  const newRoundCfg = rounds[roundNext];
  const order = computeOrder({ teams, mode: newRoundCfg.orderMode });
  return { round: roundNext, rotation: 0, turnIdx: 0, teamOrder: order, activeTeam: order[0], phase: 'roundEnd' };
}
