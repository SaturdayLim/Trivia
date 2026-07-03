/**
 * @file Player role screens (PRD §6): team pick/create, lobby wait, tap-in,
 * board (selecting or read-only), question (answer / contest counter-pick),
 * reveal, round-change interstitial. Renders purely from synced state via
 * `sync.onChange('/', render)`; every write goes through js/engine/actions.js.
 *
 * Category display metadata (name/icon/color) is not part of synced game
 * state (PRD §5.3 only stores question ids on the board) — this module
 * fetches the public question bank itself via `loadCategories()` purely for
 * that metadata, the same way the GM does, but never reads `.answer`/`.fact`
 * from it; the question text/options actually shown always come from synced
 * `game.question.payload`, never from this local copy.
 */
import * as actions from '../engine/actions.js';
import { MODES } from '../engine/scoring.js';
import { tierEmpty, categoryEmpty } from '../engine/board.js';
import { loadCategories, parseRef } from '../engine/questions.js';
import {
  el, mount, iconUrl, OPTION_LETTERS, difficultyLabel, difficultyClass,
  roundModeLabel, formatDelta, teamPill, standingsList, mountCountdown,
  confirmDialog, genId, createStaleQuestionDetector,
} from './components.js';

const TEAM_COLOR_KEYS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Team${n}`);

/**
 * @param {HTMLElement} rootEl
 * @param {Object} ctx
 * @returns {() => void} teardown
 */
export function init(rootEl, ctx) {
  const { sync, clientId } = ctx;
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

  const unsub = sync.onChange('/', (tree) => {
    lastTree = tree;
    render(tree);
  });

  function run(btn, promise) {
    if (btn) btn.disabled = true;
    promise.catch((e) => ctx.reportError && ctx.reportError(e)).finally(() => {
      if (btn) btn.disabled = false;
    });
  }

  const handlers = {
    createTeam: ({ name, color, order }, btn) =>
      run(btn, actions.createTeam(sync, { teamId: genId('t'), name, color, order, playerId: clientId, playerName: ctx.name || 'Player' })),
    joinTeam: (teamId, btn) =>
      run(btn, actions.joinTeam(sync, { teamId, playerId: clientId, playerName: ctx.name || 'Player' })),
    claimTapIn: (teamId, btn) => run(btn, actions.claimTapIn(sync, teamId, clientId)),
    requestSelection: ({ teamId, slug, dif }, btn) =>
      run(btn, actions.requestSelection(sync, { playerId: clientId, teamId, slug, dif })),
    lockAnswer: (teamId, choice, btn) => run(btn, actions.lockAnswer(sync, teamId, clientId, choice, sync.serverNow())),
  };

  function render(tree) {
    if (countdownHandle) {
      countdownHandle.destroy();
      countdownHandle = null;
    }
    if (!tree || !tree.meta) {
      mount(rootEl, centerMessage('Connecting…'));
      return;
    }

    const teams = tree.teams || {};
    const myTeamId = findMyTeam(teams, clientId);

    if (tree.meta.status === 'playing' && tree.game && tree.game.round != null) {
      if (lastRound !== null && tree.game.round !== lastRound) {
        interstitialUntil = Date.now() + 3000;
        interstitialInfo = (tree.settings.rounds || [])[tree.game.round];
      }
      lastRound = tree.game.round;
    }
    if (Date.now() < interstitialUntil) {
      mount(rootEl, roundInterstitial(lastRound, interstitialInfo));
      if (!interstitialTimer) {
        interstitialTimer = setTimeout(() => {
          interstitialTimer = null;
          render(tree);
        }, Math.max(50, interstitialUntil - Date.now()));
      }
      return;
    }

    if (tree.meta.status === 'ended') {
      mount(rootEl, endedScreen(teams));
      return;
    }

    if (tree.meta.status === 'lobby' || !myTeamId) {
      mount(rootEl, lobbyScreen({ tree, teams, myTeamId, handlers, palette: ctx.palette }));
      return;
    }

    const game = tree.game || {};
    const questionLive = game.question && !staleCheck.check(tree);
    if (questionLive) {
      mount(rootEl, questionScreen({
        tree, teams, myTeamId, clientId, handlers, getServerNow: sync.serverNow,
        onCountdown: (h) => { countdownHandle = h; },
      }));
    } else if (game.tapIn && game.tapIn.openFor === myTeamId && !game.tapIn.winner) {
      mount(rootEl, tapInScreen({ myTeamId, teams, handlers }));
    } else {
      mount(rootEl, boardScreen({ tree, teams, myTeamId, clientId, categoryMeta, handlers }));
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

function findMyTeam(teams, clientId) {
  return Object.keys(teams).find((id) => teams[id].players && teams[id].players[clientId]) || null;
}

function findPlayerName(teams, teamId, playerId) {
  const team = teams[teamId];
  return team && team.players && team.players[playerId] && team.players[playerId].name;
}

function centerMessage(msg) {
  return el('div', { class: 'screen' }, [el('div', { class: 'center-message' }, [el('p', {}, msg)])]);
}

function endedScreen(teams) {
  return el('div', { class: 'screen' }, [el('h2', { style: { textAlign: 'center' } }, 'Game Over'), standingsList(teams)]);
}

function roundInterstitial(round, cfg) {
  return el('div', { class: 'interstitial' }, [
    el('p', {}, `Round ${(round || 0) + 1}`),
    el('div', { class: 'interstitial-round-name' }, cfg ? roundModeLabel(cfg.mode) : ''),
  ]);
}

function lobbyScreen({ tree, teams, myTeamId, handlers, palette }) {
  const locked = !!(tree.meta && tree.meta.registrationLocked);
  const teamEntries = Object.entries(teams);
  const takenColors = new Set(teamEntries.map(([, t]) => t.color));

  const list = el('div', { class: 'lobby-list' }, teamEntries.map(([id, t]) => {
    const isMine = id === myTeamId;
    const players = Object.values(t.players || {}).map((p) => el('span', { class: 'lobby-player-chip' }, p.name));
    return el('div', { class: 'lobby-team-card' }, [
      el('div', { class: 'lobby-team-head' }, [
        teamPill(t, { active: isMine }),
        !myTeamId && el('button', { class: 'btn btn-small btn-primary', type: 'button', onClick: (e) => handlers.joinTeam(id, e.currentTarget) }, 'Join'),
      ]),
      el('div', { class: 'lobby-team-players' }, players),
    ]);
  }));

  const body = [el('h2', {}, 'Teams'), list];
  if (myTeamId) {
    body.push(el('p', { class: 'hint-text' }, `You're on ${teams[myTeamId].name}. Waiting for the GM to start…`));
  } else if (!locked) {
    body.push(createTeamForm({ nextOrder: teamEntries.length, takenColors, palette, handlers }));
  } else {
    body.push(el('p', { class: 'hint-text' }, 'Registration is locked — tap Join on a team above.'));
  }
  return el('div', { class: 'screen' }, body);
}

function createTeamForm({ nextOrder, takenColors, palette, handlers }) {
  let selectedColor = null;
  const nameInput = el('input', { placeholder: 'Team name', value: `Team ${nextOrder + 1}` });
  const swatchRow = el('div', { class: 'color-swatches' });
  const swatches = TEAM_COLOR_KEYS.map((key) => {
    const hex = (palette && palette[key]) || '#888888';
    const sw = el('div', {
      class: `color-swatch${takenColors.has(hex) ? ' is-taken' : ''}`,
      style: { background: hex },
      onClick: () => {
        selectedColor = hex;
        swatchRow.querySelectorAll('.color-swatch').forEach((n) => n.classList.remove('is-selected'));
        sw.classList.add('is-selected');
      },
    });
    return sw;
  });
  swatchRow.append(...swatches);

  const submit = el('button', {
    class: 'btn btn-big btn-primary', type: 'button',
    onClick: (e) => {
      const color = selectedColor || (palette && palette.Team1) || '#888888';
      const name = nameInput.value.trim() || `Team ${nextOrder + 1}`;
      handlers.createTeam({ name, color, order: nextOrder }, e.currentTarget);
    },
  }, 'Create team');

  return el('div', { class: 'form' }, [
    el('div', { class: 'field' }, [el('label', {}, 'New team name'), nameInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Color'), swatchRow]),
    submit,
  ]);
}

function tapInScreen({ myTeamId, teams, handlers }) {
  const team = teams[myTeamId] || {};
  return el('div', { class: 'screen tapin-screen' }, [
    el('div', { class: 'center-message' }, [
      el('p', {}, `${team.name || 'Your team'}, it's your turn!`),
      el('button', { class: 'tapin-button', type: 'button', onClick: (e) => handlers.claimTapIn(myTeamId, e.currentTarget) }, 'TAP IN'),
    ]),
  ]);
}

function boardScreen({ tree, teams, myTeamId, clientId, categoryMeta, handlers }) {
  const game = tree.game || {};
  const tapIn = game.tapIn || {};
  const board = game.board || {};
  const activeTeamId = game.activeTeam;
  const activeTeam = activeTeamId ? teams[activeTeamId] : null;
  const isSelector = !!tapIn.winner && tapIn.winner === clientId;

  let banner = null;
  if (tapIn.winner) {
    if (isSelector) banner = 'You got it! Pick a category and difficulty.';
    else if (tapIn.openFor === myTeamId) banner = `${findPlayerName(teams, myTeamId, tapIn.winner) || 'Your teammate'} is choosing for your team!`;
    else banner = `${activeTeam ? activeTeam.name : 'Another team'} is choosing…`;
  } else if (tapIn.openFor && tapIn.openFor !== myTeamId) {
    banner = `Waiting for ${(teams[tapIn.openFor] && teams[tapIn.openFor].name) || 'the next team'} to tap in…`;
  }

  const tiles = Object.keys(board)
    .filter((slug) => !categoryEmpty(board, slug))
    .map((slug) => boardTile({ slug, meta: categoryMeta[slug], tiers: board[slug], selectable: isSelector, myTeamId, handlers }));

  return el('div', { class: 'screen' }, [
    banner && el('div', { class: 'board-banner' }, banner),
    el('div', { class: 'board-grid' }, tiles),
  ]);
}

function boardTile({ slug, meta, tiers, selectable, myTeamId, handlers }) {
  const name = (meta && meta.name) || slug;
  const icon = meta && meta.icon;
  const counts = ['E', 'M', 'H'].map((d) => `${d}:${(tiers[d] || []).length}`).join('  ');
  return el('div', {
    class: `board-tile${selectable ? '' : ' is-readonly'}`,
    onClick: selectable
      ? () => openDifficultySheet({ slug, meta, tiers, onPick: (dif, btn) => handlers.requestSelection({ teamId: myTeamId, slug, dif }, btn) })
      : undefined,
  }, [
    icon && el('img', { src: iconUrl(icon), alt: '' }),
    el('div', { class: 'board-tile-name' }, name),
    el('div', { class: 'hint-text' }, counts),
  ]);
}

/** Bottom-sheet-style difficulty picker (PRD: "tappable category tiles → difficulty sheet"). */
function openDifficultySheet({ slug, meta, tiers, onPick }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  const name = (meta && meta.name) || slug;
  const btns = ['E', 'M', 'H'].map((dif) => {
    const count = (tiers[dif] || []).length;
    const isEmpty = tierEmpty({ [slug]: tiers }, slug, dif) || count === 0;
    return el('button', {
      class: `btn btn-big tier-btn ${difficultyClass(dif)}`, type: 'button', disabled: isEmpty,
      onClick: (e) => { onPick(dif, e.currentTarget); close(); },
    }, `${difficultyLabel(dif)} (${count})`);
  });
  overlay.appendChild(el('div', { class: 'modal-box difficulty-sheet' }, [
    el('h3', {}, name),
    ...btns,
    el('button', { class: 'btn btn-ghost', type: 'button', onClick: close }, 'Cancel'),
  ]));
  document.body.appendChild(overlay);
}

function questionScreen({ tree, teams, myTeamId, clientId, handlers, getServerNow, onCountdown }) {
  const game = tree.game;
  const q = game.question;
  const round = tree.settings.rounds[game.round];
  const dif = parseRef(q.ref).id[0];
  const activeTeamId = game.activeTeam;
  const value = q.value;
  const locks = q.locks || {};
  const myLock = myTeamId ? locks[myTeamId] : null;
  const selectorLock = locks[activeTeamId];

  const modeCtx = { locks, correct: null, roundCfg: round, selectingTeamId: activeTeamId, teamIds: Object.keys(teams), value };
  const iMayAnswer = myTeamId ? MODES[round.mode].mayAnswer(myTeamId, modeCtx) : false;
  const isRevealed = q.state === 'revealed' || q.state === 'scored';
  const result = q.result;

  function attemptLock(letter, btn) {
    const isContestCounter = round.mode === 'contest' && myTeamId !== activeTeamId;
    if (isContestCounter) {
      const selectorName = (teams[activeTeamId] && teams[activeTeamId].name) || 'the selector';
      confirmDialog(`CONTEST with ${selectorName}?`).then((ok) => {
        if (ok) handlers.lockAnswer(myTeamId, letter, btn);
      });
    } else {
      handlers.lockAnswer(myTeamId, letter, btn);
    }
  }

  const options = q.payload.options.map((optText, idx) => {
    const letter = OPTION_LETTERS[idx];
    let cls = 'option-btn';
    let disabled = true;
    let onClick;

    if (isRevealed) {
      if (result && result.correct === letter) cls += ' is-correct';
      else if (myLock && myLock.choice === letter) cls += ' is-wrong';
    } else {
      if (selectorLock && selectorLock.choice === letter) cls += ' is-selector-lock';
      if (myLock) {
        if (myLock.choice === letter) cls += ' is-locked-mine';
      } else if (iMayAnswer && q.state === 'open') {
        const blockedByContest = round.mode === 'contest' && myTeamId !== activeTeamId && selectorLock && selectorLock.choice === letter;
        if (blockedByContest) {
          cls += ' is-contest-blocked';
        } else {
          disabled = false;
          onClick = (e) => attemptLock(letter, e.currentTarget);
        }
      }
    }
    return el('button', { class: cls, type: 'button', disabled, onClick }, [el('span', { class: 'opt-letter' }, `${letter}.`), el('span', {}, optText)]);
  });

  const banners = [];
  if (!myTeamId) banners.push('Spectating — you are not on a team.');
  else if (myLock) banners.push(`Locked in: ${myLock.choice}. Waiting for reveal…`);
  else if (q.state === 'locked') banners.push("Time's up! Waiting for reveal.");
  else if (q.state === 'selecting') banners.push('Get ready…');
  else if (!iMayAnswer && q.state === 'open') banners.push(eligibilityBanner(round.mode, activeTeamId, teams, selectorLock));

  const countdownBox = el('div', {});
  const body = [
    el('div', { class: `question-title ${difficultyClass(dif)}` }, `${roundModeLabel(round.mode)} — ${difficultyLabel(dif)} (${value} pts)`),
    el('div', { class: 'question-text' }, q.payload.q),
    countdownBox,
    ...banners.map((b) => el('p', { class: 'hint-text' }, b)),
    el('div', { class: 'options-grid' }, options),
  ];

  if (q.state === 'open' && q.deadline && onCountdown) {
    onCountdown(mountCountdown(countdownBox, { deadline: q.deadline, openedAt: q.openedAt, getServerNow }));
  }

  if (result) {
    const myDelta = myTeamId ? result.deltas[myTeamId] : undefined;
    if (myDelta !== undefined) {
      body.push(el('div', { class: `delta-banner ${myDelta > 0 ? 'is-pos' : myDelta < 0 ? 'is-neg' : ''}` }, formatDelta(myDelta)));
    }
    body.push(standingsList(teams));
  }

  return el('div', { class: 'screen' }, body);
}

function eligibilityBanner(mode, activeTeamId, teams, selectorLock) {
  const activeName = (teams[activeTeamId] && teams[activeTeamId].name) || 'the active team';
  if (mode === 'exclusive') return `Only ${activeName} can answer this one.`;
  if (mode === 'contest') {
    return selectorLock ? `${activeName} locked in — pick a different answer to contest!` : `Waiting for ${activeName} to answer first…`;
  }
  return 'Waiting…';
}
