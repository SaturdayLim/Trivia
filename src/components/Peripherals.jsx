/**
 * @file The peripherals bar (PRD §3.1): Scores, Question Log and Stage Settings,
 * reachable from every role at every moment of the Game — including while a
 * teammate holds the selection claim, which V2-14 explicitly protects
 * ("Peripherals … always available to all").
 *
 * The Host's bar carries four more: Score Modifiers, Show QR, Return to Home and
 * Close Room. They are passed in rather than assumed, so a Player's bar cannot
 * grow a Close Room button by accident.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Card, RoomCode, Sheet } from './ui.jsx';
import { ScoreList } from './game.jsx';
import { QrCode, joinUrl } from './QrCode.jsx';
import { logRow, standings } from '../state/game.js';
import { contestantsLabel, contestantsOf, orderLabel, normalizeStages } from '../state/stages.js';

function TabButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] flex-1 rounded-xl px-3 text-sm font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"
    >
      {children}
    </button>
  );
}

function ScoresSheet({ room, onClose }) {
  const rows = standings(room);
  const activeTeam = room.game && room.game.activeTeam;
  return (
    <Sheet title="Scores" onClose={onClose}>
      {rows.length === 0 ? (
        <p className="text-white/40">No Teams have joined yet.</p>
      ) : (
        <ScoreList teams={rows} activeTeam={activeTeam} />
      )}
    </Sheet>
  );
}

/**
 * The Question Log. Built from `game.log` — refs, Stage and deltas — because
 * that is all the wire carries: question text lives on the Host's device only
 * (see content/catalog.js). Newest first, which is the order a Host checks it in.
 */
function LogSheet({ room, onClose }) {
  const entries = (room.game && room.game.log) || [];
  const rows = entries.map((e) => logRow(e, room)).reverse();

  return (
    <Sheet title="Question Log" onClose={onClose}>
      {rows.length === 0 ? (
        <p className="text-white/40">No questions have been played yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={`${row.ref}-${row.at}`} className="rounded-xl border border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-semibold" style={{ color: row.difficulty.tint }}>
                  {row.difficulty.label}
                </span>
                <span className="font-semibold">{row.categoryName}</span>
                <span className="ml-auto text-xs text-white/40">Stage {row.stageNumber}</span>
              </div>
              {row.selectedBy && (
                <p className="mt-0.5 text-xs text-white/40">
                  Selected by {row.selectedBy.name}
                  {row.selectedBy.team ? ` · ${row.selectedBy.team}` : ''}
                </p>
              )}
              {row.scores.length === 0 ? (
                <p className="mt-1 text-sm text-white/40">No points scored.</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {row.scores.map((s) => (
                    <li key={s.teamId} className="text-white/70">
                      {s.name}{' '}
                      <span className={s.delta > 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                        {s.delta > 0 ? `+${s.delta}` : s.delta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/**
 * Round Settings, read-only for everyone. The Host edits them from Stage setup,
 * where the controls live; showing editable fields to a Player would be a lie.
 */
function StagesSheet({ room, onClose, onEdit }) {
  const stages = normalizeStages(room.settings && room.settings.rounds);
  const current = (room.game && room.game.round) || 0;
  const playing = room.meta && room.meta.status === 'playing';

  return (
    <Sheet title="Stage Settings" onClose={onClose}>
      <ul className="flex flex-col gap-3">
        {stages.map((s, i) => (
          <li
            key={i}
            className={`rounded-xl border px-4 py-3 ${
              playing && i === current ? 'border-[var(--stack-accent)] bg-[var(--stack-accent)]/5' : 'border-white/10'
            }`}
          >
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="font-semibold">Stage {i + 1}</h3>
              {playing && i === current && (
                <span className="text-xs font-semibold text-[var(--stack-accent)]">Now Playing</span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-white/40">Rotations</dt>
                <dd>{s.rotations}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Thinking Time</dt>
                <dd>{s.timerSec > 0 ? `${s.timerSec}s` : 'None'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Penalty</dt>
                <dd>{s.penalty === 'on' ? 'On' : 'Off'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Multiplier</dt>
                <dd>×{s.multiplier}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Contestants</dt>
                <dd>{contestantsLabel(contestantsOf(s))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Selects First</dt>
                <dd>{orderLabel(s.orderMode)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Selects Next</dt>
                <dd>{orderLabel(s.orderModeNext)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      {onEdit && (
        <div className="mt-4">
          <Button variant="secondary" onClick={onEdit}>
            Edit Stage Settings
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Host only: the ±1 corrections of PRD §3.2 step 6, applied immediately. */
function ModifiersSheet({ room, onClose, onAdjust }) {
  const rows = standings(room);
  return (
    <Sheet title="Score Modifiers" onClose={onClose}>
      <p className="mb-4 text-sm text-white/50">
        Corrections apply straight away, outside the current question.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((t) => (
          <li key={t.teamId} className="flex items-center gap-3 rounded-xl border border-white/10 px-4 py-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
            <span className="truncate font-semibold">{t.name}</span>
            <span className="ml-auto w-10 text-right font-mono text-lg font-bold tabular-nums">{t.score}</span>
            <button
              type="button"
              aria-label={`Subtract a point from ${t.name}`}
              onClick={() => onAdjust(t.teamId, -1)}
              className="size-11 rounded-xl border border-white/15 text-xl"
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Add a point to ${t.name}`}
              onClick={() => onAdjust(t.teamId, 1)}
              className="size-11 rounded-xl border border-white/15 text-xl"
            >
              +
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-white/40">No Teams have joined yet.</p>}
    </Sheet>
  );
}

function QrSheet({ roomCode, onClose }) {
  return (
    <Sheet title="Scan to Join" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <QrCode value={joinUrl(roomCode)} size={220} />
        <Card className="text-center">
          <p className="text-sm text-white/50">Room Code</p>
          <RoomCode code={roomCode} size="md" />
        </Card>
      </div>
    </Sheet>
  );
}

/**
 * The bar itself. Sticky at the bottom of every in-Game screen.
 *
 * @param {Object} props
 * @param {Object} props.room
 * @param {string} props.roomCode
 * @param {Object} [props.host] - Host-only handlers; omit for Players/Displays.
 * @param {(teamId: string, delta: number) => void} [props.host.onAdjust]
 * @param {() => void} [props.host.onEditStages]
 * @param {() => void} [props.host.onReturnHome]
 * @param {() => void} [props.host.onCloseRoom]
 * @param {(active: boolean) => void} [props.host.onShowQr] - R7: fires
 *   whenever the Host's own QR sheet opens/closes, so every Display can
 *   mirror it.
 */
export function Peripherals({ room, roomCode, host = null }) {
  const [open, setOpen] = useState(null);
  const close = () => setOpen(null);

  // R7: keep the synced "Show QR Code" flag in lockstep with the sheet,
  // however it closes — the backdrop/Escape/× paths on `Sheet`, or switching
  // straight to a different tab — not just its own button. `hostRef` holds
  // the latest handler without putting `host` (a fresh object every render)
  // in the effect's deps, which would otherwise re-fire — and re-write the
  // synced flag — on every unrelated re-render.
  const hostRef = useRef(host);
  hostRef.current = host;
  useEffect(() => {
    if (!hostRef.current || !hostRef.current.onShowQr) return;
    hostRef.current.onShowQr(open === 'qr');
  }, [open]);

  return (
    <>
      <nav
        aria-label="Game tools"
        className="sticky bottom-0 z-30 mt-6 flex gap-1 border-t border-white/10 bg-[var(--stack-bg)]/95 p-2 backdrop-blur"
      >
        <TabButton onClick={() => setOpen('scores')}>Scores</TabButton>
        <TabButton onClick={() => setOpen('log')}>Question Log</TabButton>
        <TabButton onClick={() => setOpen('stages')}>Stage Settings</TabButton>
        {host && <TabButton onClick={() => setOpen('host')}>Host Tools</TabButton>}
      </nav>

      {open === 'scores' && <ScoresSheet room={room} onClose={close} />}
      {open === 'log' && <LogSheet room={room} onClose={close} />}
      {open === 'stages' && (
        <StagesSheet
          room={room}
          onClose={close}
          onEdit={host && host.onEditStages ? () => { close(); host.onEditStages(); } : null}
        />
      )}
      {open === 'modifiers' && <ModifiersSheet room={room} onClose={close} onAdjust={host.onAdjust} />}
      {open === 'qr' && <QrSheet roomCode={roomCode} onClose={close} />}

      {open === 'host' && (
        <Sheet title="Host Tools" onClose={close}>
          <div className="flex flex-col gap-3">
            <Button variant="secondary" onClick={() => setOpen('modifiers')}>
              Score Modifiers
            </Button>
            <Button variant="secondary" onClick={() => setOpen('qr')}>
              Show QR Code
            </Button>
            <Button variant="ghost" onClick={() => { close(); host.onReturnHome(); }}>
              Return to Home
            </Button>
            <Button variant="danger" onClick={() => { close(); host.onCloseRoom(); }}>
              Close Room
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
