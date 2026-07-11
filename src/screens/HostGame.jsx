/**
 * @file The Host live loop (PRD §3.2 step 5). The Host device is the Game's
 * authority: it is the only client that draws questions, opens and seals them,
 * reveals the answer, and commits scores. Everyone else writes intents.
 *
 * ---------------------------------------------------------------------------
 * THE THREE AUTHORITY EFFECTS
 * ---------------------------------------------------------------------------
 * 1. **Fulfil a selection.** A Player writes `game/selectIntent`; this screen
 *    draws a question from the board and publishes it (without the answer).
 * 2. **Seal on an explicit Lock In.** V2-15: a Lock In drops the timer to zero
 *    and locks everyone. `hasExplicitLock` distinguishes a real Lock In from a
 *    client auto-locking its pending choice at the deadline — sealing on the
 *    latter would throw away the other Teams' answers.
 * 3. **Seal at expiry, one grace window later.** See `LOCK_GRACE_MS`.
 *
 * Each effect is guarded by a ref keyed to the thing it acted on, because
 * StrictMode mounts effects twice and a double `drawQuestion` would burn two
 * questions off the board.
 *
 * The correct answer and the fun fact never touch the wire. The Host reads them
 * off their own copy of the Markdown (PRD §2: "the wire never carries them
 * pre-reveal"), and `revealQuestion` publishes only the letter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Card, Screen } from '../components/ui.jsx';
import { Options, QuestionHeader, ScoreList, Timer } from '../components/game.jsx';
import { Peripherals } from '../components/Peripherals.jsx';
import { findQuestion } from '../content/catalog.js';
import { drawQuestion } from '../engine/board.js';
import {
  adjustScore,
  clearSelectIntent,
  clearSelectionClaim,
  commitScores,
  advance,
  lockQuestion,
  openQuestion,
  openTapIn,
  revealQuestion,
  selectQuestion,
  skipQuestion,
} from '../engine/actions.js';
import {
  LOCK_GRACE_MS,
  OPTION_LETTERS,
  cycleDelta,
  hasExplicitLock,
  initialDeltas,
  pastGrace,
  selectGame,
  standings,
} from '../state/game.js';
import { ROLE } from '../app/driver.js';

/** The Host's private view of the live question: text, options, answer, fact. */
function AnswerKey({ question }) {
  if (!question) return null;
  const answerIndex = OPTION_LETTERS.indexOf(question.answer);
  return (
    <Card className="border-[var(--stack-accent)]/30 bg-[var(--stack-accent)]/[0.05]">
      <p className="mb-1 text-xs uppercase tracking-widest text-[var(--stack-accent)]">Answer</p>
      <p className="text-lg font-semibold">
        {question.answer}. {question.options[answerIndex]}
      </p>
      {question.fact && <p className="mt-3 text-sm text-white/60">{question.fact}</p>}
    </Card>
  );
}

/** Between turns: whose turn it is, and who on that Team has taken the wheel. */
function WaitingForSelection({ g, onRelease }) {
  const claim = g.claim;
  const meta = claim && claim.slug ? g.categoryMeta[claim.slug] : null;

  return (
    <Card>
      <h2 className="text-lg font-semibold">
        {g.activeTeamName ? `${g.activeTeamName} is choosing` : 'Waiting for a Team'}
      </h2>
      <p className="mt-1 text-sm text-white/50">
        {claim
          ? `${g.selectorName} has the Team's selection${meta ? ` and picked ${meta.name}` : ''}.`
          : 'The first Player on that Team to tap a Category takes the selection.'}
      </p>
      {claim && (
        <div className="mt-4">
          <Button variant="ghost" onClick={onRelease}>
            Release the Selection
          </Button>
          <p className="mt-1 text-xs text-white/30">
            Use this if that Player's phone has dropped out.
          </p>
        </div>
      )}
    </Card>
  );
}

/** After reveal: one toggle per Team, pre-filled by auto-scoring (V2-11). */
function DeltaToggles({ room, deltas, value, onCycle }) {
  const rows = standings(room);
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold">Points</h2>
      <p className="mb-4 text-sm text-white/50">
        Tap a Team to cycle it through Plus, Nothing and Minus. Update commits every Team at once.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((t) => {
          const delta = deltas[t.teamId] || 0;
          const tone =
            delta > 0
              ? 'border-emerald-400/60 bg-emerald-400/10'
              : delta < 0
                ? 'border-red-400/60 bg-red-400/10'
                : 'border-white/10';
          return (
            <li key={t.teamId}>
              <button
                type="button"
                onClick={() => onCycle(t.teamId)}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 text-left transition ${tone}`}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="truncate font-semibold">{t.name}</span>
                <span className="ml-auto font-mono text-lg font-bold tabular-nums">
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="text-white/40">No Teams have joined yet.</p>}
      <p className="mt-3 text-xs text-white/30">This question is worth {value}.</p>
    </Card>
  );
}

export default function HostGame({ sync, room, roomCode, catalog, exposure, onEditStages, onReturnHome, onCloseRoom }) {
  const g = useMemo(() => selectGame(room), [room]);
  const [deltas, setDeltas] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fulfilling = useRef(null);
  const sealing = useRef(null);
  const deltasFor = useRef(null);

  const serverNow = useCallback(() => (sync ? sync.serverNow() : Date.now()), [sync]);
  const localQuestion = useMemo(() => findQuestion(catalog, g.ref), [catalog, g.ref]);
  const teamIds = useMemo(() => Object.keys(room.teams || {}), [room.teams]);

  // --- Authority effect 1: a Player asked for a Category + difficulty. -------
  useEffect(() => {
    const intent = room.game && room.game.selectIntent;
    if (!sync || !intent || g.question) return;
    const key = `${intent.playerId}:${intent.slug}:${intent.dif}:${intent.at}`;
    if (fulfilling.current === key) return;
    fulfilling.current = key;

    (async () => {
      const { ref } = drawQuestion(g.board, intent.slug, intent.dif);
      if (!ref) {
        // The tier emptied between the Player's tap and this draw. Drop the
        // intent so their screen unsticks; their grid already shows it empty.
        await clearSelectIntent(sync, ROLE.HOST);
        return;
      }
      const full = findQuestion(catalog, ref);
      if (!full) {
        await clearSelectIntent(sync, ROLE.HOST);
        setError(`The question ${ref} is on the board but not in the Category files.`);
        return;
      }
      await selectQuestion(sync, ROLE.HOST, ref, { q: full.q, options: full.options });
      await clearSelectIntent(sync, ROLE.HOST);
    })().catch((err) => {
      fulfilling.current = null;
      setError(err.message);
    });
  }, [sync, room.game, g.question, g.board, catalog]);

  // --- Authority effect 2: an explicit Lock In seals the question (V2-15). ---
  useEffect(() => {
    if (!sync || g.qState !== 'open') return;
    if (!hasExplicitLock(g.locks, g.deadline)) return;
    if (sealing.current === g.ref) return;
    sealing.current = g.ref;
    lockQuestion(sync, ROLE.HOST).catch(() => {
      sealing.current = null;
    });
  }, [sync, g.qState, g.locks, g.deadline, g.ref]);

  // --- Authority effect 3: expiry, one grace window later. -------------------
  useEffect(() => {
    if (!sync || g.qState !== 'open' || !g.deadline) return undefined;
    const wait = Math.max(0, g.deadline + LOCK_GRACE_MS - serverNow());
    const id = setTimeout(() => {
      if (!pastGrace(g.deadline, serverNow())) return;
      lockQuestion(sync, ROLE.HOST).catch(() => {});
    }, wait + 50);
    return () => clearTimeout(id);
  }, [sync, g.qState, g.deadline, serverNow]);

  // Pre-fill the toggles once per reveal, then leave them to the Host (V2-11).
  useEffect(() => {
    if (g.qState !== 'revealed' && g.qState !== 'scored') {
      deltasFor.current = null;
      return;
    }
    if (deltasFor.current === g.ref) return;
    deltasFor.current = g.ref;
    setDeltas(initialDeltas(g.question, teamIds));
  }, [g.qState, g.ref, g.question, teamIds]);

  const guard = (fn) => async (...args) => {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleStart = guard(async () => {
    const deadline = g.stage.timerSec > 0 ? serverNow() + g.stage.timerSec * 1000 : 0;
    sealing.current = null;
    await openQuestion(sync, ROLE.HOST, deadline);
  });

  const handleExtend = guard(async () => {
    // Re-opening restores `state: 'open'`, which is what unlocks the options
    // again (V2-15). Locks already committed stay committed.
    sealing.current = null;
    const deadline = g.stage.timerSec > 0 ? serverNow() + g.stage.timerSec * 1000 : 0;
    await openQuestion(sync, ROLE.HOST, deadline);
  });

  const handleReveal = guard(async () => {
    if (!localQuestion) throw new Error('That question is not in the loaded Category files.');
    await revealQuestion(sync, ROLE.HOST, localQuestion.answer, (ref) => {
      // Exposure is written at reveal, not at Update (PRD §4) — a question the
      // room has seen is spent even if the Host never commits its points.
      exposure.record([ref], serverNow());
    });
  });

  const handleUpdate = guard(async () => {
    await commitScores(sync, ROLE.HOST, deltas);
    await advance(sync, ROLE.HOST);
  });

  const handleSkip = guard(async () => {
    await skipQuestion(sync, ROLE.HOST);
    fulfilling.current = null;
    sealing.current = null;
  });

  const handleRelease = guard(async () => {
    await clearSelectionClaim(sync, ROLE.HOST);
    await openTapIn(sync, ROLE.HOST, g.activeTeam);
  });

  const handleAdjust = (teamId, delta) => {
    adjustScore(sync, ROLE.HOST, teamId, delta).catch((err) => setError(err.message));
  };

  const peripherals = (
    <Peripherals
      room={room}
      roomCode={roomCode}
      host={{ onAdjust: handleAdjust, onEditStages, onReturnHome, onCloseRoom }}
    />
  );

  // --- Game over ------------------------------------------------------------
  if (g.ended) {
    const rows = standings(room);
    return (
      <Screen>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5">
          <h1 className="text-3xl font-semibold">Final Scores</h1>
          <ScoreList teams={rows} />
          <Button variant="danger" onClick={onCloseRoom}>
            Close Room
          </Button>
        </div>
        {peripherals}
      </Screen>
    );
  }

  const revealing = (g.qState === 'revealed' || g.qState === 'scored') && Boolean(g.result);
  const meta = g.slug ? g.categoryMeta[g.slug] : null;

  return (
    <Screen>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              Stage {g.stageNumber} · Rotation {g.rotationNumber}
            </h1>
            <p className="text-sm text-white/40">of {g.stage.rotations}</p>
          </div>
          {g.qState === 'open' && <Timer deadline={g.deadline} serverNow={serverNow} />}
          {(g.qState === 'locked' || revealing) && (
            <Timer deadline={g.deadline} serverNow={serverNow} running={false} />
          )}
        </header>

        {error && <Banner tone="error">{error}</Banner>}

        {!g.question && <WaitingForSelection g={g} onRelease={handleRelease} />}

        {g.question && (
          <>
            <QuestionHeader
              categoryName={(meta && meta.name) || g.slug}
              dif={g.dif}
              stageNumber={g.stageNumber}
              rotationNumber={g.rotationNumber}
              selectorName={g.selectorName}
            />

            <Card>
              <p className="text-lg font-semibold">{g.question.payload.q}</p>
            </Card>

            <Options
              options={g.question.payload.options}
              correct={revealing ? g.result.correct : null}
              scale="sm"
            />

            <AnswerKey question={localQuestion} />

            {!revealing && (
              <p className="text-center text-sm text-white/40">
                {Object.keys(g.locks).length} of {teamIds.length}{' '}
                {teamIds.length === 1 ? 'Team has' : 'Teams have'} locked in
              </p>
            )}

            {revealing && (
              <DeltaToggles
                room={room}
                deltas={deltas}
                value={g.value}
                onCycle={(teamId) =>
                  setDeltas((d) => ({ ...d, [teamId]: cycleDelta(d[teamId] || 0, g.value) }))
                }
              />
            )}

            <div className="flex flex-wrap gap-3">
              {g.qState === 'selecting' && (
                <>
                  <Button onClick={handleStart} disabled={busy}>
                    Start
                  </Button>
                  <Button variant="ghost" onClick={handleSkip} disabled={busy}>
                    Skip Question
                  </Button>
                </>
              )}
              {(g.qState === 'open' || g.qState === 'locked') && (
                <>
                  <Button onClick={handleReveal} disabled={busy}>
                    Reveal
                  </Button>
                  {g.stage.timerSec > 0 && (
                    <Button variant="secondary" onClick={handleExtend} disabled={busy}>
                      Extend Timer
                    </Button>
                  )}
                </>
              )}
              {revealing && (
                <Button onClick={handleUpdate} disabled={busy || g.qState === 'scored'}>
                  {busy ? 'Updating…' : 'Update'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
      {peripherals}
    </Screen>
  );
}
