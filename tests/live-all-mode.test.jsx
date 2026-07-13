/**
 * @vitest-environment jsdom
 *
 * R10 / V2-26 through the REAL screens: an "All" Stage where the Selector
 * controls the end. Two Teams answer; the Selector Locks In; the OTHER Team,
 * which had only a pending selection, is treated as locked in with it (its
 * device auto-locks when the Host pulls the timer in), and both are scored.
 *
 * ONE live-screen scenario per file — see live-harness.jsx for why the split.
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

const { Host, Play, within, seedPlayingRoom, mountAs, readTree, teardown } =
  await import('./live-harness.jsx');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => teardown(cleanup));

// ---------------------------------------------------------------------------

test('All Stage: the Selector Locks In, the other Team keeps its pending choice, both score (R10)', async () => {
  const { roomCode, host } = await seedPlayingRoom('LAM1', {
    // Stage 1 becomes "All" with Penalty On, so a wrong answer is visible as −value.
    stages: (rounds) => rounds.map((s, i) => (i === 0 ? { ...s, mode: 'all', penalty: 'on' } : s)),
    teams: [
      { id: 't1', name: 'Alpha', color: '#FFE600', order: 0 },
      { id: 't2', name: 'Bravo', color: '#33F', order: 1 },
    ],
    players: [
      { teamId: 't1', playerId: 'p1', playerName: 'Ann' },
      { teamId: 't2', playerId: 'p3', playerName: 'Cal' },
    ],
  });

  const H = within(mountAs(Host, 'host', roomCode, 'gm1').container);
  await waitFor(() => expect(H.getByText(/Alpha is choosing/)).toBeTruthy());

  const Ann = within(mountAs(Play, 'play', roomCode, 'p1', { role: 'player', playerId: 'p1', name: 'Ann', teamId: 't1' }).container);
  const Cal = within(mountAs(Play, 'play', roomCode, 'p3', { role: 'player', playerId: 'p3', name: 'Cal', teamId: 't2' }).container);
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

  // Alpha selects Medium ("Who directed it?", answer B).
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Movie Night/ }));
  });
  await waitFor(() => expect(Ann.getByText('Choose a difficulty.')).toBeTruthy());
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Medium/ }));
  });
  await waitFor(() => expect(H.getByText('Who directed it?')).toBeTruthy());

  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Start' }));
  });

  // Both Teams may answer this Stage (All). Each taps an option but does NOT
  // Lock In: Ann (Selector) has B (correct) pending, Cal has A (wrong) pending.
  await waitFor(() => expect(Ann.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());
  await waitFor(() => expect(Cal.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Bo/ }));
  });
  await act(async () => {
    fireEvent.click(Cal.getByRole('button', { name: /Ada/ }));
  });

  // The Selector Locks In. This ends the question (R10): the Host pulls the
  // timer in, and Cal's device auto-locks its pending A — Cal never pressed
  // Lock In, yet its current selection is captured.
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: 'Lock In B' }));
  });
  await waitFor(() => expect(Ann.getByText('Locked In')).toBeTruthy());
  await waitFor(() => expect(Cal.getByText('Locked In')).toBeTruthy(), { timeout: 8000 });
  expect(Cal.getByText('A')).toBeTruthy(); // the captured pending letter

  // The Host reveals and commits. Alpha right (+2), Bravo wrong and penalized (−2).
  await waitFor(() => expect(H.getByRole('button', { name: 'Reveal' }).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Reveal' }));
  });
  await waitFor(() => expect(H.getByRole('radio', { name: 'Alpha: Plus', checked: true })).toBeTruthy());
  await waitFor(() => expect(H.getByRole('radio', { name: 'Bravo: Minus', checked: true })).toBeTruthy());

  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Update' }));
  });

  const tree = readTree(host);
  expect(tree.teams.t1.score).toBe(2);
  expect(tree.teams.t2.score).toBe(-2);
  // The captured lock is real state on the wire, not just a screen effect.
  expect(tree.game.log[0].deltas).toEqual({ t1: 2, t2: -2 });
});
