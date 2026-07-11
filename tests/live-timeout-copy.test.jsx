/**
 * @vitest-environment jsdom
 *
 * R5 regression (stack-v2 PRD §8b): "Wrong timeout copy for non-contestants."
 *
 * Once time is up, a Team that was never eligible to answer this Stage must
 * see plain "Time is up." — not the fuller "No answer from <Team> — no
 * points, and no penalty" caveat, which is framing for a Team that COULD
 * have answered and simply didn't lock in time. The fix branches the copy on
 * `me.mayAnswer` (state/game.js), not on lock state — a spectator Team never
 * has a lock either, so gating on lock state alone showed them both banners.
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

const { Host, Play, within, seedPlayingRoom, mountAs, player, teardown } = await import('./live-harness.jsx');
const A = await import('../src/engine/actions.js');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => teardown(cleanup));

// ---------------------------------------------------------------------------

test('an ineligible Team sees "Time is up." only; the eligible Team that missed it gets the fuller caveat (R5)', async () => {
  const { roomCode, host } = await seedPlayingRoom('LSE1');
  // Stage 1 (from seedPlayingRoom's defaultStages) is Selector Only: Bravo
  // can never answer it.
  await A.createTeam(host, { teamId: 't2', name: 'Bravo', color: '#222', order: 1, playerId: 'p9', playerName: 'Cal' });

  const hostView = mountAs(Host, 'host', roomCode, 'gm1');
  const H = within(hostView.container);
  await waitFor(() => expect(H.getByText(/Alpha is choosing/)).toBeTruthy());

  const annView = mountAs(Play, 'play', roomCode, 'p1', player('p1', 'Ann'));
  const Ann = within(annView.container);
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

  const calView = mountAs(Play, 'play', roomCode, 'p9', { role: 'player', playerId: 'p9', name: 'Cal', teamId: 't2' });
  const Cal = within(calView.container);
  await waitFor(() => expect(Cal.getByText(/Alpha is choosing/)).toBeTruthy());

  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Movie Night/ }));
  });
  await waitFor(() => expect(Ann.getByText('Choose a difficulty.')).toBeTruthy());
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Easy/ }));
  });
  await waitFor(() => expect(H.getByRole('button', { name: 'Start' })).toBeTruthy());
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Start' }));
  });

  await waitFor(() => expect(Ann.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());
  // Before time is up, Cal's spectator copy is the "watch along" framing.
  expect(Cal.getByText('Only Alpha may answer this Stage. Watch along.')).toBeTruthy();

  // Time runs out and the Host seals the question. Nobody ever locks an
  // answer — Alpha (eligible) missed it, and Bravo (ineligible) was never in
  // the running to begin with.
  await act(async () => {
    await A.lockQuestion(host, 'gm');
  });

  await waitFor(() => expect(Cal.getByText('Time is up.')).toBeTruthy());
  expect(Cal.queryByText(/No answer from/)).toBeNull();
  expect(Cal.queryByText(/Watch along/)).toBeNull();

  await waitFor(() => expect(Ann.getByText('Time is up. No answer from Alpha — no points, and no penalty.')).toBeTruthy());
});
