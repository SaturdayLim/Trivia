/**
 * @file Pure board-drawing engine for the Stack trivia game (PRD §4.7). No
 * DOM, no sync, no randomness beyond the injected `rng` — safe to unit-test
 * deterministically by passing a seeded generator.
 */

/** @typedef {'E'|'M'|'H'} Difficulty */
/** @typedef {Object<Difficulty, string[]>} TierMap - question ids remaining per tier. */
/** @typedef {Object<string, TierMap>} Board - keyed by category slug. */

const DIFFICULTIES = ['E', 'M', 'H'];

/** Pick up to `n` random, distinct entries from `arr` (never mutates `arr`). */
function pickRandom(arr, n, rng) {
  const pool = arr.slice();
  const picked = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/**
 * Build a fresh board: for each `settings.categories` slug present in
 * `categories`, draw min(tierSize, available) random fresh question ids per
 * difficulty (excluding `usedRefs` when `settings.excludeUsed`).
 * @param {Object} opts
 * @param {Array<{slug: string, questions: Array<{id: string, dif: Difficulty}>}>} opts.categories
 * @param {Object} opts.settings
 * @param {string[]} opts.settings.categories - slugs to include on the board.
 * @param {number} opts.settings.tierSize
 * @param {boolean} opts.settings.excludeUsed
 * @param {Set<string>|string[]} [opts.usedRefs] - refs ("slug:id") to exclude.
 * @param {() => number} [opts.rng] - returns a float in [0,1); default Math.random.
 * @returns {{board: Board, drawn: string[]}} `drawn` = every ref placed, flat.
 */
export function buildBoard({ categories, settings, usedRefs = [], rng = Math.random }) {
  const used = usedRefs instanceof Set ? usedRefs : new Set(usedRefs);
  const wantSlugs = new Set(settings.categories);
  const board = {};
  const drawn = [];

  for (const cat of categories) {
    if (!wantSlugs.has(cat.slug)) continue;
    const tiers = {};
    for (const dif of DIFFICULTIES) {
      const pool = cat.questions
        .filter((q) => q.dif === dif)
        .map((q) => q.id)
        .filter((id) => !(settings.excludeUsed && used.has(`${cat.slug}:${id}`)));
      tiers[dif] = pickRandom(pool, settings.tierSize, rng);
      for (const id of tiers[dif]) drawn.push(`${cat.slug}:${id}`);
    }
    board[cat.slug] = tiers;
  }
  return { board, drawn };
}

/**
 * Randomly draw one question id out of `board[slug][dif]`, removing it.
 * Immutable: returns a new board; `board` itself is untouched.
 * @param {Board} board
 * @param {string} slug
 * @param {Difficulty} dif
 * @param {() => number} [rng]
 * @returns {{ref: ?string, board: Board}} `ref` is null (board unchanged) when the tier is already empty.
 */
export function drawQuestion(board, slug, dif, rng = Math.random) {
  const tier = (board[slug] && board[slug][dif]) || [];
  if (tier.length === 0) return { ref: null, board };
  const idx = Math.floor(rng() * tier.length);
  const id = tier[idx];
  const newTier = tier.slice(0, idx).concat(tier.slice(idx + 1));
  const newBoard = { ...board, [slug]: { ...board[slug], [dif]: newTier } };
  return { ref: `${slug}:${id}`, board: newBoard };
}

/**
 * @param {Board} board
 * @param {string} slug
 * @param {Difficulty} dif
 * @returns {boolean} true when `board[slug][dif]` has no ids left.
 */
export function tierEmpty(board, slug, dif) {
  const tier = board[slug] && board[slug][dif];
  return !(tier && tier.length > 0);
}

/**
 * @param {Board} board
 * @param {string} slug
 * @returns {boolean} true when every difficulty tier in `slug` is empty.
 */
export function categoryEmpty(board, slug) {
  return DIFFICULTIES.every((dif) => tierEmpty(board, slug, dif));
}

/**
 * @param {Board} board
 * @returns {boolean} true when every category on the board is empty.
 */
export function boardEmpty(board) {
  return Object.keys(board).every((slug) => categoryEmpty(board, slug));
}
