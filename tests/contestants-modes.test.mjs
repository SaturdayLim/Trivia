/**
 * The V2-26 Contestants modes — Selector Only / All / Fastest Fingers — at the
 * two pure seams they turn on:
 *   1. `scoring.MODES[mode].scoreOutcome` — the amended scoring the trial round
 *      LOCKED (R10/R13): the selecting Team must answer in every mode and takes
 *      the no-answer penalty when Penalty is On; a non-selecting Team is scored
 *      only if it answers and is penalty-exempt on silence; Fastest Fingers
 *      scores every locked Team (ties included).
 *   2. `state/game.js` `lockEnding` — which explicit Lock In ends the question,
 *      and how (seal now vs pull the timer in), per mode.
 *
 * These are the rules the Host loop and the Player/Display screens branch on, so
 * they are pinned here as pure functions rather than only through a click-through.
 */
import assert from 'node:assert';
import { test } from 'vitest';
import { MODES } from '../src/engine/scoring.js';
import { modeFor } from '../src/state/stages.js';
import { lockEnding } from '../src/state/game.js';

const TEAMS = ['t1', 't2', 't3']; // t1 is the selecting Team throughout.
const lock = (choice, at = 1) => ({ playerId: 'p', choice, at });

/** Run a mode's scoreOutcome with sensible defaults. */
function score(contestants, { locks, correct = 'A', penalty = 'on', value = 2 }) {
  const mode = MODES[modeFor(contestants)];
  return mode.scoreOutcome({
    locks,
    correct,
    roundCfg: { penalty },
    selectingTeamId: 't1',
    teamIds: TEAMS,
    value,
  }).deltas;
}

// ---------------------------------------------------------------------------
// Selector Only
// ---------------------------------------------------------------------------

test('Selector Only: only the selecting Team scores, and its silence is penalized (V2-26)', () => {
  // Selector right.
  assert.deepEqual(score('selector', { locks: { t1: lock('A') } }), { t1: 2, t2: 0, t3: 0 });
  // Selector wrong, Penalty On -> -value.
  assert.deepEqual(score('selector', { locks: { t1: lock('B') } }), { t1: -2, t2: 0, t3: 0 });
  // Selector wrong, Penalty Off -> 0.
  assert.deepEqual(score('selector', { locks: { t1: lock('B') }, penalty: 'off' }), { t1: 0, t2: 0, t3: 0 });
  // Selector silent, Penalty On -> the no-answer penalty (V2-26 amends V2-16).
  assert.deepEqual(score('selector', { locks: {} }), { t1: -2, t2: 0, t3: 0 });
  // Selector silent, Penalty Off -> 0.
  assert.deepEqual(score('selector', { locks: {}, penalty: 'off' }), { t1: 0, t2: 0, t3: 0 });
  // A stray non-selector lock cannot score in Selector Only (defense in depth).
  assert.deepEqual(score('selector', { locks: { t2: lock('A') } }), { t1: -2, t2: 0, t3: 0 });
});

// ---------------------------------------------------------------------------
// All
// ---------------------------------------------------------------------------

test('All: every locked Team scores; selecting Team penalized on silence, others exempt (R10/V2-26)', () => {
  // Selector right, one other right, one other wrong (Penalty On), one silent.
  assert.deepEqual(
    score('all', { locks: { t1: lock('A'), t2: lock('A'), t3: lock('B') } }),
    { t1: 2, t2: 2, t3: -2 }
  );
  // Selector silent -> penalized; a non-selecting silent Team -> exempt (0).
  assert.deepEqual(score('all', { locks: { t2: lock('A') } }), { t1: -2, t2: 2, t3: 0 });
  // Nobody answers: only the selecting Team eats the no-answer penalty.
  assert.deepEqual(score('all', { locks: {} }), { t1: -2, t2: 0, t3: 0 });
  // Penalty Off: no negatives anywhere, silence is 0.
  assert.deepEqual(
    score('all', { locks: { t2: lock('B') }, penalty: 'off' }),
    { t1: 0, t2: 0, t3: 0 }
  );
});

// ---------------------------------------------------------------------------
// Fastest Fingers
// ---------------------------------------------------------------------------

test('Fastest Fingers: the answerers score, ties included; selecting Team penalized only on total silence (R13)', () => {
  // One Team answered first and correctly — it scores, nobody else does.
  assert.deepEqual(score('fastest', { locks: { t2: lock('A') } }), { t1: 0, t2: 2, t3: 0 });
  // A tie: two Teams both lock (both correct) — both score (ties allowed).
  assert.deepEqual(
    score('fastest', { locks: { t2: lock('A'), t3: lock('A') } }),
    { t1: 0, t2: 2, t3: 2 }
  );
  // A tie where one raced in wrong: the wrong one is penalized (Penalty On).
  assert.deepEqual(
    score('fastest', { locks: { t2: lock('A'), t3: lock('C') } }),
    { t1: 0, t2: 2, t3: -2 }
  );
  // The selecting Team answered first: it scores like anyone else.
  assert.deepEqual(score('fastest', { locks: { t1: lock('A') } }), { t1: 2, t2: 0, t3: 0 });
  // Someone answered but the selecting Team did not: it was RACED, not silent,
  // so it is NOT penalized (distinct from All).
  assert.deepEqual(score('fastest', { locks: { t2: lock('B') } }), { t1: 0, t2: -2, t3: 0 });
  // Nobody answered at all: the selecting Team takes the no-answer penalty.
  assert.deepEqual(score('fastest', { locks: {} }), { t1: -2, t2: 0, t3: 0 });
  assert.deepEqual(score('fastest', { locks: {}, penalty: 'off' }), { t1: 0, t2: 0, t3: 0 });
});

// ---------------------------------------------------------------------------
// lockEnding — which lock ends the question, and how
// ---------------------------------------------------------------------------

test('lockEnding: Selector Only seals on the selector lock', () => {
  const D = 1000;
  const args = (locks) => ({ locks, deadline: D, contestants: 'selector', selectingTeamId: 't1' });
  assert.equal(lockEnding(args({})), null, 'no lock yet');
  // An expiry auto-lock (at >= deadline) does not seal early.
  assert.equal(lockEnding(args({ t1: lock('A', D + 5) })), null);
  // An explicit selector Lock In (at < deadline) seals immediately.
  assert.equal(lockEnding(args({ t1: lock('A', D - 5) })), 'seal');
});

test('lockEnding: All ends ONLY on the selector lock, and by pulling the timer in (R10)', () => {
  const D = 1000;
  const args = (locks) => ({ locks, deadline: D, contestants: 'all', selectingTeamId: 't1' });
  assert.equal(lockEnding(args({})), null);
  // A NON-selector's explicit lock must NOT end the question — it only locks that Team.
  assert.equal(lockEnding(args({ t2: lock('A', D - 5) })), null, 'a non-selector lock does not end it');
  // The selector's explicit lock ends it via the pull mechanism.
  assert.equal(lockEnding(args({ t2: lock('A', D - 5), t1: lock('B', D - 3) })), 'pull');
  // Its expiry auto-lock does not pull early (the timer path seals that).
  assert.equal(lockEnding(args({ t1: lock('B', D + 2) })), null);
});

test('lockEnding: Fastest Fingers seals on the FIRST explicit lock by any Team (R13)', () => {
  const D = 1000;
  const args = (locks) => ({ locks, deadline: D, contestants: 'fastest', selectingTeamId: 't1' });
  assert.equal(lockEnding(args({})), null);
  // Any Team's explicit lock ends it — the selector need not be involved.
  assert.equal(lockEnding(args({ t2: lock('A', D - 5) })), 'seal');
  assert.equal(lockEnding(args({ t1: lock('A', D - 5) })), 'seal');
  // Only an expiry auto-lock: the timer path handles it, not this.
  assert.equal(lockEnding(args({ t2: lock('A', D + 5) })), null);
});

test('lockEnding: an untimed Stage treats every lock as explicit', () => {
  const args = (contestants, locks) => ({ locks, deadline: 0, contestants, selectingTeamId: 't1' });
  assert.equal(lockEnding(args('selector', { t1: lock('A', 0) })), 'seal');
  assert.equal(lockEnding(args('all', { t1: lock('A', 0) })), 'pull');
  assert.equal(lockEnding(args('all', { t2: lock('A', 0) })), null, 'still only the selector ends All');
  assert.equal(lockEnding(args('fastest', { t2: lock('A', 0) })), 'seal');
});
