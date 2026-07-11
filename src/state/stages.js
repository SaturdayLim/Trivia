/**
 * @file The Stage vocabulary (V2-23) and the translation between what the Host
 * configures and what the engine consumes.
 *
 * ---------------------------------------------------------------------------
 * TWO VOCABULARIES, ONE SHAPE
 * ---------------------------------------------------------------------------
 * A **Game** has 4 **Stages**; each Stage runs a pre-set number of
 * **Rotations**; a Rotation is one selection turn per Team. That is the language
 * of PRD §3.2/§4 and of every string a user reads.
 *
 * The engine, ported from v1, calls a Stage a `round` and stores it as a
 * `RoundConfig` (scoring.js): `{mode, rotations, multiplier, penalty, orderMode,
 * timerSec}`. Renaming that would have meant rewriting scheduler + scoring +
 * their regression suite, which V2-1 forbids ("keep the tested engine").
 *
 * So this module is the seam. Everything above it says Stage; everything below
 * it says round; the two fields the PRD adds that v1 had no name for are:
 *
 *   - **Contestants** (Selector Only / All) — is exactly v1's round `mode`,
 *     spelled `exclusive` / `community`. `contest` and `suddendeath` are not
 *     reachable from the v2 UI: contest is excluded outright (V2-9), and
 *     "sudden death" in v2 is a *configuration* (All contestants, penalty on,
 *     high multiplier), not a distinct scoring rule — `suddendeath`'s
 *     `scoreOutcome` is literally `community`'s. Both modes stay in the engine.
 *
 *   - **Who Selects Next** (V2-10) — v1 had one order rule per round, applied
 *     both to seed the round and to re-sort it each rotation. v2 splits those:
 *     `orderMode` seeds the Stage, `orderModeNext` orders every rotation after
 *     the first. See scheduler.js.
 *
 * Pure: no React, no sync, no clock.
 */

/** A Game is four Stages (V2-23). Not configurable in v2. */
export const STAGE_COUNT = 4;

/** v1 defect #8: the timer had no default. It does now. */
export const DEFAULT_TIMER_SEC = 30;

/** V2-17: "Questions per Tier" — how many of each difficulty a Category contributes. */
export const DEFAULT_TIER_SIZE = 4;

/** Bounds for the typeable numeric fields (v1 defect #9). Generous, not silly. */
export const LIMITS = {
  rotations: { min: 1, max: 20 },
  multiplier: { min: 1, max: 10 },
  timerSec: { min: 0, max: 300 },
  tierSize: { min: 1, max: 20 },
};

/** Who may lock an answer (PRD §3.2 "Contestants"). */
export const CONTESTANTS = [
  { value: 'selector', label: 'Selector Only', hint: 'Only the Team that chose the question may answer.' },
  { value: 'all', label: 'All Teams', hint: 'Every Team answers. The first Team to Lock In ends the question.' },
];

/** Turn-order rules (V2-10). Ties always break by registration order. */
export const ORDER_MODES = [
  { value: 'registration', label: 'Registration Order' },
  { value: 'winnerFirst', label: 'Winner First' },
  { value: 'loserFirst', label: 'Loser First' },
];

export const PENALTIES = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

const CONTESTANTS_TO_MODE = { selector: 'exclusive', all: 'community' };
const MODE_TO_CONTESTANTS = { exclusive: 'selector', community: 'all', suddendeath: 'all', contest: 'all' };

/** @param {'selector'|'all'} contestants @returns {'exclusive'|'community'} */
export function modeFor(contestants) {
  return CONTESTANTS_TO_MODE[contestants] || 'exclusive';
}

/**
 * The Contestants setting behind a round's `mode`. `contest`/`suddendeath` are
 * legacy modes the v2 UI never writes; they read back as "All Teams" rather
 * than as an empty control.
 * @param {?{mode?: string}} round
 * @returns {'selector'|'all'}
 */
export function contestantsOf(round) {
  return MODE_TO_CONTESTANTS[round && round.mode] || 'selector';
}

/** @param {?{mode?: string}} round @returns {boolean} true when every Team answers. */
export function isAllContest(round) {
  return contestantsOf(round) === 'all';
}

function label(list, value) {
  const found = list.find((o) => o.value === value);
  return found ? found.label : value;
}

export const orderLabel = (value) => label(ORDER_MODES, value);
export const contestantsLabel = (value) => label(CONTESTANTS, value);

/**
 * The four Stages a fresh Game starts with (PRD §4: "Stage 1 intro (30s, no
 * penalty, selector-only, ×1, registration order), Stage 4 sudden death
 * (penalty, all contest, ×2–3, loser-first)"). Rotation counts follow v1's
 * DEFAULT_ROUNDS. Every field is editable in Stage setup before Begin.
 * @returns {Array<Object>} RoundConfig[]
 */
export function defaultStages() {
  return [
    { mode: 'exclusive', rotations: 3, multiplier: 1, penalty: 'off', orderMode: 'registration', orderModeNext: 'registration', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'exclusive', rotations: 3, multiplier: 1, penalty: 'on', orderMode: 'winnerFirst', orderModeNext: 'winnerFirst', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'community', rotations: 1, multiplier: 2, penalty: 'on', orderMode: 'loserFirst', orderModeNext: 'loserFirst', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'community', rotations: 1, multiplier: 3, penalty: 'on', orderMode: 'loserFirst', orderModeNext: 'loserFirst', timerSec: DEFAULT_TIMER_SEC },
  ];
}

/**
 * Clamp one numeric field to its limits, tolerating the empty string and other
 * mid-typing garbage a text input hands over (v1 defect #9: these fields must
 * accept typing, so they must survive a transiently invalid value).
 * @param {'rotations'|'multiplier'|'timerSec'|'tierSize'} field
 * @param {any} raw
 * @param {number} fallback
 * @returns {number}
 */
export function clampField(field, raw, fallback) {
  const { min, max } = LIMITS[field];
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Coerce anything that claims to be a Stage into a valid RoundConfig. Used on
 * every read from the room tree (Firebase can hand back a partial object) and
 * on every write out of the Stage-setup form.
 * @param {?Object} stage
 * @param {?Object} [fallback] - defaults to Stage 1's defaults.
 * @returns {Object} RoundConfig
 */
export function normalizeStage(stage, fallback = defaultStages()[0]) {
  const s = stage || {};
  const contestants = s.mode ? contestantsOf(s) : contestantsOf(fallback);
  return {
    mode: modeFor(contestants),
    rotations: clampField('rotations', s.rotations, fallback.rotations),
    multiplier: clampField('multiplier', s.multiplier, fallback.multiplier),
    penalty: s.penalty === 'on' ? 'on' : 'off',
    orderMode: ORDER_MODES.some((o) => o.value === s.orderMode) ? s.orderMode : fallback.orderMode,
    orderModeNext: ORDER_MODES.some((o) => o.value === s.orderModeNext)
      ? s.orderModeNext
      : // v1 rounds carry no orderModeNext. Falling back to `orderMode` keeps
        // their behaviour identical to what the scheduler did before it existed.
        (ORDER_MODES.some((o) => o.value === s.orderMode) ? s.orderMode : fallback.orderModeNext),
    timerSec: clampField('timerSec', s.timerSec, fallback.timerSec),
  };
}

/**
 * The room's `settings.rounds`, always exactly `STAGE_COUNT` valid Stages.
 * @param {?Array<Object>} rounds
 * @returns {Array<Object>}
 */
export function normalizeStages(rounds) {
  const defaults = defaultStages();
  return defaults.map((d, i) => normalizeStage(rounds && rounds[i], d));
}

/**
 * One line of proper-case prose describing a Stage — the Round Settings
 * peripheral (PRD §3.1) on every role's screen.
 * @param {Object} stage
 * @returns {string}
 */
export function stageSummary(stage) {
  const s = normalizeStage(stage);
  const parts = [
    `${s.rotations} ${s.rotations === 1 ? 'Rotation' : 'Rotations'}`,
    contestantsLabel(contestantsOf(s)),
    `×${s.multiplier}`,
    s.penalty === 'on' ? 'Penalty On' : 'Penalty Off',
    s.timerSec > 0 ? `${s.timerSec}s Thinking Time` : 'No Timer',
  ];
  return parts.join(' · ');
}

/**
 * How many questions a Stage will consume at most, given the Team count. Shown
 * next to the Category picker so a Host can see they have drawn enough.
 * @param {Array<Object>} stages
 * @param {number} teamCount
 * @returns {number}
 */
export function questionsNeeded(stages, teamCount) {
  return normalizeStages(stages).reduce((n, s) => n + s.rotations * Math.max(teamCount, 1), 0);
}
