// Pure lobby derivation (src/state/lobby.js): the model behind the shared
// waiting lobby (v1 defect #1) and the join gate (v1 defect #10, V2-13).
import assert from 'node:assert';
import { test } from 'vitest';
import {
  TEAM_COLORS,
  canJoin,
  matchTeam,
  nextTeamColor,
  nextTeamOrder,
  selectLobby,
  teamKey,
} from '../src/state/lobby.js';

test('teamKey: two players typing the same name land on one team', () => {
  assert.equal(teamKey('Team Rocket'), 'team-rocket');
  assert.equal(teamKey('  team   rocket  '), 'team-rocket');
  assert.equal(teamKey('Team Rocket!!'), 'team-rocket');
  assert.equal(teamKey('TEAM ROCKET'), 'team-rocket');
  assert.equal(teamKey('Café'), 'cafe', 'accents fold to the base letter');
  assert.equal(teamKey('CAFE'), 'cafe', 'so Café and CAFE are one Team');
  assert.equal(teamKey('   '), '');
  assert.equal(teamKey(null), '');

  // A name with no Latin letters must still produce a usable, stable Firebase
  // path segment — never '' (which would write to `teams/`).
  for (const exotic of ['日本', '🔥🔥', '...']) {
    const key = teamKey(exotic);
    assert.match(key, /^team-[a-z0-9]+$/, `${exotic} -> ${key}`);
    assert.equal(key, teamKey(exotic), 'stable, so both players land on it');
    assert.ok(!/[.$#[\]/]/.test(key), 'legal as a Firebase key');
  }
  assert.notEqual(teamKey('日本'), teamKey('🔥🔥'), 'different names, different Teams');
});

test('new teams slot below the existing order and take the next color (V2-13)', () => {
  assert.equal(nextTeamOrder({}), 0);
  assert.equal(nextTeamColor({}), TEAM_COLORS[0]);

  const teams = { a: { order: 0 }, b: { order: 1 }, c: { order: 2 } };
  assert.equal(nextTeamOrder(teams), 3, 'joins last, never in the middle');
  assert.equal(nextTeamColor(teams), TEAM_COLORS[3]);

  // Gaps (a team removed) must not reuse an order that would tie.
  assert.equal(nextTeamOrder({ a: { order: 0 }, c: { order: 5 } }), 6);
  assert.equal(nextTeamOrder({ a: {} }), 0, 'missing order treated as -1');

  // The palette wraps rather than running out at 30 teams (V2-18).
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i}`, { order: i }]));
  assert.equal(nextTeamColor(many), TEAM_COLORS[0]);
});

test('matchTeam finds an existing team by typed name, else null', () => {
  const teams = { 'team-rocket': { name: 'Team Rocket' } };
  assert.equal(matchTeam(teams, 'team rocket'), 'team-rocket');
  assert.equal(matchTeam(teams, 'TEAM  ROCKET'), 'team-rocket');
  assert.equal(matchTeam(teams, 'Team Magma'), null);
  assert.equal(matchTeam(teams, ''), null);
  assert.equal(matchTeam(null, 'x'), null);
});

test('canJoin: open before AND during a game; shut only when dead (defect #10)', () => {
  assert.deepEqual(canJoin({ meta: { status: 'lobby' } }), { allowed: true });
  assert.deepEqual(canJoin({ meta: { status: 'playing' } }), { allowed: true }, 'mid-game join (V2-13)');
  assert.deepEqual(canJoin({ meta: {} }), { allowed: true }, 'missing status defaults to lobby');
  assert.deepEqual(canJoin({ meta: { status: 'ended' } }), { allowed: false, reason: 'game-over' });
  assert.deepEqual(canJoin({ meta: { status: 'closed' } }), { allowed: false, reason: 'room-closed' });
  assert.deepEqual(canJoin(null), { allowed: false, reason: 'no-room' });
});

// ---------------------------------------------------------------------------

const ROOM = {
  meta: { status: 'lobby', gmClientId: 'gm1' },
  teams: {
    bravo: { name: 'Bravo', color: '#222', order: 1, score: 3, players: { p2: { name: 'Bea' } } },
    alpha: {
      name: 'Alpha',
      color: '#111',
      order: 0,
      score: 5,
      players: { p1: { name: 'Ann' }, p3: { name: 'Cal' } },
    },
  },
  clients: {
    gm1: { role: 'gm', name: 'Host' },
    d1: { role: 'display', name: 'Display ABCD' },
    p1: { role: 'player', name: 'Ann', teamId: 'alpha' },
  },
};

const ROSTER = [
  { clientId: 'gm1', role: 'gm', connected: true },
  { clientId: 'p1', role: 'player', connected: true },
  { clientId: 'p2', role: 'player', connected: false },
  { clientId: 'd1', role: 'display', connected: true },
];

test('selectLobby: teams in registration order, players connected-first', () => {
  const lobby = selectLobby(ROOM, ROSTER);

  assert.deepEqual(lobby.teams.map((t) => t.teamId), ['alpha', 'bravo'], 'order field, not key order');
  assert.equal(lobby.teams[0].score, 5);
  assert.equal(lobby.playerCount, 3);

  // Ann is connected, Cal has never been seen on the roster -> Ann first.
  assert.deepEqual(lobby.teams[0].players.map((p) => p.name), ['Ann', 'Cal']);
  assert.deepEqual(lobby.teams[0].players.map((p) => p.connected), [true, false]);

  // Bea's phone is asleep. She is still on Bravo — presence must never delete
  // a player from the game state.
  assert.equal(lobby.teams[1].players.length, 1);
  assert.equal(lobby.teams[1].players[0].connected, false);
});

test('selectLobby: host liveness and displays come from presence', () => {
  const lobby = selectLobby(ROOM, ROSTER);
  assert.deepEqual(lobby.host, { clientId: 'gm1', connected: true });
  assert.deepEqual(lobby.displays.map((d) => d.name), ['Display ABCD']);
  assert.equal(lobby.displays[0].connected, true);

  const hostAway = selectLobby(ROOM, ROSTER.map((r) => (r.clientId === 'gm1' ? { ...r, connected: false } : r)));
  assert.deepEqual(hostAway.host, { clientId: 'gm1', connected: false });
});

test('selectLobby: an empty room renders a real lobby, not a placeholder (defect #1)', () => {
  const lobby = selectLobby({ meta: { status: 'lobby' } }, []);
  assert.deepEqual(lobby.teams, []);
  assert.deepEqual(lobby.displays, []);
  assert.equal(lobby.playerCount, 0);
  assert.deepEqual(lobby.host, { clientId: null, connected: false });
  assert.equal(lobby.inProgress, false);

  // And a null room (pre-connect) must not throw — it renders empty.
  const empty = selectLobby(null, null);
  assert.equal(empty.status, 'lobby');
  assert.equal(empty.playerCount, 0);
});

test('selectLobby: inProgress tracks meta.status', () => {
  assert.equal(selectLobby({ meta: { status: 'playing' } }, []).inProgress, true);
  assert.equal(selectLobby({ meta: { status: 'lobby' } }, []).inProgress, false);
  assert.equal(selectLobby({ meta: { status: 'ended' } }, []).inProgress, false);
});
