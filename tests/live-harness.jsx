/**
 * Shared harness for the live-screen tests. Not itself a test file (no `.test`
 * suffix), so Vitest imports it but never runs it directly.
 *
 * WHY THE LIVE-SCREEN TESTS ARE ONE-PER-FILE. Each test drives several React
 * screens over the real mock driver's BroadcastChannel. Vitest isolates the
 * module graph per FILE, not per test-in-file, and Node's BroadcastChannel
 * teardown leaks across tests that share one jsdom process — a diff from a
 * torn-down room can go missing for the next test, dropping (not merely
 * delaying) a reveal. Splitting one scenario per file gives each the clean
 * event loop it gets in isolation, where every scenario passes deterministically.
 *
 * Each test file still declares its own `vi.mock` calls (they are hoisted
 * per-file); this module only holds the plumbing they share.
 */

import { render, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createSync } from '../src/sync/adapter.js';
import * as driverMock from '../src/sync/driver-mock.js';
import * as A from '../src/engine/actions.js';
import { defaultStages } from '../src/state/stages.js';

export { within };
export { default as Host } from '../src/screens/Host.jsx';
export { default as Play } from '../src/screens/Play.jsx';
export { default as Display } from '../src/screens/Display.jsx';

const sessions = [];

/**
 * A room already in play: one Category on the board, Alpha up first.
 *
 * The seeding session stays alive as the mock driver's serializer (the tab that
 * created the room holds authority). Its clientId is `seed-gm`, NOT `gm1` — but
 * it seats `gm1` as the Host (`createRoomState`'s clientId sets
 * `meta.gmClientId`), so the rendered `<Host>` (clientId `gm1`) finds itself
 * already seated and runs as an ordinary client of this serializer. Sharing the
 * clientId would fuse the two sessions into one wire identity and split the
 * authority in two — which never happens with one real Host device.
 *
 * Defaults reproduce the original single-Team (Alpha, Ann + Bea) shape every
 * existing caller relies on. `opts` lets a test seed a different Contestants
 * mode or more Teams without duplicating this plumbing:
 * @param {string} roomCode
 * @param {Object} [opts]
 * @param {(rounds: Object[]) => Object[]} [opts.stages] - transform the default
 *   Stages (e.g. force Stage 1 into "All" mode).
 * @param {Array<{id,name,color,order}>} [opts.teams]
 * @param {Array<{teamId,playerId,playerName}>} [opts.players]
 */
export async function seedPlayingRoom(roomCode, opts = {}) {
  const teams = opts.teams || [{ id: 't1', name: 'Alpha', color: '#FFE600', order: 0 }];
  const players = opts.players || [
    { teamId: 't1', playerId: 'p1', playerName: 'Ann' },
    { teamId: 't1', playerId: 'p2', playerName: 'Bea' },
  ];
  const stages = (opts.stages || ((r) => r))(defaultStages().map((s) => ({ ...s, rotations: 1, timerSec: 30 })));

  const host = await createSync({
    driver: driverMock, roomCode, clientId: 'seed-gm', role: 'gm', create: true, initialState: {},
  });
  sessions.push(host);

  await A.createRoomState(host, 'gm', {
    clientId: 'gm1',
    hostPin: '1234',
    teams,
    settings: {
      rounds: stages,
      orderRecalc: 'perRotation',
      categories: ['movies'],
      tierSizes: { movies: 1 },
      categoryMeta: { movies: { name: 'Movie Night', icon: null, n: 1 } },
      excludeUsed: true,
    },
  });
  await A.registerClient(host, { clientId: 'gm1', role: 'gm', name: 'Host' });
  for (const p of players) await A.joinTeam(host, p);

  await A.setBoard(host, 'gm', { movies: { E: ['E1'], M: ['M1'], H: ['H1'] } });
  const started = await A.startGame(host, 'gm');
  await A.openTapIn(host, 'gm', started.activeTeam);

  return { roomCode, host };
}

/** Read the authoritative tree after the flow, via the live serializer session. */
export function readTree(host) {
  let tree;
  host.onChange('/', (t) => { tree = t; })();
  return tree;
}

/**
 * Mount one screen as one device. Under the mock driver the app treats
 * sessionStorage as "this tab", so stamping the client id (and that device's
 * saved identity) before each mount is what makes one jsdom stand in for
 * several phones.
 */
export function mountAs(Component, path, roomCode, clientId, identity) {
  sessionStorage.setItem('stack-client-id', clientId);
  if (identity) sessionStorage.setItem(`stack-identity-${roomCode}`, JSON.stringify(identity));
  else sessionStorage.removeItem(`stack-identity-${roomCode}`);
  if (clientId === 'gm1') sessionStorage.setItem(`stack-hostpin-${roomCode}`, '1234');

  return render(
    <MemoryRouter initialEntries={[`/${path}?room=${roomCode}`]}>
      <Routes>
        <Route path={`/${path}`} element={<Component />} />
      </Routes>
    </MemoryRouter>
  );
}

export const player = (playerId, name) => ({ role: 'player', playerId, name, teamId: 't1' });

export function teardown(cleanup) {
  cleanup();
  for (const s of sessions.splice(0)) {
    try { s.close(); } catch { /* already closed */ }
  }
}
