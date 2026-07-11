/**
 * @vitest-environment jsdom
 *
 * R2 regression (stack-v2 PRD §8b): "Host 'Extend Timer' button does nothing."
 *
 * The root cause was not the button or the deadline write: `openQuestion`
 * never cleared `game/question/locks` on a re-open, so a Player's expiry
 * auto-lock from the OLD (smaller) deadline survived onto the NEW, later one.
 * `hasExplicitLock` (state/game.js) reads a lock's `at` against whatever
 * deadline is live right now, so that leftover auto-lock read as an
 * *explicit* Lock In against the extended deadline — and HostGame's own
 * authority effect resealed the question the instant it reopened, before a
 * human could ever see the options unlock. See actions.openQuestion for the
 * fix (locks now clear on every open, not only the first).
 *
 * This exercises the real Host/Player screens over the real mock driver, not
 * just the actions layer, because the bug lived in a React effect
 * (`HostGame`'s authority effect 2) reacting to state the pure actions calls
 * in `live-loop.test.mjs` never round-trip through.
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

const { Host, Play, within, seedPlayingRoom, mountAs, readTree, player, teardown } =
  await import('./live-harness.jsx');
const A = await import('../src/engine/actions.js');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => teardown(cleanup));

// ---------------------------------------------------------------------------

test('Extend after an expiry auto-lock actually reopens the question (R2)', async () => {
  const { roomCode, host } = await seedPlayingRoom('LSD1');

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
  await waitFor(() => expect(H.getByText('Easy one?')).toBeTruthy());

  // A very short deadline, written directly (not via the "Start" button,
  // which would use the Stage's real 30s) so the test doesn't wait 30s for a
  // real expiry.
  await act(async () => {
    await A.openQuestion(host, 'gm', host.serverNow() + 80);
  });
  await waitFor(() => expect(Ann.getByRole('button', { name: 'Choose an Option' })).toBeTruthy());

  // Ann taps an option but never presses Lock In: her own device auto-locks
  // it for her at the deadline (V2-15) — this is the auto-lock that must not
  // survive as "explicit" once the Host extends.
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /^A\s*e-a$/ }));
  });
  await waitFor(() => expect(Ann.getByText('Locked In')).toBeTruthy(), { timeout: 2000 });

  // Wait for the Host's own grace-window effect to actually seal the
  // question, matching the real "it looks stuck" complaint.
  await waitFor(
    () => expect(readTree(host).game.question?.state).toBe('locked'),
    { timeout: 3000 }
  );

  // --- The Host extends. -----------------------------------------------------
  await act(async () => {
    fireEvent.click(H.getByRole('button', { name: 'Extend Timer' }));
  });

  // The real proof: Ann returns to Options, not the locked-in full screen —
  // which only happens if the question genuinely reopened (state === 'open')
  // AND stayed open, rather than resealing on her now-stale auto-lock read
  // against the extended deadline. (Her Lock In button still reads "Lock In
  // A" — her pending choice from before rides along, exactly like a fresh
  // "Start" would; only the server-side lock and the seal were stale.)
  await waitFor(() => expect(Ann.queryByText('Locked In')).toBeNull(), { timeout: 2000 });
  await waitFor(() => expect(Ann.getByRole('button', { name: 'Lock In A' })).toBeTruthy());
  expect(readTree(host).game.question.state).toBe('open');

  // And she can genuinely answer again, all the way to a fresh Lock In.
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: /^B\s*e-b$/ }));
  });
  await act(async () => {
    fireEvent.click(Ann.getByRole('button', { name: 'Lock In B' }));
  });
  await waitFor(() => expect(Ann.getByText('Locked In')).toBeTruthy());
  expect(Ann.getByText('B')).toBeTruthy();
});
