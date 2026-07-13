/**
 * @file EEXR audit record generator.
 *
 * Joins an exposure-tree JSON dump (pulled from the live RTDB) against the local
 * question bank (public/questions/*.md) and emits a named audit record of every
 * question consumed on a given match day.
 *
 * WHY: exposure is written at Reveal as `exposure/<slug>/<id> = <epoch ms>`
 * (src/state/exposure.js). That timestamp is the only per-question record a match
 * leaves behind — there is no session label in the schema — so "which questions did
 * today's match burn?" is answered by filtering the tree to the match date and
 * joining ids back to the bank for human-readable text.
 *
 * USAGE (run on a machine that has the dump; no network needed by this script):
 *   1. Export the live tree first (PowerShell / curl), e.g.:
 *        curl "https://stack-ep5-default-rtdb.asia-southeast1.firebasedatabase.app/exposure.json" -o exposure-dump.json
 *   2. node scripts/eexr-audit.mjs --dump=exposure-dump.json --date=2026-07-12 --title="EEXR 07-12"
 *
 * FLAGS:
 *   --dump=<path>    Required. The exposure.json dump.
 *   --date=<YYYY-MM-DD>  Match day in Asia/Singapore (UTC+8). Default: newest non-legacy day in the dump.
 *   --title=<str>    Record title / output filename stem. Default: "EEXR <date>".
 *   --out=<dir>      Output directory. Default: current directory.
 *   --tz=<hours>     UTC offset for day bucketing. Default: 8 (asia-southeast1).
 *
 * OUTPUT: <title>.md (readable record) and <title>.csv (opens in Excel).
 * With no --date it prints a per-day breakdown so you can see which day to pick.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BANK_DIR = join(ROOT, 'public', 'questions');

// The legacy import stamp (scripts/migrate-exposure.mjs) — these 230 refs were
// pre-loaded from used-legacy.json, never "played", so they are excluded.
const LEGACY_STAMP = 1783065124912;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a, true];
  }),
);
const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};
if (!args.dump) die('Missing --dump=<path to exposure.json>. See the header of this file for usage.');
const TZ = args.tz != null ? Number(args.tz) : 8;

// ---------------------------------------------------------------------------
// bank: slug -> { name, questions: { id -> {dif, q, options[], answer, fact} } }
// ---------------------------------------------------------------------------
function parseBankFile(text) {
  const lines = text.split(/\r?\n/);
  let name = '';
  const questions = {};
  let cur = null;
  const flush = () => {
    if (cur && cur.id) questions[cur.id] = cur;
  };
  for (const line of lines) {
    const cat = /^#\s*Category:\s*(.+)$/.exec(line);
    if (cat) { name = cat[1].trim(); continue; }
    const head = /^##\s+(\S+)\s*$/.exec(line);
    if (head) {
      flush();
      const id = head[1];
      const dif = /^([EMH])\d+$/.exec(id)?.[1] ?? '?';
      cur = { id, dif, q: '', options: [], answer: '', fact: '' };
      continue;
    }
    if (!cur) continue;
    const q = /^Q:\s*(.*)$/.exec(line);
    if (q) { cur.q = q[1].trim(); continue; }
    const opt = /^([A-D])\)\s*(.*)$/.exec(line);
    if (opt) { cur.options.push({ letter: opt[1], text: opt[2].trim() }); continue; }
    const ans = /^Answer:\s*([A-D])/.exec(line);
    if (ans) { cur.answer = ans[1]; continue; }
    const fact = /^Fact:\s*(.*)$/.exec(line);
    if (fact) { cur.fact = fact[1].trim(); continue; }
  }
  flush();
  return { name, questions };
}

function loadBank() {
  const bank = {};
  for (const file of readdirSync(BANK_DIR)) {
    if (!file.endsWith('.md')) continue;
    const slug = file.replace(/\.md$/, '');
    bank[slug] = parseBankFile(readFileSync(join(BANK_DIR, file), 'utf8'));
  }
  return bank;
}

// ---------------------------------------------------------------------------
// date helpers (bucket by local calendar day at the given UTC offset)
// ---------------------------------------------------------------------------
const dayKey = (ts) => new Date(ts + TZ * 3600_000).toISOString().slice(0, 10);
const timeStr = (ts) => new Date(ts + TZ * 3600_000).toISOString().slice(11, 16);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const tree = JSON.parse(readFileSync(resolve(process.cwd(), args.dump), 'utf8'));
const bank = loadBank();

// Flatten to played entries (exclude the legacy pre-load).
const entries = [];
for (const [slug, ids] of Object.entries(tree || {})) {
  if (!ids || typeof ids !== 'object') continue;
  for (const [id, ts] of Object.entries(ids)) {
    if (typeof ts !== 'number' || ts === LEGACY_STAMP) continue;
    entries.push({ slug, id, ts });
  }
}

if (entries.length === 0) {
  die('No non-legacy exposure entries found in the dump — nothing was played after the initial import, or the dump is the legacy tree only.');
}

// Per-day breakdown.
const byDay = {};
for (const e of entries) (byDay[dayKey(e.ts)] ||= []).push(e);
const days = Object.keys(byDay).sort();

if (!args.date) {
  console.log('\n  Played-question days in this dump (Asia/Singapore, UTC+' + TZ + '):\n');
  for (const d of days) console.log(`    ${d}  —  ${byDay[d].length} questions`);
  console.log(`\n  Re-run with --date=${days[days.length - 1]} (or another day) to generate the record.\n`);
  process.exit(0);
}

const target = args.date;
const rows = (byDay[target] || []).slice().sort((a, b) => a.ts - b.ts);
if (rows.length === 0) {
  die(`No questions found for ${target}. Available days: ${days.join(', ')}`);
}

const title = args.title || `EEXR ${target}`;
const outDir = args.out ? resolve(process.cwd(), args.out) : process.cwd();

// Enrich + count.
const enriched = rows.map((e, i) => {
  const cat = bank[e.slug];
  const qn = cat?.questions?.[e.id];
  const ansText = qn?.options?.find((o) => o.letter === qn.answer)?.text || '';
  return {
    n: i + 1,
    time: timeStr(e.ts),
    category: cat?.name || e.slug,
    slug: e.slug,
    difficulty: { E: 'Easy', M: 'Medium', H: 'Hard', '?': '?' }[qn?.dif || '?'],
    id: e.id,
    question: qn?.q || '(not found in local bank — archived or renamed category?)',
    answer: qn ? `${qn.answer}) ${ansText}` : '',
    fact: qn?.fact || '',
  };
});

const byCat = {};
const byDif = {};
for (const r of enriched) {
  byCat[r.category] = (byCat[r.category] || 0) + 1;
  byDif[r.difficulty] = (byDif[r.difficulty] || 0) + 1;
}

// ---- Markdown ----
const md = [];
md.push(`# ${title} — Exposed-Question Audit`);
md.push('');
md.push(`_Match day: ${target} (Asia/Singapore). Questions consumed: **${enriched.length}**. `);
md.push(`Source: live exposure tree (\`exposure/<slug>/<id>\`), written at Reveal. These are now excluded from all future games._`);
md.push('');
md.push(`## Summary`);
md.push('');
md.push(`- **Total played:** ${enriched.length}`);
md.push(`- **By difficulty:** ` + Object.entries(byDif).map(([k, v]) => `${k} ${v}`).join(' · '));
md.push(`- **By category:** ` + Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', '));
md.push('');
md.push(`## Questions`);
md.push('');
md.push(`| # | Time | Category | Difficulty | ID | Question | Correct answer |`);
md.push(`|---|---|---|---|---|---|---|`);
for (const r of enriched) {
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  md.push(`| ${r.n} | ${r.time} | ${esc(r.category)} | ${r.difficulty} | ${r.id} | ${esc(r.question)} | ${esc(r.answer)} |`);
}
md.push('');
writeFileSync(join(outDir, `${title}.md`), md.join('\n'), 'utf8');

// ---- CSV ----
const csvEsc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [['#', 'Time', 'Category', 'Slug', 'Difficulty', 'ID', 'Question', 'Correct answer', 'Fact']
  .map(csvEsc).join(',')];
for (const r of enriched) {
  csv.push([r.n, r.time, r.category, r.slug, r.difficulty, r.id, r.question, r.answer, r.fact].map(csvEsc).join(','));
}
writeFileSync(join(outDir, `${title}.csv`), csv.join('\n'), 'utf8');

console.log(`\n  ${title}: ${enriched.length} questions on ${target}.`);
console.log(`  Wrote:\n    ${join(outDir, `${title}.md`)}\n    ${join(outDir, `${title}.csv`)}\n`);
