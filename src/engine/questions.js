/**
 * @file Question-content layer for the Stack trivia app.
 * Parses and serializes category Markdown files per PRD §3.2, discovers the
 * category set via questions/index.json, and provides question-ref helpers.
 * Pure module — no DOM access — safe to import in the browser or in Node.
 */

/**
 * @typedef {Object} Category
 * @property {string} slug   Kebab-case filename stem, e.g. "movie-night".
 * @property {string} name   Display name, from the "# Category:" line.
 * @property {?string} icon  Filename stem in assets/icons (no extension), or null.
 * @property {?string} color Hex color string (tile accent), or null.
 */

/**
 * @typedef {Object} Question
 * @property {string} id     "E1".."E<n>" / "M1".."M<n>" / "H1".."H<n>".
 * @property {'E'|'M'|'H'} dif Difficulty tier.
 * @property {string} q      Question text; "\n"-joined when the source spanned lines.
 * @property {string[]} options Exactly four option strings; index 0..3 = A..D.
 * @property {'A'|'B'|'C'|'D'} answer Correct option letter.
 * @property {string} fact   Fun fact text, "" when absent; "\n"-joined when multi-line.
 */

/**
 * @typedef {Object} ParseError
 * @property {string} file Filename passed to parseCategory (or "questions/index.json").
 * @property {number} line 1-based line number; 0 when not line-addressable (e.g. a fetch failure).
 * @property {string} msg  Human-readable description.
 */

/**
 * @typedef {Object} ParseResult
 * @property {?Category} category  Null when `errors` is non-empty (file rejected whole).
 * @property {Question[]} questions Empty when `errors` is non-empty.
 * @property {ParseError[]} errors
 */

const HEADING_RE = /^##\s+(\S+)\s*$/;
const ID_RE = /^([EMH])(\d+)$/;
const CATEGORY_LINE_RE = /^#\s*Category:\s*(.*)$/;
const ICON_LINE_RE = /^Icon:\s*(.*)$/;
const COLOR_LINE_RE = /^Color:\s*(.*)$/;
const OPTION_RE = /^([A-D])\)\s*(.*)$/;
const ANSWER_RE = /^Answer:\s*(.*)$/;
const Q_PREFIX_RE = /^Q:\s*(.*)$/;
const FACT_PREFIX_RE = /^Fact:\s*(.*)$/;
const LETTERS = ['A', 'B', 'C', 'D'];
const DIFFICULTIES = ['E', 'M', 'H'];

function isBlank(line) {
  return line.trim() === '';
}

/** Drop trailing blank entries (keeps interior blank lines as paragraph breaks). */
function stripTrailingBlank(arr) {
  const out = arr.slice();
  while (out.length && isBlank(out[out.length - 1])) out.pop();
  return out;
}

function slugFromFilename(filename) {
  const base = filename.split(/[\\/]/).pop() || filename;
  return base.replace(/\.md$/i, '');
}

/** Parse the "# Category:"/"Icon:"/"Color:" block. Returns Category or null on fatal error. */
function parseHeader(headerLines, filename, errors) {
  let i = 0;
  const total = headerLines.length;
  while (i < total && isBlank(headerLines[i])) i++;

  if (i >= total || !CATEGORY_LINE_RE.test(headerLines[i])) {
    errors.push({ file: filename, line: i + 1, msg: 'Expected "# Category: <name>" as the first line' });
    return null;
  }
  const name = CATEGORY_LINE_RE.exec(headerLines[i])[1].trim();
  if (!name) {
    errors.push({ file: filename, line: i + 1, msg: 'Category name must not be empty' });
  }
  i++;

  let icon = null;
  let color = null;
  while (i < total) {
    if (isBlank(headerLines[i])) { i++; continue; }
    const iconM = ICON_LINE_RE.exec(headerLines[i]);
    const colorM = COLOR_LINE_RE.exec(headerLines[i]);
    if (iconM) {
      if (icon !== null) errors.push({ file: filename, line: i + 1, msg: 'Duplicate "Icon:" line' });
      icon = iconM[1].trim() || null;
    } else if (colorM) {
      if (color !== null) errors.push({ file: filename, line: i + 1, msg: 'Duplicate "Color:" line' });
      color = colorM[1].trim() || null;
    } else {
      errors.push({ file: filename, line: i + 1, msg: `Unexpected line in category header: "${headerLines[i]}"` });
    }
    i++;
  }

  return { slug: slugFromFilename(filename), name, icon, color };
}

/**
 * Parse one question block's body (lines after its "## E1" heading, up to the
 * next heading or EOF). Returns {q, options, answer, fact} or null on the
 * first structural error found in this block (already pushed to `errors`).
 */
function parseBlock(bodyLines, startLineNo, filename, errors) {
  const total = bodyLines.length;
  const lineNo = (offset) => startLineNo + offset;
  let i = 0;

  while (i < total && isBlank(bodyLines[i])) i++;
  if (i >= total || !Q_PREFIX_RE.test(bodyLines[i])) {
    errors.push({ file: filename, line: lineNo(i), msg: 'Expected "Q:" line' });
    return null;
  }
  const qStartLine = lineNo(i);
  const qContent = [Q_PREFIX_RE.exec(bodyLines[i])[1]];
  i++;
  while (i < total && !OPTION_RE.test(bodyLines[i])) {
    qContent.push(bodyLines[i]);
    i++;
  }
  if (i >= total) {
    errors.push({ file: filename, line: qStartLine, msg: 'Question missing options — expected an "A)" line' });
    return null;
  }
  const qText = stripTrailingBlank(qContent).join('\n');
  if (!qText.trim()) {
    errors.push({ file: filename, line: qStartLine, msg: 'Question text (Q:) must not be empty' });
    return null;
  }

  const options = [];
  for (const letter of LETTERS) {
    if (i >= total) {
      errors.push({ file: filename, line: lineNo(i - 1), msg: `Missing option ${letter})` });
      return null;
    }
    const m = OPTION_RE.exec(bodyLines[i]);
    if (!m || m[1] !== letter) {
      errors.push({ file: filename, line: lineNo(i), msg: `Expected "${letter})" line, found "${bodyLines[i]}"` });
      return null;
    }
    const val = m[2].trim();
    if (!val) {
      errors.push({ file: filename, line: lineNo(i), msg: `Option ${letter}) must not be empty` });
      return null;
    }
    options.push(val);
    i++;
  }

  while (i < total && isBlank(bodyLines[i])) i++;
  if (i >= total || !ANSWER_RE.test(bodyLines[i])) {
    errors.push({ file: filename, line: lineNo(i), msg: 'Expected "Answer:" line' });
    return null;
  }
  const answerRaw = ANSWER_RE.exec(bodyLines[i])[1].trim();
  if (!LETTERS.includes(answerRaw)) {
    errors.push({ file: filename, line: lineNo(i), msg: `Invalid Answer value "${answerRaw}" — must be A, B, C, or D` });
    return null;
  }
  const answer = answerRaw;
  i++;

  while (i < total && isBlank(bodyLines[i])) i++;
  let fact = '';
  if (i < total) {
    if (FACT_PREFIX_RE.test(bodyLines[i])) {
      const factContent = [FACT_PREFIX_RE.exec(bodyLines[i])[1]];
      i++;
      while (i < total) {
        factContent.push(bodyLines[i]);
        i++;
      }
      fact = stripTrailingBlank(factContent).join('\n');
    } else {
      errors.push({ file: filename, line: lineNo(i), msg: 'Unexpected content after Answer: — expected "Fact:" or end of question' });
      return null;
    }
  }

  return { q: qText, options, answer, fact };
}

/** Validate one difficulty's id sequence: >=1 entry, sequential from 1, no gaps/dupes. */
function validateSequence(dif, entries, filename, errors) {
  if (entries.length === 0) {
    errors.push({ file: filename, line: 1, msg: `No ${dif} questions found — at least one required per difficulty` });
    return;
  }
  const byN = new Map();
  for (const e of entries) {
    if (!byN.has(e.n)) byN.set(e.n, []);
    byN.get(e.n).push(e.line);
  }
  for (const [n, lns] of byN) {
    for (let k = 1; k < lns.length; k++) {
      errors.push({ file: filename, line: lns[k], msg: `Duplicate id ${dif}${n}` });
    }
  }
  const maxN = Math.max(...byN.keys());
  const sorted = entries.slice().sort((a, b) => a.n - b.n);
  for (let k = 1; k <= maxN; k++) {
    if (!byN.has(k)) {
      const next = sorted.find((e) => e.n > k);
      const line = next ? next.line : sorted[sorted.length - 1].line;
      errors.push({ file: filename, line, msg: `Missing ${dif}${k} — ids must be sequential from 1 with no gaps` });
    }
  }
}

/**
 * Parse one category Markdown file per PRD §3.2 (strict grammar).
 * On any grammar violation the file is rejected whole (category: null,
 * questions: []) but every violation found is still reported in `errors`
 * with an accurate 1-based line number.
 * @param {string} text Raw file contents.
 * @param {string} filename Filename, e.g. "movie-night.md" (used for the slug and in errors).
 * @returns {ParseResult}
 */
export function parseCategory(text, filename) {
  const errors = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const headings = [];
  lines.forEach((line, idx) => {
    const m = HEADING_RE.exec(line);
    if (m) headings.push({ index: idx, raw: m[1] });
  });

  const headerEnd = headings.length ? headings[0].index : lines.length;
  const category = parseHeader(lines.slice(0, headerEnd), filename, errors);

  if (headings.length === 0) {
    errors.push({ file: filename, line: lines.length || 1, msg: 'No questions found — expected "## E1" style headings' });
  }

  const questions = [];
  const buckets = { E: [], M: [], H: [] };

  for (let b = 0; b < headings.length; b++) {
    const start = headings[b].index;
    const end = b + 1 < headings.length ? headings[b + 1].index : lines.length;
    const headingLine = start + 1;
    const raw = headings[b].raw;
    const idMatch = ID_RE.exec(raw);
    const n = idMatch ? parseInt(idMatch[2], 10) : NaN;
    const canonical = Boolean(idMatch) && raw === `${idMatch[1]}${n}` && n >= 1;

    if (!canonical) {
      errors.push({
        file: filename,
        line: headingLine,
        msg: `Invalid question id "${raw}" — must be E<n>, M<n>, or H<n>, numbered from 1 with no leading zeros`,
      });
      parseBlock(lines.slice(start + 1, end), start + 2, filename, errors);
      continue;
    }

    const dif = idMatch[1];
    buckets[dif].push({ n, line: headingLine });

    const body = parseBlock(lines.slice(start + 1, end), start + 2, filename, errors);
    if (body) {
      questions.push({ id: `${dif}${n}`, dif, q: body.q, options: body.options, answer: body.answer, fact: body.fact });
    }
  }

  if (headings.length > 0) {
    for (const dif of DIFFICULTIES) {
      validateSequence(dif, buckets[dif], filename, errors);
    }
  }

  if (errors.length > 0) {
    return { category: null, questions: [], errors };
  }
  return { category, questions, errors: [] };
}

/**
 * Serialize a category back to canonical .md text — the exact inverse of
 * parseCategory for canonically-formatted input.
 * @param {{category: Category, questions: Question[]}} categoryObj
 * @returns {string} Canonical Markdown text (trailing newline included).
 */
export function serializeCategory({ category, questions }) {
  const lines = [];
  lines.push(`# Category: ${category.name}`);
  if (category.icon) lines.push(`Icon: ${category.icon}`);
  if (category.color) lines.push(`Color: ${category.color}`);
  lines.push('');

  questions.forEach((qz, idx) => {
    lines.push(`## ${qz.id}`);
    const qLines = qz.q.split('\n');
    lines.push(`Q: ${qLines[0]}`);
    for (let k = 1; k < qLines.length; k++) lines.push(qLines[k]);
    qz.options.forEach((opt, oi) => lines.push(`${LETTERS[oi]}) ${opt}`));
    lines.push(`Answer: ${qz.answer}`);
    if (qz.fact) {
      const fLines = qz.fact.split('\n');
      lines.push(`Fact: ${fLines[0]}`);
      for (let k = 1; k < fLines.length; k++) lines.push(fLines[k]);
    }
    if (idx < questions.length - 1) lines.push('');
  });

  return lines.join('\n') + '\n';
}

function joinUrl(base, path) {
  if (!base) return path;
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Fetch questions/index.json then every listed category file (skipping any
 * filename starting with "_"), parsing each with parseCategory.
 * @param {string} [baseUrl] Root the app is served from; defaults to ".".
 * @returns {Promise<{categories: Array<Category & {questions: Question[]}>, errors: ParseError[]}>}
 */
export async function loadCategories(baseUrl = '.') {
  const errors = [];
  const categories = [];
  const indexFile = 'questions/index.json';

  let filenames;
  try {
    const res = await fetch(joinUrl(baseUrl, indexFile));
    if (!res.ok) {
      errors.push({ file: indexFile, line: 0, msg: `Failed to fetch index: HTTP ${res.status}` });
      return { categories, errors };
    }
    filenames = await res.json();
  } catch (e) {
    errors.push({ file: indexFile, line: 0, msg: `Failed to fetch/parse index: ${e.message}` });
    return { categories, errors };
  }

  if (!Array.isArray(filenames)) {
    errors.push({ file: indexFile, line: 0, msg: 'index.json must be a JSON array of filenames' });
    return { categories, errors };
  }

  for (const filename of filenames) {
    if (typeof filename !== 'string' || filename.startsWith('_')) continue;
    try {
      const res = await fetch(joinUrl(baseUrl, `questions/${filename}`));
      if (!res.ok) {
        errors.push({ file: filename, line: 0, msg: `Failed to fetch: HTTP ${res.status}` });
        continue;
      }
      const text = await res.text();
      const result = parseCategory(text, filename);
      if (result.errors.length > 0) {
        errors.push(...result.errors);
      } else {
        categories.push({ ...result.category, questions: result.questions });
      }
    } catch (e) {
      errors.push({ file: filename, line: 0, msg: `Failed to fetch/parse: ${e.message}` });
    }
  }

  return { categories, errors };
}

/**
 * Build a global question reference string.
 * @param {string} slug Category slug.
 * @param {string} id Question id, e.g. "E1".
 * @returns {string} e.g. "movie-night:E1".
 */
export function makeRef(slug, id) {
  return `${slug}:${id}`;
}

/**
 * Inverse of makeRef.
 * @param {string} ref e.g. "movie-night:E1".
 * @returns {{slug: string, id: string}}
 */
export function parseRef(ref) {
  const i = ref.indexOf(':');
  if (i === -1) {
    throw new Error(`Invalid question ref "${ref}" — expected "<slug>:<id>"`);
  }
  return { slug: ref.slice(0, i), id: ref.slice(i + 1) };
}
