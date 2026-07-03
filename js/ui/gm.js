/**
 * @file GM console (PRD §6): pre-create settings (categories/rounds/global),
 * lobby manager (rename/reorder/lock), live game console (question preview
 * WITH correct answer + fun fact, reveal/lock/skip, per-team delta editor),
 * extras (score adjust / end round / end game / room code+URL), presence.
 * GM is the sole writer of game state (PRD §5.1) — every write goes through
 * js/engine/actions.js. Also runs two background observers while mounted:
 * the select-intent fulfiller and the timer-expiry auto-locker.
 *
 * GM keeps the full loaded question bank in memory (`bank`, keyed by
 * "slug:id") — the correct answer and fun fact for the live question are
 * looked up LOCALLY here and never synced (PRD criterion 11).
 *
 * Round/order settings are editable pre-creation AND between questions
 * (actions.updateRoundSettings refuses while a question is live); the GM's
 * local draft hydrates from synced settings on (re)join so a refreshed GM
 * tab edits what the room actually uses. Score adjust and end-round /
 * end-game are wired to actions.adjustScore/endRound/endGame. The category
 * picker preloads questions/game-defaults.json, and the board section offers
 * a one-tap import of questions/used-legacy.json (v6 archive used-status)
 * into this device's used-question memory.
 */
import * as actions from '../engine/actions.js';
import { loadCategories, parseRef } from '../engine/questions.js';
import { buildBoard, drawQuestion, categoryEmpty, tierEmpty } from '../engine/board.js';
import { DEFAULT_ROUNDS } from '../engine/scoring.js';
import * as storage from '../engine/storage.js';
import {
  el, mount, iconUrl, OPTION_LETTERS, difficultyLabel, difficultyClass,
  roundModeLabel, teamPill, standingsList, mountCountdown, confirmDialog,
  joinUrl, showBanner, createStaleQuestionDetector,
} from './components.js';

const ROUND_MODES = ['community', 'exclusive', 'contest', 'suddendeath'];
const ORDER_MODES = ['registration', 'winnerFirst', 'loserFirst'];
const PENALTY_MODES = ['on', 'off', 'half'];

/**
 * @param {HTMLElement} rootEl
 * @param {Object} ctx
 * @returns {() => void} teardown
 */
export function init(rootEl, ctx) {
  const { sync, clientId } = ctx;

  let categories = [];
  let catMap = new Map();
  let bank = new Map(); // "slug:id" -> question incl. answer/fact — LOCAL ONLY, never synced
  let usedSet = new Set(storage.loadUsed());
  const draft = {
    tierSize: 4,
    boardSize: 10,
    excludeUsed: storage.excludeUsedToggle(),
    orderRecalc: 'perRound',
    categorySlugs: [],
    rounds: DEFAULT_ROUNDS.map((r) => ({ ...r })),
  };
  let settingsOpen = false;
  let presenceList = [];
  let countdownHandle = null;
  let lockTimer = null;
  let lastTree = null;
  let handlingIntent = false;
  let hydratedFromTree = false;
  let deltaEdits = { ref: null, values: {} }; // survives presence-driven rerenders
  const staleCheck = createStaleQuestionDetector();

  loadCategories()
    .then(async ({ categories: cats, errors }) => {
      categories = cats;
      catMap = new Map(cats.map((c) => [c.slug, c]));
      bank = new Map();
      for (const cat of cats) {
        for (const q of cat.questions) bank.set(`${cat.slug}:${q.id}`, { ...q, slug: cat.slug });
      }
      if (draft.categorySlugs.length === 0) {
        // Board preset (e.g. the planned game night) beats first-N-alphabetical.
        const defaults = await fetch('questions/game-defaults.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const preset = defaults && Array.isArray(defaults.categories)
          ? defaults.categories.filter((s) => catMap.has(s))
          : [];
        draft.categorySlugs = preset.length ? preset : cats.slice(0, draft.boardSize).map((c) => c.slug);
      }
      if (errors.length) {
        console.error('Question bank errors:', errors);
        showBanner(`Question bank has ${errors.length} error(s) in questions/*.md — see console.`, { kind: 'error', autoHideMs: 8000 });
      }
      renderNow();
    })
    .catch((e) => ctx.reportError(e));

  function renderNow() {
    render(lastTree);
  }

  function run(btn, promise) {
    if (btn) btn.disabled = true;
    promise.catch((e) => ctx.reportError && ctx.reportError(e)).finally(() => {
      if (btn) btn.disabled = false;
    });
  }

  // -------------------------------------------------------------------
  // Background observers (independent of what's currently rendered)
  // -------------------------------------------------------------------

  function armLockTimer(question) {
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
    if (question && question.state === 'open' && question.deadline) {
      const delay = Math.max(0, question.deadline - sync.serverNow());
      lockTimer = setTimeout(() => {
        actions.lockQuestion(sync, 'gm').catch(() => {});
      }, delay);
    }
  }

  function handleSelectIntent(intent) {
    if (!intent || handlingIntent) return;
    handlingIntent = true;
    fulfilIntent(intent)
      .catch((e) => ctx.reportError(e))
      .finally(() => { handlingIntent = false; });
  }

  async function fulfilIntent(intent) {
    const tree = lastTree;
    const board = (tree && tree.game && tree.game.board) || {};
    if (tierEmpty(board, intent.slug, intent.dif)) {
      await actions.clearSelectIntent(sync, 'gm');
      return;
    }
    const { ref } = drawQuestion(board, intent.slug, intent.dif);
    if (!ref) {
      await actions.clearSelectIntent(sync, 'gm');
      return;
    }
    const full = bank.get(ref);
    if (!full) {
      // Bank not loaded yet (boot race) — clear so the player can retry.
      await actions.clearSelectIntent(sync, 'gm');
      return;
    }
    const round = (tree.settings.rounds || [])[tree.game.round];
    await actions.selectQuestion(sync, 'gm', ref, { q: full.q, options: full.options });
    const deadline = round.timerSec ? sync.serverNow() + round.timerSec * 1000 : 0;
    await actions.openQuestion(sync, 'gm', deadline);
    await actions.clearSelectIntent(sync, 'gm');
  }

  const unsubTree = sync.onChange('/', (tree) => {
    lastTree = tree;
    // A refreshed GM tab must edit the room's REAL settings, not defaults.
    if (!hydratedFromTree && tree && tree.settings) {
      hydratedFromTree = true;
      const s = tree.settings;
      draft.tierSize = s.tierSize ?? draft.tierSize;
      draft.boardSize = s.boardSize ?? draft.boardSize;
      draft.excludeUsed = s.excludeUsed !== false;
      draft.orderRecalc = s.orderRecalc || draft.orderRecalc;
      if (Array.isArray(s.categories) && s.categories.length) draft.categorySlugs = [...s.categories];
      if (Array.isArray(s.rounds) && s.rounds.length) draft.rounds = s.rounds.map((r) => ({ ...r }));
    }
    render(tree);
  });
  const unsubIntent = sync.onChange('game/selectIntent', handleSelectIntent);
  const unsubQuestion = sync.onChange('game/question', armLockTimer);
  const unsubPresence = sync.onPresence((roster) => {
    presenceList = roster;
    renderNow();
  });

  // -------------------------------------------------------------------
  // Render dispatch
  // -------------------------------------------------------------------

  function render(tree) {
    if (countdownHandle) {
      countdownHandle.destroy();
      countdownHandle = null;
    }
    if (!tree) {
      mount(rootEl, centerMessage('Connecting…'));
      return;
    }
    if (!tree.meta) {
      mount(rootEl, preCreateScreen());
      return;
    }

    let body;
    if (tree.meta.status === 'lobby') body = lobbyConsole(tree);
    else if (tree.meta.status === 'playing') body = gameConsole(tree);
    else body = endedConsole(tree);

    mount(rootEl, el('div', { class: 'screen screen-wide' }, [gmHeader(tree), body]));
  }

  // -------------------------------------------------------------------
  // Pre-create: settings + categories + rounds, then "Create Room"
  // -------------------------------------------------------------------

  function preCreateScreen() {
    const canCreate = draft.categorySlugs.length > 0;
    return el('div', { class: 'screen screen-wide' }, [
      el('h2', {}, 'Set up your game'),
      categories.length === 0 && el('p', { class: 'hint-text' }, 'Loading question bank…'),
      settingsPanel({ editableRoundsAndOrder: true }),
      el('button', {
        class: 'btn btn-big btn-primary', type: 'button', disabled: !canCreate,
        onClick: (e) => {
          e.currentTarget.disabled = true;
          actions.createRoomState(sync, 'gm', {
            clientId,
            settings: {
              orderRecalc: draft.orderRecalc,
              tierSize: draft.tierSize,
              boardSize: draft.boardSize,
              categories: draft.categorySlugs,
              excludeUsed: draft.excludeUsed,
              rounds: draft.rounds,
            },
            teams: [],
          }).catch((err) => {
            ctx.reportError(err);
            e.currentTarget.disabled = false;
          });
        },
      }, 'Create Room'),
    ]);
  }

  function freshCount(cat, dif) {
    return cat.questions.filter((q) => q.dif === dif && !(draft.excludeUsed && usedSet.has(`${cat.slug}:${q.id}`))).length;
  }

  function settingsPanel({ editableRoundsAndOrder }) {
    const categoryGrid = el('div', { class: 'category-grid' }, categories.map((cat) => {
      const selected = draft.categorySlugs.includes(cat.slug);
      const atCap = !selected && draft.categorySlugs.length >= draft.boardSize;
      const counts = ['E', 'M', 'H'].map((d) => `${d}:${freshCount(cat, d)}`).join('  ');
      return el('div', {
        class: `category-card${selected ? ' is-selected' : ''}${atCap ? ' is-disabled' : ''}`,
        onClick: () => {
          if (selected) draft.categorySlugs = draft.categorySlugs.filter((s) => s !== cat.slug);
          else if (!atCap) draft.categorySlugs = [...draft.categorySlugs, cat.slug];
          renderNow();
        },
      }, [
        cat.icon && el('img', { src: iconUrl(cat.icon), alt: '' }),
        el('div', {}, cat.name),
        el('div', { class: 'cat-counts' }, counts),
      ]);
    }));

    const boardSection = el('div', { class: 'settings-section' }, [
      el('h3', {}, `Categories (${draft.categorySlugs.length}/${draft.boardSize})`),
      categoryGrid,
      el('div', { class: 'round-row-grid' }, [
        numberField('Questions per tier', draft.tierSize, (v) => { draft.tierSize = Math.max(1, v); renderNow(); }),
        numberField('Board size (categories)', draft.boardSize, (v) => { draft.boardSize = Math.max(1, v); renderNow(); }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Exclude previously used questions'),
        el('input', { type: 'checkbox', checked: draft.excludeUsed, onChange: (e) => { draft.excludeUsed = e.target.checked; storage.excludeUsedToggle(draft.excludeUsed); renderNow(); } }),
      ]),
      el('div', { class: 'form-row' }, [
        el('button', { class: 'btn btn-small btn-secondary', type: 'button', onClick: () => { storage.resetUsed(); usedSet = new Set(); renderNow(); } }, 'Reset used-question memory'),
        el('button', {
          class: 'btn btn-small btn-secondary', type: 'button',
          onClick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const refs = await fetch('questions/used-legacy.json').then((r) => r.json());
              storage.recordUsed(refs);
              usedSet = new Set(storage.loadUsed());
              showBanner(`Imported ${refs.length} used-question refs from the v6 archive.`, { autoHideMs: 4000 });
              renderNow();
            } catch (err) {
              ctx.reportError(err);
              btn.disabled = false;
            }
          },
        }, 'Import v6 used list'),
      ]),
    ]);

    const roomExists = !!(lastTree && lastTree.meta);
    const questionLive = !!(lastTree && lastTree.game && lastTree.game.question);
    const canEdit = editableRoundsAndOrder || !questionLive;
    const orderSection = el('div', { class: `settings-section${canEdit ? '' : ' is-locked'}` }, [
      el('h3', {}, canEdit ? 'Rounds' : 'Rounds (locked while a question is live)'),
      selectField('Order recalculation', draft.orderRecalc, ['perRound', 'perRotation'], canEdit, (v) => { draft.orderRecalc = v; renderNow(); }),
      roundTable(canEdit),
      roomExists && canEdit && el('button', {
        class: 'btn btn-secondary', type: 'button',
        onClick: (e) => run(e.currentTarget, actions.updateRoundSettings(sync, 'gm', { rounds: draft.rounds, orderRecalc: draft.orderRecalc }).then((res) => {
          if (res && res.committed) showBanner('Round settings applied.', { autoHideMs: 3000 });
          else showBanner('Refused: a question is in progress.', { kind: 'error', autoHideMs: 4000 });
        })),
      }, 'Apply round changes'),
    ]);

    return el('div', { class: 'settings-panel' }, [boardSection, orderSection]);
  }

  function roundTable(editable) {
    const rows = draft.rounds.map((r, idx) => el('div', { class: 'round-row' }, [
      el('div', { class: 'round-row-controls' }, [
        el('strong', {}, `Round ${idx + 1} — ${roundModeLabel(r.mode)}`),
        editable && el('div', { class: 'reorder-btns' }, [
          el('button', { class: 'btn btn-small', type: 'button', disabled: idx === 0, onClick: () => moveRound(idx, -1) }, '▲'),
          el('button', { class: 'btn btn-small', type: 'button', disabled: idx === draft.rounds.length - 1, onClick: () => moveRound(idx, 1) }, '▼'),
          el('button', { class: 'btn btn-small btn-danger', type: 'button', disabled: draft.rounds.length <= 1, onClick: () => { draft.rounds.splice(idx, 1); renderNow(); } }, 'Remove'),
        ]),
      ]),
      el('div', { class: 'round-row-grid' }, [
        selectField('Mode', r.mode, ROUND_MODES, editable, (v) => { r.mode = v; renderNow(); }),
        numberField('Rotations', r.rotations, (v) => { r.rotations = Math.max(1, v); renderNow(); }, !editable),
        numberField('Multiplier', r.multiplier, (v) => { r.multiplier = Math.max(1, v); renderNow(); }, !editable),
        selectField('Penalty', r.penalty, PENALTY_MODES, editable, (v) => { r.penalty = v; renderNow(); }),
        selectField('Order mode', r.orderMode, ORDER_MODES, editable, (v) => { r.orderMode = v; renderNow(); }),
        numberField('Timer sec (0=none)', r.timerSec, (v) => { r.timerSec = Math.max(0, v); renderNow(); }, !editable),
      ]),
    ]));
    return el('div', { class: 'round-table' }, [
      ...rows,
      editable && el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { draft.rounds.push({ ...DEFAULT_ROUNDS[0] }); renderNow(); } }, 'Add round'),
    ]);
  }

  function moveRound(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= draft.rounds.length) return;
    const tmp = draft.rounds[idx];
    draft.rounds[idx] = draft.rounds[j];
    draft.rounds[j] = tmp;
    renderNow();
  }

  // -------------------------------------------------------------------
  // Header (persistent: room code/URL, presence, settings toggle)
  // -------------------------------------------------------------------

  function gmHeader(tree) {
    const presenceEls = presenceList.map((p) => el('span', { class: `presence-dot${p.connected ? '' : ' is-off'}`, title: p.role }));
    return el('div', { class: 'gm-header' }, [
      el('div', {}, [
        el('div', { class: 'room-code-display' }, ctx.roomCode),
        el('div', { class: 'join-url' }, joinUrl(ctx.roomCode, 'player')),
      ]),
      el('div', { class: 'presence-list' }, presenceEls),
      el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => { settingsOpen = !settingsOpen; renderNow(); } }, settingsOpen ? 'Close settings' : 'Settings'),
    ]);
  }

  // -------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------

  function lobbyConsole(tree) {
    const teams = tree.teams || {};
    const locked = !!tree.meta.registrationLocked;
    const sorted = Object.entries(teams).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    const teamRows = sorted.map(([id, t], idx) => el('div', { class: 'lobby-team-card' }, [
      el('div', { class: 'lobby-team-head' }, [
        teamPill(t),
        el('div', { class: 'reorder-btns' }, [
          el('button', { class: 'btn btn-small', type: 'button', disabled: idx === 0, onClick: (e) => reorderTeam(sorted, idx, -1, e.currentTarget) }, '▲'),
          el('button', { class: 'btn btn-small', type: 'button', disabled: idx === sorted.length - 1, onClick: (e) => reorderTeam(sorted, idx, 1, e.currentTarget) }, '▼'),
          el('button', { class: 'btn btn-small', type: 'button', onClick: () => renameTeam(id, t) }, 'Rename'),
        ]),
      ]),
      el('div', { class: 'lobby-team-players' }, Object.values(t.players || {}).map((p) => el('span', { class: 'lobby-player-chip' }, p.name))),
    ]));

    return el('div', { class: 'gm-grid' }, [
      el('div', {}, [
        el('h2', {}, 'Lobby'),
        settingsOpen ? settingsPanel({ editableRoundsAndOrder: false }) : null,
        el('div', { class: 'lobby-list' }, teamRows),
      ]),
      el('div', { class: 'gm-panel extras-panel' }, [
        el('h3', {}, 'Registration'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: (e) => run(e.currentTarget, actions.lockRegistration(sync, 'gm', !locked)) }, locked ? 'Unlock registration' : 'Lock registration'),
        el('button', {
          class: 'btn btn-big btn-primary', type: 'button', disabled: Object.keys(teams).length < 2,
          onClick: (e) => startGame(e.currentTarget),
        }, 'Build board & start'),
        ...extrasPanel(tree),
      ]),
    ]);
  }

  function renameTeam(teamId, team) {
    const name = prompt('Team name', team.name);
    if (name && name.trim()) actions.gmUpdateTeam(sync, 'gm', teamId, { name: name.trim() }).catch(ctx.reportError);
  }

  function reorderTeam(sortedArr, idx, dir, btn) {
    const j = idx + dir;
    if (j < 0 || j >= sortedArr.length) return;
    const [idA, teamA] = sortedArr[idx];
    const [idB, teamB] = sortedArr[j];
    run(btn, Promise.all([
      actions.gmUpdateTeam(sync, 'gm', idA, { order: teamB.order }),
      actions.gmUpdateTeam(sync, 'gm', idB, { order: teamA.order }),
    ]));
  }

  function startGame(btn) {
    btn.disabled = true;
    const usedRefs = draft.excludeUsed ? usedSet : [];
    const { board } = buildBoard({
      categories,
      settings: { categories: draft.categorySlugs, tierSize: draft.tierSize, excludeUsed: draft.excludeUsed },
      usedRefs,
    });
    actions.setBoard(sync, 'gm', board)
      .then(() => actions.startGame(sync, 'gm'))
      .then((res) => res && res.activeTeam && actions.openTapIn(sync, 'gm', res.activeTeam))
      .catch((err) => {
        ctx.reportError(err);
        btn.disabled = false;
      });
  }

  // -------------------------------------------------------------------
  // In-game console
  // -------------------------------------------------------------------

  function gameConsole(tree) {
    const game = tree.game;
    const questionLive = game.question && !staleCheck.check(tree);
    let mainPanel;
    if (!questionLive) {
      mainPanel = boardOverview(tree);
    } else if (game.question.state === 'selecting') {
      mainPanel = centerMessage('Preparing question…');
    } else if (game.question.state === 'revealed' || game.question.state === 'scored') {
      mainPanel = scoringConsole(tree);
    } else {
      mainPanel = questionConsole(tree);
    }
    return el('div', { class: 'gm-grid' }, [
      el('div', {}, [settingsOpen ? settingsPanel({ editableRoundsAndOrder: false }) : null, mainPanel]),
      el('div', { class: 'gm-panel extras-panel' }, extrasPanel(tree)),
    ]);
  }

  function boardOverview(tree) {
    const game = tree.game;
    const teams = tree.teams || {};
    const tapIn = game.tapIn || {};
    const board = game.board || {};
    const status = tapIn.winner
      ? `${findPlayerName(teams, game.activeTeam, tapIn.winner) || 'Selector'} (${(teams[game.activeTeam] || {}).name || ''}) is choosing…`
      : `Waiting for ${(teams[tapIn.openFor] || {}).name || '—'} to tap in…`;

    const activeSlugs = Object.keys(board).filter((slug) => !categoryEmpty(board, slug));
    if (activeSlugs.length === 0 && Object.keys(board).length > 0) {
      return el('div', { class: 'gm-panel' }, [el('p', {}, 'Board is empty — every category is exhausted. Consider ending the game.'), el('p', { class: 'hint-text' }, status)]);
    }

    const tiles = activeSlugs.map((slug) => {
      const meta = catMap.get(slug);
      const tiers = board[slug];
      const counts = ['E', 'M', 'H'].map((d) => `${d}:${(tiers[d] || []).length}`).join('  ');
      return el('div', { class: 'board-tile is-readonly' }, [
        meta && meta.icon && el('img', { src: iconUrl(meta.icon), alt: '' }),
        el('div', { class: 'board-tile-name' }, (meta && meta.name) || slug),
        el('div', { class: 'hint-text' }, counts),
      ]);
    });

    return el('div', { class: 'gm-panel' }, [
      el('h3', {}, 'Board'),
      el('p', { class: 'hint-text' }, status),
      el('div', { class: 'board-grid' }, tiles),
    ]);
  }

  function questionConsole(tree) {
    const game = tree.game;
    const q = game.question;
    const teams = tree.teams || {};
    const round = tree.settings.rounds[game.round];
    const full = bank.get(q.ref);
    const dif = parseRef(q.ref).id[0];

    const options = q.payload.options.map((optText, idx) => {
      const letter = OPTION_LETTERS[idx];
      const isCorrect = full && full.answer === letter;
      const lockedTeams = Object.entries(q.locks || {}).filter(([, l]) => l.choice === letter).map(([teamId]) => teams[teamId]).filter(Boolean);
      return el('div', { class: `option-btn${isCorrect ? ' is-gm-correct-marker' : ''}` }, [
        el('span', { class: 'opt-letter' }, `${letter}.`),
        el('span', {}, optText),
        lockedTeams.length ? el('div', { class: 'lock-tags' }, lockedTeams.map((t) => el('span', { class: 'lock-tag', style: { background: t.color } }))) : null,
      ]);
    });

    const locksList = el('div', { class: 'locks-list' }, Object.entries(q.locks || {}).map(([teamId, l]) =>
      el('div', { class: 'lock-row' }, [teamPill(teams[teamId] || { name: teamId }), el('span', { class: 'lock-choice' }, l.choice)])
    ));

    const countdownBox = el('div', {});
    const body = [
      el('div', { class: `question-title ${difficultyClass(dif)}` }, `${roundModeLabel(round.mode)} — ${difficultyLabel(dif)} (${q.value} pts)`),
      el('div', { class: 'question-text' }, q.payload.q),
      countdownBox,
      el('div', { class: 'options-grid' }, options),
      full && el('div', { class: 'fact-card' }, [el('div', { class: 'fact-label' }, 'Fun fact (GM only)'), el('div', {}, full.fact || '—')]),
      el('h3', {}, `Locks (${Object.keys(q.locks || {}).length})`),
      locksList,
      el('div', { class: 'form-row' }, [
        el('button', { class: 'btn btn-secondary', type: 'button', disabled: q.state !== 'open', onClick: (e) => run(e.currentTarget, actions.lockQuestion(sync, 'gm')) }, 'Lock now'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: (e) => run(e.currentTarget, actions.skipQuestion(sync, 'gm')) }, 'Skip'),
        el('button', {
          class: 'btn btn-big btn-primary', type: 'button', disabled: !full,
          onClick: (e) => run(e.currentTarget, actions.revealQuestion(sync, 'gm', full.answer, (ref) => { storage.recordUsed([ref]); usedSet.add(ref); })),
        }, full ? 'Reveal' : 'Loading answer key…'),
      ]),
    ];

    if (q.state === 'open' && q.deadline) {
      countdownHandle = mountCountdown(countdownBox, { deadline: q.deadline, openedAt: q.openedAt, getServerNow: sync.serverNow });
    }

    return el('div', { class: 'gm-panel' }, body);
  }

  function scoringConsole(tree) {
    const game = tree.game;
    const q = game.question;
    const teams = tree.teams || {};
    const full = bank.get(q.ref);
    const dif = parseRef(q.ref).id[0];
    // Persist in-progress overrides across rerenders (presence updates rerender
    // every ~2s; a per-render object would wipe the GM's typed edits).
    if (deltaEdits.ref !== q.ref) {
      deltaEdits = { ref: q.ref, values: { ...(q.result ? q.result.deltas : {}) } };
    }
    const edited = deltaEdits.values;

    const options = q.payload.options.map((optText, idx) => {
      const letter = OPTION_LETTERS[idx];
      let cls = 'option-btn';
      if (q.result && q.result.correct === letter) cls += ' is-correct';
      else if (Object.values(q.locks || {}).some((l) => l.choice === letter)) cls += ' is-wrong';
      return el('div', { class: cls }, [el('span', { class: 'opt-letter' }, `${letter}.`), el('span', {}, optText)]);
    });

    const rows = Object.entries(teams).map(([teamId, t]) => {
      const input = el('input', {
        type: 'number', value: edited[teamId] || 0,
        onChange: (e) => { edited[teamId] = parseInt(e.target.value, 10) || 0; },
      });
      const setVal = (v) => { edited[teamId] = v; input.value = v; };
      return el('div', { class: 'delta-row' }, [
        teamPill(t),
        input,
        el('div', { class: 'delta-quick-btns' }, [
          el('button', { class: 'btn btn-small btn-minus', type: 'button', onClick: () => setVal(-q.value) }, `−${q.value}`),
          el('button', { class: 'btn btn-small btn-nil', type: 'button', onClick: () => setVal(0) }, '0'),
          el('button', { class: 'btn btn-small btn-plus', type: 'button', onClick: () => setVal(q.value) }, `+${q.value}`),
        ]),
      ]);
    });

    const applyBtn = el('button', {
      class: 'btn btn-big btn-primary', type: 'button',
      onClick: (e) => {
        e.currentTarget.disabled = true;
        actions.commitScores(sync, 'gm', edited)
          .then(() => actions.advance(sync, 'gm'))
          .catch((err) => {
            ctx.reportError(err);
            e.currentTarget.disabled = false;
          });
      },
    }, 'Apply & back to board');

    return el('div', { class: 'gm-panel' }, [
      el('div', { class: `question-title ${difficultyClass(dif)}` }, `${difficultyLabel(dif)} (${q.value} pts) — Correct: ${q.result ? q.result.correct : '—'}`),
      el('div', { class: 'question-text' }, q.payload.q),
      el('div', { class: 'options-grid' }, options),
      full && el('div', { class: 'fact-card' }, [el('div', { class: 'fact-label' }, 'Fun fact (GM only)'), el('div', {}, full.fact || '—')]),
      el('h3', {}, 'Scores'),
      el('div', { class: 'delta-editor' }, rows),
      applyBtn,
    ]);
  }

  // -------------------------------------------------------------------
  // Extras panel (room code/URL, score adjust, end round/game)
  // -------------------------------------------------------------------

  function extrasPanel(tree) {
    const teams = tree.teams || {};
    return [
      el('h3', {}, 'Room'),
      el('div', { class: 'room-code-display' }, ctx.roomCode),
      el('div', { class: 'join-url' }, joinUrl(ctx.roomCode, 'player')),
      el('p', { class: 'hint-text' }, 'QR code: TODO — out of scope for v1 (PRD §6); share the link/code above.'),
      el('h3', {}, 'Score adjust'),
      ...Object.entries(teams).map(([id, t]) => scoreAdjustRow(id, t)),
      el('h3', {}, 'Round / game control'),
      el('button', {
        class: 'btn btn-secondary', type: 'button',
        onClick: (e) => {
          const btn = e.currentTarget;
          confirmDialog('End this round now? Any live question is discarded unscored.').then((ok) => {
            if (ok) run(btn, actions.endRound(sync, 'gm'));
          });
        },
      }, 'End round early'),
      el('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: (e) => {
          const btn = e.currentTarget;
          confirmDialog('End the game now? Current scores become final.').then((ok) => {
            if (ok) run(btn, actions.endGame(sync, 'gm'));
          });
        },
      }, 'End game'),
    ];
  }

  function scoreAdjustRow(teamId, team) {
    return el('div', { class: 'delta-row' }, [
      teamPill(team),
      el('div', { class: 'delta-quick-btns' }, [
        el('button', { class: 'btn btn-small btn-minus', type: 'button', onClick: (e) => run(e.currentTarget, actions.adjustScore(sync, 'gm', teamId, -1)) }, '−1'),
        el('button', { class: 'btn btn-small btn-plus', type: 'button', onClick: (e) => run(e.currentTarget, actions.adjustScore(sync, 'gm', teamId, +1)) }, '+1'),
      ]),
    ]);
  }

  function endedConsole(tree) {
    return el('div', { class: 'gm-panel' }, [el('h2', {}, 'Game Over'), standingsList(tree.teams || {})]);
  }

  return () => {
    unsubTree();
    unsubIntent();
    unsubQuestion();
    unsubPresence();
    if (countdownHandle) countdownHandle.destroy();
    if (lockTimer) clearTimeout(lockTimer);
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (no closure state needed)
// ---------------------------------------------------------------------------

function centerMessage(msg) {
  return el('div', { class: 'screen' }, [el('div', { class: 'center-message' }, [el('p', {}, msg)])]);
}

function findPlayerName(teams, teamId, playerId) {
  const team = teams[teamId];
  return team && team.players && team.players[playerId] && team.players[playerId].name;
}

function numberField(label, value, onChange, disabled = false) {
  return el('div', { class: 'field' }, [
    el('label', {}, label),
    el('input', { type: 'number', value, min: 0, disabled, onChange: (e) => onChange(parseInt(e.target.value, 10) || 0) }),
  ]);
}

function selectField(label, value, options, enabled, onChange) {
  return el('div', { class: 'field' }, [
    el('label', {}, label),
    el('select', { value, disabled: !enabled, onChange: (e) => onChange(e.target.value) }, options.map((o) => el('option', { value: o }, o))),
  ]);
}
