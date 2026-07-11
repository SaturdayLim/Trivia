/**
 * @vitest-environment jsdom
 *
 * R8 regression (stack-v2 PRD §8b): a brand-new room's Category step
 * preselects the Quickstart Categories from `public/questions/game-defaults.json`
 * (v1 decision #32's board), still fully editable, and the edited selection —
 * not the raw preset — is what gets Confirmed.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { CATEGORIES } = vi.hoisted(() => ({
  CATEGORIES: ['marvel', 'desserts', 'flags', 'other-cat'].map((slug, i) => ({
    slug,
    name: slug,
    icon: null,
    iconSrc: null,
    n: i + 1,
    questions: [{ id: 'E1', dif: 'E', q: `${slug} E1?`, options: ['a', 'b', 'c', 'd'], answer: 'A', fact: '' }],
  })),
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

const { createSync } = await import('../src/sync/adapter.js');
const driverMock = await import('../src/sync/driver-mock.js');
const A = await import('../src/engine/actions.js');
const { default: Host } = await import('../src/screens/Host.jsx');

let fetchSpy;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
    if (String(url).includes('game-defaults.json')) {
      return Promise.resolve({ ok: true, json: async () => ({ categories: ['marvel', 'desserts', 'flags'] }) });
    }
    return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
  });
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

test('a brand-new room preselects the Quickstart Categories, editable (R8)', async () => {
  const roomCode = 'QSA1';
  const host = await createSync({
    driver: driverMock, roomCode, clientId: 'gm1', role: 'gm', create: true, initialState: {},
  });
  await A.createRoomState(host, 'gm', { clientId: 'gm1', hostPin: '1234', teams: [] });

  sessionStorage.setItem('stack-client-id', 'gm1');
  sessionStorage.setItem(`stack-hostpin-${roomCode}`, '1234');

  render(
    <MemoryRouter initialEntries={[`/host?room=${roomCode}`]}>
      <Routes>
        <Route path="/host" element={<Host />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(screen.getByText('Choose Your Categories')).toBeTruthy());

  // `getByRole('button', {name: /slug/i})` alone also matches the per-slug
  // NumberField steppers ("Increase/Decrease Questions per Tier for marvel"),
  // so scope to the tile — the only button with `aria-pressed`.
  const tile = (slug) =>
    screen.getAllByRole('button', { name: new RegExp(slug, 'i') }).find((b) => b.hasAttribute('aria-pressed'));

  // Preselected from the fetched preset, not empty.
  expect(tile('marvel').getAttribute('aria-pressed')).toBe('true');
  expect(tile('desserts').getAttribute('aria-pressed')).toBe('true');
  expect(tile('flags').getAttribute('aria-pressed')).toBe('true');
  expect(tile('other-cat').getAttribute('aria-pressed')).toBe('false');

  // Editable: deselect a default, select a non-default.
  await act(async () => {
    fireEvent.click(tile('marvel'));
  });
  expect(tile('marvel').getAttribute('aria-pressed')).toBe('false');
  await act(async () => {
    fireEvent.click(tile('other-cat'));
  });
  expect(tile('other-cat').getAttribute('aria-pressed')).toBe('true');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
  });

  // The edited set — not the raw preset — is what got Confirmed into the tree.
  await waitFor(() => {
    let tree;
    host.onChange('/', (t) => { tree = t; })();
    expect(tree.settings.categories.slice().sort()).toEqual(['desserts', 'flags', 'other-cat']);
  });
});
