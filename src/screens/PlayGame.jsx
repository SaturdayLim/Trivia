/**
 * @file The Player's in-Game screen (PRD §3.3). A Player writes exactly three
 * kinds of thing and never touches game state directly: a selection claim, a
 * selection intent, and an answer lock.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM AND THE TAP-IN ARE ONE GESTURE (V2-14)
 * ---------------------------------------------------------------------------
 * Tapping a Category is what claims the Team's turn. `claimSelection` is the
 * atomic gate — one teammate wins it, the rest are locked out until Back — and
 * `claimTapIn` immediately hands the winner the seat that `requestSelection`
 * checks. They are separate nodes for historical reasons (v1 had the tap-in; v2
 * added the claim with its `screen`/`slug` fields and a release path), so this
 * screen takes and gives them back together. Nothing else may.
 *
 * ---------------------------------------------------------------------------
 * THE AUTO-LOCK (V2-15) AND WHY IT IS NOT A DISQUALIFICATION (V2-16)
 * ---------------------------------------------------------------------------
 * "Expiry → options auto-disable; any currently-selected option is locked in as
 * the answer." Only this device knows what its Player has tapped but not
 * committed, so this device writes that lock, at the deadline, on the server
 * clock. If they tapped nothing, nothing is written: no answer, zero points, no
 * penalty, and no disqualification — V2-16 in three lines of `if`.
 *
 * Leaving the locked-in view does not disqualify either. It is a panel with a
 * Back button, not a cell.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Card, Screen } from '../components/ui.jsx';
import { BigLetter, CategoryGrid, DifficultyGrid, Options, QuestionHeader, ScoreList, Timer } from '../components/game.jsx';
import { Peripherals } from '../components/Peripherals.jsx';
import { claimSelection, claimTapIn, lockAnswer, releaseSelection, releaseTapIn, requestSelection } from '../engine/actions.js';
import { liveSlugs, selectGame, selectMe, standings, tierCounts } from '../state/game.js';

/** The Category grid, built from the directory the Host wrote (no fetches). */
function categoryItems(g) {
  return liveSlugs(g.board, g.categories).map((slug) => {
    const meta = g.categoryMeta[slug] || {};
    const counts = tierCounts(g.board, slug);
    return {
      slug,
      name: meta.name || slug,
      icon: meta.icon || null,
      n: meta.n || 1,
      badge: `${counts.total} Left`,
    };
  });
}

/** Waiting on someone else — another Team, or a teammate who tapped first. */
function Waiting({ title, detail, room, activeTeam }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-lg font-semibold">{title}</h2>
        {detail && <p className="mt-1 text-sm text-white/50">{detail}</p>}
      </Card>
      <ScoreList teams={standings(room)} activeTeam={activeTeam} />
    </div>
  );
}

export default function PlayGame({ sync, room, roomCode, clientId, teamId, onExit }) {
  const g = useMemo(() => selectGame(room), [room]);
  const me = useMemo(() => selectMe(room, { playerId: clientId, teamId }), [room, clientId, teamId]);

  const [pending, setPending] = useState(null); // this device's tapped-but-uncommitted letter
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const autoLocked = useRef(null);

  const serverNow = useCallback(() => (sync ? sync.serverNow() : Date.now()), [sync]);

  // A new question wipes the pending choice. Without this, the letter tapped on
  // the last question would be auto-locked into this one at its deadline.
  useEffect(() => {
    setPending(null);
    autoLocked.current = null;
  }, [g.ref]);

  // --- The auto-lock (V2-15). ----------------------------------------------
  // Keyed on `g.deadline`, not `g.ref`: a Host's Extend (R2) reopens the SAME
  // question with a NEW deadline, and clears the stale locks that caused
  // Extend to look inert (see actions.openQuestion). If this guard stayed
  // keyed on `ref`, a Player who was already auto-locked once for this
  // question would never get a second chance to auto-lock in the extended
  // window — their still-pending choice would silently vanish instead.
  useEffect(() => {
    if (!sync || g.qState !== 'open' || !g.deadline) return undefined;
    if (!me.mayAnswer || me.hasLocked || !pending) return undefined;
    if (autoLocked.current === g.deadline) return undefined;

    const wait = Math.max(0, g.deadline - serverNow());
    const id = setTimeout(() => {
      autoLocked.current = g.deadline;
      // `serverNow()` here is at-or-after the deadline, which is exactly what
      // tells the Host this was an expiry lock and not an explicit Lock In —
      // so it must not seal the question on the other Teams.
      lockAnswer(sync, teamId, clientId, pending, serverNow()).catch(() => {});
    }, wait);
    return () => clearTimeout(id);
  }, [sync, g.qState, g.deadline, g.ref, me.mayAnswer, me.hasLocked, pending, teamId, clientId, serverNow]);

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

  // Tapping a Category claims the Team's selection and the tap-in seat together.
  // Tap-in FIRST: the claim carries the `slug`, and the moment it lands every
  // teammate's screen switches to the difficulty view — including this one. If
  // the tap-in seat weren't already taken by then, `requestSelection` from the
  // difficulty screen would race the seat and be refused as `not-selector`.
  const handlePickCategory = guard(async (slug) => {
    const seat = await claimTapIn(sync, teamId, clientId);
    if (!seat.committed) {
      setError('A teammate got there first.');
      return;
    }
    const claim = await claimSelection(sync, { playerId: clientId, teamId, screen: 'difficulty', slug });
    if (!claim.committed) {
      // Lost the claim after taking the seat: give the seat back so the winner
      // isn't left holding half the turn.
      await releaseTapIn(sync, { teamId, playerId: clientId });
      setError('A teammate got there first.');
    }
  });

  const handlePickDifficulty = guard(async (dif) => {
    const slug = g.claim && g.claim.slug;
    if (!slug) return;
    const res = await requestSelection(sync, { playerId: clientId, teamId, slug, dif });
    if (!res.committed) setError('That selection could not be sent. Try again.');
  });

  // Back gives both halves back, so any teammate may take the turn (V2-14).
  const handleBackToCategories = guard(async () => {
    await releaseSelection(sync, { playerId: clientId, teamId });
    await releaseTapIn(sync, { teamId, playerId: clientId });
  });

  const handleLockIn = guard(async () => {
    if (!pending) return;
    const res = await lockAnswer(sync, teamId, clientId, pending, serverNow());
    if (!res.committed) {
      setError(
        res.reason === 'not-open'
          ? 'Time is up on that question.'
          : res.reason === 'not-eligible'
            ? 'Only the Team that chose may answer this Stage.'
            : 'Your Team has already locked in.'
      );
    }
  });

  const peripherals = <Peripherals room={room} roomCode={roomCode} />;

  const wrap = (children) => (
    <Screen>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-5">
        {error && <Banner tone="error">{error}</Banner>}
        {children}
      </div>
      {peripherals}
    </Screen>
  );

  // --- Game over ------------------------------------------------------------
  if (g.ended) {
    return wrap(
      <>
        <h1 className="text-2xl font-semibold">Final Scores</h1>
        <ScoreList teams={standings(room)} />
        <Button variant="ghost" onClick={onExit}>
          Leave
        </Button>
      </>
    );
  }

  // --- No live question: somebody is selecting ------------------------------
  if (!g.question) {
    if (!me.isActiveTeam) {
      return wrap(
        <Waiting
          title={`${g.activeTeamName || 'A Team'} is choosing`}
          detail={g.claim ? `${g.selectorName} is picking a Category.` : 'Waiting for them to tap a Category.'}
          room={room}
          activeTeam={g.activeTeam}
        />
      );
    }

    if (me.lockedOut) {
      const meta = g.claim && g.claim.slug ? g.categoryMeta[g.claim.slug] : null;
      return wrap(
        <Waiting
          title={`${g.selectorName} is choosing for your Team`}
          detail={
            meta
              ? `They picked ${meta.name} and are choosing a difficulty. Scores and the Question Log are still yours to check.`
              : 'Your teammate tapped first. Scores and the Question Log are still yours to check.'
          }
          room={room}
          activeTeam={g.activeTeam}
        />
      );
    }

    if (me.holdsClaim && g.claim && g.claim.slug) {
      const meta = g.categoryMeta[g.claim.slug] || {};
      return wrap(
        <>
          <header>
            <p className="text-sm text-white/40">
              Stage {g.stageNumber} · Rotation {g.rotationNumber}
            </p>
            <h1 className="text-2xl font-semibold">{meta.name || g.claim.slug}</h1>
            <p className="mt-1 text-sm text-white/50">Choose a difficulty.</p>
          </header>
          <DifficultyGrid
            counts={tierCounts(g.board, g.claim.slug)}
            multiplier={g.stage.multiplier}
            onPick={handlePickDifficulty}
            // Not gated on `busy`: `requestSelection` writes an intent via a
            // first-write-wins transact, so a double tap is harmless, and a
            // Player must never find a live difficulty tile inert.
          />
          <Button variant="ghost" onClick={handleBackToCategories} disabled={busy}>
            Back
          </Button>
        </>
      );
    }

    // My Team's turn, nobody has claimed it: the grid is open to whoever taps.
    const items = categoryItems(g);
    return wrap(
      <>
        <header>
          <p className="text-sm text-white/40">
            Stage {g.stageNumber} · Rotation {g.rotationNumber}
          </p>
          <h1 className="text-2xl font-semibold">Your Team chooses</h1>
          <p className="mt-1 text-sm text-white/50">
            The first teammate to tap a Category picks for {me.teamName}.
          </p>
        </header>
        {items.length === 0 ? (
          <Card className="text-center text-white/40">Every Category has been played out.</Card>
        ) : (
          <CategoryGrid items={items} onPick={handlePickCategory} disabled={busy} />
        )}
      </>
    );
  }

  // --- A question is live ---------------------------------------------------
  const revealing = (g.qState === 'revealed' || g.qState === 'scored') && Boolean(g.result);
  const meta = g.slug ? g.categoryMeta[g.slug] : null;
  const myChoice = me.myLock ? me.myLock.choice : null;

  // The locked-in letter, full screen (PRD §3.3 step 4). Only before the reveal:
  // once the answer is public, showing them their own letter tells them nothing.
  if (me.hasLocked && !revealing) {
    return (
      <BigLetter
        letter={myChoice}
        caption={
          g.qState === 'open'
            ? 'Waiting for the other Teams and the Host.'
            : 'Locked. Waiting for the Host to reveal.'
        }
      >
        <div className="mt-8">{peripherals}</div>
      </BigLetter>
    );
  }

  const answering = me.mayAnswer && g.qState === 'open';

  return wrap(
    <>
      <QuestionHeader
        categoryName={(meta && meta.name) || g.slug}
        dif={g.dif}
        stageNumber={g.stageNumber}
        rotationNumber={g.rotationNumber}
        selectorName={g.selectorName}
      />

      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold">{g.question.payload.q}</p>
        {g.qState === 'open' ? (
          <Timer deadline={g.deadline} serverNow={serverNow} />
        ) : (
          <Timer deadline={g.deadline} serverNow={serverNow} running={false} />
        )}
      </div>

      {/* R5: the copy branches on answer-eligibility (`me.mayAnswer`), not on
          lock state. A Team that was never eligible to answer isn't told
          "no answer" once time is up — of course they didn't answer, they
          couldn't — they just see that time is up. The fuller "no answer"
          caveat is for a Team that COULD have answered and didn't. */}
      {me.mayAnswer && g.qState === 'selecting' && (
        <Banner>Get ready. The options open when the Host starts the timer.</Banner>
      )}
      {me.mayAnswer && me.missedIt && !revealing && (
        <Banner tone="warn">Time is up. No answer from {me.teamName} — no points, and no penalty.</Banner>
      )}
      {!me.mayAnswer && !revealing && (
        <Banner>{me.missedIt ? 'Time is up.' : `Only ${g.activeTeamName} may answer this Stage. Watch along.`}</Banner>
      )}

      <Options
        options={g.question.payload.options}
        selected={pending}
        locked={myChoice}
        correct={revealing ? g.result.correct : null}
        onPick={answering ? (letter) => setPending(letter) : undefined}
        disabled={!answering}
      />

      {answering && (
        <Button onClick={handleLockIn} disabled={busy || !pending}>
          {pending ? `Lock In ${pending}` : 'Choose an Option'}
        </Button>
      )}

      {revealing && (
        <Card>
          <p className="font-semibold">
            {!myChoice
              ? 'Your Team did not answer.'
              : myChoice === g.result.correct
                ? 'Correct.'
                : 'Not this time.'}
          </p>
          <p className="mt-1 text-sm text-white/50">Waiting for the Host to update the scores.</p>
        </Card>
      )}
    </>
  );
}
