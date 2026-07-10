/**
 * Migrate v1's used-question memory into the v2 global exposure tree (V2-5).
 *
 *   node scripts/migrate-exposure.mjs              # dry run (default)
 *   node scripts/migrate-exposure.mjs --commit     # actually write to RTDB
 *   node scripts/migrate-exposure.mjs --commit --db=<databaseURL>
 *
 * Source: public/questions/used-legacy.json — 230 `"<slug>:<id>"` refs mined
 * from the v6 workbook's Archive column on 2026-07-03.
 * Target: `exposure/<slug>/<id> = <epoch ms>` at the database root.
 *
 * WRITE STRATEGY: one REST `PATCH /exposure/<slug>.json` per category, whose
 * body names only that category's question ids. PATCH merges children, so a
 * re-run is idempotent and — crucially — a category that has accumulated real
 * exposures since the last run keeps them. The tempting single
 * `PATCH /exposure.json` with a nested body instead replaces each category
 * child wholesale, which would silently drop them.
 *
 * TIMESTAMP: every legacy ref is stamped with the moment the v6 workbook was
 * imported, not "now". These questions were exposed at some unknown point
 * before that date; the import is the earliest instant we can honestly claim.
 *
 * RULES: the default RTDB rules deny `/exposure` outright (locked mode). Paste
 * firebase-rules.json into the console's Rules tab before running with
 * --commit, or every request comes back 401 Permission denied.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The v6 legacy import (see public/questions/import-report.txt line 1). */
const LEGACY_AT = Date.parse('2026-07-03T07:52:04.912Z');

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const dbArg = args.find((a) => a.startsWith('--db='));

function die(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// --- inputs ----------------------------------------------------------------

const legacyPath = resolve(ROOT, 'public/questions/used-legacy.json');
let refs;
try {
  refs = JSON.parse(readFileSync(legacyPath, 'utf8'));
} catch (e) {
  die(`cannot read ${legacyPath}: ${e.message}`);
}
if (!Array.isArray(refs)) die('used-legacy.json must be a JSON array of "<slug>:<id>" refs');

async function databaseUrl() {
  if (dbArg) return dbArg.slice('--db='.length);
  const cfgPath = resolve(ROOT, 'src/sync/firebase-config.js');
  const mod = await import(`file://${cfgPath}`).catch((e) => die(`cannot load firebase-config.js: ${e.message}`));
  const url = mod.default && mod.default.databaseURL;
  if (!url) die('firebase-config.js has no databaseURL');
  return url.replace(/\/$/, '');
}

// --- transform -------------------------------------------------------------

/** @returns {{tree: Object, bad: string[]}} */
function buildTree(list) {
  const tree = {};
  const bad = [];
  for (const ref of list) {
    if (typeof ref !== 'string') {
      bad.push(String(ref));
      continue;
    }
    const i = ref.indexOf(':');
    const slug = ref.slice(0, i);
    const id = ref.slice(i + 1);
    if (i === -1 || !slug || !/^[EMH]\d+$/.test(id)) {
      bad.push(ref);
      continue;
    }
    if (!tree[slug]) tree[slug] = {};
    tree[slug][id] = LEGACY_AT;
  }
  return { tree, bad };
}

const { tree, bad } = buildTree(refs);
const slugs = Object.keys(tree).sort();
const total = slugs.reduce((n, s) => n + Object.keys(tree[s]).length, 0);

console.log(`\n  stack v2 — exposure migration (V2-5)`);
console.log(`  source : ${legacyPath.replace(ROOT, '.')}`);
console.log(`  refs   : ${refs.length} read, ${total} valid, ${bad.length} rejected`);
console.log(`  stamp  : ${LEGACY_AT} (${new Date(LEGACY_AT).toISOString()})`);
console.log(`  shape  : exposure/<slug>/<id> = <epoch ms>`);
console.log(`  ${slugs.length} categories:\n`);
for (const slug of slugs) {
  const ids = Object.keys(tree[slug]).sort();
  console.log(`    ${slug.padEnd(32)} ${String(ids.length).padStart(3)}  ${ids.join(' ')}`);
}
if (bad.length) {
  console.log(`\n  rejected refs (not "<slug>:<E|M|H><n>"):`);
  for (const b of bad) console.log(`    ${b}`);
}

if (!commit) {
  console.log(`\n  DRY RUN — nothing written. Re-run with --commit to write ${total} refs to Firebase.`);
  console.log(`  First paste firebase-rules.json into the RTDB console's Rules tab, or /exposure stays denied.\n`);
  process.exit(0);
}

// --- write -----------------------------------------------------------------

const base = await databaseUrl();
console.log(`\n  COMMIT -> ${base}/exposure\n`);

let written = 0;
for (const slug of slugs) {
  const url = `${base}/exposure/${encodeURIComponent(slug)}.json`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tree[slug]),
  });
  if (!res.ok) {
    const body = await res.text();
    die(`PATCH ${slug} -> HTTP ${res.status} ${body.trim()}\n    (401 = the exposure rule is missing; see firebase-rules.json)`);
  }
  written += Object.keys(tree[slug]).length;
  console.log(`    ✓ ${slug.padEnd(32)} ${Object.keys(tree[slug]).length}`);
}

// --- verify ----------------------------------------------------------------

const verify = await fetch(`${base}/exposure.json`);
if (!verify.ok) die(`readback failed: HTTP ${verify.status}`);
const remote = await verify.json();
const remoteTotal = Object.values(remote || {}).reduce((n, ids) => n + Object.keys(ids || {}).length, 0);

console.log(`\n  wrote ${written} refs across ${slugs.length} categories`);
console.log(`  readback: ${Object.keys(remote || {}).length} categories, ${remoteTotal} refs live in exposure/`);
if (remoteTotal < total) die(`readback is short by ${total - remoteTotal} refs`);
console.log(`\n  ✓ migration complete — visible in the Firebase console under exposure/\n`);
