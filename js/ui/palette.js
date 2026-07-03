/**
 * @file Parses assets/setup-color.txt and applies it as CSS custom properties
 * (PRD §8, RULES-v6 §E). Import-safe: no top-level DOM/fetch access — nothing
 * runs until `applyPalette()` is called (from main.js at boot).
 *
 * Naming: every `Key = #HEX` line becomes `--kebab-case-of-key` (e.g.
 * `DiffEasy` -> `--diff-easy`, `Team1` -> `--team1`). A few keys additionally
 * get a short alias used throughout css/app.css and js/ui/*: `CorrectColor`
 * -> also `--correct`, `WrongColor` -> also `--wrong`. Teams 5-8 (PRD §4.1:
 * "colors beyond 4 derive from the palette") are synthesized from Team1-4.
 */

const SOURCE_URL = 'assets/setup-color.txt';
const LINE_RE = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(#[0-9A-Fa-f]{3,8})\s*$/;

/** Short aliases requested alongside the full kebab form. */
const ALIASES = { CorrectColor: 'correct', WrongColor: 'wrong' };

/**
 * "Team1" -> "team1", "DiffEasy" -> "diff-easy", "PhaseLineActive" ->
 * "phase-line-active". Digits are kept attached to the preceding word.
 * @param {string} key
 * @returns {string}
 */
export function kebabCase(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Parse "Key = #HEX" lines; blank lines and lines starting with # are
 * ignored; malformed lines are silently skipped (fallback CSS covers gaps).
 * @param {string} text
 * @returns {Object<string,string>} original-case key -> hex string.
 */
export function parsePalette(text) {
  const map = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE_RE.exec(line);
    if (m) map[m[1]] = m[2].toUpperCase();
  }
  return map;
}

/** @param {string} hex @returns {{h:number,s:number,l:number}} */
export function hexToHsl(hex) {
  const clean = hex.replace('#', '');
  const bytes = clean.length === 3
    ? clean.split('').map((c) => parseInt(c + c, 16))
    : [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  const [r, g, b] = bytes.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

/** @param {{h:number,s:number,l:number}} hsl @returns {string} "#RRGGBB" */
export function hslToHex({ h, s, l }) {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let rgb = [0, 0, 0];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`.toUpperCase();
}

/**
 * Derive a visually-related tint by moving lightness 60% of the way toward
 * white, keeping hue/saturation — reads as "the same team color, family 2".
 * @param {string} hex
 * @param {number} [amount=0.6]
 * @returns {string}
 */
export function shiftLightness(hex, amount = 0.6) {
  const hsl = hexToHsl(hex);
  const newL = Math.min(hsl.l + (100 - hsl.l) * amount, 96);
  return hslToHex({ ...hsl, l: newL });
}

/**
 * Add synthesized Team5..Team8 entries (from Team1..Team4) to a parsed map.
 * @param {Object<string,string>} map
 * @returns {Object<string,string>}
 */
export function extendTeams(map) {
  const out = { ...map };
  for (let i = 1; i <= 4; i++) {
    const base = map[`Team${i}`];
    if (base) out[`Team${i + 4}`] = shiftLightness(base);
  }
  return out;
}

/**
 * Apply every entry in `map` as a CSS custom property on `target`, plus any
 * documented short aliases.
 * @param {Object<string,string>} map
 * @param {HTMLElement} [target]
 */
export function applyToDom(map, target = document.documentElement) {
  for (const [key, value] of Object.entries(map)) {
    target.style.setProperty(`--${kebabCase(key)}`, value);
    if (ALIASES[key]) target.style.setProperty(`--${ALIASES[key]}`, value);
  }
}

/**
 * Fetch + parse + apply the palette. Never throws — css/app.css defines a
 * fallback for every property, so a failed/missing fetch just leaves those
 * defaults in place.
 * @param {string} [url]
 * @returns {Promise<Object<string,string>>} parsed map incl. Team5-8 (empty on failure).
 */
export async function applyPalette(url = SOURCE_URL) {
  let map = {};
  try {
    const res = await fetch(url);
    if (res.ok) map = parsePalette(await res.text());
  } catch {
    // Network/parse failure: fall through with an empty map — app.css
    // fallback custom properties keep every screen fully styled.
  }
  const extended = extendTeams(map);
  applyToDom(extended);
  return extended;
}
