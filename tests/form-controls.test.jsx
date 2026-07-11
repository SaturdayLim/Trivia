/**
 * @vitest-environment jsdom
 *
 * The Stage-setup form controls, which settle three of the v1 defects by
 * construction. These test the behaviours the defects were about, directly.
 */

import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { NumberField, Select, Segmented } from '../src/components/ui.jsx';

afterEach(cleanup);

test('NumberField accepts typing, not just the steppers (v1 defect #9)', () => {
  const seen = [];
  const { container } = render(
    <NumberField label="Thinking Time" value={30} min={0} max={300} onChange={(n) => seen.push(n)} />
  );
  const input = within(container).getByLabelText('Thinking Time');

  // Typing a value commits it — the whole point of the defect fix.
  fireEvent.change(input, { target: { value: '45' } });
  expect(seen.at(-1)).toBe(45);

  // Out-of-range typing is clamped, not rejected outright.
  fireEvent.change(input, { target: { value: '999' } });
  expect(seen.at(-1)).toBe(300);

  // An empty box mid-retype is legal and holds the last good value on blur.
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);
  expect(seen.at(-1)).toBe(300);

  // The steppers still work — stepping off the `value` prop (30 here, since this
  // harness holds it fixed) rather than off the draft.
  fireEvent.click(within(container).getByRole('button', { name: /Increase/ }));
  expect(seen.at(-1)).toBe(31);
});

test('NumberField steppers move by one and respect bounds', () => {
  const seen = [];
  const { container } = render(
    <NumberField ariaLabel="Rotations" value={2} min={1} max={5} onChange={(n) => seen.push(n)} />
  );
  fireEvent.click(within(container).getByRole('button', { name: /Decrease/ }));
  expect(seen.at(-1)).toBe(1);
});

test('Select stays open until an explicit choice, and closes on it (v1 defect #7)', () => {
  const seen = [];
  const { container, baseElement } = render(
    <Select
      label="Who Selects Next"
      value="registration"
      onChange={(v) => seen.push(v)}
      options={[
        { value: 'registration', label: 'Registration Order' },
        { value: 'winnerFirst', label: 'Winner First' },
        { value: 'loserFirst', label: 'Loser First' },
      ]}
    />
  );

  // Open it.
  fireEvent.click(within(container).getByRole('button', { name: /Registration Order/ }));
  const list = () => within(baseElement).queryByRole('listbox');
  expect(list()).toBeTruthy();

  // A stray click on the backdrop does NOT dismiss it — this is the defect: the
  // v1 dropdown auto-closed on the first outside interaction.
  const backdrop = baseElement.querySelector('[aria-hidden="true"]');
  fireEvent.click(backdrop);
  expect(list()).toBeTruthy();

  // Only an explicit option choice commits and closes.
  fireEvent.click(within(baseElement).getByRole('option', { name: /Winner First/ }));
  expect(seen.at(-1)).toBe('winnerFirst');
  expect(list()).toBeNull();
});

test('Select closes on Cancel and on Escape without changing the value', () => {
  const seen = [];
  const opts = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];
  const { container, baseElement } = render(
    <Select label="Pick" value="a" onChange={(v) => seen.push(v)} options={opts} />
  );

  fireEvent.click(within(container).getByRole('button', { name: 'Alpha' }));
  fireEvent.click(within(baseElement).getByRole('button', { name: 'Cancel' }));
  expect(within(baseElement).queryByRole('listbox')).toBeNull();

  fireEvent.click(within(container).getByRole('button', { name: 'Alpha' }));
  act(() => {
    fireEvent.keyDown(window, { key: 'Escape' });
  });
  expect(within(baseElement).queryByRole('listbox')).toBeNull();
  expect(seen).toEqual([]); // neither dismissal changed the value
});

test('Segmented is always-visible radios — nothing to auto-dismiss', () => {
  const seen = [];
  const { container } = render(
    <Segmented
      label="Penalty"
      value="off"
      onChange={(v) => seen.push(v)}
      options={[
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ]}
    />
  );
  const on = within(container).getByRole('radio', { name: 'On' });
  fireEvent.click(on);
  expect(seen.at(-1)).toBe('on');
  expect(within(container).getByRole('radio', { name: 'Off' })).toBeTruthy();
});
