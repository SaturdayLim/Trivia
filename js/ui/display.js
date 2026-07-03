/**
 * @file Display role screen (PRD §6): read-only big screen — board with
 * remaining counts, score bars (positive up / negative down), active
 * question with per-team lock glows as they land, reveal, standings. Writes
 * nothing to sync (PRD §5.1) and never shows the fun fact. Category display
 * metadata (name/icon) is fetched locally the same way player.js does — see
 * that file's header comment for why this doesn't leak the answer/fact.
 */
import { categoryEmpty } from '../engine/board.js';
import { loadCategories, parseRef } from '../engine/questions.js';
import {
  el, mount, iconUrl, OPTION_LETTERS, difficultyLabel, difficultyClass,
  roundModeLabel, formatDelta, scoreBar, standingsList, mountCountdown, joinUrl,
  createStaleQuestionDetector,
} from './components.js';

/**
 * @param {HTMLElement} rootEl
 * @param {Object} ctx
 * @returns {() => void} teardown
 */
export function init(rootEl, ctx) {
  let countdownHandle = null;
  let lastRound = null;
  let interstitialUntil = 0;
  let interstitialInfo = null;
  let interstitialTimer = null;
  let categoryMeta = {};
  let lastTree = null;
  const staleCheck = createStaleQuestionDetector();

  loadCategories()
    .then(({ categories }) => {
      categoryMeta = Object.fromEntries(categories.map((c) => [c.slug, c]));
      if (lastTree) render(lastTree);
    })
    .catch(() => {});

  const unsub = ctx.sync.onChange('/', (tree) => {
    lastTree = tree;
    render(tree);
  });

  function render(tree) {
    if (countdownHandle) {
      countdownHandle.destroy();
      countdownHandle = null;
    }
    if (!tree || !tree.meta) {
      mount(rootEl, lobbyWaitScreen(ctx.roomCode, {}));
      return;
    }

    const teams = tree.teams || {};

    if (tree.meta.status === 'playing' && tree.game && tree.game.round != null) {
      if (lastRound !== null && tree.game.round !== lastRound) {
        interstitialUntil = Date.now() + 3000;
        interstitialInfo = (tree.settings.rounds || [])[tree.game.round];
      }
      lastRound = tree.game.round;
    }
    if (Date.now() < interstitialUntil) {
      mount(rootEl, roundInterstitial(lastRound, interstitialInfo, ctx.roomCode));
      if (!interstitialTimer) {
        interstitialTimer = setTimeout(() => {
          interstitialTimer = null;
          render(tree);
        }, Math.max(50, interstitialUntil - Date.now()));
      }
      return;
    }

    if (tree.meta.status === 'lobby') {
      mount(rootEl, lobbyWaitScreen(ctx.roomCode, teams));
      return;
    }
    if (tree.meta.status === 'ended') {
      mount(rootEl, endedScreen(teams, ctx.roomCode));
      return;
    }

    const game = tree.game || {};
    const questionLive = game.question && !staleCheck.check(tree);
    if (questionLive) {
      mount(rootEl, questionScreen({
        tree, teams, roomCode: ctx.roomCode, getServerNow: ctx.sync.serverNow,
        onCountdown: (h) => { countdownHandle = h; },
      }));
    } else {
      mount(rootEl, boardScreen({ tree, teams, categoryMeta, roomCode: ctx.roomCode }));
    }
  }

  return () => {
    unsub();
    if (countdownHandle) countdownHandle.destroy();
    if (interstitialTimer) clearTimeout(interstitialTimer);
  };
}

// ---------------------------------------------------------------------------
// Pure screen builders
// ---------------------------------------------------------------------------

function roomFooter(roomCode) {
  return el('div', { class: 'board-banner' }, [
    el('div', {}, `Room code: ${roomCode || '—'}`),
    el('div', { class: 'join-url' }, roomCode ? joinUrl(roomCode, 'player') : ''),
  ]);
}

function lobbyWaitScreen(roomCode, teams) {
  const teamEls = Object.values(teams || {}).map((t) => el('div', { class: 'lobby-team-card' }, [
    el('div', { class: 'lobby-team-head' }, [el('span', { class: 'team-dot', style: { background: t.color || '#888' } }), el('span', {}, t.name)]),
    el('div', { class: 'lobby-team-players' }, Object.values(t.players || {}).map((p) => el('span', { class: 'lobby-player-chip' }, p.name))),
  ]));
  return el('div', { class: 'screen screen-wide' }, [
    el('img', { class: 'entry-logo', src: 'assets/Stack Logo 512.png', alt: 'Stack', style: { margin: '0 auto' } }),
    el('h1', { class: 'room-code-display', style: { textAlign: 'center' } }, roomCode || ''),
    el('p', { style: { textAlign: 'center' } }, 'Waiting for the Game Master to start…'),
    el('div', { class: 'lobby-list' }, teamEls),
  ]);
}

function endedScreen(teams, roomCode) {
  return el('div', { class: 'screen screen-wide' }, [
    el('h1', { style: { textAlign: 'center' } }, 'Game Over'),
    standingsList(teams),
    roomFooter(roomCode),
  ]);
}

function roundInterstitial(round, cfg, roomCode) {
  return el('div', { class: 'interstitial' }, [
    el('p', {}, `Round ${(round || 0) + 1}`),
    el('div', { class: 'interstitial-round-name' }, cfg ? roundModeLabel(cfg.mode) : ''),
    roomFooter(roomCode),
  ]);
}

function boardScreen({ tree, teams, categoryMeta, roomCode }) {
  const game = tree.game || {};
  const board = game.board || {};
  const tapIn = game.tapIn || {};
  const activeTeamId = game.activeTeam;
  const activeTeam = activeTeamId ? teams[activeTeamId] : null;
  const round = (tree.settings.rounds || [])[game.round];

  let banner = 'Waiting…';
  if (tapIn.winner) banner = `${activeTeam ? activeTeam.name : ''} is choosing…`;
  else if (tapIn.openFor) banner = `Waiting for ${(teams[tapIn.openFor] && teams[tapIn.openFor].name) || ''} to tap in…`;

  const maxAbs = Math.max(1, ...Object.values(teams).map((t) => Math.abs(t.score || 0)), 1);
  const scores = el('div', { class: 'score-row' }, Object.values(teams).map((t) => scoreBar(t, maxAbs)));

  const tiles = Object.keys(board)
    .filter((slug) => !categoryEmpty(board, slug))
    .map((slug) => {
      const meta = categoryMeta[slug];
      const tiers = board[slug];
      const counts = ['E', 'M', 'H'].map((d) => `${d}:${(tiers[d] || []).length}`).join('  ');
      return el('div', { class: 'board-tile is-readonly' }, [
        meta && meta.icon && el('img', { src: iconUrl(meta.icon), alt: '' }),
        el('div', { class: 'board-tile-name' }, (meta && meta.name) || slug),
        el('div', { class: 'hint-text' }, counts),
      ]);
    });

  return el('div', { class: 'screen screen-wide' }, [
    el('div', { class: 'board-banner' }, `Round ${game.round + 1} — ${round ? roundModeLabel(round.mode) : ''} — Rotation ${game.rotation + 1}${round ? '/' + round.rotations : ''}`),
    scores,
    el('div', { class: 'board-banner' }, banner),
    el('div', { class: 'board-grid' }, tiles),
    roomFooter(roomCode),
  ]);
}

function questionScreen({ tree, teams, roomCode, getServerNow, onCountdown }) {
  const game = tree.game;
  const q = game.question;
  const round = tree.settings.rounds[game.round];
  const dif = parseRef(q.ref).id[0];
  const locks = q.locks || {};
  const isRevealed = q.state === 'revealed' || q.state === 'scored';
  const result = q.result;

  const options = q.payload.options.map((optText, idx) => {
    const letter = OPTION_LETTERS[idx];
    let cls = 'option-btn';
    if (isRevealed && result) {
      if (result.correct === letter) cls += ' is-correct';
      else if (Object.values(locks).some((l) => l.choice === letter)) cls += ' is-wrong';
    }
    const tags = Object.entries(locks)
      .filter(([, l]) => l.choice === letter)
      .map(([teamId]) => el('span', { class: 'lock-tag', style: { background: (teams[teamId] && teams[teamId].color) || '#888' } }));
    return el('div', { class: cls }, [
      el('span', { class: 'opt-letter' }, `${letter}.`),
      el('span', {}, optText),
      tags.length ? el('div', { class: 'lock-tags' }, tags) : null,
    ]);
  });

  const countdownBox = el('div', {});
  const body = [
    el('div', { class: `question-title ${difficultyClass(dif)}` }, `${roundModeLabel(round.mode)} — ${difficultyLabel(dif)} (${q.value} pts)`),
    el('div', { class: 'question-text' }, q.payload.q),
    countdownBox,
    el('div', { class: 'options-grid' }, options),
  ];

  if (q.state === 'open' && q.deadline && onCountdown) {
    onCountdown(mountCountdown(countdownBox, { deadline: q.deadline, openedAt: q.openedAt, getServerNow }));
  }

  if (result) {
    const maxAbs = Math.max(1, ...Object.values(teams).map((t) => Math.abs(t.score || 0)), 1);
    body.push(el('div', { class: 'score-row' }, Object.entries(teams).map(([id, t]) => {
      const delta = result.deltas ? result.deltas[id] : undefined;
      return el('div', {}, [
        scoreBar(t, maxAbs),
        delta !== undefined && el('div', { class: `delta-banner ${delta > 0 ? 'is-pos' : delta < 0 ? 'is-neg' : ''}` }, formatDelta(delta)),
      ]);
    })));
  }

  body.push(roomFooter(roomCode));
  return el('div', { class: 'screen screen-wide' }, body);
}
