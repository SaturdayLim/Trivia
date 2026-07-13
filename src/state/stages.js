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
 *   - **Contestants** (Selector Only / All / Fastest Fingers, V2-26) — the v2
 *     UI writes one of three dedicated engine modes: `selectorOnly` / `all` /
 *     `fastest` (scoring.js). These carry the trial-round scoring the register
 *     LOCKED (R10/R13): the selecting team must answer in every mode, and a
 *     first-to-answer race is its own mode. They are DISTINCT from v1's
 *     `exclusive`/`community`/`contest`/`suddendeath`, which the regression
 *     suite pins and the v2 UI never writes — a room persisted before this
 *     change still reads back as one of the three via `contestantsOf` +
 *     `modeFor` on the next normalize (V2-9: contest stays unsurfaced).
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

/** Who may lock an answer (PRD §3.2 "Contestants", 3-way per V2-26). */
export const CONTESTANTS = [
  { value: 'selector', label: 'Selector Only', hint: 'Only the Team that chose the question may answer.' },
  {
    value: 'all',
    label: 'All',
    hint: 'Every Team answers, but the Selector controls the end: the question closes when the Selector Locks In (or time runs out), and every other Team keeps its current selection.',
  },
  {
    value: 'fastest',
    label: 'Fastest Fingers',
    hint: 'Every Team answers. The first Team to Lock In ends the question and scores. Teams tied on timing all score.',
  },
];

/** Turn-order rules (V2-10). Labels renamed per R14; values and the
 *  registration-order tiebreak are unchanged. */
export const ORDER_MODES = [
  { value: 'registration', label: 'Registration Order' },
  { value: 'winnerFirst', label: 'Winning Team' },
  { value: 'loserFirst', label: 'Lowest Score' },
];

export const PENALTIES = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
];

/**
 * Click-in tooltip copy for Stage-setup headers (v1 defect #3). Kept beside
 * the fields they describe rather than duplicated at each call site — Host
 * setup and the read-only Stage Settings peripheral both draw from this.
 */
export const FIELD_HELP = {
  rotations: 'How many times this Stage goes around the table — one turn per Team, in order.',
  timerSec: 'How many seconds Contestants get to Lock In once the Host starts the question. 0 means no timer.',
  multiplier: "This Stage's point values (1 Easy · 2 Medium · 3 Hard) are multiplied by this number.",
  penalty: 'When On, a wrong Lock In subtracts the question’s value instead of scoring zero. No answer is never penalized.',
  orderMode: 'Which Team takes the very first turn of this Stage: Registration order, whoever is winning, or whoever is behind.',
  orderModeNext: 'After the first turn, which Team gets each next turn. Ties always break by Registration order.',
  tierSize: 'How many Easy, Medium and Hard questions each Category puts on the board. A Category with fewer than this contributes what it has.',
};

const CONTESTANTS_TO_MODE = { selector: 'selectorOnly', all: 'all', fastest: 'fastest' };
const MODE_TO_CONTESTANTS = {
  // v2 modes (V2-26) — what the UI writes now.
  selectorOnly: 'selector',
  all: 'all',
  fastest: 'fastest',
  // Legacy v1 modes: a room persisted before V2-26 carries these, and reads
  // back as a Contestants value rather than a blank control. `normalizeStage`
  // re-derives the v2 mode from this on the next read/write. `contest`
  // (excluded, V2-9) and `suddendeath` both surface as "All".
  exclusive: 'selector',
  community: 'all',
  suddendeath: 'all',
  contest: 'all',
};

/** @param {'selector'|'all'|'fastest'} contestants @returns {'selectorOnly'|'all'|'fastest'} */
export function modeFor(contestants) {
  return CONTESTANTS_TO_MODE[contestants] || 'selectorOnly';
}

/**
 * The Contestants setting behind a round's `mode`. Legacy modes read back as a
 * live Contestants value rather than an empty control (see MODE_TO_CONTESTANTS).
 * @param {?{mode?: string}} round
 * @returns {'selector'|'all'|'fastest'}
 */
export function contestantsOf(round) {
  return MODE_TO_CONTESTANTS[round && round.mode] || 'selector';
}

/** @param {?{mode?: string}} round @returns {boolean} true only for the "All" mode. */
export function isAllContest(round) {
  return contestantsOf(round) === 'all';
}

/**
 * True when every Team may answer this Stage — both "All" and "Fastest Fingers"
 * (V2-26), as opposed to "Selector Only". The screens branch on this to decide
 * whether to enable non-selecting Teams' options.
 * @param {?{mode?: string}} round
 * @returns {boolean}
 */
export function everyoneAnswers(round) {
  return contestantsOf(round) !== 'selector';
}

function label(list, value) {
  const found = list.find((o) => o.value === value);
  return found ? found.label : value;
}

export const orderLabel = (value) => label(ORDER_MODES, value);
export const contestantsLabel = (value) => label(CONTESTANTS, value);

/**
 * The four Stages a fresh Game starts with (PRD §4: "Stage 1 intro (30s, no
 * penalty, Selector Only, ×1, registration order), Stage 4 sudden death
 * (penalty, Fastest Fingers, ×2–3, lowest-score first)"). Rotation counts
 * follow v1's DEFAULT_ROUNDS. Every field is editable in Stage setup before Begin.
 * @returns {Array<Object>} RoundConfig[]
 */
export function defaultStages() {
  return [
    { mode: 'selectorOnly', rotations: 3, multiplier: 1, penalty: 'off', orderMode: 'registration', orderModeNext: 'registration', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'selectorOnly', rotations: 3, multiplier: 1, penalty: 'on', orderMode: 'winnerFirst', orderModeNext: 'winnerFirst', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'all', rotations: 1, multiplier: 2, penalty: 'on', orderMode: 'loserFirst', orderModeNext: 'loserFirst', timerSec: DEFAULT_TIMER_SEC },
    { mode: 'fastest', rotations: 1, multiplier: 3, penalty: 'on', orderMode: 'loserFirst', orderModeNext: 'loserFirst', timerSec: DEFAULT_TIMER_SEC },
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
