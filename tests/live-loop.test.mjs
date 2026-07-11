// The S4 done-when, headless: a Host, three Players on two Teams and a Display
// play real turns end to end — claim, select, open, lock, reveal, commit,
// advance — over the REAL driver-mock (BroadcastChannel transport, propose/CAS
// path), one createSync() per browser tab.
//
// What this cannot prove: that React renders it, or that two physical phones on
// Firebase agree within 1s. `tests/screens.test.jsx` covers the first; the
// second is the device pass, and it is still Michael's.

import assert from 'node:assert';
import { afterEach, beforeAll, test } from 'vitest';
import { createSync } from '../src/sync/adapter.js';
import * as driverMock from '../src/sync/driver-mock.js';
import * as A from '../src/engine/actions.js';
import { buildBoard, drawQuestion } from '../src/engine/board.js';
import { defaultStages, modeFor } from '../src/state/stages.js';
import { hasExplicitLock, selectGame, selectMe } from '../src/state/game.js';
import { createExposureStore, createMemoryExposureBackend } from '../src/state/exposure.js';

beforeAll(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

const open = [];
afterEach(() => {
  for (const s of open.splice(0)) {
    try { s.close(); } catch { /* already closed */ }
  }
});

let roomSeq = 0;
const freshCode = () => `LL${String((roomSeq += 1)).padStart(2, '0')}`;

async function tab(roomCode, clientId, role, create = false) {
  const sync = await createSync({ driver: driverMock, roomCode, clientId, role, create, initialState: create ? {} : null });
  open.push(sync);
  return sync;
}

const read = (sync, path) => {
  let v;
  sync.onChange(path, (x) => { v = x; })();
  return v;
};

/** A write reaches the OTHER tabs a tick later; PRD §6 promises ≤1s. Wait for it. */
async function until(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for the room to converge');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Two categories, plenty deep, so a draw never runs the tier dry mid-test. */
const CATEGORIES = ['movies', 'space'].map((slug) => ({
  slug,
  name: slug === 'movies' ? 'Movie Night' : 'Space',
  questions: ['E', 'M', 'H'].flatMap((dif) =>
    Array.from({ length: 4 }, (_, i) => ({
      id: `${dif}${i + 1}`,
      dif,
      q: `${slug} ${dif}${i + 1}?`,
      options: ['a', 'b', 'c', 'd'],
      answer: 'A',
      fact: 'A fact.',
    }))
  ),
}));

const findQ = (ref) => {
  const [slug, id] = ref.split(':');
  return CATEGORIES.find((c) => c.slug === slug).questions.find((q) => q.id === id);
};

/**
 * Stand up a room the way the Host screen does: v2 default Stages, a drawn
 * board, round 1 seated, the first tap-in open.
 */
async function seedGame({ stages, teams }) {
  const code = freshCode();
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', {
    clientId: 'gm1',
    hostPin: '1234',
    teams,
    settings: {
      rounds: stages,
      orderRecalc: 'perRotation',
      categories: ['movies', 'space'],
      tierSize: 4,
      excludeUsed: true,
    },
  });
  const { board } = buildBoard({
    categories: CATEGORIES,
    settings: { categories: ['movies', 'space'], tierSize: 4, excludeUsed: true },
  });
  await A.setBoard(host, 'gm', board);
  const started = await A.startGame(host, 'gm');
  await A.openTapIn(host, 'gm', started.activeTeam);
  return { code, host, started };
}

/** The Host's fulfilment effect, as a function: draw, publish, clear the intent. */
async function hostFulfils(host) {
  const intent = read(host, 'game/selectIntent');
  assert.ok(intent, 'a selection intent is waiting');
  const board = read(host, 'game/board');
  const { ref } = drawQuestion(board, intent.slug, intent.dif);
  assert.ok(ref, 'the tier had a question left');
  const full = findQ(ref);
  await A.selectQuestion(host, 'gm', ref, { q: full.q, options: full.options });
  await A.clearSelectIntent(host, 'gm');
  return ref;
}

const TEAMS = [
  { id: 't1', name: 'Alpha', color: '#111', order: 0 },
  { id: 't2', name: 'Bravo', color: '#222', order: 1 },
];

// ---------------------------------------------------------------------------

test('one full turn: claim, select, start, lock in, reveal, update, advance', async () => {
  const stages = defaultStages().map((s) => ({ ...s, rotations: 1, timerSec: 30 }));
  const { code, host } = await seedGame({ stages, teams: TEAMS });

  const ann = await tab(code, 'p1', 'player'); // Alpha
  const bea = await tab(code, 'p2', 'player'); // Alpha
  const cal = await tab(code, 'p3', 'player'); // Bravo
  const tv = await tab(code, 'd1', 'display');

  await A.createTeam(ann, { teamId: 't1', name: 'Alpha', color: '#111', order: 0, playerId: 'p1', playerName: 'Ann' });
  await A.joinTeam(bea, { teamId: 't1', playerId: 'p2', playerName: 'Bea' });
  await A.createTeam(cal, { teamId: 't2', name: 'Bravo', color: '#222', order: 1, playerId: 'p3', playerName: 'Cal' });

  // --- Ann taps a Category first: she claims her Team's turn (V2-14) --------
  const claim = await A.claimSelection(ann, { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies' });
  assert.ok(claim.committed);
  await A.claimTapIn(ann, 't1', 'p1');

  const beaLoses = await A.claimSelection(bea, { playerId: 'p2', teamId: 't1', screen: 'difficulty', slug: 'space' });
  assert.ok(!beaLoses.committed && beaLoses.reason === 'claimed-by-teammate');

  // Cal's Team is not up; the claim does not "lock him out", he simply has no turn.
  await until(() => Boolean(read(cal, 'selectionClaim')));
  const calView = selectMe({ ...read(cal, '/') }, { playerId: 'p3', teamId: 't2' });
  assert.ok(!calView.isActiveTeam && !calView.lockedOut);

  // The Display learns the Category from the claim (PRD §3.4).
  await until(() => read(tv, 'selectionClaim')?.slug === 'movies');

  // --- Ann picks a difficulty; the Host fulfils it -------------------------
  const req = await A.requestSelection(ann, { playerId: 'p1', teamId: 't1', slug: 'movies', dif: 'M' });
  assert.ok(req.committed);
  const beaCannotRequest = await A.requestSelection(bea, { playerId: 'p2', teamId: 't1', slug: 'space', dif: 'E' });
  assert.ok(!beaCannotRequest.committed, 'only the tap-in winner may request');

  await until(() => Boolean(read(host, 'game/selectIntent')));
  const ref = await hostFulfils(host);
  assert.equal(ref.split(':')[0], 'movies');

  await until(() => read(ann, 'game/question')?.state === 'selecting');
  const wire = read(ann, 'game/question');
  assert.deepEqual(Object.keys(wire.payload).sort(), ['options', 'q'], 'the answer never goes on the wire');
  assert.equal(wire.value, 2, 'Medium × the Stage multiplier of 1');

  // --- Host starts the timer; options activate ------------------------------
  const deadline = host.serverNow() + 30_000;
  await A.openQuestion(host, 'gm', deadline);
  await until(() => read(ann, 'game/question')?.state === 'open');

  // Stage 1 is Selector Only: Cal's Team may not answer.
  const roomForCal = read(cal, '/');
  assert.ok(!selectMe(roomForCal, { playerId: 'p3', teamId: 't2' }).mayAnswer);
  const calBlocked = await A.lockAnswer(cal, 't2', 'p3', 'A', cal.serverNow());
  assert.ok(!calBlocked.committed && calBlocked.reason === 'not-eligible');

  // --- Ann Locks In before the deadline: an explicit Lock In (V2-15) --------
  const lock = await A.lockAnswer(ann, 't1', 'p1', 'A', ann.serverNow());
  assert.ok(lock.committed);
  await until(() => Boolean(read(host, 'game/question/locks')?.t1));
  assert.ok(
    hasExplicitLock(read(host, 'game/question/locks'), deadline),
    'the Host sees a Lock In, not an expiry auto-lock — so it seals the question'
  );
  await A.lockQuestion(host, 'gm');
  await until(() => read(bea, 'game/question')?.state === 'locked');

  // --- Reveal: exposure is written here, not at Update (PRD §4) -------------
  const exposure = createExposureStore(createMemoryExposureBackend());
  await exposure.load();
  const rev = await A.revealQuestion(host, 'gm', findQ(ref).answer, (r) => exposure.record([r], 1000));
  assert.deepEqual(rev.deltas, { t1: 2, t2: 0 }, 'Alpha is right, Bravo never answered');
  await until(() => exposure.isExposed(ref));

  await until(() => read(tv, 'game/question')?.state === 'revealed');
  assert.equal(read(tv, 'game/question').result.correct, 'A', 'the Display can colour the options now');

  // --- Update: the Host may override before committing (V2-11) -------------
  await A.commitScores(host, 'gm', { t1: 2, t2: -2 });
  assert.equal(read(host, 'teams/t1/score'), 2);
  assert.equal(read(host, 'teams/t2/score'), -2, 'the Host overrode the auto-scored zero');

  const next = await A.advance(host, 'gm');
  assert.equal(next.activeTeam, 't2', 'the turn passes');
  assert.equal(read(host, 'game/question'), undefined, 'all screens return Home');
  assert.equal(read(host, 'selectionClaim'), undefined, 'the claim is cleared with the turn');
  await until(() => read(ann, 'game/tapIn')?.openFor === 't2');
});

test('Back releases both the claim and the tap-in, so a teammate can take over (V2-14)', async () => {
  const stages = defaultStages().map((s) => ({ ...s, rotations: 1 }));
  const { code, host } = await seedGame({ stages, teams: TEAMS });
  const ann = await tab(code, 'p1', 'player');
  const bea = await tab(code, 'p2', 'player');

  await A.claimSelection(ann, { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies' });
  await A.claimTapIn(ann, 't1', 'p1');
  assert.equal(read(host, 'game/tapIn').winner, 'p1');

  // A teammate cannot steal either half.
  assert.ok(!(await A.releaseSelection(bea, { playerId: 'p2', teamId: 't1' })).committed);
  assert.ok(!(await A.releaseTapIn(bea, { teamId: 't1', playerId: 'p2' })).committed);
  assert.equal(read(host, 'game/tapIn').winner, 'p1', 'still Ann');

  // Ann presses Back. Both halves come back, or Bea would hold a claim that
  // `requestSelection` still refused as `not-selector`.
  assert.ok((await A.releaseSelection(ann, { playerId: 'p1', teamId: 't1' })).committed);
  assert.ok((await A.releaseTapIn(ann, { teamId: 't1', playerId: 'p1' })).committed);
  await until(() => read(bea, 'selectionClaim') == null);
  assert.ok(read(host, 'game/tapIn').winner == null);

  // Now Bea takes the turn, all the way to a live question.
  assert.ok((await A.claimSelection(bea, { playerId: 'p2', teamId: 't1', screen: 'difficulty', slug: 'space' })).committed);
  assert.ok((await A.claimTapIn(bea, 't1', 'p2')).committed);
  assert.ok((await A.requestSelection(bea, { playerId: 'p2', teamId: 't1', slug: 'space', dif: 'E' })).committed);

  await until(() => Boolean(read(host, 'game/selectIntent')));
  const ref = await hostFulfils(host);
  assert.equal(ref.split(':')[0], 'space');
});

test('an All-Teams Stage: everyone answers, and the timer expiry locks in pending choices (V2-15, V2-16)', async () => {
  const stages = defaultStages().map((s) => ({ ...s, mode: modeFor('all'), rotations: 1, penalty: 'on', multiplier: 1 }));
  const { code, host } = await seedGame({ stages, teams: TEAMS });
  const ann = await tab(code, 'p1', 'player');
  const cal = await tab(code, 'p3', 'player');

  await A.claimSelection(ann, { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies' });
  await A.claimTapIn(ann, 't1', 'p1');
  await A.requestSelection(ann, { playerId: 'p1', teamId: 't1', slug: 'movies', dif: 'E' });
  await until(() => Boolean(read(host, 'game/selectIntent')));
  const ref = await hostFulfils(host);

  const deadline = host.serverNow() + 40;
  await A.openQuestion(host, 'gm', deadline);
  await until(() => read(ann, 'game/question')?.state === 'open');
  await until(() => read(cal, 'game/question')?.state === 'open');

  // Both Teams may answer this Stage.
  assert.ok(selectMe(read(ann, '/'), { playerId: 'p1', teamId: 't1' }).mayAnswer);
  assert.ok(selectMe(read(cal, '/'), { playerId: 'p3', teamId: 't2' }).mayAnswer);

  // Nobody Locks In. At the deadline each device auto-locks whatever its player
  // had tapped: Ann had 'A' pending, Cal had 'C'.
  await new Promise((r) => setTimeout(r, 60));
  const annAt = ann.serverNow();
  const calAt = cal.serverNow();
  assert.ok(annAt >= deadline && calAt >= deadline, 'both auto-locks land at or after the deadline');
  assert.ok((await A.lockAnswer(ann, 't1', 'p1', 'A', annAt)).committed);
  assert.ok((await A.lockAnswer(cal, 't2', 'p3', 'C', calAt)).committed);

  const locks = read(host, 'game/question/locks');
  assert.ok(
    !hasExplicitLock(locks, deadline),
    'neither lock is explicit, so the Host must NOT have sealed on the first one — both answers survive'
  );

  await A.lockQuestion(host, 'gm');
  const rev = await A.revealQuestion(host, 'gm', findQ(ref).answer);
  assert.deepEqual(rev.deltas, { t1: 1, t2: -1 }, 'Ann right, Cal wrong and penalized');
});

test('no answer at expiry scores zero and is never penalized (V2-16)', async () => {
  const stages = defaultStages().map((s) => ({ ...s, mode: modeFor('all'), rotations: 1, penalty: 'on' }));
  const { code, host } = await seedGame({ stages, teams: TEAMS });
  const ann = await tab(code, 'p1', 'player');

  await A.claimSelection(ann, { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies' });
  await A.claimTapIn(ann, 't1', 'p1');
  await A.requestSelection(ann, { playerId: 'p1', teamId: 't1', slug: 'movies', dif: 'H' });
  await until(() => Boolean(read(host, 'game/selectIntent')));
  const ref = await hostFulfils(host);

  await A.openQuestion(host, 'gm', host.serverNow() + 20);
  // A Player's actions read that tab's own mirror of the tree: Ann cannot lock
  // an answer to a question her phone has not received yet. The screen has the
  // same constraint — it renders no options until `state === 'open'`.
  await until(() => read(ann, 'game/question')?.state === 'open');
  assert.ok((await A.lockAnswer(ann, 't1', 'p1', 'A', ann.serverNow())).committed);
  await A.lockQuestion(host, 'gm');

  const rev = await A.revealQuestion(host, 'gm', findQ(ref).answer);
  assert.equal(rev.deltas.t1, 3, 'Hard is worth 3');
  assert.equal(rev.deltas.t2, 0, 'no lock: zero, not minus three');
  assert.ok(selectMe(read(host, '/'), { playerId: 'p3', teamId: 't2' }).missedIt);
});

test('a Host extending the timer reopens the options (V2-15)', async () => {
  const stages = defaultStages().map((s) => ({ ...s, rotations: 1, timerSec: 30 }));
  const { code, host } = await seedGame({ stages, teams: TEAMS });
  const ann = await tab(code, 'p1', 'player');

  await A.claimSelection(ann, { playerId: 'p1', teamId: 't1', screen: 'difficulty', slug: 'movies' });
  await A.claimTapIn(ann, 't1', 'p1');
  await A.requestSelection(ann, { playerId: 'p1', teamId: 't1', slug: 'movies', dif: 'E' });
  await until(() => Boolean(read(host, 'game/selectIntent')));
  await hostFulfils(host);

  await A.openQuestion(host, 'gm', host.serverNow() + 10);
  await A.lockQuestion(host, 'gm');
  await until(() => read(ann, 'game/question')?.state === 'locked');
  const blocked = await A.lockAnswer(ann, 't1', 'p1', 'B', ann.serverNow());
  assert.ok(!blocked.committed && blocked.reason === 'not-open');

  // Extend: same action the Host screen calls, with a fresh deadline.
  await A.openQuestion(host, 'gm', host.serverNow() + 30_000);
  await until(() => read(ann, 'game/question')?.state === 'open');
  assert.ok((await A.lockAnswer(ann, 't1', 'p1', 'B', ann.serverNow())).committed, 'options are live again');
});

test('a Player joining mid-Game gets a turn, and the board settings survive a refresh', async () => {
  const stages = defaultStages().map((s) => ({ ...s, rotations: 1 }));
  const { code, host } = await seedGame({ stages, teams: [TEAMS[0]] });

  // The Host wrote Categories, per-Category N and the display directory (V2-17).
  const ok = await A.updateBoardSettings(host, 'gm', {
    categories: ['movies'],
    tierSizes: { movies: 5 },
    categoryMeta: { movies: { name: 'Movie Night', icon: null, n: 1 } },
  });
  assert.ok(ok.committed);
  assert.equal(read(host, 'settings/tierSizes').movies, 5);
  assert.equal(read(host, 'settings/categoryMeta').movies.name, 'Movie Night');

  // A phone that just joined reads the directory instead of 58 Markdown files.
  const dan = await tab(code, 'p9', 'player');
  await A.createTeam(dan, { teamId: 't9', name: 'Delta', color: '#333', order: 9, playerId: 'p9', playerName: 'Dan' });
  await until(() => Boolean(read(dan, 'settings/categoryMeta')));
  const g = selectGame(read(dan, '/'));
  assert.equal(g.categoryMeta.movies.name, 'Movie Night');
  assert.deepEqual(g.categories, ['movies']);

  // Delta slots below Alpha, at 0 points (V2-13). Alpha was the whole of Stage
  // 1's single rotation, so advancing crosses into Stage 2 — which re-seeds the
  // order and picks Delta up. Registration order puts the newcomer last.
  assert.equal(read(host, 'teams/t9/score'), 0);
  const next = await A.advance(host, 'gm');
  assert.deepEqual(next.teamOrder, ['t1', 't9'], 'the new Team is slotted below the existing one');
  assert.equal(next.activeTeam, 't1');
  assert.equal(next.round, 1, 'Stage 2');

  // One more turn and it is Delta's.
  const dansTurn = await A.advance(host, 'gm');
  assert.equal(dansTurn.activeTeam, 't9');
  await until(() => read(dan, 'game/activeTeam') === 't9');

  // Board settings cannot change under a live question.
  assert.ok((await A.claimSelection(dan, { playerId: 'p9', teamId: 't9', screen: 'difficulty', slug: 'movies' })).committed);
  assert.ok((await A.claimTapIn(dan, 't9', 'p9')).committed);
  assert.ok((await A.requestSelection(dan, { playerId: 'p9', teamId: 't9', slug: 'movies', dif: 'E' })).committed);
  await until(() => Boolean(read(host, 'game/selectIntent')));
  await hostFulfils(host);
  const refused = await A.updateBoardSettings(host, 'gm', { categories: ['space'] });
  assert.ok(!refused.committed && refused.reason === 'question-in-progress');
});
