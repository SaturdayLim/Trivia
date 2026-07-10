/**
 * @file Cross-game exposure memory (V2-5, PRD §4 "Exposure"): which questions
 * have already been shown, so they never come up again in a future game.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ISN'T AN ADAPTER PATH
 * ---------------------------------------------------------------------------
 * Every `sync.update(path, …)` in this app is relative to `rooms/<roomCode>`
 * (see driver-firebase.js's `roomRef`). Exposure is deliberately NOT per-room:
 * PRD §2 puts it at the database root as `exposure/<categoryId>/<questionId>`
 * so it outlives the room that wrote it. The sync adapter therefore cannot
 * address it at all, and exposure gets its own tiny store with its own
 * pluggable backend — the same swappable-driver idea, one level up.
 *
 * Backends (all implement `{read, merge, remove, watch?}`):
 *   - `createFirebaseExposureBackend()` — the real thing, RTDB root.
 *   - `createLocalExposureBackend()`    — localStorage; pairs with the mock
 *     driver so an offline single-device game still remembers (V2-21).
 *   - `createMemoryExposureBackend()`   — tests.
 *
 * ---------------------------------------------------------------------------
 * SHAPE
 * ---------------------------------------------------------------------------
 *   exposure/<slug>/<questionId> = <epoch ms when it was revealed>
 *
 * The timestamp (rather than `true`) costs nothing and answers "when did we
 * last use this?" for the Admin UI's exposure panel (ADMIN-UI-BRIEF §4).
 * `board.buildBoard` wants `usedRefs` as `"<slug>:<id>"` strings, which is
 * what `toRefs` produces — the engine stays untouched.
 */

import { parseRef } from '../engine/questions.js';

/** @typedef {Object<string, Object<string, number>>} ExposureTree */

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/**
 * Fold `"<slug>:<id>"` refs into an exposure tree stamped with `at`.
 * @param {string[]} refs
 * @param {number} at - epoch ms.
 * @returns {ExposureTree}
 */
export function refsToTree(refs, at) {
  const tree = {};
  for (const ref of refs) {
    const { slug, id } = parseRef(ref);
    if (!tree[slug]) tree[slug] = {};
    tree[slug][id] = at;
  }
  return tree;
}

/**
 * Flatten an exposure tree back to sorted `"<slug>:<id>"` refs — the form
 * `board.buildBoard({usedRefs})` consumes.
 * @param {?ExposureTree} tree
 * @returns {string[]}
 */
export function toRefs(tree) {
  const refs = [];
  for (const [slug, ids] of Object.entries(tree || {})) {
    if (!ids || typeof ids !== 'object') continue;
    for (const id of Object.keys(ids)) refs.push(`${slug}:${id}`);
  }
  return refs.sort();
}

/**
 * @param {?ExposureTree} tree
 * @param {string} ref
 * @returns {boolean}
 */
export function isExposed(tree, ref) {
  const { slug, id } = parseRef(ref);
  return Boolean(tree && tree[slug] && tree[slug][id] != null);
}

/**
 * @param {?ExposureTree} tree
 * @param {string} slug
 * @returns {Set<string>} the question ids of `slug` already exposed.
 */
export function exposedIds(tree, slug) {
  return new Set(Object.keys((tree && tree[slug]) || {}));
}

/**
 * How many questions of `slug` remain undrawn — the "available count" the host's
 * category tiles show (PRD §3.2), and what makes a category unselectable at 0.
 * @param {?ExposureTree} tree
 * @param {{slug: string, questions: Array<{id: string}>}} category
 * @returns {number}
 */
export function availableCount(tree, category) {
  const used = exposedIds(tree, category.slug);
  return category.questions.filter((q) => !used.has(q.id)).length;
}

/**
 * Deep-merge `patch` into `base` (both exposure trees), returning a new tree.
 * Later timestamps never overwrite earlier ones: the first exposure is the one
 * worth remembering, and a re-merge of the same legacy data must be idempotent.
 * @param {?ExposureTree} base
 * @param {?ExposureTree} patch
 * @returns {ExposureTree}
 */
export function mergeTrees(base, patch) {
  const out = {};
  for (const [slug, ids] of Object.entries(base || {})) out[slug] = { ...ids };
  for (const [slug, ids] of Object.entries(patch || {})) {
    if (!out[slug]) out[slug] = {};
    for (const [id, at] of Object.entries(ids || {})) {
      const existing = out[slug][id];
      out[slug][id] = typeof existing === 'number' ? Math.min(existing, at) : at;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ExposureBackend
 * @property {() => Promise<?ExposureTree>} read
 * @property {(tree: ExposureTree) => Promise<void>} merge - deep-merge, not replace.
 * @property {(slug: ?string) => Promise<void>} remove - one category, or all when null.
 * @property {(cb: (tree: ExposureTree) => void) => (() => void)} [watch]
 */

/**
 * Wrap a backend with a cached snapshot, so hot paths (`isExposed` per tile,
 * per question) stay synchronous after one `load()`.
 * @param {ExposureBackend} backend
 * @returns {Object}
 */
export function createExposureStore(backend) {
  /** @type {ExposureTree} */
  let cache = {};
  let loaded = false;
  const subs = new Set();

  function publish() {
    for (const cb of subs) cb(snapshot());
  }

  /** @returns {ExposureTree} a defensive copy of the cached tree. */
  function snapshot() {
    return mergeTrees(cache, {});
  }

  return {
    /** Pull the authoritative tree into cache. Call once before drawing a board. */
    async load() {
      cache = (await backend.read()) || {};
      loaded = true;
      publish();
      return snapshot();
    },

    /** @returns {boolean} true once `load()` has resolved at least once. */
    get isLoaded() {
      return loaded;
    },

    snapshot,

    /** @param {string} ref @returns {boolean} */
    isExposed(ref) {
      return isExposed(cache, ref);
    },

    /** @returns {string[]} every exposed ref — feed straight to `buildBoard`. */
    usedRefs() {
      return toRefs(cache);
    },

    /**
     * Record refs as exposed. Called at reveal (PRD §4), via
     * `actions.revealQuestion`'s `onUsedRef` hook — the engine never learns
     * that exposure moved out of localStorage.
     * @param {string[]|string} refs
     * @param {number} at - epoch ms (`sync.serverNow()`).
     */
    async record(refs, at) {
      const list = Array.isArray(refs) ? refs : [refs];
      if (list.length === 0) return;
      const patch = refsToTree(list, at);
      cache = mergeTrees(cache, patch);
      publish();
      await backend.merge(patch);
    },

    /**
     * Host: reset exposure for one category (unlocks a depleted category, PRD
     * §3.2) or, with no slug, for everything.
     * @param {?string} [slug]
     */
    async reset(slug = null) {
      if (slug) {
        const next = { ...cache };
        delete next[slug];
        cache = next;
      } else {
        cache = {};
      }
      publish();
      await backend.remove(slug);
    },

    /**
     * Subscribe to cache changes (local writes always; remote writes too when
     * the backend supports `watch`). Fires immediately with the current tree.
     * @param {(tree: ExposureTree) => void} cb
     * @returns {() => void} unsubscribe
     */
    subscribe(cb) {
      subs.add(cb);
      cb(snapshot());
      let unwatch = null;
      if (typeof backend.watch === 'function') {
        unwatch = backend.watch((tree) => {
          cache = tree || {};
          publish();
        });
      }
      return () => {
        subs.delete(cb);
        if (unwatch) unwatch();
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** Root path of the global exposure tree. */
export const EXPOSURE_ROOT = 'exposure';

/**
 * In-memory backend. Tests, and any caller that wants a throwaway store.
 * @param {ExposureTree} [initial]
 * @returns {ExposureBackend}
 */
export function createMemoryExposureBackend(initial = {}) {
  let tree = mergeTrees(initial, {});
  return {
    async read() {
      return mergeTrees(tree, {});
    },
    async merge(patch) {
      tree = mergeTrees(tree, patch);
    },
    async remove(slug) {
      if (slug) {
        const next = { ...tree };
        delete next[slug];
        tree = next;
      } else {
        tree = {};
      }
    },
  };
}

const LOCAL_KEY = 'stack-exposure';

/**
 * localStorage backend — the offline/mock-driver counterpart (V2-21). Same
 * degrade-to-no-op discipline as `engine/storage.js`: a disabled or full
 * storage means exposure isn't remembered, never a thrown error mid-game.
 * @returns {ExposureBackend}
 */
export function createLocalExposureBackend(key = LOCAL_KEY) {
  const readRaw = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };
  const writeRaw = (tree) => {
    try {
      localStorage.setItem(key, JSON.stringify(tree));
    } catch {
      /* storage unavailable — degrade to in-memory for this session */
    }
  };
  return {
    async read() {
      return readRaw();
    },
    async merge(patch) {
      writeRaw(mergeTrees(readRaw(), patch));
    },
    async remove(slug) {
      if (!slug) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        return;
      }
      const next = readRaw();
      delete next[slug];
      writeRaw(next);
    },
  };
}

/**
 * Firebase RTDB backend, rooted at `/exposure` — outside `rooms/<code>`, so it
 * survives every room. Needs the `exposure` rule from docs/FIREBASE-SETUP.md §4
 * (the default locked-mode rules deny it).
 *
 * `merge` uses `ref.update()` with slash-joined keys, which patches only the
 * named children: two hosts revealing questions in different categories at the
 * same moment can't clobber each other, and nothing else under `/exposure` is
 * touched. A whole-tree `set()` would.
 *
 * @returns {ExposureBackend}
 */
export function createFirebaseExposureBackend() {
  let rootRefPromise = null;
  async function rootRef() {
    if (!rootRefPromise) {
      rootRefPromise = import('../sync/driver-firebase.js')
        .then((mod) => mod.getDatabase())
        .then(({ rtdb }) => rtdb.ref(EXPOSURE_ROOT))
        .catch((err) => {
          rootRefPromise = null; // let a later call retry once config/SDK is fixed
          throw err;
        });
    }
    return rootRefPromise;
  }

  return {
    async read() {
      const ref = await rootRef();
      // `once('value')` rather than `get()`: both exist on the compat SDK, but
      // `once` has been in the namespaced API since v3 — one less version floor.
      const snap = await ref.once('value');
      return snap.val() || {};
    },
    async merge(patch) {
      const ref = await rootRef();
      /** @type {Object<string, number>} */
      const flat = {};
      for (const [slug, ids] of Object.entries(patch)) {
        for (const [id, at] of Object.entries(ids)) flat[`${slug}/${id}`] = at;
      }
      if (Object.keys(flat).length === 0) return;
      await ref.update(flat);
    },
    async remove(slug) {
      const ref = await rootRef();
      await (slug ? ref.child(slug).remove() : ref.remove());
    },
    watch(cb) {
      let off = null;
      let cancelled = false;
      rootRef().then((ref) => {
        if (cancelled) return;
        const handler = (snap) => cb(snap.val() || {});
        ref.on('value', handler);
        off = () => ref.off('value', handler);
      });
      return () => {
        cancelled = true;
        if (off) off();
      };
    },
  };
}
