// Category icon resolution (src/content/icons.js, V2-8) and the shipped
// manifest that backs it.
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'vitest';
import { indexManifest, resolveIcon, resolveIcons } from '../src/content/icons.js';

const MANIFEST = JSON.parse(readFileSync(new URL('../public/icons/manifest.json', import.meta.url), 'utf8'));

test('manifest matches what is actually on disk, logos excluded', () => {
  const onDisk = readdirSync(new URL('../public/icons', import.meta.url))
    .filter((f) => /\.png$/i.test(f) && !/^Logo_/i.test(f))
    .sort();
  assert.deepEqual([...MANIFEST].sort(), onDisk, 'run `npm run icons:manifest` after touching public/icons');
  assert.ok(!MANIFEST.some((f) => /^Logo_/i.test(f)), 'logos are not category icons');
});

test('rule 1: a slug-named icon wins', () => {
  const manifest = ['marvel.png', 'Icon_Lightning.png'];
  const res = resolveIcon({ slug: 'marvel', icon: 'Icon_Lightning' }, 0, { manifest });
  assert.deepEqual(res, { kind: 'image', src: '/icons/marvel.png', via: 'slug' });
});

test('rule 2: frontmatter Icon: attaches a legacy symbol to a slug that does not match', () => {
  const manifest = ['Icon_Lightning.png'];
  const res = resolveIcon({ slug: 'archive-harry-potter', icon: 'Icon_Lightning' }, 3, { manifest });
  assert.deepEqual(res, { kind: 'image', src: '/icons/Icon_Lightning.png', via: 'frontmatter' });

  // Extension in the frontmatter is tolerated; matching is case-insensitive.
  assert.equal(resolveIcon({ slug: 'x', icon: 'Icon_Lightning.png' }, 0, { manifest }).via, 'frontmatter');
  assert.equal(resolveIcon({ slug: 'x', icon: 'icon_lightning' }, 0, { manifest }).via, 'frontmatter');
});

test('rule 3: numbered circle when nothing matches — and when frontmatter is stale', () => {
  const manifest = ['Icon_Lightning.png'];

  assert.deepEqual(resolveIcon({ slug: 'ocean', icon: null }, 0, { manifest }), { kind: 'number', n: 1, via: 'fallback' });
  assert.deepEqual(resolveIcon({ slug: 'ocean' }, 9, { manifest }), { kind: 'number', n: 10, via: 'fallback' });

  // A frontmatter line pointing at a file nobody shipped must not render a
  // broken <img> — it degrades to the circle.
  assert.deepEqual(resolveIcon({ slug: 'ocean', icon: 'Icon_Deleted' }, 0, { manifest }), {
    kind: 'number',
    n: 1,
    via: 'fallback',
  });

  assert.deepEqual(resolveIcon({ slug: 'ocean' }, 0, { manifest: [] }), { kind: 'number', n: 1, via: 'fallback' });
});

test('resolveIcons numbers the fallbacks 1..n in board order (V2-8)', () => {
  const manifest = ['flags.png'];
  const cats = [{ slug: 'ocean' }, { slug: 'flags' }, { slug: 'marvel' }];
  const out = resolveIcons(cats, { manifest });

  assert.deepEqual(out.map((r) => r.via), ['fallback', 'slug', 'fallback']);
  assert.deepEqual(out.map((r) => r.n), [1, undefined, 3], 'the circle shows board position, not a fallback counter');
});

test('indexManifest tolerates junk and a custom base', () => {
  const idx = indexManifest(['A.png', null, 42, 'b.PNG']);
  assert.deepEqual([...idx.keys()].sort(), ['a', 'b']);
  assert.equal(resolveIcon({ slug: 'a' }, 0, { manifest: idx, base: '/assets/icons' }).src, '/assets/icons/A.png');
});

test('every Icon: line in the question bank resolves to a real file', () => {
  const dir = new URL('../public/questions/', import.meta.url);
  const idx = indexManifest(MANIFEST);
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const m = /^Icon:\s*(.+)$/m.exec(text);
    if (!m) continue;
    const slug = file.replace(/\.md$/, '');
    const res = resolveIcon({ slug, icon: m[1].trim() }, 0, { manifest: idx });
    assert.equal(res.kind, 'image', `${file} declares "Icon: ${m[1].trim()}" but no such icon ships`);
  }
});
