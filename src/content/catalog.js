/**
 * @file The Category catalog the Host picks from, and the small directory the
 * rest of the room gets instead.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY THE HOST LOADS THE QUESTION BANK
 * ---------------------------------------------------------------------------
 * `loadCategories()` fetches `questions/index.json` and then one Markdown file
 * per Category — 58 requests. The Host must do it: they are the authority, they
 * draw the board, and they read the answer and the fun fact off their own phone
 * (PRD §3.2 step 5), which is precisely why the answer never goes on the wire.
 *
 * Players and Displays need none of that. They need a Category's *name* and
 * *icon* to draw a tile, and the board (already synced) tells them what remains.
 * So the Host writes a `categoryMeta` directory into `settings` at Confirm —
 * one small object, one write — and thirty phones fetch nothing.
 */

import { loadCategories } from '../engine/questions.js';
import { loadIconManifest, resolveIcons } from './icons.js';
import { availableCount, exposedIds } from '../state/exposure.js';

/**
 * Attach a resolved icon and a 1-based board position to each Category. The
 * position is what the numbered-circle fallback draws (V2-8), so it has to be
 * decided in one pass over the whole list, not per tile.
 * @param {Array<Object>} categories - from `loadCategories`.
 * @param {Map<string, string>|string[]} manifest
 * @returns {Array<Object>} each category plus `{iconSrc: ?string, n: number}`
 */
export function withIcons(categories, manifest) {
  const icons = resolveIcons(categories, { manifest });
  return categories.map((cat, i) => ({
    ...cat,
    n: i + 1,
    iconSrc: icons[i].kind === 'image' ? icons[i].src : null,
  }));
}

/**
 * Per-Category availability against the exposure tree (V2-5): how many questions
 * have never been shown, and how many remain in each tier. A Category at zero is
 * unselectable until the Host resets its exposure (PRD §3.2 step 2).
 * @param {?Object} exposureTree
 * @param {Array<Object>} categories - with `questions`.
 * @returns {Array<Object>} each category plus `{available, tiers: {E,M,H}, depleted}`
 */
export function withAvailability(exposureTree, categories) {
  return categories.map((cat) => {
    const used = exposedIds(exposureTree, cat.slug);
    const tiers = { E: 0, M: 0, H: 0 };
    for (const q of cat.questions) {
      if (!used.has(q.id)) tiers[q.dif] += 1;
    }
    const available = availableCount(exposureTree, cat);
    return { ...cat, available, tiers, depleted: available === 0 };
  });
}

/**
 * The directory written into `settings.categoryMeta` at Confirm — everything a
 * Player or Display needs to render a Category tile, and nothing else.
 * @param {Array<Object>} categories - the full, icon-resolved list.
 * @param {string[]} slugs - the selected ones.
 * @returns {Object<string, {name: string, icon: ?string, n: number}>}
 */
export function buildCategoryMeta(categories, slugs) {
  const wanted = new Set(slugs);
  const meta = {};
  for (const cat of categories) {
    if (!wanted.has(cat.slug)) continue;
    meta[cat.slug] = { name: cat.name, icon: cat.iconSrc || null, n: cat.n };
  }
  return meta;
}

/**
 * Find the full question (text, options, answer, fact) behind a ref. The Host
 * calls this twice per question: once to put `{q, options}` on the wire, once at
 * reveal to name the correct letter. It never leaves the Host's device.
 * @param {Array<Object>} categories
 * @param {string} ref - "slug:id"
 * @returns {?Object}
 */
export function findQuestion(categories, ref) {
  if (!ref) return null;
  const i = ref.indexOf(':');
  const slug = ref.slice(0, i);
  const id = ref.slice(i + 1);
  const cat = categories.find((c) => c.slug === slug);
  if (!cat) return null;
  return cat.questions.find((q) => q.id === id) || null;
}

/**
 * The Quickstart preset (R8, PRD §8b): the fixed ten Categories a brand-new
 * room's Category step preselects, still fully editable — v1 decision #32's
 * board, already shipped as `public/questions/game-defaults.json`. Degrades
 * to no preselection if the file is missing or malformed, same posture as
 * `loadIconManifest`: Setup must never be blocked by a missing static file.
 * @returns {Promise<string[]>}
 */
export async function loadGameDefaults() {
  try {
    const res = await fetch('/questions/game-defaults.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.categories) ? data.categories.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Module-level cache: the bank is static, and StrictMode mounts twice. */
let catalogPromise = null;

/**
 * Load and decorate the whole Category bank, once per page load.
 * @returns {Promise<{categories: Array<Object>, errors: Array<Object>}>}
 */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [{ categories, errors }, manifest] = await Promise.all([
        loadCategories('/'),
        loadIconManifest(),
      ]);
      // Every Category in the bank, `archive-*` included — v1 showed them all
      // and nothing in the PRD retires them. Curating the bank is the Admin UI's
      // job (V2-6), not a filter quietly buried in a loader.
      return { categories: withIcons(categories, manifest), errors };
    })().catch((err) => {
      catalogPromise = null; // a failed fetch must not poison the next attempt
      throw err;
    });
  }
  return catalogPromise;
}
