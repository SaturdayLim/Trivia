// Cross-game exposure memory (src/state/exposure.js, V2-5) + the legacy
// used-legacy.json migration shape, + proof that an exposed question never
// comes back onto a board (the whole point of the tree).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import {
  availableCount,
  createExposureStore,
  createMemoryExposureBackend,
  exposedIds,
  isExposed,
  mergeTrees,
  refsToTree,
  toRefs,
} from '../src/state/exposure.js';
import { buildBoard } from '../src/engine/board.js';

test('pure core: refs <-> tree round-trip, exposure lookups', () => {
  const at = 1_700_000_000_000;
  const tree = refsToTree(['marvel:E1', 'marvel:H3', 'flags:M2'], at);

  assert.deepEqual(tree, {
    marvel: { E1: at, H3: at },
    flags: { M2: at },
  });
  assert.deepEqual(toRefs(tree), ['flags:M2', 'marvel:E1', 'marvel:H3'], 'sorted refs');

  assert.ok(isExposed(tree, 'marvel:E1'));
  assert.ok(!isExposed(tree, 'marvel:E2'));
  assert.ok(!isExposed(tree, 'ocean:E1'), 'unknown category');
  assert.ok(!isExposed(null, 'marvel:E1'), 'empty tree exposes nothing');

  assert.deepEqual([...exposedIds(tree, 'marvel')].sort(), ['E1', 'H3']);
  assert.deepEqual([...exposedIds(tree, 'nope')], []);

  assert.deepEqual(toRefs(null), []);
  assert.deepEqual(toRefs({ marvel: null }), [], 'a nulled category contributes nothing');
});

test('mergeTrees: additive, and the EARLIEST timestamp wins', () => {
  const early = { marvel: { E1: 100 } };
  const late = { marvel: { E1: 900, E2: 900 }, flags: { M1: 900 } };

  assert.deepEqual(mergeTrees(early, late), {
    marvel: { E1: 100, E2: 900 },
    flags: { M1: 900 },
  });

  // Idempotence is what makes re-running the migration safe.
  assert.deepEqual(mergeTrees(late, late), late);
  assert.deepEqual(mergeTrees(null, null), {});

  const base = { marvel: { E1: 100 } };
  mergeTrees(base, { marvel: { E2: 200 } });
  assert.deepEqual(base, { marvel: { E1: 100 } }, 'never mutates its inputs');
});

test('availableCount: counts what is left to draw in a category', () => {
  const cat = { slug: 'marvel', questions: [{ id: 'E1' }, { id: 'E2' }, { id: 'M1' }] };
  assert.equal(availableCount({}, cat), 3);
  assert.equal(availableCount({ marvel: { E1: 1 } }, cat), 2);
  assert.equal(availableCount({ marvel: { E1: 1, E2: 1, M1: 1 } }, cat), 0, 'depleted -> unselectable');
});

test('store: record / snapshot / usedRefs / reset(one) / reset(all)', async () => {
  const backend = createMemoryExposureBackend();
  const store = createExposureStore(backend);

  assert.equal(store.isLoaded, false);
  await store.load();
  assert.equal(store.isLoaded, true);
  assert.deepEqual(store.snapshot(), {});

  await store.record(['marvel:E1', 'marvel:M2'], 500);
  await store.record('flags:H1', 600);

  assert.ok(store.isExposed('marvel:E1'));
  assert.ok(store.isExposed('flags:H1'));
  assert.ok(!store.isExposed('flags:H2'));
  assert.deepEqual(store.usedRefs(), ['flags:H1', 'marvel:E1', 'marvel:M2']);

  // The cache is not the truth — a fresh store over the same backend agrees.
  const reread = createExposureStore(backend);
  assert.deepEqual(await reread.load(), { marvel: { E1: 500, M2: 500 }, flags: { H1: 600 } });

  await store.record([], 700); // no-op, no backend write
  assert.deepEqual(store.usedRefs(), ['flags:H1', 'marvel:E1', 'marvel:M2']);

  await store.reset('marvel');
  assert.deepEqual(store.usedRefs(), ['flags:H1'], 'host reset unlocks one category');
  assert.deepEqual(await createExposureStore(backend).load(), { flags: { H1: 600 } }, 'reset hit the backend');

  await store.reset();
  assert.deepEqual(store.usedRefs(), []);
  assert.deepEqual(await createExposureStore(backend).load(), {});
});

test('store: subscribe fires immediately and on every local write', async () => {
  const store = createExposureStore(createMemoryExposureBackend({ marvel: { E1: 1 } }));
  const seen = [];
  const unsub = store.subscribe((tree) => seen.push(toRefs(tree)));

  assert.deepEqual(seen, [[]], 'fires immediately with the (still empty) cache');
  await store.load();
  await store.record(['flags:M1'], 2);
  await store.reset('marvel');
  unsub();
  await store.record(['ocean:E1'], 3);

  assert.deepEqual(seen, [[], ['marvel:E1'], ['flags:M1', 'marvel:E1'], ['flags:M1']]);
  assert.equal(seen.length, 4, 'no callback after unsubscribe');
});

test('store: snapshot is a copy — callers cannot corrupt the cache', async () => {
  const store = createExposureStore(createMemoryExposureBackend({ marvel: { E1: 1 } }));
  await store.load();
  const snap = store.snapshot();
  snap.marvel.E1 = 999;
  delete snap.marvel.E1;
  assert.ok(store.isExposed('marvel:E1'), 'cache survived a hostile caller');
});

test('exposed questions are excluded from a freshly drawn board (V2-5 end to end)', async () => {
  const categories = [
    {
      slug: 'marvel',
      questions: [
        { id: 'E1', dif: 'E' }, { id: 'E2', dif: 'E' }, { id: 'E3', dif: 'E' },
        { id: 'M1', dif: 'M' }, { id: 'M2', dif: 'M' },
        { id: 'H1', dif: 'H' },
      ],
    },
  ];
  const store = createExposureStore(createMemoryExposureBackend());
  await store.load();
  await store.record(['marvel:E1', 'marvel:E2', 'marvel:M1'], 1);

  const settings = { categories: ['marvel'], tierSize: 3, excludeUsed: true };
  const { board, drawn } = buildBoard({ categories, settings, usedRefs: store.usedRefs(), rng: () => 0 });

  assert.deepEqual(board.marvel.E, ['E3'], 'only the unexposed Easy remains');
  assert.deepEqual(board.marvel.M, ['M2']);
  assert.deepEqual(board.marvel.H, ['H1']);
  assert.deepEqual(drawn.sort(), ['marvel:E3', 'marvel:H1', 'marvel:M2']);

  // Short tiers just contribute what they have (V2-17) — 3 wanted, 1 available.
  assert.equal(board.marvel.E.length, 1);
});

test('legacy migration: used-legacy.json maps cleanly onto the exposure shape', () => {
  const refs = JSON.parse(readFileSync(new URL('../public/questions/used-legacy.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(refs) && refs.length > 0);

  const bad = refs.filter((r) => typeof r !== 'string' || !/^[a-z0-9-]+:[EMH]\d+$/.test(r));
  assert.deepEqual(bad, [], 'every legacy ref parses as "<slug>:<E|M|H><n>"');

  const at = Date.parse('2026-07-03T07:52:04.912Z');
  const tree = refsToTree(refs, at);
  const total = Object.values(tree).reduce((n, ids) => n + Object.keys(ids).length, 0);

  assert.equal(total, new Set(refs).size, 'no ref lost or doubled in the fold');
  assert.equal(toRefs(tree).length, total);
  assert.ok(Object.keys(tree).length > 1, 'spans multiple categories');
  for (const ids of Object.values(tree)) {
    for (const stamp of Object.values(ids)) assert.equal(stamp, at, 'stamped with the v6 import instant');
  }
});
