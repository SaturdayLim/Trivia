/**
 * @vitest-environment jsdom
 *
 * The click-in (?) tooltip (v1 defect #3: "Unexplained headers … no
 * definitions"). Tap-to-open rather than hover — there is no hover on the
 * phones this app is mobile-first for — and dismissible by an outside tap or
 * Escape, unlike `Select`'s dropdown (a definition is a glance, not a
 * decision the app needs to protect).
 */

import { afterEach, expect, test } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Tooltip } from '../src/components/ui.jsx';
import { FIELD_HELP, defaultStages } from '../src/state/stages.js';
import { StageSetup } from '../src/screens/HostSetup.jsx';

afterEach(cleanup);

test('Tooltip is closed until tapped, then shows its text', () => {
  const { container } = render(<Tooltip text="How many times this Stage goes around the table." />);
  expect(within(container).queryByRole('tooltip')).toBeNull();

  fireEvent.click(within(container).getByRole('button', { name: 'What does this mean?' }));
  expect(within(container).getByRole('tooltip').textContent).toMatch(/goes around the table/);
});

test('Tooltip closes on an outside tap and on Escape', () => {
  const { container, baseElement } = render(<Tooltip text="Definition text." />);
  const toggle = within(container).getByRole('button', { name: 'What does this mean?' });

  fireEvent.click(toggle);
  expect(within(baseElement).queryByRole('tooltip')).toBeTruthy();
  fireEvent.click(within(baseElement).getByRole('button', { name: 'Close' }));
  expect(within(baseElement).queryByRole('tooltip')).toBeNull();

  fireEvent.click(toggle);
  expect(within(baseElement).queryByRole('tooltip')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(within(baseElement).queryByRole('tooltip')).toBeNull();
});

test('Tooltip toggle has a 44px+ tap target despite its small glyph (PRD §6)', () => {
  const { container } = render(<Tooltip text="x" />);
  const toggle = within(container).getByRole('button', { name: 'What does this mean?' });
  // The visible glyph is a size-5 (20px) circle; the invisible -inset-3 hit
  // area (12px each side) is what actually satisfies the 44px floor.
  expect(toggle.className).toMatch(/size-5/);
  expect(toggle.querySelector('[aria-hidden="true"]').className).toMatch(/-inset-3/);
});

test('Stage setup carries a tooltip for every header with no other explanation', () => {
  const { container } = render(
    <StageSetup
      stages={defaultStages()}
      teamCount={2}
      questionsOnBoard={100}
      onChange={() => {}}
      onConfirm={() => {}}
      onBack={() => {}}
      busy={false}
    />
  );
  // One tooltip per field per Stage card (Rotations, Thinking Time,
  // Multiplier, Penalty, Who Selects First, Who Selects Next) x 4 Stages.
  const tooltipToggles = within(container).getAllByRole('button', { name: /What does .* mean\?/ });
  expect(tooltipToggles.length).toBe(6 * 4);

  fireEvent.click(tooltipToggles[0]);
  expect(within(container).getByRole('tooltip').textContent).toBe(FIELD_HELP.rotations);
});
