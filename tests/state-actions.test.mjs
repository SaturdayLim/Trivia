// The v2 state-schema actions driven through the real adapter with an
// in-memory driver: room tree shape, host PIN + single-host seat (V2-19),
// lifecycle touch/close (V2-20), selection claim first-click lock (V2-14).
import assert from 'node:assert';
import { test } from 'vitest';
import { createSync, splitPath, getAtPath, setAtPath } from '../src/sync/adapter.js';
import * as A from '../src/engine/actions.js';
import { isRoomExpired, ROOM_TTL_MS } from '../src/state/room.js';

/**
 * Minimal driver honoring the adapter contract. `transact` mirrors driver-mock:
 * `undefined` from txnFn aborts, `null` commits a delete.
 */
function makeTestDriver() {
  let tree = {};
  const subs = new Set();
  const fan = (path, value) => { for (const cb of subs) cb({ path, value }); };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v ?? null)));
  return {
    async connect({ create, initialState }) {
      if (create) tree = clone(initialState || {});
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

async function makeRoom({ hostPin = '4821', clientId = 'gm1' } = {}) {
  const driver = makeTestDriver();
  const sync = await createSync({ driver, roomCode: 'T', clientId, role: 'gm', create: true, initialState: {} });
  const read = (path) => { let v; sync.onChange(path, (x) => { v = x; })(); return v; };
  await A.createRoomState(sync, 'gm', {
    clientId,
    hostPin,
    settings: { categories: ['cat-a'] },
    teams: [
      { id: 't1', name: 'Alpha', color: '#111', order: 0 },
      { id: 't2', name: 'Bravo', color: '#222', order: 1 },
    ],
  });
  return { driver, sync, read };
}

// ---------------------------------------------------------------------------

test('createRoomState writes the v2 additions and nothing stale', async () => {
  const before = Date.now();
  const { read } = await makeRoom();

  assert.equal(read('hostPin'), '4821');
  assert.equal(read('selectionClaim'), undefined, 'no claim at creation');
  assert.equal(read('meta/gmClientId'), 'gm1');
  assert.equal(read('meta/status'), 'lobby');
  assert.equal(read('meta/createdAt'), undefined, 'v1 meta.createdAt retired in favour of lifecycle');

  const lifecycle = read('lifecycle');
  assert.equal(typeof lifecycle.createdAt, 'number');
  assert.equal(lifecycle.createdAt, lifecycle.lastActivityAt, 'both stamped at creation');
  assert.ok(lifecycle.createdAt >= before);

  // The v1 tree is still intact underneath.
  assert.equal(read('game/round'), 0);
  assert.deepEqual(read('game/tapIn'), { openFor: null, winner: null });
  assert.equal(read('settings/tierSize'), 4);
  assert.equal(Object.keys(read('teams')).length, 2);
});

test('createRoomState refuses a non-gm caller', async () => {
  const driver = makeTestDriver();
  const sync = await createSync({ driver, roomCode: 'T', clientId: 'p1', role: 'player', create: true, initialState: {} });
  assert.equal(await A.createRoomState(sync, 'player', { clientId: 'p1', teams: [] }), null);
});

test('createRoomState with no PIN yields a room nobody can claim (mock/offline)', async () => {
  const { sync, read } = await makeRoom({ hostPin: null });
  assert.equal(read('hostPin'), undefined);
  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm2', pin: '' }), { committed: false, reason: 'bad-pin' });
  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm2', pin: '0000' }), { committed: false, reason: 'bad-pin' });
});

// --- lifecycle (V2-20) -----------------------------------------------------

test('touchActivity resets the expiry clock; closeRoom is terminal', async () => {
  const { sync, read } = await makeRoom();
  const created = read('lifecycle').createdAt;

  // Backdate the room to one ms shy of aging out, then prove a touch saves it.
  await sync.update('lifecycle/lastActivityAt', created - ROOM_TTL_MS + 1);
  const stale = { meta: { status: read('meta/status') }, lifecycle: read('lifecycle') };
  assert.ok(isRoomExpired(stale, created + 1), 'about to expire');

  const touched = await A.touchActivity(sync);
  assert.equal(read('lifecycle/lastActivityAt'), touched);
  const fresh = { meta: { status: read('meta/status') }, lifecycle: read('lifecycle') };
  assert.ok(!isRoomExpired(fresh, touched), 'touch bought another 24h');
  assert.equal(read('lifecycle').createdAt, created, 'createdAt never moves');

  assert.deepEqual(await A.closeRoom(sync, 'gm'), { closed: true });
  assert.equal(read('meta/status'), 'closed');
  const closed = { meta: { status: 'closed' }, lifecycle: read('lifecycle') };
  assert.ok(isRoomExpired(closed, touched), 'closed is expired regardless of the clock');

  assert.equal(await A.closeRoom(sync, 'player'), null, 'players cannot close the room');
});

// --- host PIN + single-host seat (V2-19) -----------------------------------

test('claimHost: wrong PIN never seats anyone', async () => {
  const { sync, read } = await makeRoom();
  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm2', pin: '0000' }), { committed: false, reason: 'bad-pin' });
  assert.equal(read('meta/gmClientId'), 'gm1', 'seat untouched');
});

test('claimHost: refused while the seated host is live on the roster', async () => {
  const { sync, read } = await makeRoom();
  const res = await A.claimHost(sync, { clientId: 'gm2', pin: '4821', hostPresent: true });
  assert.deepEqual(res, { committed: false, reason: 'host-present' });
  assert.equal(read('meta/gmClientId'), 'gm1', 'no second concurrent host, ever (V2-19)');
});

test('claimHost: the same device reclaiming its own seat always succeeds', async () => {
  const { sync, read } = await makeRoom();
  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm1', pin: '4821', hostPresent: true }), { committed: true });
  assert.equal(read('meta/gmClientId'), 'gm1');
});

test('claimHost: a new device takes the seat once the old host is gone, and bumps activity', async () => {
  const { sync, read } = await makeRoom();
  await sync.update('lifecycle/lastActivityAt', 1);

  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm2', pin: '4821', hostPresent: false }), { committed: true });
  assert.equal(read('meta/gmClientId'), 'gm2', 'host rejoined on a new phone');
  assert.ok(read('lifecycle/lastActivityAt') > 1, 'a successful claim is activity');
});

test('claimHost: an empty seat can be taken, and releaseHost only works for its occupant', async () => {
  const { sync, read } = await makeRoom();

  assert.equal(await A.releaseHost(sync, 'gm', 'gm2'), false, 'not your seat');
  assert.equal(await A.releaseHost(sync, 'player', 'gm1'), null, 'players cannot release');
  assert.equal(await A.releaseHost(sync, 'gm', 'gm1'), true);
  assert.equal(read('meta/gmClientId'), undefined, 'seat vacated');

  // Vacated -> claimable even though presence still (wrongly) says a host is up.
  assert.deepEqual(await A.claimHost(sync, { clientId: 'gm3', pin: '4821', hostPresent: true }), { committed: true });
  assert.equal(read('meta/gmClientId'), 'gm3');
});

// --- selection claim (V2-14) ----------------------------------------------

async function roomOnTurn(teamId = 't1') {
  const ctx = await makeRoom();
  await ctx.sync.update('game/activeTeam', teamId);
  return ctx;
}

test('claimSelection: first teammate wins, the rest are locked out', async () => {
  const { sync, read } = await roomOnTurn('t1');

  const first = await A.claimSelection(sync, { playerId: 'p1', teamId: 't1' });
  assert.equal(first.committed, true);
  assert.equal(first.claim.playerId, 'p1');
  assert.equal(first.claim.screen, 'category');
  assert.equal(typeof first.claim.at, 'number');

  const second = await A.claimSelection(sync, { playerId: 'p2', teamId: 't1' });
  assert.equal(second.committed, false);
  assert.equal(second.reason, 'claimed-by-teammate');
  assert.equal(second.claim.playerId, 'p1', 'the loser is told who holds it');
  assert.equal(read('selectionClaim').playerId, 'p1');
});

test('claimSelection: only the active team may claim', async () => {
  const { sync, read } = await roomOnTurn('t1');
  const res = await A.claimSelection(sync, { playerId: 'p3', teamId: 't2' });
  assert.deepEqual(res, { committed: false, reason: 'not-active-team' });
  assert.equal(read('selectionClaim'), undefined);
});

test('claimSelection: the holder may move between screens; a teammate still cannot', async () => {
  const { sync, read } = await roomOnTurn('t1');
  await A.claimSelection(sync, { playerId: 'p1', teamId: 't1', screen: 'category' });

  const moved = await A.claimSelection(sync, { playerId: 'p1', teamId: 't1', screen: 'difficulty' });
  assert.equal(moved.committed, true);
  assert.equal(read('selectionClaim').screen, 'difficulty');

  const blocked = await A.claimSelection(sync, { playerId: 'p2', teamId: 't1', screen: 'difficulty' });
  assert.equal(blocked.committed, false);
  assert.equal(read('selectionClaim').playerId, 'p1');
});

test('claimSelection: a stale claim from a finished turn never gates the new team', async () => {
  const { sync, read } = await roomOnTurn('t1');
  await A.claimSelection(sync, { playerId: 'p1', teamId: 't1' });

  await sync.update('game/activeTeam', 't2'); // turn moved on, claim not cleared
  const res = await A.claimSelection(sync, { playerId: 'p3', teamId: 't2' });
  assert.equal(res.committed, true, 't2 must not be held hostage by t1s lock');
  assert.equal(read('selectionClaim').teamId, 't2');
  assert.equal(read('selectionClaim').playerId, 'p3');
});

test('releaseSelection: Back frees the lock, but only for the holder', async () => {
  const { sync, read } = await roomOnTurn('t1');
  await A.claimSelection(sync, { playerId: 'p1', teamId: 't1' });

  assert.deepEqual(await A.releaseSelection(sync, { playerId: 'p2', teamId: 't1' }), {
    committed: false,
    reason: 'not-claim-holder',
  });
  assert.equal(read('selectionClaim').playerId, 'p1', 'a teammate cannot steal it by pressing Back');

  assert.deepEqual(await A.releaseSelection(sync, { playerId: 'p1', teamId: 't1' }), { committed: true });
  assert.equal(read('selectionClaim'), undefined);

  assert.deepEqual(await A.releaseSelection(sync, { playerId: 'p1', teamId: 't1' }), {
    committed: false,
    reason: 'not-claim-holder',
  }, 'releasing nothing is not a commit');

  // Freed -> the teammate may now take it.
  assert.equal((await A.claimSelection(sync, { playerId: 'p2', teamId: 't1' })).committed, true);
  assert.equal(read('selectionClaim').playerId, 'p2');
});

test('clearSelectionClaim is host-only', async () => {
  const { sync, read } = await roomOnTurn('t1');
  await A.claimSelection(sync, { playerId: 'p1', teamId: 't1' });

  assert.equal(await A.clearSelectionClaim(sync, 'player'), null);
  assert.equal(read('selectionClaim').playerId, 'p1');

  assert.equal(await A.clearSelectionClaim(sync, 'gm'), true);
  assert.equal(read('selectionClaim'), undefined);
});

test('advance() and endRound() drop the outgoing team\'s claim', async () => {
  const { sync, read } = await makeRoom();
  await A.startGame(sync, 'gm');
  await A.claimSelection(sync, { playerId: 'p1', teamId: read('game/activeTeam') });
  assert.ok(read('selectionClaim'), 'claimed');

  await A.advance(sync, 'gm');
  assert.equal(read('selectionClaim'), undefined, 'advance clears the claim');

  await A.claimSelection(sync, { playerId: 'p3', teamId: read('game/activeTeam') });
  assert.ok(read('selectionClaim'), 'claimed again');
  await A.endRound(sync, 'gm');
  assert.equal(read('selectionClaim'), undefined, 'endRound clears the claim');
});
