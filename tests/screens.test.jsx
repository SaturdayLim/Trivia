/**
 * @vitest-environment jsdom
 *
 * Screen smoke tests: the React layer actually mounts, connects through the
 * real mock driver, and reaches the shared live lobby.
 *
 * This is the closest a headless run can get to S3's done-when ("2 phones + a
 * display join and sit in a live lobby"). It exercises the true join path —
 * `useRoom` -> `createSync` -> `driver-mock` over BroadcastChannel — with two
 * Player components and one Display component mounted against a room a Host
 * created. What it still does NOT prove: real devices, Firebase, or that any of
 * it looks right. Those want the browser/device pass.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// The app resolves its driver through this module; point it at the mock one and
// keep the rest of the stack (adapter, actions, hooks, components) untouched.
vi.mock('../src/app/driver.js', async () => {
  const mock = await import('../src/sync/driver-mock.js');
  return {
    ROLE: (await import('../src/state/roles.js')).ROLE,
    driverName: () => 'mock',
    isMockDriver: () => true,
    loadDriver: async () => mock,
    roomExists: (code) => mock.roomExists(code),
    loadExposureBackend: async () => (await import('../src/state/exposure.js')).createLocalExposureBackend(),
  };
});

const { createSync } = await import('../src/sync/adapter.js');
const driverMock = await import('../src/sync/driver-mock.js');
const A = await import('../src/engine/actions.js');
const { default: Play } = await import('../src/screens/Play.jsx');
const { default: Display } = await import('../src/screens/Display.jsx');
const { default: Home } = await import('../src/screens/Home.jsx');

let roomSeq = 0;
const sessions = [];

/** Stand up a room the way `createRoom` does, then close the creating session. */
async function seedRoom() {
  roomSeq += 1;
  const roomCode = `SC${String(roomSeq).padStart(2, '0')}`;
  const host = await createSync({
    driver: driverMock, roomCode, clientId: 'gm1', role: 'gm', create: true, initialState: {},
  });
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });
  await A.registerClient(host, { clientId: 'gm1', role: 'gm', name: 'Host' });
  sessions.push(host);
  return { roomCode, host };
}

/**
 * Render a screen at `/<path>?room=CODE`, pinning this tab's clientId.
 *
 * jsdom gives the whole file ONE sessionStorage, but the app under mock-driver
 * treats sessionStorage as "this tab". Overwriting the client id before each
 * mount is therefore what makes one jsdom stand in for several tabs — and it is
 * also why `renderScreen` must clear any identity belonging to the previous
 * occupant, exactly as a genuinely separate tab would have none.
 */
function renderScreen(Component, path, roomCode, clientId) {
  sessionStorage.setItem('stack-client-id', clientId);
  const stored = sessionStorage.getItem(`stack-identity-${roomCode}`);
  if (stored && JSON.parse(stored).playerId !== clientId) {
    sessionStorage.removeItem(`stack-identity-${roomCode}`);
  }
  return render(
    <MemoryRouter initialEntries={[`/${path}?room=${roomCode}`]}>
      <Routes>
        <Route path={`/${path}`} element={<Component />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) {
    try { s.close(); } catch { /* already closed */ }
  }
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

test('Home offers Start and Join, and never a dead placeholder', () => {
  render(<MemoryRouter><Home /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Start a Game' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Join a Game' })).toBeTruthy();
  expect(screen.queryByText(/Connecting/i)).toBeNull();
});

test('a Player connects and lands on the join form, not a spinner', async () => {
  const { roomCode } = await seedRoom();
  renderScreen(Play, 'play', roomCode, 'p1');

  // The connecting state must resolve, and it must resolve into something real.
  await waitFor(() => expect(screen.getByText('Join the Game')).toBeTruthy());
  expect(screen.getByLabelText(/Your Name/i)).toBeTruthy();
  expect(screen.getByLabelText(/Team Name/i)).toBeTruthy();
  expect(screen.getByText(/A new Team will be created/)).toBeTruthy();
  expect(screen.queryByText(/Joining the Game…/)).toBeNull();
});

test('a Display attaches, shows the Room Code and the QR block', async () => {
  const { roomCode } = await seedRoom();
  renderScreen(Display, 'display', roomCode, 'd1');

  await waitFor(() => expect(screen.getByText('Scan to Join')).toBeTruthy());
  expect(screen.getAllByText(roomCode).length).toBeGreaterThan(0);
  expect(screen.getByText('Waiting for the Host to begin the Game.')).toBeTruthy();
  // Empty room renders a real, populated lobby (v1 defect #1).
  expect(screen.getByText(/No Teams yet/)).toBeTruthy();
});

test('two Players join and both see the same live lobby (S3 done-when, headless)', async () => {
  const { roomCode, host } = await seedRoom();

  // Player 1 creates "Team Rocket" through the real UI path.
  const p1 = renderScreen(Play, 'play', roomCode, 'p1');
  await waitFor(() => expect(screen.getByText('Join the Game')).toBeTruthy());

  const { fireEvent } = await import('@testing-library/dom');
  fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Ann' } });
  fireEvent.change(screen.getByLabelText(/Team Name/i), { target: { value: 'Team Rocket' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  });

  // Ann is seated: she sees the lobby, her team, and herself on it.
  // "Ann" appears twice on purpose: on the Team tile, and in "You are Ann".
  await waitFor(() => expect(screen.getByText(/You are/)).toBeTruthy());
  expect(screen.getAllByText('Ann').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Team Rocket').length).toBeGreaterThan(0);
  p1.unmount();

  // Player 2 opens a fresh tab and sees Ann's team already there — the join
  // propagated over the wire, not through React state.
  renderScreen(Play, 'play', roomCode, 'p2');
  await waitFor(() => expect(screen.getByText('Join the Game')).toBeTruthy());
  await waitFor(() => expect(screen.getByRole('button', { name: /Team Rocket/ })).toBeTruthy());

  // Tapping the team tile fills the name; confirming joins rather than forks.
  fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Bea' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Team Rocket/ }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  });

  await waitFor(() => expect(screen.getByText(/You are/)).toBeTruthy());

  // The host's tree is the arbiter: one team, two players.
  let tree;
  host.onChange('/', (t) => { tree = t; })();
  expect(Object.keys(tree.teams)).toEqual(['team-rocket']);
  expect(Object.keys(tree.teams['team-rocket'].players).sort()).toEqual(['p1', 'p2']);
});

test('a Player refreshing resumes their seat instead of re-joining', async () => {
  const { roomCode } = await seedRoom();

  const first = renderScreen(Play, 'play', roomCode, 'p1');
  await waitFor(() => expect(screen.getByText('Join the Game')).toBeTruthy());

  const { fireEvent } = await import('@testing-library/dom');
  fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Ann' } });
  fireEvent.change(screen.getByLabelText(/Team Name/i), { target: { value: 'Alpha' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  });
  await waitFor(() => expect(screen.getByText(/You are/)).toBeTruthy());

  // Simulate F5: tear the tree down, mount it again with the same clientId and
  // the same localStorage. No join form should appear.
  first.unmount();
  renderScreen(Play, 'play', roomCode, 'p1');

  await waitFor(() => expect(screen.getByText(/You are/)).toBeTruthy());
  expect(screen.queryByText('Join the Game')).toBeNull();
  expect(screen.getAllByText('Ann').length).toBeGreaterThan(0);
});

test('a Player cannot join a closed Room', async () => {
  const { roomCode, host } = await seedRoom();
  await A.closeRoom(host, 'gm');

  renderScreen(Play, 'play', roomCode, 'p9');
  await waitFor(() => expect(screen.getByText(/This Game has ended|This Room is closed/)).toBeTruthy());
  expect(screen.queryByText('Join the Game')).toBeNull();
});
