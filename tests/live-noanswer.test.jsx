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

test('a Player who never answers is told so, and is not disqualified (V2-16)', async () => {
  const { roomCode, host } = await seedPlayingRoom('LSB1');

  const hostView = mountAs(Host, 'host', roomCode, 'gm1');
  const H = within(hostView.container);
  await waitFor(() => expect(H.getByText(/Alpha is choosing/)).toBeTruthy());

  const annView = mountAs(Play, 'play', roomCode, 'p1', player('p1', 'Ann'));
  const Ann = within(annView.container);
  await waitFor(() => expect(Ann.getByText('Your Team chooses')).toBeTruthy());

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

  // Ann taps nothing at all. The Host reveals directly from the open question.
  await waitFor(() => expect(Ann.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());
  // Wait for Reveal to be enabled: the Host's action buttons disable while the
  // previous action (Start) is in flight, and firing a click at a disabled
  // button is a silent no-op. A human waits for the button to settle; so must
  // this test, or it races Start's `busy` flag.
  await waitFor(() => expect(H.getByRole('button', { name: 'Reveal' }).disabled).toBe(false));
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Reveal' }));
  });

  await waitFor(() => expect(Ann.getByText('Your Team did not answer.')).toBeTruthy());
  // Zero, pre-filled — not a penalty, even though Stage 1 could carry one.
  expect(H.getByRole('button', { name: /Alpha\s*0/ })).toBeTruthy();

  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Update' }));
  });
  const tree = readTree(host);
  expect(tree.teams.t1.score).toBe(0);
});
