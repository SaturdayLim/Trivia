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

test('the Back button hands the turn back to a teammate (V2-14)', async () => {
  const { roomCode } = await seedPlayingRoom('LSC1');

  const annView = mountAs(Play, 'play', roomCode, 'p1', player('p1', 'Ann'));
  const Ann = within(annView.container);
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

  const beaView = mountAs(Play, 'play', roomCode, 'p2', player('p2', 'Bea'));
  const Bea = within(beaView.container);
  await waitFor(() => expect(Bea.getByText('Your Team chooses')).toBeTruthy());

  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /Movie Night/ }));
  });
  await waitFor(() => expect(Bea.getByText(/Ann is choosing for your Team/)).toBeTruthy());

  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: 'Back' }));
  });

  // Both halves came back: Bea sees the grid again and can take the turn.
  await waitFor(() => expect(Bea.getByText('Your Team chooses')).toBeTruthy());
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

  await act(async () => {
    fireEvent.click(Bea.getByRole('button', { name: /Movie Night/ }));
  });
  await waitFor(() => expect(Bea.getByText('Choose a difficulty.')).toBeTruthy());
  await waitFor(() => expect(Ann.getByText(/Bea is choosing for your Team/)).toBeTruthy());
});
