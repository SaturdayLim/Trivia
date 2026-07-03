/**
 * @file Boot + routing for the Stack trivia app. Parses location.hash,
 * renders the entry/join screens, establishes the realtime sync connection
 * (PRD §5.2), then hands off to the matching js/ui/<role>.js module.
 *
 * This is the ONLY file that imports a sync driver — swapping to Firebase
 * later means changing the one import below; nothing else (including every
 * js/ui/*.js module) references a driver module directly.
 */
import { createSync } from './sync/adapter.js';
// SWAP POINT: replace with `import * as driver from './sync/driver-firebase.js';`
// to move from same-device testing to real Firebase RTDB sync. createSync's
// contract is driver-agnostic, so nothing else in the app needs to change.
import * as driver from './sync/driver-mock.js';
import { registerClient } from './engine/actions.js';
import { getOrCreateClientId, loadIdentity, saveIdentity } from './engine/storage.js';
import { applyPalette } from './ui/palette.js';
import { genRoomCode, renderEntryScreen, mount, el, showBanner, hideBanner } from './ui/components.js';
import * as playerUi from './ui/player.js';
import * as gmUi from './ui/gm.js';
import * as displayUi from './ui/display.js';

const ROLES = ['player', 'gm', 'display'];
const ROLE_MODULES = { player: playerUi, gm: gmUi, display: displayUi };

const rootEl = document.getElementById('app');
const clientId = getOrCreateClientId();
const paletteReady = applyPalette();

/** @type {?{key: string, sync: import('./sync/adapter.js').SyncHandle, teardown: ?Function}} */
let active = null;

/** @param {string} hash @returns {{role: ?string, roomCode: ?string}} */
function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [routePart, queryPart] = raw.split('?');
  const role = ROLES.includes(routePart) ? routePart : null;
  const params = new URLSearchParams(queryPart || '');
  return { role, roomCode: (params.get('room') || '').toUpperCase() || null };
}

/** @param {string} role @param {string} roomCode */
function setHash(role, roomCode) {
  const next = `#/${role}${roomCode ? `?room=${roomCode}` : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** Shared error reporter handed to every role module via ctx.reportError. */
function reportError(err) {
  console.error(err);
  const message = (err && err.message) || String(err);
  showBanner(`Connection problem: ${message}`, { kind: 'error', autoHideMs: 6000 });
}

/** @returns {Promise<import('./sync/adapter.js').SyncHandle>} */
async function connect({ roomCode, role, create = false }) {
  return createSync({ driver, roomCode, clientId, role, create, initialState: create ? {} : null });
}

function renderLoading(message) {
  mount(rootEl, el('div', { class: 'screen' }, [el('div', { class: 'center-message' }, [el('p', {}, message)])]));
}

function renderConnectError(message, onRetry) {
  mount(rootEl, el('div', { class: 'screen' }, [
    el('div', { class: 'center-message' }, [
      el('p', {}, message),
      el('button', { class: 'btn btn-primary', type: 'button', onClick: onRetry }, 'Try again'),
    ]),
  ]));
}

/** Tear down any previously active session before starting a new one. */
function teardownActive() {
  if (active) {
    if (active.teardown) active.teardown();
    if (active.sync) active.sync.close();
    active = null;
  }
  hideBanner();
}

function goToEntry() {
  teardownActive();
  history.replaceState(null, '', '#/');
  renderEntryScreen(rootEl, { onSelect: (role) => boot({ role, roomCode: null }) });
}

/** Player/Display join form (room code, + name for player). */
function renderJoinForm({ role, roomCode, name, error, onSubmit }) {
  const codeInput = el('input', { id: 'f-room', value: roomCode || '', placeholder: 'ABCDE', maxlength: 5, autocapitalize: 'characters' });
  const nameInput = role === 'player' ? el('input', { id: 'f-name', value: name || '', placeholder: 'Your name', maxlength: 24 }) : null;
  const form = el('form', {
    class: 'form',
    onSubmit: (e) => {
      e.preventDefault();
      onSubmit({ roomCode: codeInput.value.trim().toUpperCase(), name: nameInput ? nameInput.value.trim() : 'Display' });
    },
  }, [
    el('div', { class: 'field' }, [el('label', { for: 'f-room' }, 'Room code'), codeInput]),
    nameInput && el('div', { class: 'field' }, [el('label', { for: 'f-name' }, 'Your name'), nameInput]),
    error && el('p', { class: 'error-text' }, error),
    el('button', { class: 'btn btn-big btn-primary', type: 'submit' }, role === 'player' ? 'Join room' : 'Watch room'),
  ]);
  mount(rootEl, el('div', { class: 'screen' }, [
    el('img', { class: 'entry-logo', src: 'assets/Stack Logo 512.png', alt: 'Stack', style: { margin: '0 auto 12px', width: '140px' } }),
    el('h2', { style: { textAlign: 'center' } }, role === 'player' ? 'Join as Player' : 'Watch as Display'),
    form,
    el('button', { class: 'btn btn-ghost', type: 'button', onClick: goToEntry }, 'Back'),
  ]));
}

function renderRejoinOffer({ roomCode, savedName, onRejoin, onStartOver }) {
  mount(rootEl, el('div', { class: 'screen' }, [
    el('div', { class: 'center-message' }, [
      el('p', {}, `Rejoin room ${roomCode} as ${savedName}?`),
      el('button', { class: 'btn btn-big btn-primary', type: 'button', onClick: onRejoin }, 'Rejoin'),
      el('button', { class: 'btn btn-ghost', type: 'button', onClick: onStartOver }, "Not you? Start over"),
    ]),
  ]));
}

function renderNewRoomChoice({ onCreate }) {
  mount(rootEl, el('div', { class: 'screen' }, [
    el('img', { class: 'entry-logo', src: 'assets/Stack Logo 512.png', alt: 'Stack', style: { margin: '0 auto 12px', width: '140px' } }),
    el('div', { class: 'center-message' }, [
      el('p', {}, 'Create a new room. You will be its Game Master.'),
      el('button', { class: 'btn btn-big btn-primary', type: 'button', onClick: onCreate }, 'New Room'),
    ]),
    el('button', { class: 'btn btn-ghost', type: 'button', onClick: goToEntry }, 'Back'),
  ]));
}

/** Register presence + persist identity, then hand off to the role module. */
async function finishHandoff({ role, roomCode, sync, name }) {
  try {
    await registerClient(sync, { clientId, role, name: name || (role === 'gm' ? 'GM' : 'Display'), teamId: null });
  } catch (e) {
    reportError(e);
  }
  saveIdentity(roomCode, { role, teamId: null, playerId: clientId, name: name || null });
  setHash(role, roomCode);
  const palette = await paletteReady;
  const teardown = ROLE_MODULES[role].init(rootEl, {
    sync, role, clientId, roomCode, name: name || null, palette, reportError,
    leaveRoom: goToEntry,
  });
  active = { key: `${role}:${roomCode}`, sync, teardown: typeof teardown === 'function' ? teardown : null };
}

async function bootGm(roomCode) {
  if (roomCode) {
    renderLoading('Reconnecting to your room…');
    try {
      const sync = await connect({ roomCode, role: 'gm', create: false });
      await finishHandoff({ role: 'gm', roomCode, sync, name: 'GM' });
    } catch {
      renderConnectError(`Could not reconnect to room ${roomCode}.`, () => boot({ role: 'gm', roomCode: null }));
    }
    return;
  }
  renderNewRoomChoice({
    onCreate: async () => {
      const code = genRoomCode();
      renderLoading('Creating room…');
      try {
        const sync = await connect({ roomCode: code, role: 'gm', create: true });
        await finishHandoff({ role: 'gm', roomCode: code, sync, name: 'GM' });
      } catch {
        renderConnectError('Could not create a room.', () => boot({ role: 'gm', roomCode: null }));
      }
    },
  });
}

async function bootJoinable(role, roomCode) {
  const saved = roomCode ? loadIdentity(roomCode) : null;
  const attempt = async (code, name) => {
    renderLoading(`Joining room ${code}…`);
    try {
      const sync = await connect({ roomCode: code, role, create: false });
      await finishHandoff({ role, roomCode: code, sync, name });
    } catch {
      renderJoinForm({ role, roomCode: code, name, error: `Room "${code}" not found.`, onSubmit: ({ roomCode: rc, name: n }) => attempt(rc, n) });
    }
  };

  if (saved && saved.role === role && roomCode) {
    renderRejoinOffer({
      roomCode, savedName: saved.name || 'you',
      onRejoin: () => attempt(roomCode, saved.name),
      onStartOver: () => renderJoinForm({ role, roomCode, name: '', error: null, onSubmit: ({ roomCode: rc, name }) => attempt(rc, name) }),
    });
    return;
  }
  renderJoinForm({ role, roomCode, name: saved ? saved.name : '', error: null, onSubmit: ({ roomCode: rc, name }) => attempt(rc, name) });
}

/** @param {{role: ?string, roomCode: ?string}} parsed */
async function boot(parsed) {
  if (!parsed.role) {
    goToEntry();
    return;
  }
  teardownActive();
  if (parsed.role === 'gm') await bootGm(parsed.roomCode);
  else await bootJoinable(parsed.role, parsed.roomCode);
}

window.addEventListener('hashchange', () => {
  const parsed = parseHash(location.hash);
  const key = parsed.role ? `${parsed.role}:${parsed.roomCode || ''}` : null;
  if (active && key === active.key) return; // route matches what we already set ourselves
  boot(parsed);
});

boot(parseHash(location.hash));
