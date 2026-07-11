/**
 * @vitest-environment jsdom
 *
 * V2-25: eased transitions, not a new source of truth. These tests are about
 * what the S5 note (S4 REVIEW) warned against — motion must never delay or
 * reorder an authority decision, only how it is presented. `ScoreList`'s
 * count-up is the one animation with actual state (a display value trailing
 * the real score), so it is the one worth pinning: it must show the right
 * number immediately on mount, and never lose track of it across Team
 * roster changes (V2-13 mid-Game joins render a fresh row per Team).
 */

import { afterEach, expect, test } from 'vitest';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import { ScoreList } from '../src/components/game.jsx';

afterEach(cleanup);

test('ScoreList shows the real score immediately on first render, no animation lag', () => {
  const { container } = render(
    <ScoreList teams={[{ teamId: 't1', name: 'Alpha', color: '#fff', score: 7 }]} />
  );
  expect(within(container).getByText('7')).toBeTruthy();
});

test('ScoreList settles on the new score after a change (count-up is presentational only)', async () => {
  const teams = [{ teamId: 't1', name: 'Alpha', color: '#fff', score: 2 }];
  const { rerender, container } = render(<ScoreList teams={teams} />);
  expect(within(container).getByText('2')).toBeTruthy();

  rerender(<ScoreList teams={[{ ...teams[0], score: 9 }]} />);
  await waitFor(() => expect(within(container).getByText('9')).toBeTruthy());
});

test('ScoreList keeps every row correct when a Team joins mid-Game (V2-13)', () => {
  const { container, rerender } = render(
    <ScoreList teams={[{ teamId: 't1', name: 'Alpha', color: '#fff', score: 3 }]} />
  );
  rerender(
    <ScoreList
      teams={[
        { teamId: 't1', name: 'Alpha', color: '#fff', score: 3 },
        { teamId: 't2', name: 'Beta', color: '#000', score: 0 },
      ]}
    />
  );
  expect(within(container).getByText('Alpha')).toBeTruthy();
  expect(within(container).getByText('Beta')).toBeTruthy();
  expect(within(container).getByText('3')).toBeTruthy();
  expect(within(container).getByText('0')).toBeTruthy();
});
