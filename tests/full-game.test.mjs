// Headless full-game integration: 3 teams, 4 rounds (community/exclusive/
// contest/suddendeath), driven ONLY through src/engine/actions.js over the
// real adapter with an in-memory driver. Hand-computed score expectations.
import assert from 'node:assert';
import { test } from 'vitest';
import { createSync, splitPath, getAtPath, setAtPath } from '../src/sync/adapter.js';
import * as A from '../src/engine/actions.js';

test('full game integration (community/exclusive/contest/suddendeath)', async () => {

function makeTestDriver() {
  let tree = {};
  const subs = new Set();
  const fan = (path, value) => { for (const cb of subs) cb({ path, value }); };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v ?? null)));
  return {
    async connect({ create, initialState }) {
      if (create) { tree = clone(initialState || {}); }
      return { get tree() { return tree; } };
    },
    async update(s, path, value) { tree = setAtPath(tree, splitPath(path), value); fan(path, value); },
    async transact(s, path, fn) {
      const segs = splitPath(path);
      const cur = getAtPath(tree, segs);
      const out = fn(cur === undefined ? undefined : clone(cur));
      if (out === undefined) return { committed: false, current: cur };
      tree = setAtPath(tree, segs, out);
      fan(path, out);
      return { committed: true, current: out };
    },
    subscribe(s, cb) { subs.add(cb); return () => subs.delete(cb); },
    presence() { return () => {}; },
    offsetProbe() { return 0; },
    close() {},
  };
}

const driver = makeTestDriver();
const gm = await createSync({ driver, roomCode: 'T', clientId: 'gm1', role: 'gm', create: true, initialState: {} });
const read = (path) => { let v; gm.onChange(path, (x) => { v = x; })(); return v; };

const ROUNDS = [
  { mode: 'community',   rotations: 1, multiplier: 1, penalty: 'off', orderMode: 'registration', timerSec: 0 },
  { mode: 'exclusive',   rotations: 1, multiplier: 1, penalty: 'on',  orderMode: 'winnerFirst',  timerSec: 0 },
  { mode: 'contest',     rotations: 1, multiplier: 1, penalty: 'off', orderMode: 'loserFirst',   timerSec: 0 },
  { mode: 'suddendeath', rotations: 1, multiplier: 2, penalty: 'on',  orderMode: 'loserFirst',   timerSec: 0 },
];
await A.createRoomState(gm, 'gm', {
  clientId: 'gm1',
  settings: { orderRecalc: 'perRound', tierSize: 6, boardSize: 1, categories: ['cat-a'], excludeUsed: true, rounds: ROUNDS },
  teams: [
    { id: 't1', name: 'Alpha', color: '#111', order: 0 },
    { id: 't2', name: 'Bravo', color: '#222', order: 1 },
    { id: 't3', name: 'Carol', color: '#333', order: 2 },
  ],
});
await A.setBoard(gm, 'gm', { 'cat-a': { E: ['E1','E2','E3','E4','E5','E6'], M: ['M1','M2','M3'], H: ['H1','H2','H3'] } });
const st = await A.startGame(gm, 'gm');
assert.deepEqual(st.teamOrder, ['t1','t2','t3'], 'round 1 = registration order');
await A.openTapIn(gm, 'gm', st.activeTeam);

const usedRefs = [];
const PAYLOAD = { q: 'Q?', options: ['a','b','c','d'] }; // correct is always A
const now = () => gm.serverNow();

async function playTurn({ selPlayer, selTeam, ref, locks, expectDeltas, guardChecks }) {
  const claim = await A.claimTapIn(gm, selTeam, selPlayer);
  assert.ok(claim.committed, 'tap-in by ' + selPlayer + ' commits');
  const req = await A.requestSelection(gm, { playerId: selPlayer, teamId: selTeam, slug: 'cat-a', dif: ref[0] });
  assert.ok(req.committed, "selection intent commits");
  await A.selectQuestion(gm, 'gm', 'cat-a:' + ref, PAYLOAD);
  await A.openQuestion(gm, 'gm', 0);
  await A.clearSelectIntent(gm, 'gm');
  if (guardChecks) await guardChecks({ preLocks: true });
  for (const [teamId, playerId, choice] of locks) {
    const r = await A.lockAnswer(gm, teamId, playerId, choice, now());
    assert.ok(r.committed, 'lock ' + teamId + ':' + choice + ' commits');
  }
  if (guardChecks) await guardChecks({ preLocks: false });
  const rev = await A.revealQuestion(gm, 'gm', 'A', (r) => usedRefs.push(r));
  assert.deepEqual(rev.deltas, expectDeltas, 'deltas for ' + ref + ': ' + JSON.stringify(rev.deltas) + ' vs ' + JSON.stringify(expectDeltas));
  await A.commitScores(gm, 'gm');
  return A.advance(gm, 'gm');
}

// ---- ROUND 0: community, value 1, penalty off -----------------------------
let adv = await playTurn({ selPlayer: 'p1a', selTeam: 't1', ref: 'E1',
  locks: [['t1','p1a','A'], ['t2','p2a','B']],
  expectDeltas: { t1: 1, t2: 0, t3: 0 } });
assert.equal(adv.activeTeam, 't2');
adv = await playTurn({ selPlayer: 'p2a', selTeam: 't2', ref: 'E2',
  locks: [['t2','p2a','A'], ['t1','p1b','B'], ['t3','p3a','A']],
  expectDeltas: { t1: 0, t2: 1, t3: 1 },
  guardChecks: async ({ preLocks }) => {
    if (!preLocks) {
      const dup = await A.lockAnswer(gm, 't2', 'p2b', 'C', now());
      assert.ok(!dup.committed, 'second lock for same team refused');
    }
  } });
adv = await playTurn({ selPlayer: 'p3a', selTeam: 't3', ref: 'E3',
  locks: [['t3','p3a','B']],
  expectDeltas: { t1: 0, t2: 0, t3: 0 } });
// scores: t1=1 t2=1 t3=1 -> round 1 winnerFirst, 3-way tie by registration
assert.equal(adv.phase, 'roundEnd');
assert.deepEqual(adv.teamOrder, ['t1','t2','t3'], 'winnerFirst with 3-way tie = registration order');

// ---- ROUND 1: exclusive, value 2, penalty on ------------------------------
adv = await playTurn({ selPlayer: 'p1a', selTeam: 't1', ref: 'M1',
  locks: [['t1','p1a','B']],
  expectDeltas: { t1: -2, t2: 0, t3: 0 },
  guardChecks: async ({ preLocks }) => {
    if (preLocks) {
      const r = await A.lockAnswer(gm, 't2', 'p2a', 'A', now());
      assert.ok(!r.committed && r.reason === 'not-eligible', 'non-selector cannot lock in exclusive');
    }
  } });
adv = await playTurn({ selPlayer: 'p2a', selTeam: 't2', ref: 'M2',
  locks: [['t2','p2a','A']], expectDeltas: { t1: 0, t2: 2, t3: 0 } });
adv = await playTurn({ selPlayer: 'p3a', selTeam: 't3', ref: 'M3',
  locks: [], expectDeltas: { t1: 0, t2: 0, t3: 0 } });
// scores: t1=-1 t2=3 t3=1 -> contest round loserFirst = [t1,t3,t2]
assert.deepEqual(adv.teamOrder, ['t1','t3','t2'], 'loserFirst order into contest round');

// ---- ROUND 2: contest, value 3, selector exempt, contestor +/-full --------
adv = await playTurn({ selPlayer: 'p1a', selTeam: 't1', ref: 'H1',
  locks: [['t1','p1a','B'], ['t2','p2a','A'], ['t3','p3a','C']],
  expectDeltas: { t1: 0, t2: 3, t3: -3 },
  guardChecks: async ({ preLocks }) => {
    if (preLocks) {
      const early = await A.lockAnswer(gm, 't2', 'p2a', 'A', now());
      assert.ok(!early.committed, 'contestor cannot lock before selector public lock');
    }
  } });
adv = await playTurn({ selPlayer: 'p3a', selTeam: 't3', ref: 'H2',
  locks: [['t3','p3a','A']], expectDeltas: { t1: 0, t2: 0, t3: 3 },
  guardChecks: async ({ preLocks }) => {
    if (!preLocks) {
      const same = await A.lockAnswer(gm, 't1', 'p1a', 'A', now());
      assert.ok(!same.committed && same.reason === 'must-differ-from-selector', 'contestor must pick a different option');
    }
  } });
adv = await playTurn({ selPlayer: 'p2a', selTeam: 't2', ref: 'H3',
  locks: [['t2','p2a','B'], ['t1','p1b','A']],
  expectDeltas: { t1: 3, t2: 0, t3: 0 } });
// scores after contest: t1=-1+3=2, t2=3+3=6, t3=1-3+3=1 -> loserFirst = [t3,t1,t2]
assert.deepEqual(adv.teamOrder, ['t3','t1','t2'], 'loserFirst into sudden death');

// mid-question settings guard
await A.claimTapIn(gm, 't1', 'p1a');
await A.requestSelection(gm, { playerId: 'p1a', teamId: 't1', slug: 'cat-a', dif: 'E' });
await A.selectQuestion(gm, 'gm', 'cat-a:E4', PAYLOAD);
await A.openQuestion(gm, 'gm', 0);
await A.clearSelectIntent(gm, 'gm');
const refused = await A.updateRoundSettings(gm, 'gm', { orderRecalc: 'perRotation' });
assert.ok(refused && refused.committed === false, 'settings update refused mid-question');

// ---- ROUND 3: suddendeath, value 1x2=2, penalty on ------------------------
const locks3 = [['t1','p1a','B'], ['t3','p3a','A']];
for (const [teamId, playerId, choice] of locks3) await A.lockAnswer(gm, teamId, playerId, choice, now());
const rev = await A.revealQuestion(gm, 'gm', 'A', (r) => usedRefs.push(r));
assert.deepEqual(rev.deltas, { t1: -2, t2: 0, t3: 2 }, 'suddendeath x2 with penalty');
await A.commitScores(gm, 'gm');
adv = await A.advance(gm, 'gm');
await A.adjustScore(gm, 'gm', 't2', 1); // GM bonus
const okSettings = await A.updateRoundSettings(gm, 'gm', { orderRecalc: 'perRotation' });
assert.ok(okSettings.committed, 'settings update allowed between questions');

adv = await playTurn({ selPlayer: 'p2a', selTeam: adv.activeTeam, ref: 'E5',
  locks: [['t2','p2a','A']], expectDeltas: { t1: 0, t2: 2, t3: 0 } });
adv = await playTurn({ selPlayer: 'p3a', selTeam: adv.activeTeam, ref: 'E6',
  locks: [['t3','p3a','A'], ['t2','p2a','B']],
  expectDeltas: { t1: 0, t2: -2, t3: 2 } });

assert.equal(adv.phase, 'gameEnd', 'game ends after last round');
assert.equal(read('meta/status'), 'ended');
const scores = { t1: read('teams/t1/score'), t2: read('teams/t2/score'), t3: read('teams/t3/score') };
// t1: 1(E1)-2(M1)+3(H3 contest)-2(E4) = 0
// t2: 1(E2)+2(M2)+3(H1 contest)+1(adjust)+2(E5)-2(E6) = 7
// t3: 1(E2)-3(H1 contest)+3(H2)+2(E4)+2(E6) = 5
assert.deepEqual(scores, { t1: 0, t2: 7, t3: 5 }, 'final scores ' + JSON.stringify(scores));
assert.equal(usedRefs.length, 12, 'used-ref hook fired for all 12 questions');
assert.equal(read('game/board')['cat-a'].E.length, 0, 'E tier fully consumed');

// ---- endRound / endGame on a fresh room -----------------------------------
const d2 = makeTestDriver();
const gm2 = await createSync({ driver: d2, roomCode: 'U', clientId: 'gm1', role: 'gm', create: true, initialState: {} });
await A.createRoomState(gm2, 'gm', {
  clientId: 'gm1',
  settings: { orderRecalc: 'perRound', tierSize: 4, boardSize: 1, categories: ['c'], excludeUsed: false,
    rounds: [ROUNDS[0], { ...ROUNDS[1], orderMode: 'loserFirst' }] },
  teams: [ { id: 'x', name: 'X', color: '#1', order: 0 }, { id: 'y', name: 'Y', color: '#2', order: 1 } ],
});
await A.setBoard(gm2, 'gm', { c: { E: ['E1','E2'], M: ['M1'], H: ['H1'] } });
await A.startGame(gm2, 'gm');
await A.openTapIn(gm2, 'gm', 'x');
await A.claimTapIn(gm2, 'x', 'px');
await A.selectQuestion(gm2, 'gm', 'c:E1', PAYLOAD);
await A.openQuestion(gm2, 'gm', 0);
await A.adjustScore(gm2, 'gm', 'y', 5); // y leads -> loserFirst round 2 = [x, y]
const er = await A.endRound(gm2, 'gm');
assert.equal(er.round, 1, 'endRound jumps to round 2');
const read2 = (p) => { let v; gm2.onChange(p, (x) => { v = x; })(); return v; };
assert.equal(read2('game/question'), undefined, 'live question discarded');
assert.deepEqual(read2('game/teamOrder'), ['x','y'], 'round-2 order by its orderMode (loserFirst)');
assert.equal(read2('game/tapIn').openFor, 'x', 'tap-in reopened');
await A.endGame(gm2, 'gm');
assert.equal(read2('meta/status'), 'ended', 'endGame ends');

console.log('FULL-GAME INTEGRATION: all assertions passed (12 turns, 4 modes, guards, endRound/endGame, finals t1=0 t2=7 t3=5)');

});
