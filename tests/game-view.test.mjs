/**
 * The pure game view (src/state/game.js). These are the rules the Host, Player
 * and Display screens branch on, so they are tested here rather than through a
 * click-through: who may answer, who is locked out, what a Lock In means, and
 * what "no answer" means (V2-16).
 */
import assert from 'node:assert';
import { test } from 'vitest';
import {
  LOCK_GRACE_MS,
  cycleDelta,
  difficultyOf,
  hasExplicitLock,
  initialDeltas,
  liveSlugs,
  logRow,
  mayAnswer,
  pastGrace,
  secondsLeft,
  selectGame,
  selectMe,
  standings,
  tierCounts,
  valueOf,
} from '../src/state/game.js';
import { defaultStages, modeFor } from '../src/state/stages.js';
import { MODES } from '../src/engine/scoring.js';

const DEADLINE = 1_000_000;

/** A room mid-question. Overrides are shallow-merged into `game`. */
function makeRoom({ stage = {}, game = {}, teams: teamOverride } = {}) {
  const stages = defaultStages();
  const rounds = stages.map((s, i) => (i === 0 ? { ...s, ...stage } : s));
  return {
    meta: { status: 'playing' },
    settings: {
      rounds,
      categories: ['movies', 'space'],
      categoryMeta: { movies: { name: 'Movie Night', icon: null, n: 1 }, space: { name: 'Space', icon: null, n: 2 } },
    },
    teams: teamOverride || {
      t1: { name: 'Alpha', color: '#111', order: 0, score: 3, players: { p1: { name: 'Ann' }, p2: { name: 'Bea' } } },
      t2: { name: 'Bravo', color: '#222', order: 1, score: 7, players: { p3: { name: 'Cal' } } },
    },
    clients: { p1: { role: 'player', name: 'Ann', teamId: 't1' } },
    selectionClaim: null,
    game: {
      round: 0,
      rotation: 0,
      turnIdx: 0,
      teamOrder: ['t1', 't2'],
      activeTeam: 't1',
      tapIn: { openFor: 't1', winner: null },
      board: { movies: { E: ['E1', 'E2'], M: ['M1'], H: [] }, space: { E: [], M: [], H: [] } },
      question: null,
      log: [],
      ...game,
    },
  };
}

function question(over = {}) {
  return {
    ref: 'movies:M1',
    state: 'open',
    value: 2,
    openedAt: 0,
    deadline: DEADLINE,
    payload: { q: 'Q?', options: ['a', 'b', 'c', 'd'] },
    locks: {},
    result: null,
    ...over,
  };
}

test('selectGame reads the tree, not a second copy of the rules', () => {
  const room = makeRoom({ game: { question: question(), rotation: 1 } });
  const g = selectGame(room);

  assert.equal(g.playing, true);
  assert.equal(g.stageNumber, 1);
  assert.equal(g.rotationNumber, 2);
  assert.equal(g.activeTeamName, 'Alpha');
  assert.equal(g.slug, 'movies');
  assert.equal(g.dif, 'M');
  assert.equal(g.value, 2);
  assert.equal(g.deadline, DEADLINE);
  assert.equal(g.qState, 'open');
  assert.equal(g.allContest, false, 'Stage 1 is Selector Only');
  assert.deepEqual(g.categories, ['movies', 'space']);

  assert.equal(difficultyOf('movies:H3'), 'H');
  assert.deepEqual(tierCounts(g.board, 'movies'), { E: 2, M: 1, H: 0, total: 3 });
  assert.deepEqual(tierCounts(g.board, 'nope'), { E: 0, M: 0, H: 0, total: 0 });
  assert.deepEqual(liveSlugs(g.board, g.categories), ['movies'], 'a played-out Category leaves the grid');

  assert.equal(valueOf(room, 'H'), 3, 'Hard × the Stage multiplier of 1');
});

test('who may answer follows the Stage, and the engine mode decides (not the UI)', () => {
  const selectorOnly = makeRoom({ stage: { mode: modeFor('selector') }, game: { question: question() } });
  assert.ok(mayAnswer(selectorOnly, 't1'), 'the selecting Team may');
  assert.ok(!mayAnswer(selectorOnly, 't2'), 'nobody else may');

  const everyone = makeRoom({ stage: { mode: modeFor('all') }, game: { question: question() } });
  assert.ok(mayAnswer(everyone, 't1'));
  assert.ok(mayAnswer(everyone, 't2'), 'All Teams contest');

  // The screen and the write-path guard consult the same function.
  assert.equal(
    mayAnswer(selectorOnly, 't2'),
    MODES.exclusive.mayAnswer('t2', {
      locks: {}, correct: null, roundCfg: selectorOnly.settings.rounds[0], selectingTeamId: 't1', teamIds: ['t1', 't2'], value: 2,
    })
  );

  assert.ok(!mayAnswer(makeRoom(), 't1'), 'no live question, nobody answers');
});

test('selectMe: the claim locks teammates out, and other Teams are not "locked out" (V2-14)', () => {
  const claimed = makeRoom({
    game: { question: null },
  });
  claimed.selectionClaim = { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies', at: 1 };

  const holder = selectMe(claimed, { playerId: 'p1', teamId: 't1' });
  assert.ok(holder.isActiveTeam && holder.holdsClaim && !holder.lockedOut);

  const teammate = selectMe(claimed, { playerId: 'p2', teamId: 't1' });
  assert.ok(teammate.isActiveTeam && !teammate.holdsClaim && teammate.lockedOut);

  const other = selectMe(claimed, { playerId: 'p3', teamId: 't2' });
  assert.ok(!other.isActiveTeam && !other.holdsClaim && !other.lockedOut, 'they have no turn, they are not locked');

  // A claim left behind by the previous turn gates nobody.
  claimed.game.activeTeam = 't2';
  assert.ok(!selectMe(claimed, { playerId: 'p3', teamId: 't2' }).lockedOut, 'stale claim ignored');
});

test('selectMe: no answer at expiry is not a disqualification (V2-16)', () => {
  const room = makeRoom({
    stage: { mode: modeFor('all') },
    game: { question: question({ state: 'locked', locks: { t2: { playerId: 'p3', choice: 'A', at: 5 } } }) },
  });

  const answered = selectMe(room, { playerId: 'p3', teamId: 't2' });
  assert.ok(answered.hasLocked);
  assert.equal(answered.myLock.choice, 'A');
  assert.ok(!answered.missedIt);

  const silent = selectMe(room, { playerId: 'p1', teamId: 't1' });
  assert.ok(!silent.hasLocked);
  assert.ok(silent.missedIt, 'the screen can say "no answer"…');

  // …and the engine scores that as zero, never as a penalty.
  const { deltas } = MODES.community.scoreOutcome({
    locks: room.game.question.locks,
    correct: 'B',
    roundCfg: { ...room.settings.rounds[0], penalty: 'on' },
    selectingTeamId: 't1',
    teamIds: ['t1', 't2'],
    value: 2,
  });
  assert.equal(deltas.t1, 0, 'no lock, no penalty (V2-16)');
  assert.equal(deltas.t2, -2, 'a wrong lock is penalized');
});

test('an explicit Lock In seals the question; an expiry auto-lock does not (V2-15)', () => {
  const explicit = { t1: { playerId: 'p1', choice: 'A', at: DEADLINE - 1 } };
  const atExpiry = { t1: { playerId: 'p1', choice: 'A', at: DEADLINE } };
  const afterExpiry = { t2: { playerId: 'p3', choice: 'B', at: DEADLINE + 40 } };

  assert.ok(hasExplicitLock(explicit, DEADLINE), 'locked before the deadline = a real Lock In');
  assert.ok(!hasExplicitLock(atExpiry, DEADLINE), 'locked at the deadline = an auto-lock');
  assert.ok(!hasExplicitLock(afterExpiry, DEADLINE), 'locked after the deadline = an auto-lock');
  assert.ok(!hasExplicitLock({}, DEADLINE), 'nobody locked');

  // An untimed Stage has no auto-lock, so every lock is explicit.
  assert.ok(hasExplicitLock(afterExpiry, 0));
  assert.ok(!hasExplicitLock({}, 0));

  // The two together: one team Locks In early, another auto-locks. The first
  // wins the seal, which is the point — but both locks are on the tree.
  const mixed = { ...explicit, ...afterExpiry };
  assert.ok(hasExplicitLock(mixed, DEADLINE));
});

test('the Host seals an expired question only after the grace window', () => {
  assert.equal(secondsLeft(DEADLINE, DEADLINE - 2400), 3);
  assert.equal(secondsLeft(DEADLINE, DEADLINE + 5), 0, 'never negative');
  assert.equal(secondsLeft(0, 1), null, 'an untimed Stage has no countdown');

  assert.ok(!pastGrace(DEADLINE, DEADLINE + LOCK_GRACE_MS - 1), 'in-flight auto-locks still have time');
  assert.ok(pastGrace(DEADLINE, DEADLINE + LOCK_GRACE_MS));
  assert.ok(!pastGrace(0, 9e9), 'an untimed Stage never expires on its own');
});

test('the Host cycles a Team through Plus, Nothing and Minus (V2-11)', () => {
  assert.equal(cycleDelta(2, 2), 0);
  assert.equal(cycleDelta(0, 2), -2);
  assert.equal(cycleDelta(-2, 2), 2);

  // Pre-filled from what the engine scored, with every Team present.
  const q = question({ state: 'revealed', result: { correct: 'A', deltas: { t1: 2 } } });
  assert.deepEqual(initialDeltas(q, ['t1', 't2']), { t1: 2, t2: 0 });
  assert.deepEqual(initialDeltas(null, ['t1']), { t1: 0 });

  // A Host awarding a verbal answer gets the full question value, and a
  // second tap takes it away again — V2-12 fixes the penalty at the same size.
  assert.equal(cycleDelta(cycleDelta(0, 3), 3), 3);
});

test('standings rank by score, ties by registration order (V2-10)', () => {
  const room = makeRoom({
    teams: {
      t1: { name: 'Alpha', color: '#111', order: 0, score: 5, players: {} },
      t2: { name: 'Bravo', color: '#222', order: 1, score: 9, players: {} },
      t3: { name: 'Carol', color: '#333', order: 2, score: 5, players: {} },
    },
  });
  const rows = standings(room);
  assert.deepEqual(rows.map((r) => r.teamId), ['t2', 't1', 't3']);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2], 'a tie shares a rank');
  assert.deepEqual(standings(null), []);
});

test('a Question Log row carries only what the wire carries', () => {
  const room = makeRoom();
  const row = logRow({ ref: 'movies:H2', round: 2, deltas: { t1: 3, t2: 0 }, at: 99 }, room);

  assert.equal(row.stageNumber, 3);
  assert.equal(row.categoryName, 'Movie Night');
  assert.equal(row.difficulty.label, 'Hard');
  assert.deepEqual(row.scores, [{ teamId: 't1', name: 'Alpha', delta: 3 }], 'zero deltas are not "scores"');

  // An unknown Category degrades to its slug rather than to "undefined".
  assert.equal(logRow({ ref: 'ghosts:E1', round: 0, deltas: {} }, room).categoryName, 'ghosts');
});
