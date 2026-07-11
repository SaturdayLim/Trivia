/**
 * The Stage vocabulary (V2-23) and its translation to the engine's RoundConfig,
 * plus the two engine changes S4 needed: per-Category "Questions per Tier"
 * (V2-17) and the "Who Selects Next" split (V2-10).
 */
import assert from 'node:assert';
import { test } from 'vitest';
import {
  CONTESTANTS,
  DEFAULT_TIER_SIZE,
  DEFAULT_TIMER_SEC,
  STAGE_COUNT,
  clampField,
  contestantsOf,
  defaultStages,
  isAllContest,
  modeFor,
  normalizeStage,
  normalizeStages,
  questionsNeeded,
  stageSummary,
} from '../src/state/stages.js';
import { buildBoard, tierSizeFor } from '../src/engine/board.js';
import { advanceTurn, rotationOrderMode } from '../src/engine/scheduler.js';
import { MODES } from '../src/engine/scoring.js';

test('Contestants maps onto the engine modes, and contest is never one of them (V2-9)', () => {
  assert.equal(modeFor('selector'), 'exclusive');
  assert.equal(modeFor('all'), 'community');

  assert.equal(contestantsOf({ mode: 'exclusive' }), 'selector');
  assert.equal(contestantsOf({ mode: 'community' }), 'all');
  // Legacy rounds still read back as something, rather than as a blank control.
  assert.equal(contestantsOf({ mode: 'suddendeath' }), 'all');
  assert.equal(contestantsOf({ mode: 'contest' }), 'all');
  assert.equal(contestantsOf(null), 'selector');

  assert.ok(!isAllContest({ mode: 'exclusive' }));
  assert.ok(isAllContest({ mode: 'community' }));

  // Whatever the UI can write, `scoring.MODES` must know how to run.
  for (const c of CONTESTANTS) assert.ok(MODES[modeFor(c.value)], `mode for ${c.value} exists`);
  for (const stage of defaultStages()) assert.ok(MODES[stage.mode], `${stage.mode} is a real mode`);
  assert.ok(!defaultStages().some((s) => s.mode === 'contest'), 'contest is excluded (V2-9)');
});

test('a fresh Game has four Stages, all with a 30s timer (v1 defect #8)', () => {
  const stages = defaultStages();
  assert.equal(stages.length, STAGE_COUNT);
  for (const s of stages) assert.equal(s.timerSec, DEFAULT_TIMER_SEC);

  // PRD §4's named bookends.
  assert.deepEqual(
    { contestants: contestantsOf(stages[0]), penalty: stages[0].penalty, mult: stages[0].multiplier, first: stages[0].orderMode },
    { contestants: 'selector', penalty: 'off', mult: 1, first: 'registration' },
    'Stage 1: intro'
  );
  assert.equal(contestantsOf(stages[3]), 'all', 'Stage 4: everyone contests');
  assert.equal(stages[3].penalty, 'on');
  assert.ok(stages[3].multiplier >= 2);
  assert.equal(stages[3].orderMode, 'loserFirst');
});

test('clampField survives everything a text input can hand it (v1 defect #9)', () => {
  assert.equal(clampField('timerSec', '45', 30), 45);
  assert.equal(clampField('timerSec', '', 30), 30, 'an empty box mid-retype keeps the old value');
  assert.equal(clampField('timerSec', 'abc', 30), 30);
  assert.equal(clampField('timerSec', '9999', 30), 300, 'clamped to max');
  assert.equal(clampField('rotations', '0', 3), 1, 'clamped to min');
  assert.equal(clampField('rotations', 2.9, 3), 2, 'truncated, not rounded');
  assert.equal(clampField('multiplier', -5, 1), 1);
  assert.equal(clampField('tierSize', '7', DEFAULT_TIER_SIZE), 7);
});

test('normalizeStage repairs a partial or legacy round', () => {
  // A v1 round: no orderModeNext, a mode the v2 UI cannot write.
  const legacy = { mode: 'contest', rotations: 1, multiplier: 1, penalty: 'half', orderMode: 'loserFirst', timerSec: 0 };
  const s = normalizeStage(legacy);
  assert.equal(s.mode, 'community', 'contest reads back as All Teams');
  assert.equal(s.penalty, 'off', 'half is not a v2 penalty (V2-12)');
  assert.equal(s.orderModeNext, 'loserFirst', 'absent Selects Next falls back to Selects First');
  assert.equal(s.timerSec, 0, 'an untimed Stage stays untimed');

  const empty = normalizeStage({});
  assert.equal(empty.timerSec, DEFAULT_TIMER_SEC);
  assert.equal(empty.rotations, defaultStages()[0].rotations);

  assert.equal(normalizeStages(null).length, STAGE_COUNT, 'always four Stages');
  assert.equal(normalizeStages([{ rotations: 9 }])[0].rotations, 9);
});

test('stageSummary and questionsNeeded read in the Game vocabulary (V2-23)', () => {
  const s = normalizeStage({ mode: 'community', rotations: 1, multiplier: 3, penalty: 'on', timerSec: 20 });
  const text = stageSummary(s);
  assert.match(text, /1 Rotation\b/);
  assert.match(text, /All Teams/);
  assert.match(text, /×3/);
  assert.match(text, /Penalty On/);
  assert.match(text, /20s Thinking Time/);
  assert.match(stageSummary({ ...s, timerSec: 0 }), /No Timer/);

  // 3 + 3 + 1 + 1 rotations, 4 teams.
  assert.equal(questionsNeeded(defaultStages(), 4), 32);
  assert.equal(questionsNeeded(defaultStages(), 0), 8, 'a team count of zero still reports a shape');
});

// ---------------------------------------------------------------------------
// V2-17: per-Category Questions per Tier
// ---------------------------------------------------------------------------

test('buildBoard draws N per tier per Category, and short tiers give what they have (V2-17)', () => {
  const cat = (slug, e, m, h) => ({
    slug,
    questions: [
      ...Array.from({ length: e }, (_, i) => ({ id: `E${i + 1}`, dif: 'E' })),
      ...Array.from({ length: m }, (_, i) => ({ id: `M${i + 1}`, dif: 'M' })),
      ...Array.from({ length: h }, (_, i) => ({ id: `H${i + 1}`, dif: 'H' })),
    ],
  });

  assert.equal(tierSizeFor({ tierSize: 4 }, 'a'), 4, 'falls back to the room-wide N');
  assert.equal(tierSizeFor({ tierSize: 4, tierSizes: { a: 6 } }, 'a'), 6);
  assert.equal(tierSizeFor({ tierSize: 4, tierSizes: { b: 6 } }, 'a'), 4);

  // V2-17's own worked example: N=5 against only 3 Mediums -> 5 + 3 + 5 = 13.
  const { board, drawn } = buildBoard({
    categories: [cat('thin', 9, 3, 9)],
    settings: { categories: ['thin'], tierSize: 4, tierSizes: { thin: 5 }, excludeUsed: false },
  });
  assert.equal(board.thin.E.length, 5);
  assert.equal(board.thin.M.length, 3, 'a short tier contributes what it has');
  assert.equal(board.thin.H.length, 5);
  assert.equal(drawn.length, 13);

  // Two categories, two different Ns, on one board.
  const two = buildBoard({
    categories: [cat('a', 9, 9, 9), cat('b', 9, 9, 9)],
    settings: { categories: ['a', 'b'], tierSize: 4, tierSizes: { a: 2 }, excludeUsed: false },
  });
  assert.equal(two.board.a.E.length, 2, 'per-Category N wins');
  assert.equal(two.board.b.E.length, 4, 'the other falls back to tierSize');

  // Exposure still excludes, per tier, before N is applied.
  const fresh = buildBoard({
    categories: [cat('a', 5, 5, 5)],
    settings: { categories: ['a'], tierSize: 4, excludeUsed: true },
    usedRefs: ['a:E1', 'a:E2', 'a:E3'],
  });
  assert.equal(fresh.board.a.E.length, 2, 'only 2 unexposed Easy questions remain');
  assert.ok(!fresh.drawn.includes('a:E1'));
});

// ---------------------------------------------------------------------------
// V2-10: Who Selects First seeds the Stage, Who Selects Next orders each cycle
// ---------------------------------------------------------------------------

test('rotationOrderMode prefers Selects Next, falling back to Selects First', () => {
  assert.equal(rotationOrderMode({ orderMode: 'winnerFirst' }), 'winnerFirst');
  assert.equal(rotationOrderMode({ orderMode: 'winnerFirst', orderModeNext: 'loserFirst' }), 'loserFirst');
});

test('advanceTurn re-sorts each rotation by Who Selects Next (V2-10)', () => {
  const teams = { t1: { order: 0, score: 1 }, t2: { order: 1, score: 9 }, t3: { order: 2, score: 5 } };
  const rounds = [
    // Seeded winnerFirst, but every later rotation runs loserFirst.
    { rotations: 3, orderMode: 'winnerFirst', orderModeNext: 'loserFirst' },
    { rotations: 1, orderMode: 'registration' },
  ];
  const settings = { rounds, orderRecalc: 'perRotation' };

  // Last team of rotation 0 finishes -> rotation 1 is ordered by Selects Next.
  const next = advanceTurn(
    { round: 0, rotation: 0, turnIdx: 2, teamOrder: ['t2', 't3', 't1'], teams },
    settings
  );
  assert.equal(next.rotation, 1);
  assert.deepEqual(next.teamOrder, ['t1', 't3', 't2'], 'loserFirst, not the winnerFirst seed');
  assert.equal(next.activeTeam, 't1');

  // Mid-rotation moves never re-sort.
  const mid = advanceTurn({ round: 0, rotation: 0, turnIdx: 0, teamOrder: ['t2', 't3', 't1'], teams }, settings);
  assert.deepEqual(mid.teamOrder, ['t2', 't3', 't1']);
  assert.equal(mid.activeTeam, 't3');

  // A round with no orderModeNext behaves exactly as v1 did.
  const legacy = advanceTurn(
    { round: 0, rotation: 0, turnIdx: 2, teamOrder: ['t2', 't3', 't1'], teams },
    { rounds: [{ rotations: 2, orderMode: 'winnerFirst' }], orderRecalc: 'perRotation' }
  );
  assert.deepEqual(legacy.teamOrder, ['t2', 't3', 't1'], 'winnerFirst by score');

  // perRound keeps the held order, orderModeNext or not.
  const held = advanceTurn(
    { round: 0, rotation: 0, turnIdx: 2, teamOrder: ['t2', 't3', 't1'], teams },
    { rounds, orderRecalc: 'perRound' }
  );
  assert.deepEqual(held.teamOrder, ['t2', 't3', 't1']);

  // Crossing into a new Stage always uses that Stage's Who Selects First.
  const crossed = advanceTurn(
    { round: 0, rotation: 2, turnIdx: 2, teamOrder: ['t2', 't3', 't1'], teams },
    settings
  );
  assert.equal(crossed.round, 1);
  assert.deepEqual(crossed.teamOrder, ['t1', 't2', 't3'], 'registration order seeds Stage 2');
});
