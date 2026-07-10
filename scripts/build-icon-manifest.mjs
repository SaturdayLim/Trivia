/**
 * Regenerate public/icons/manifest.json — the list of category-icon files the
 * browser may assume exist. Logos are excluded (they are not category icons).
 * Run after adding or removing an icon PNG:  node scripts/build-icon-manifest.mjs
 */
import { readdirSync, writeFileSync } from 'node:fs';

const DIR = 'public/icons';
const files = readdirSync(DIR)
  .filter((f) => /\.png$/i.test(f) && !/^Logo_/i.test(f))
  .sort();

writeFileSync(`${DIR}/manifest.json`, JSON.stringify(files, null, 1) + '\n');
console.log(`icons/manifest.json: ${files.length} category icons`);
