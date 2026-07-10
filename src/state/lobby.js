/**
 * @file Pure derivation of "who is in this room right now" — the model behind
 * the shared waiting lobby every role sees (PRD §3.1, v1 defect #1: no more
 * "Connecting…" placeholder).
 *
 * Two sources have to be married here, and they are not the same thing:
 *   - The **room tree** (`teams`, `clients`, `meta`) is durable game state. A
 *     player who closes their phone is still on their team.
 *   - The **presence roster** (driver-level heartbeats) is liveness. It knows
 *     who is reachable this second, and nothing about the game.
 *
 * The lobby wants both: every registered player, each flagged connected or not.
 * Presence alone would make a team vanish when its phone sleeps; the room tree
 * alone could never show a grey dot. Hence one join, done here, once.
 *
 * No React, no sync — `selectLobby(room, roster)` is a function of its two
 * arguments, so every rule below is a unit test rather than a click-through.
 */

import { ROLE } from './roles.js';

/** Team tile colors, assigned by registration order (V2-4 palette, S5 refines). */
export const TEAM_COLORS = [
  '#FFE600', '#4CC9F0', '#F72585', '#4ADE80',
  '#FB923C', '#A78BFA', '#22D3EE', '#F87171',
];

/** Deterministic 32-bit string hash, base36. Only used to name a team key. */
function hash36(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable team id derived from the typed name, so two players typing "Team
 * Rocket" land on the SAME team instead of creating two. This is what makes
 * PRD §3.3's single "enter/join team name" field work: the caller tries
 * `createTeam` (first-write-wins on the id), and a loser simply becomes a
 * `joinTeam`.
 *
 * The id is also a Firebase path segment (`teams/<teamId>`), so it must be
 * non-empty and free of `. $ # [ ] /`. Accents fold to their base letter
 * ("Café" and "Cafe" are one team, which is what the players mean). A name
 * with no Latin letters at all — "日本", "🔥🔥" — would otherwise reduce to the
 * empty string and write to `teams/`, corrupting the room; those fall back to a
 * hash of the name, which keeps the one-name-one-team invariant in any script.
 *
 * @param {string} name
 * @returns {string} e.g. "Team  Rocket!" -> "team-rocket"; "日本" -> "team-1a2b3c"
 */
export function teamKey(name) {
  const trimmed = String(name ?? '').trim().toLowerCase();
  if (!trimmed) return '';
  const slug = trimmed
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `team-${hash36(trimmed)}`;
}

/**
 * Where a new team sits in turn order: below every existing team (V2-13).
 * @param {?Object<string, {order: number}>} teams
 * @returns {number}
 */
export function nextTeamOrder(teams) {
  const orders = Object.values(teams || {}).map((t) => (typeof t.order === 'number' ? t.order : -1));
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/**
 * @param {?Object<string, {order: number}>} teams
 * @returns {string} the color a team created now should take.
 */
export function nextTeamColor(teams) {
  return TEAM_COLORS[nextTeamOrder(teams) % TEAM_COLORS.length];
}

/** clientId -> connected, from the driver's presence roster. */
function connectedMap(roster) {
  const map = new Map();
  for (const entry of roster || []) map.set(entry.clientId, Boolean(entry.connected));
  return map;
}

/**
 * @typedef {Object} LobbyPlayer
 * @property {string} playerId
 * @property {string} name
 * @property {boolean} connected
 *
 * @typedef {Object} LobbyTeam
 * @property {string} teamId
 * @property {string} name
 * @property {string} color
 * @property {number} order
 * @property {number} score
 * @property {LobbyPlayer[]} players - connected first, then by name.
 *
 * @typedef {Object} Lobby
 * @property {LobbyTeam[]} teams - in registration order.
 * @property {LobbyPlayer[]} displays
 * @property {{clientId: ?string, connected: boolean}} host
 * @property {number} playerCount
 * @property {string} status - meta.status ('lobby' | 'playing' | 'ended' | 'closed').
 * @property {boolean} inProgress - true once the game has started (drives the
 *   "joining mid-Game" copy, V2-13).
 */

/**
 * Marry the room tree with the presence roster.
 * @param {?Object} room - the whole synced room tree.
 * @param {?Array<{clientId: string, role: string, connected: boolean}>} roster
 * @returns {Lobby}
 */
export function selectLobby(room, roster) {
  const live = connectedMap(roster);
  const clients = (room && room.clients) || {};
  const status = (room && room.meta && room.meta.status) || 'lobby';

  const teams = Object.entries((room && room.teams) || {})
    .map(([teamId, team]) => ({
      teamId,
      name: team.name || teamId,
      color: team.color || TEAM_COLORS[0],
      order: typeof team.order === 'number' ? team.order : 0,
      score: team.score || 0,
      players: Object.entries(team.players || {})
        .map(([playerId, p]) => ({
          playerId,
          name: (p && p.name) || 'Player',
          connected: live.get(playerId) === true,
        }))
        // Connected players first so a sleeping phone never pushes a live one
        // off the top of a crowded tile.
        .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.order - b.order);

  const displays = Object.entries(clients)
    .filter(([, c]) => c && c.role === ROLE.DISPLAY)
    .map(([clientId, c]) => ({
      playerId: clientId,
      name: c.name || 'Display',
      connected: live.get(clientId) === true,
    }))
    // A display that has gone away is noise on a projector screen: drop it once
    // it's both disconnected and unnamed. Keep disconnected named ones — the
    // host wants to know the projector fell off.
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));

  const hostClientId = (room && room.meta && room.meta.gmClientId) || null;

  return {
    teams,
    displays,
    host: { clientId: hostClientId, connected: hostClientId ? live.get(hostClientId) === true : false },
    playerCount: teams.reduce((n, t) => n + t.players.length, 0),
    status,
    inProgress: status === 'playing',
  };
}

/**
 * Find the team a name would land on — an exact `teamKey` match. Returns null
 * when the name is free, in which case the caller creates the team.
 * @param {?Object<string, Object>} teams
 * @param {string} name
 * @returns {?string} the existing teamId, or null.
 */
export function matchTeam(teams, name) {
  const key = teamKey(name);
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(teams || {}, key) ? key : null;
}

/**
 * Can a player still join? Yes, at every point except a dead room — that is the
 * whole of v1 defect #10 plus V2-13. Encoded here so no screen can forget it.
 * @param {?Object} room
 * @returns {{allowed: boolean, reason?: string}}
 */
export function canJoin(room) {
  if (!room) return { allowed: false, reason: 'no-room' };
  const status = (room.meta && room.meta.status) || 'lobby';
  if (status === 'closed') return { allowed: false, reason: 'room-closed' };
  if (status === 'ended') return { allowed: false, reason: 'game-over' };
  return { allowed: true };
}
