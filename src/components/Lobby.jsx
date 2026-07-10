/**
 * @file The shared waiting lobby (PRD §3.1). ONE component, rendered on the
 * host's phone, every player's phone, and the display. That is the fix for v1
 * defect #1: there is no longer a per-role "waiting" screen that could get
 * stuck, because there is no longer a per-role waiting screen.
 *
 * Everyone sees the same three facts — who is hosting, which Teams exist and
 * who is on them, which Displays are attached — updating live. The differences
 * between roles are additive chrome (a QR block, a Begin button), never a
 * different source of truth.
 */

import { Card, PresenceDot, RoomCode } from './ui.jsx';
import { QrCode, joinUrl } from './QrCode.jsx';

function TeamTile({ team }) {
  return (
    // Uniform tile: fixed min height, equal grid cell (v1 defect #2). Teams
    // with one player and teams with six must not produce a ragged grid.
    <Card className="flex min-h-[128px] flex-col gap-2 !p-4">
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: team.color }} />
        <h3 className="truncate font-semibold">{team.name}</h3>
        <span className="ml-auto shrink-0 text-sm text-white/40">
          {team.players.length} {team.players.length === 1 ? 'Player' : 'Players'}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {team.players.map((p) => (
          <li key={p.playerId} className="flex items-center gap-2 text-sm text-white/70">
            <PresenceDot connected={p.connected} />
            <span className="truncate">{p.name}</span>
          </li>
        ))}
        {team.players.length === 0 && <li className="text-sm text-white/30">No players yet</li>}
      </ul>
    </Card>
  );
}

/**
 * @param {Object} props
 * @param {import('../state/lobby.js').Lobby} props.lobby
 * @param {string} props.roomCode
 * @param {boolean} [props.showQr] - host and display show it; players don't
 *   (they're already in, and a phone screen is precious).
 * @param {'sm'|'lg'} [props.scale='sm'] - `lg` = the projected Display, read
 *   from across a room.
 * @param {React.ReactNode} [props.children] - role-specific chrome, below the fold.
 */
export function Lobby({ lobby, roomCode, showQr = false, scale = 'sm', children }) {
  const big = scale === 'lg';

  return (
    <div className={`mx-auto flex w-full flex-col gap-6 ${big ? 'max-w-6xl p-8' : 'max-w-2xl p-5'}`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className={`text-white/40 ${big ? 'text-lg' : 'text-sm'}`}>Room Code</p>
          <RoomCode code={roomCode} size={big ? 'xl' : 'lg'} />
        </div>
        <div className="flex items-center gap-2 text-sm text-white/60">
          <PresenceDot connected={lobby.host.connected} />
          {lobby.host.connected ? 'Host connected' : 'Waiting for the Host'}
        </div>
      </header>

      {showQr && (
        <Card className="flex flex-wrap items-center gap-6">
          <QrCode value={joinUrl(roomCode)} size={big ? 220 : 160} />
          <div className="flex-1">
            <h2 className={`font-semibold ${big ? 'text-3xl' : 'text-xl'}`}>Scan to Join</h2>
            <p className={`mt-1 text-white/50 ${big ? 'text-xl' : 'text-sm'}`}>
              Or open this page and enter the Room Code above.
            </p>
          </div>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className={`font-semibold ${big ? 'text-3xl' : 'text-xl'}`}>
            Teams <span className="text-white/40">({lobby.teams.length})</span>
          </h2>
          <span className={`text-white/40 ${big ? 'text-xl' : 'text-sm'}`}>
            {lobby.playerCount} {lobby.playerCount === 1 ? 'Player' : 'Players'}
          </span>
        </div>

        {lobby.teams.length === 0 ? (
          <Card className="text-center text-white/40">
            No Teams yet. The first Player to join creates one.
          </Card>
        ) : (
          // Uniform grid — every tile the same width, auto-fitting the screen.
          <div className={`grid gap-3 ${big ? 'grid-cols-4' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {lobby.teams.map((team) => (
              <TeamTile key={team.teamId} team={team} />
            ))}
          </div>
        )}
      </section>

      {lobby.displays.length > 0 && (
        <section>
          <h2 className={`mb-2 font-semibold ${big ? 'text-2xl' : 'text-base'}`}>
            Displays <span className="text-white/40">({lobby.displays.length})</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {lobby.displays.map((d) => (
              <span
                key={d.playerId}
                className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70"
              >
                <PresenceDot connected={d.connected} />
                {d.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {children}
    </div>
  );
}
