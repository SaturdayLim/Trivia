/**
 * @vitest-environment jsdom
 *
 * ONE live-screen scenario per file — see live-harness.jsx for why the split.
 * Real Host/Player/Display components over the real mock driver, driven by
 * clicking the actual buttons. What this cannot prove: real devices, Firebase,
 * or ≤1s sync — those want the device pass, still Michael's.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const { CATEGORIES } = vi.hoisted(() => ({
  CATEGORIES: [
    {
      slug: 'movies',
      name: 'Movie Night',
      icon: null,
      iconSrc: null,
      n: 1,
      questions: [
        { id: 'E1', dif: 'E', q: 'Easy one?', options: ['e-a', 'e-b', 'e-c', 'e-d'], answer: 'A', fact: '' },
        { id: 'M1', dif: 'M', q: 'Who directed it?', options: ['Ada', 'Bo', 'Cy', 'Di'], answer: 'B', fact: 'Shot in one take.' },
        { id: 'H1', dif: 'H', q: 'Hard one?', options: ['h-a', 'h-b', 'h-c', 'h-d'], answer: 'C', fact: '' },
      ],
    },
  ],
}));

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

vi.mock('../src/content/catalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadCatalog: async () => ({ categories: CATEGORIES, errors: [] }),
}));

const { Host, Play, Display, within, seedPlayingRoom, mountAs, readTree, player, teardown } =
  await import('./live-harness.jsx');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => teardown(cleanup));

// ---------------------------------------------------------------------------

test('a whole turn, clicked through the real screens (S4 done-when, headless)', async () => {
  const { roomCode, host } = await seedPlayingRoom('LSA1');

  const hostView = mountAs(Host, 'host', roomCode, 'gm1');
  const H = within(hostView.container);
  await waitFor(() => expect(H.getByText(/Alpha is choosing/)).toBeTruthy());

  const annView = mountAs(Play, 'play', roomCode, 'p1', player('p1', 'Ann'));
  const Ann = within(annView.container);
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

  const beaView = mountAs(Play, 'play', roomCode, 'p2', player('p2', 'Bea'));
  const Bea = within(beaView.container);
  await waitFor(() => expect(Bea.getByText('Your Team chooses')).toBeTruthy());

  // --- Ann taps a Category. She claims the turn; Bea is locked out (V2-14). --
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Movie Night/ }));
  });

  await waitFor(() => expect(Ann.getByText('Choose a difficulty.')).toBeTruthy());
  await waitFor(() => expect(Bea.getByText(/Ann is choosing for your Team/)).toBeTruthy());
  // Bea keeps her peripherals while locked out — V2-14 says so explicitly.
  expect(Bea.getByRole('button', { name: 'Question Log' })).toBeTruthy();
  expect(Bea.queryByRole('button', { name: /Movie Night/ })).toBeNull();

  // The Host sees who took the wheel, and which Category.
  await waitFor(() => expect(H.getByText(/Ann has the Team's selection and picked Movie Night/)).toBeTruthy());

  // A Display, attached mid-turn, renders the difficulty view (PRD §3.4).
  const tvView = mountAs(Display, 'display', roomCode, 'd1');
  const Tv = within(tvView.container);
  await waitFor(() => expect(Tv.getByText(/Ann is choosing/)).toBeTruthy());
  expect(Tv.getAllByText('Movie Night').length).toBeGreaterThan(0);

  // --- Ann picks Medium. The Host's effect draws and publishes the question. -
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Medium/ }));
  });

  await waitFor(() => expect(H.getByText('Who directed it?')).toBeTruthy());
  // The answer and the fun fact are on the Host's phone only.
  expect(H.getByText('B. Bo')).toBeTruthy();
  expect(H.getByText('Shot in one take.')).toBeTruthy();
  await waitFor(() => expect(Ann.getByText('Who directed it?')).toBeTruthy());
  expect(Ann.queryByText('Shot in one take.')).toBeNull();
  expect(Ann.getByText(/The options open when the Host starts the timer/)).toBeTruthy();

  // --- Host presses Start: the options activate (PRD §3.2 step 5). ----------
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Start' }));
  });
  await waitFor(() => expect(Ann.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());

  // --- Ann taps B, then Locks In. Her letter fills the screen. --------------
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /^B\s*Bo$/ }));
  });
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: 'Lock In B' }));
  });

  await waitFor(() => expect(Ann.getByText('Locked In')).toBeTruthy());
  expect(Ann.getByText('B')).toBeTruthy();
  // The Host counts the lock, and seals the question on it (V2-15).
  await waitFor(() => expect(H.getByText(/1 of 1 Team has locked in/)).toBeTruthy());

  // --- Host reveals. ---------------------------------------------------------
  await waitFor(() => expect(H.getByRole('button', { name: 'Reveal' }).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Reveal' }));
  });

  // The toggles are pre-filled by auto-scoring: Medium is worth 2 (V2-11).
  // R3: a 3-state Plus/Nothing/Minus control, not a tap-to-cycle button.
  await waitFor(() => expect(H.getByRole('radio', { name: 'Alpha: Plus', checked: true })).toBeTruthy());
  await waitFor(() => expect(Ann.getByText('Correct.')).toBeTruthy());
  await waitFor(() => expect(Tv.getByText(/\+2/)).toBeTruthy());

  // The Host can overrule it before committing: Plus -> Nothing -> Minus -> Plus.
  await act(async () => {
    fireEvent.click(H.getByRole('radio', { name: 'Alpha: Nothing' }));
  });
  expect(H.getByRole('radio', { name: 'Alpha: Nothing', checked: true })).toBeTruthy();
  await act(async () => {
    fireEvent.click(H.getByRole('radio', { name: 'Alpha: Minus' }));
  });
  expect(H.getByRole('radio', { name: 'Alpha: Minus', checked: true })).toBeTruthy();
  await act(async () => {
    fireEvent.click(H.getByRole('radio', { name: 'Alpha: Plus' }));
  });
  expect(H.getByRole('radio', { name: 'Alpha: Plus', checked: true })).toBeTruthy();

  // --- Host presses Update: scores commit, every screen returns Home. --------
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Update' }));
  });

  await waitFor(() => expect(H.getByText(/Alpha is choosing/)).toBeTruthy());
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());
  await waitFor(() => expect(Tv.getByText('Categories')).toBeTruthy());

  const tree = readTree(host);
  expect(tree.teams.t1.score).toBe(2);
  expect(tree.game.question).toBeUndefined();
  expect(tree.selectionClaim).toBeUndefined();
  expect(tree.game.log.length).toBe(1);
  expect(tree.game.log[0].ref).toBe('movies:M1');
  // R4: the Question Log remembers who selected it.
  expect(tree.game.log[0].selectedBy).toEqual({ playerId: 'p1', teamId: 't1' });

  // Exposure was written at reveal (PRD §4), into the offline backend (V2-21).
  const exposed = JSON.parse(localStorage.getItem('stack-exposure') || '{}');
  expect(exposed.movies?.M1).toBeGreaterThan(0);
});
