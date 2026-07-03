/**
 * @file Small hand-rolled DOM helpers shared by every screen module (PRD §6,
 * §8). No virtual DOM. Import-safe: nothing touches `document` at import
 * time — every DOM access happens inside a function body, called later.
 * String content is always attached via `textContent`/DOM text nodes, never
 * `innerHTML`, so caller-supplied user strings (team/player names) can never
 * inject markup.
 */

// ---------------------------------------------------------------------------
// Core element builder
// ---------------------------------------------------------------------------

/**
 * Build a DOM element. `attrs.class`/`className` sets className; `attrs.style`
 * (object) is applied via Object.assign; `attrs.onXxx` functions are wired as
 * `addEventListener('xxx', fn)`; other keys are set as a property when the
 * property exists on the node (covers value/checked/disabled/src/...), else
 * as a plain attribute (covers aria-*, for, tabindex, ...). `children` may be
 * strings/numbers (always turned into text nodes — never parsed as HTML),
 * nodes, or falsy (skipped), so `[cond && el(...)]` patterns work.
 * @param {string} tag
 * @param {Object<string, any>} [attrs]
 * @param {Array<Node|string|number|false|null|undefined>|Node|string|number} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  // <select value=X> can only select a matching <option> once its children
  // exist, so defer that one assignment until after children are appended.
  const deferredSelectValue = tag === 'select' && attrs && 'value' in attrs ? attrs.value : undefined;
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (deferredSelectValue !== undefined && key === 'value') continue;
    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node) {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else {
      node.setAttribute(key, value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    node.appendChild(
      typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child
    );
  }
  if (deferredSelectValue !== undefined) node.value = deferredSelectValue;
  return node;
}

/** Remove every child of `node`. @param {HTMLElement} node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace `rootEl`'s contents with a single node. @param {HTMLElement} rootEl @param {Node} node */
export function mount(rootEl, node) {
  clear(rootEl);
  rootEl.appendChild(node);
}

// ---------------------------------------------------------------------------
// IDs / codes
// ---------------------------------------------------------------------------

/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** @param {number} [len] @returns {string} a room code, e.g. "K7QRX". */
export function genRoomCode(len = 5) {
  let out = '';
  for (let i = 0; i < len; i++) out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return out;
}

/** @param {string} [prefix] @returns {string} a short unique id, e.g. "t_m6x1a2-3f". */
export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The join URL for a room (used on the GM's room-code/QR panel).
 * @param {string} roomCode
 * @param {string} [role]
 * @returns {string}
 */
export function joinUrl(roomCode, role = 'player') {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/${role}?room=${roomCode}`;
}

// ---------------------------------------------------------------------------
// Labels / assets
// ---------------------------------------------------------------------------

/** @param {string} name Icon filename stem (no extension). @returns {string} */
export function iconUrl(name) {
  return `assets/icons/${name}.png`;
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

const DIFF_LABELS = { E: 'Easy', M: 'Medium', H: 'Hard' };
const DIFF_CLASS = { E: 'dif-easy', M: 'dif-med', H: 'dif-hard' };
/** @param {'E'|'M'|'H'} dif @returns {string} */
export function difficultyLabel(dif) {
  return DIFF_LABELS[dif] || dif;
}
/** @param {'E'|'M'|'H'} dif @returns {string} CSS class for difficulty coloring. */
export function difficultyClass(dif) {
  return DIFF_CLASS[dif] || 'dif-easy';
}

const MODE_LABELS = { community: 'COMMUNITY', exclusive: 'EXCLUSIVE', contest: 'CONTEST', suddendeath: 'SUDDEN DEATH' };
/** @param {string} mode @returns {string} v6 display name (RULES-v6 §A). */
export function roundModeLabel(mode) {
  return MODE_LABELS[mode] || mode;
}

/** @param {number} n @returns {string} "+2" / "0" / "-1" */
export function formatDelta(n) {
  const v = n || 0;
  return v > 0 ? `+${v}` : String(v);
}

// ---------------------------------------------------------------------------
// Composite components (pure: data in, element out)
// ---------------------------------------------------------------------------

/**
 * @param {{name?:string,color?:string}} team
 * @param {{active?:boolean, muted?:boolean, onClick?:?Function}} [opts]
 * @returns {HTMLElement}
 */
export function teamPill(team, { active = false, muted = false, onClick = null } = {}) {
  const dot = el('span', { class: 'team-dot', style: { background: team.color || '#888' } });
  const label = el('span', { class: 'team-pill-name' }, team.name || '');
  return el(onClick ? 'button' : 'div', {
    class: `team-pill${active ? ' is-active' : ''}${muted ? ' is-muted' : ''}`,
    type: onClick ? 'button' : undefined,
    onClick: onClick || undefined,
  }, [dot, label]);
}

/**
 * Display-screen score bar: positive grows up, negative grows down from a
 * shared zero line (RULES-v6 §C, PRD §6). All bars in one row should share
 * the same `maxAbs` so heights are comparable.
 * @param {{name?:string,color?:string,score?:number}} team
 * @param {number} [maxAbs]
 * @returns {HTMLElement}
 */
export function scoreBar(team, maxAbs = 10) {
  const score = team.score || 0;
  const safeMax = Math.max(maxAbs, 1);
  const posPct = `${(Math.max(0, score) / safeMax) * 100}%`;
  const negPct = `${(Math.max(0, -score) / safeMax) * 100}%`;
  const color = team.color || '#888';
  return el('div', { class: 'score-bar' }, [
    el('div', { class: 'score-value' }, formatDelta(score)),
    el('div', { class: 'score-track' }, [
      el('div', { class: 'score-pos-area' }, [el('div', { class: 'score-fill', style: { height: posPct, background: color } })]),
      el('div', { class: 'score-zero-line' }),
      el('div', { class: 'score-neg-area' }, [el('div', { class: 'score-fill score-fill-neg', style: { height: negPct } })]),
    ]),
    el('div', { class: 'score-bar-name' }, team.name || ''),
  ]);
}

/**
 * Sorted (high to low) standings list.
 * @param {Object<string,{name?:string,color?:string,score?:number}>} teamsObj
 * @returns {HTMLElement}
 */
export function standingsList(teamsObj) {
  const rows = Object.entries(teamsObj || {})
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  return el('ol', { class: 'standings-list' }, rows.map((t) =>
    el('li', { class: 'standings-row' }, [
      el('span', { class: 'team-dot', style: { background: t.color || '#888' } }),
      el('span', { class: 'standings-name' }, t.name || t.id),
      el('span', { class: 'standings-score' }, formatDelta(t.score || 0)),
    ])
  ));
}

/**
 * `actions.advance()` moves `game.round/rotation/turnIdx` and re-opens
 * tap-in, but never clears `game.question` — so after scoring, the finished
 * question object lingers until the next `selectQuestion` overwrites it.
 * Every role renders purely from state, so left unchecked every screen would
 * keep showing the old reveal through the next team's tap-in and board
 * selection. This tracks the "turn fingerprint" (round:rotation:turnIdx) a
 * question was last seen progressing (not yet scored) under, and reports it
 * stale the moment that fingerprint no longer matches the live one — which
 * happens exactly when `advance()` runs, regardless of tap-in/selection
 * state. Call `.check(tree)` at most once per render (it has side effects).
 * @returns {{check: (tree: any) => boolean}}
 */
export function createStaleQuestionDetector() {
  let seenFingerprint = null;
  let trackedRef = null;
  return {
    check(tree) {
      const game = tree && tree.game;
      if (!game || !game.question) {
        seenFingerprint = null;
        trackedRef = null;
        return false;
      }
      const fp = `${game.round}:${game.rotation}:${game.turnIdx}`;
      if (game.question.ref !== trackedRef) {
        trackedRef = game.question.ref;
        seenFingerprint = fp; // first sight of this ref — treat as live
      } else if (game.question.state !== 'scored') {
        seenFingerprint = fp; // still progressing this turn — keep current
      }
      return fp !== seenFingerprint;
    },
  };
}

/**
 * A big thumb-target button (PRD §8: "big thumb targets").
 * @param {string} label
 * @param {?Function} onClick
 * @param {{kind?:string, disabled?:boolean}} [opts]
 * @returns {HTMLElement}
 */
export function bigButton(label, onClick, { kind = 'primary', disabled = false } = {}) {
  return el('button', { class: `btn btn-big btn-${kind}`, type: 'button', disabled, onClick }, label);
}

// ---------------------------------------------------------------------------
// Countdown (self-ticking; owns its own interval so full-tree re-renders
// don't need to repaint every second — role modules must call `.destroy()`
// on the previous instance before mounting a new one)
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container Appended into; caller owns its lifetime.
 * @param {Object} opts
 * @param {number} opts.deadline Epoch ms; falsy/0 = no timer configured.
 * @param {number} [opts.openedAt] Epoch ms the question opened (for the bar's %).
 * @param {() => number} opts.getServerNow
 * @param {() => void} [opts.onExpire] Called once when the deadline passes.
 * @param {string} [opts.label]
 * @returns {{destroy: () => void}}
 */
export function mountCountdown(container, { deadline, openedAt, getServerNow, onExpire, label = '' } = {}) {
  if (!deadline) {
    container.appendChild(el('div', { class: 'countdown countdown-none' }, label || 'No timer'));
    return { destroy() {} };
  }
  const wrap = el('div', { class: 'countdown' });
  const bar = el('div', { class: 'countdown-bar' });
  const text = el('div', { class: 'countdown-text' });
  wrap.append(el('div', { class: 'countdown-track' }, [bar]), text);
  container.appendChild(wrap);

  const totalSpan = Math.max(1, deadline - (openedAt || deadline - 1));
  let expired = false;
  function tick() {
    const remainMs = Math.max(0, deadline - getServerNow());
    const remainSec = Math.ceil(remainMs / 1000);
    text.textContent = `${label ? label + ' — ' : ''}${remainSec}s`;
    bar.style.width = `${Math.max(0, Math.min(100, (remainMs / totalSpan) * 100))}%`;
    bar.classList.toggle('is-urgent', remainSec <= 5 && remainMs > 0);
    if (remainMs <= 0 && !expired) {
      expired = true;
      if (typeof onExpire === 'function') onExpire();
    }
  }
  tick();
  const timer = setInterval(tick, 250);
  return { destroy: () => clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// Imperative overlays (modal confirm, global status banner) — the only
// pieces of UI here that are not pure render-from-data, by nature.
// ---------------------------------------------------------------------------

/**
 * @param {string} message
 * @param {{okText?:string, cancelText?:string}} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { okText = 'Yes', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' });
    const done = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.appendChild(el('div', { class: 'modal-box' }, [
      el('p', { class: 'modal-message' }, message),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => done(false) }, cancelText),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: () => done(true) }, okText),
      ]),
    ]));
    document.body.appendChild(overlay);
  });
}

let bannerEl = null;
let bannerTimer = null;
function ensureBanner() {
  if (bannerEl) return bannerEl;
  bannerEl = el('div', { class: 'stack-banner' });
  bannerEl.hidden = true;
  bannerEl.setAttribute('role', 'status');
  document.body.appendChild(bannerEl);
  return bannerEl;
}
/**
 * Global status banner (connection loss, action rejections). Appended to
 * `document.body` lazily on first use, above whatever screen is mounted.
 * @param {string} message
 * @param {{kind?:'info'|'error', autoHideMs?:number}} [opts]
 */
export function showBanner(message, { kind = 'info', autoHideMs = 0 } = {}) {
  const node = ensureBanner();
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = false;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = autoHideMs > 0 ? setTimeout(hideBanner, autoHideMs) : null;
}
/** Hide the global status banner. */
export function hideBanner() {
  if (bannerEl) bannerEl.hidden = true;
}

/**
 * Three-role entry screen with the Stack logo (PRD §6/§8).
 * @param {HTMLElement} rootEl
 * @param {{onSelect: (role: 'player'|'gm'|'display') => void}} opts
 */
export function renderEntryScreen(rootEl, { onSelect } = {}) {
  const cards = [
    { role: 'player', title: 'Player', desc: 'Join a room, join a team, play.' },
    { role: 'gm', title: 'Game Master', desc: 'Create a room and run the game.' },
    { role: 'display', title: 'Display', desc: 'Big screen for everyone to watch.' },
  ].map((c) =>
    el('button', { class: 'role-card', type: 'button', onClick: () => onSelect && onSelect(c.role) }, [
      el('h2', {}, c.title),
      el('p', {}, c.desc),
    ])
  );
  mount(rootEl, el('div', { class: 'entry-screen' }, [
    el('img', { class: 'entry-logo', src: 'assets/Stack Logo 512.png', alt: 'Stack' }),
    el('div', { class: 'role-cards' }, cards),
  ]));
}
