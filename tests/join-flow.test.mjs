// The S3 done-when, headless: a Host, two Players and a Display sit in one
// live lobby and all see the same thing.
//
// This drives the REAL driver-mock — BroadcastChannel transport, the
// serializer, the propose/CAS path, localStorage persistence — not an
// in-memory stand-in. Node 24 ships BroadcastChannel; localStorage is shimmed
// below because the driver only ever calls get/set/removeItem on it. Each
// createSync() here stands in for one browser tab.
//
// What this canNOT prove: that React renders it, or that two physical phones on
// Firebase agree within 1s. Those need the browser/device pass.

import assert from 'node:assert';
import { afterEach, beforeAll, test } from 'vitest';
import { createSync } from '../src/sync/adapter.js';
import * as driverMock from '../src/sync/driver-mock.js';
import * as A from '../src/engine/actions.js';
import { pickFreeRoomCode } from '../src/state/room.js';
import { matchTeam, nextTeamColor, nextTeamOrder, selectLobby, teamKey } from '../src/state/lobby.js';

beforeAll(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

/** Every session opened by a test, so timers/channels never leak between them. */
const open = [];
afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
});

let roomSeq = 0;
function freshCode() {
  roomSeq += 1;
  return `RM${String(roomSeq).padStart(2, '0')}`;
}

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

/**
 * Poll until `predicate` holds. A write resolves as soon as the room's
 * authority has applied it — the diff still has to reach the OTHER tabs over
 * BroadcastChannel, which is a later tick. Asserting another tab's tree the
 * instant our own write resolves is a race, and PRD §6 only promises the rest
 * of the room converges within 1s. So: wait for convergence, don't assume it.
 */
async function until(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out waiting for the room to converge');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The roster the driver would report, for lobbies where presence isn't the thing under test. */
const rosterOf = (...ids) => ids.map((clientId) => ({ clientId, connected: true }));

// ---------------------------------------------------------------------------

test('pickFreeRoomCode does not hand back a code the mock driver already holds', async () => {
  const taken = freshCode();
  const host = await tab(taken, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });

  assert.equal(await driverMock.roomExists(taken), true, 'a created room is persisted immediately');
  assert.equal(await driverMock.roomExists('ZZZZ'), false);

  const code = await pickFreeRoomCode(driverMock.roomExists, { rng: () => 0 });
  assert.notEqual(code, taken);
});

test('a Host, two Players and a Display converge on one live lobby', async () => {
  const code = freshCode();

  // --- Host creates the room and takes its seat ----------------------------
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });
  await A.registerClient(host, { clientId: 'gm1', role: 'gm', name: 'Host' });

  // The lobby is real and empty from the first frame — not a placeholder.
  const atCreation = selectLobby(read(host, '/'), rosterOf('gm1'));
  assert.deepEqual(atCreation.teams, []);
  assert.equal(atCreation.host.connected, true);
  assert.equal(atCreation.status, 'lobby');

  // --- Player 1 joins, creating a Team -------------------------------------
  const p1 = await tab(code, 'p1', 'player');
  let teams = read(p1, 'teams');
  // Not `deepEqual(teams, undefined)`: driver-mock keeps the empty `{}` that
  // createRoomState wrote, while RTDB drops empty objects and yields undefined.
  // What both drivers agree on is that the first Team sorts first.
  assert.equal(nextTeamOrder(teams), 0, 'no teams yet, on either driver');

  const created = await A.createTeam(p1, {
    teamId: teamKey('Team Rocket'),
    name: 'Team Rocket',
    color: nextTeamColor(teams),
    order: nextTeamOrder(teams),
    playerId: 'p1',
    playerName: 'Ann',
  });
  assert.equal(created.committed, true);

  // --- Player 2 types the SAME team name -> joins it, does not fork it ------
  const p2 = await tab(code, 'p2', 'player');
  teams = read(p2, 'teams');
  const existing = matchTeam(teams, 'team rocket');
  assert.equal(existing, 'team-rocket', 'p2 sees p1s team through the wire');

  const joined = await A.joinTeam(p2, { teamId: existing, playerId: 'p2', playerName: 'Bea' });
  assert.equal(joined.committed, true);

  // --- Player 3 creates a second Team, slotted below the first --------------
  const p3 = await tab(code, 'p3', 'player');
  teams = read(p3, 'teams');
  await A.createTeam(p3, {
    teamId: teamKey('Team Magma'),
    name: 'Team Magma',
    color: nextTeamColor(teams),
    order: nextTeamOrder(teams),
    playerId: 'p3',
    playerName: 'Cal',
  });

  // --- Display attaches -----------------------------------------------------
  const display = await tab(code, 'd1', 'display');
  await A.registerClient(display, { clientId: 'd1', role: 'display', name: 'Display D1' });

  // --- Everyone sees the same lobby ----------------------------------------
  const roster = rosterOf('gm1', 'p1', 'p2', 'p3', 'd1');
  const tabs = [host, p1, p2, p3, display];
  await until(() =>
    tabs.every((s) => {
      const l = selectLobby(read(s, '/'), roster);
      return l.teams.length === 2 && l.playerCount === 3 && l.displays.length === 1;
    })
  );
  const views = tabs.map((s) => selectLobby(read(s, '/'), roster));

  for (const [i, lobby] of views.entries()) {
    const who = ['host', 'p1', 'p2', 'p3', 'display'][i];
    assert.deepEqual(lobby.teams.map((t) => t.name), ['Team Rocket', 'Team Magma'], `${who}: teams + order`);
    assert.deepEqual(lobby.teams[0].players.map((p) => p.name), ['Ann', 'Bea'], `${who}: Rocket roster`);
    assert.deepEqual(lobby.teams[1].players.map((p) => p.name), ['Cal'], `${who}: Magma roster`);
    assert.equal(lobby.playerCount, 3, `${who}: player count`);
    assert.deepEqual(lobby.displays.map((d) => d.name), ['Display D1'], `${who}: display attached`);
    assert.equal(lobby.host.clientId, 'gm1', `${who}: host seated`);
    assert.equal(lobby.teams[1].order, 1, `${who}: new team slotted last`);
    assert.equal(lobby.teams[0].score, 0, `${who}: teams start at 0`);
  }
});

test('two players racing the same new Team name produce one Team, not two', async () => {
  const code = freshCode();
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });

  const p1 = await tab(code, 'p1', 'player');
  const p2 = await tab(code, 'p2', 'player');
  const args = (playerId, playerName) => ({
    teamId: teamKey('Sudden Death'),
    name: 'Sudden Death',
    color: '#fff',
    order: 0,
    playerId,
    playerName,
  });

  // Same tick, same id: createTeam transacts, so exactly one commits.
  const [a, b] = await Promise.all([
    A.createTeam(p1, args('p1', 'Ann')),
    A.createTeam(p2, args('p2', 'Bea')),
  ]);
  assert.equal(Number(a.committed) + Number(b.committed), 1, 'exactly one creator');

  // The loser's screen falls back to joinTeam — the outcome they wanted anyway.
  const loser = a.committed ? p2 : p1;
  const loserId = a.committed ? 'p2' : 'p1';
  const loserName = a.committed ? 'Bea' : 'Ann';
  assert.equal((a.committed ? b : a).reason, 'team-id-taken');
  const rescue = await A.joinTeam(loser, { teamId: 'sudden-death', playerId: loserId, playerName: loserName });
  assert.equal(rescue.committed, true);

  await until(() => selectLobby(read(host, '/'), rosterOf('p1', 'p2')).playerCount === 2);
  const lobby = selectLobby(read(host, '/'), rosterOf('p1', 'p2'));
  assert.equal(lobby.teams.length, 1, 'one Team, not two');
  assert.deepEqual(lobby.teams[0].players.map((p) => p.name).sort(), ['Ann', 'Bea']);
});

test('a Player joins mid-Game at 0 points, slotted last (V2-13, defect #10)', async () => {
  const code = freshCode();
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });

  const p1 = await tab(code, 'p1', 'player');
  await A.createTeam(p1, {
    teamId: 'alpha', name: 'Alpha', color: '#111', order: 0, playerId: 'p1', playerName: 'Ann',
  });

  // Host starts the Game. Registration is NOT locked — that gate is for the
  // Host to close deliberately, and V2-13 says joins keep working.
  await A.startGame(host, 'gm');
  await host.transact('teams/alpha/score', () => 7);

  const late = await tab(code, 'p9', 'player');
  const room = read(late, '/');
  assert.equal(room.meta.status, 'playing');
  assert.deepEqual(selectLobby(room, []).inProgress, true, 'the join form warns about a Game in progress');

  const res = await A.createTeam(late, {
    teamId: teamKey('Latecomers'),
    name: 'Latecomers',
    color: nextTeamColor(room.teams),
    order: nextTeamOrder(room.teams),
    playerId: 'p9',
    playerName: 'Zed',
  });
  assert.equal(res.committed, true, 'a Player CAN join after the Game has begun');

  await until(() => selectLobby(read(host, '/'), rosterOf('p1', 'p9')).teams.length === 2);
  const lobby = selectLobby(read(host, '/'), rosterOf('p1', 'p9'));
  assert.deepEqual(lobby.teams.map((t) => t.name), ['Alpha', 'Latecomers']);
  assert.equal(lobby.teams[1].score, 0, 'joins at 0 points');
  assert.equal(lobby.teams[1].order, 1, 'slotted below the Teams already playing');
});

test('a refreshed Player tab resumes its seat rather than duplicating it', async () => {
  const code = freshCode();
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });

  const p1 = await tab(code, 'p1', 'player');
  await A.createTeam(p1, {
    teamId: 'alpha', name: 'Alpha', color: '#111', order: 0, playerId: 'p1', playerName: 'Ann',
  });
  p1.close();

  // Same clientId comes back (storage.getOrCreateClientId is stable) and
  // re-announces itself, exactly as the Play screen's effect does.
  const p1again = await tab(code, 'p1', 'player');
  await A.registerClient(p1again, { clientId: 'p1', role: 'player', name: 'Ann', teamId: 'alpha' });

  const lobby = selectLobby(read(p1again, '/'), rosterOf('p1'));
  assert.equal(lobby.teams.length, 1);
  assert.deepEqual(lobby.teams[0].players.map((p) => p.name), ['Ann'], 'one Ann, not two');
});

test('a closed Room refuses new Players on every screen', async () => {
  const code = freshCode();
  const host = await tab(code, 'gm1', 'gm', true);
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });
  await A.closeRoom(host, 'gm');

  const late = await tab(code, 'p9', 'player');
  const { canJoin } = await import('../src/state/lobby.js');
  assert.deepEqual(canJoin(read(late, '/')), { allowed: false, reason: 'room-closed' });
});
