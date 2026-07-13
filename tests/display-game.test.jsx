/**
 * @vitest-environment jsdom
 *
 * DisplayGame is pure props-in (room, roomCode, sync) with no driver/router
 * dependency of its own, so these render it directly against hand-built room
 * trees — no mock driver, no live harness. Covers three of the S4.6 (PRD §8b)
 * findings that all live in this one read-only screen:
 *   R1 — locked answers highlighted pre-reveal.
 *   R6 — a Final Results podium when the Game ends.
 *   R7 — the Host's "Show QR Code" toggle overriding whatever this Display
 *        would otherwise show.
 */

import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { defaultStages } from '../src/state/stages.js';
import DisplayGame from '../src/screens/DisplayGame.jsx';

afterEach(cleanup);

const sync = { serverNow: () => 1_000_000 };

function baseRoom(overrides = {}) {
  return {
    meta: { status: 'playing' },
    settings: {
      rounds: defaultStages(),
      categories: ['movies'],
      categoryMeta: { movies: { name: 'Movie Night', icon: null, n: 1 } },
    },
    teams: {
      t1: { name: 'Alpha', color: '#111', order: 0, score: 3, players: {} },
      t2: { name: 'Bravo', color: '#222', order: 1, score: 5, players: {} },
    },
    game: {
      round: 0,
      rotation: 0,
      teamOrder: ['t1', 't2'],
      activeTeam: 't1',
      board: { movies: { E: [], M: [], H: [] } },
      question: null,
      log: [],
    },
    ...overrides,
  };
}

test('R1: locked answers are highlighted pre-reveal, safe because a lock already ends answering', () => {
  const room = baseRoom({
    game: {
      round: 0,
      rotation: 0,
      teamOrder: ['t1', 't2'],
      activeTeam: 't1',
      board: {},
      log: [],
      question: {
        ref: 'movies:E1',
        state: 'locked',
        value: 1,
        deadline: 1_000_500,
        payload: { q: 'Q?', options: ['e-a', 'e-b', 'e-c', 'e-d'] },
        locks: { t1: { playerId: 'p1', choice: 'B', at: 999_900 } },
        result: null,
      },
    },
  });

  const { container } = render(<DisplayGame room={room} roomCode="ABCD" sync={sync} />);

  const highlighted = Array.from(container.querySelectorAll('div')).filter((el) =>
    el.className.includes('border-[var(--stack-accent)]')
  );
  // Exactly one tile carries the accent highlight, and it is Team Alpha's
  // locked letter (B / "e-b") — not any of the other three options.
  expect(highlighted.length).toBe(1);
  expect(highlighted[0].textContent).toContain('e-b');
});

test('R11: pre-reveal, only the SELECTOR\'s locked letter is highlighted, not another Team\'s', () => {
  // t1 (Alpha) is the selecting Team. In an "All" Stage a non-selecting Team can
  // lock without ending the question (R10), so showing every lock would leak
  // answers — the Display shows the Selector's answer only (R11).
  const room = baseRoom({
    settings: {
      rounds: defaultStages().map((s, i) => (i === 0 ? { ...s, mode: 'all' } : s)),
      categories: ['movies'],
      categoryMeta: { movies: { name: 'Movie Night', icon: null, n: 1 } },
    },
    game: {
      round: 0,
      rotation: 0,
      teamOrder: ['t1', 't2'],
      activeTeam: 't1',
      board: {},
      log: [],
      question: {
        ref: 'movies:E1',
        state: 'open',
        value: 1,
        deadline: 1_000_500,
        payload: { q: 'Q?', options: ['e-a', 'e-b', 'e-c', 'e-d'] },
        // Only Bravo (a non-selector) has locked so far — 'D' / "e-d".
        locks: { t2: { playerId: 'p3', choice: 'D', at: 999_900 } },
        result: null,
      },
    },
  });

  const first = render(<DisplayGame room={room} roomCode="ABCD" sync={sync} />);
  let highlighted = Array.from(first.container.querySelectorAll('div')).filter((el) =>
    el.className.includes('border-[var(--stack-accent)]')
  );
  expect(highlighted.length).toBe(0); // Bravo's lock is NOT shown pre-reveal
  cleanup();

  // Now the Selector (t1) also locks 'B' / "e-b": that — and only that — shows.
  room.game.question.locks.t1 = { playerId: 'p1', choice: 'B', at: 999_950 };
  const second = render(<DisplayGame room={room} roomCode="ABCD" sync={sync} />);
  highlighted = Array.from(second.container.querySelectorAll('div')).filter((el) =>
    el.className.includes('border-[var(--stack-accent)]')
  );
  expect(highlighted.length).toBe(1);
  expect(highlighted[0].textContent).toContain('e-b');
});

test('R6: the ended Game shows a ranked podium, not a plain list', () => {
  const room = baseRoom({ meta: { status: 'ended' } });
  room.teams = {
    t1: { name: 'Alpha', color: '#111', order: 0, score: 5, players: {} },
    t2: { name: 'Bravo', color: '#222', order: 1, score: 9, players: {} },
    t3: { name: 'Carol', color: '#333', order: 2, score: 2, players: {} },
  };

  const { getByText, getAllByText } = render(<DisplayGame room={room} roomCode="ABCD" sync={sync} />);

  expect(getByText('Final Scores')).toBeTruthy();
  // Bravo has the highest score: rank #1.
  expect(getByText('#1')).toBeTruthy();
  expect(getAllByText('Bravo').length).toBeGreaterThan(0);
  expect(getAllByText('Alpha').length).toBeGreaterThan(0);
  expect(getAllByText('Carol').length).toBeGreaterThan(0);
});

test('R7: the Host\'s Show QR Code toggle overrides the Display, mid-question included', () => {
  const room = baseRoom({
    meta: { status: 'playing', showQr: true },
    game: {
      round: 0,
      rotation: 0,
      teamOrder: ['t1'],
      activeTeam: 't1',
      board: {},
      log: [],
      question: {
        ref: 'movies:E1',
        state: 'open',
        value: 1,
        deadline: 1_000_500,
        payload: { q: 'A live question?', options: ['e-a', 'e-b', 'e-c', 'e-d'] },
        locks: {},
        result: null,
      },
    },
  });

  const { getByText, queryByText, getAllByText } = render(<DisplayGame room={room} roomCode="WXYZ" sync={sync} />);

  expect(getByText('Scan to Join')).toBeTruthy();
  expect(getAllByText('WXYZ').length).toBeGreaterThan(0);
  expect(queryByText('A live question?')).toBeNull();
});
