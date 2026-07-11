/**
 * @file The projected Display, in Game (PRD §3.4). Read-only and landscape: it
 * writes nothing, holds no authority, and takes no turn. Everything on it is
 * derived from the room tree, which is why it can never disagree with a phone.
 *
 * The progression it walks — Home → difficulty selection → question → reveal →
 * Home — is not a state machine of its own. It is a rendering of whatever the
 * Host and the selecting Team have already put in the tree.
 */

import { useCallback, useMemo } from 'react';
import { RoomCode, Screen } from '../components/ui.jsx';
import { CategoryGrid, DifficultyGrid, Options, QuestionHeader, ScoreList, Timer } from '../components/game.jsx';
import { QrCode, joinUrl } from '../components/QrCode.jsx';
import { liveSlugs, selectGame, standings, tierCounts } from '../state/game.js';
import { contestantsLabel, contestantsOf, stageSummary } from '../state/stages.js';

function Frame({ children }) {
  return (
    <Screen>
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-8">{children}</div>
    </Screen>
  );
}

function StageStrip({ g }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4">
      <h1 className="text-4xl font-semibold">
        Stage {g.stageNumber}{' '}
        <span className="text-white/40">
          · Rotation {g.rotationNumber} of {g.stage.rotations}
        </span>
      </h1>
      <p className="text-xl text-white/50">{stageSummary(g.stage)}</p>
    </header>
  );
}

export default function DisplayGame({ room, roomCode, sync }) {
  const g = useMemo(() => selectGame(room), [room]);
  const serverNow = useCallback(() => (sync ? sync.serverNow() : Date.now()), [sync]);
  const rows = standings(room);

  // --- The Host toggled Show QR Code (R7) ------------------------------------
  // Overrides whatever this Display would otherwise show — mid-question
  // included — because that is the point: hand the room a way back in without
  // the Host having to pause the Game.
  if (room && room.meta && room.meta.showQr) {
    return (
      <Frame>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 text-center">
          <h1 className="text-5xl font-bold">Scan to Join</h1>
          <QrCode value={joinUrl(roomCode)} size={320} />
          <RoomCode code={roomCode} size="xl" />
        </div>
      </Frame>
    );
  }

  // --- Game over --------------------------------------------------------------
  if (g.ended) {
    // A plain podium (R6): the top three raised by rank, everyone else below
    // as a normal list. Motion/medal polish is explicitly S5's, not this
    // sprint's — "plain is fine" per the requirement.
    const [first, second, third, ...rest] = rows;
    const podiumHeight = { 1: 'pb-20', 2: 'pb-12', 3: 'pb-6' };
    return (
      <Frame>
        <h1 className="text-center text-6xl font-bold">Final Scores</h1>
        {rows.length > 0 ? (
          <div className="mx-auto flex w-full max-w-4xl flex-1 items-end justify-center gap-6">
            {[second, first, third].filter(Boolean).map((t) => (
              <div
                key={t.teamId}
                className={`flex flex-col items-center gap-2 rounded-t-2xl border border-white/10 bg-white/[0.03] px-8 pt-6 ${podiumHeight[t.rank] || 'pb-6'}`}
              >
                <span className="text-lg text-white/50">#{t.rank}</span>
                <span className="size-4 rounded-full" style={{ background: t.color }} />
                <span className="text-2xl font-semibold">{t.name}</span>
                <span className="font-mono text-4xl font-bold tabular-nums">{t.score}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-2xl text-white/40">No Teams played.</p>
        )}
        {rest.length > 0 && (
          <div className="mx-auto w-full max-w-3xl">
            <ScoreList teams={rest} scale="lg" />
          </div>
        )}
      </Frame>
    );
  }

  // --- A question is live ---------------------------------------------------
  if (g.question) {
    const revealing = (g.qState === 'revealed' || g.qState === 'scored') && Boolean(g.result);
    const meta = g.slug ? g.categoryMeta[g.slug] : null;
    // R1: highlight every Team's locked letter pre-reveal — safe by design,
    // since a lock already zeroes the timer and locks everyone else (V2-15).
    const lockedLetters = Object.values(g.locks || {}).map((l) => l.choice);

    return (
      <Frame>
        <QuestionHeader
          categoryName={(meta && meta.name) || g.slug}
          dif={g.dif}
          stageNumber={g.stageNumber}
          rotationNumber={g.rotationNumber}
          selectorName={g.selectorName}
          scale="lg"
        />

        <div className="flex flex-1 flex-col gap-6">
          <div className="flex items-start justify-between gap-8">
            <p className="text-4xl font-semibold leading-snug">{g.question.payload.q}</p>
            <Timer deadline={g.deadline} serverNow={serverNow} running={g.qState === 'open'} size="lg" />
          </div>

          <Options
            options={g.question.payload.options}
            locked={lockedLetters}
            correct={revealing ? g.result.correct : null}
            scale="lg"
          />
        </div>

        {revealing ? (
          <section>
            <h2 className="mb-3 text-2xl font-semibold">Points</h2>
            <ul className="flex flex-wrap gap-3">
              {rows.map((t) => {
                const delta = (g.result.deltas && g.result.deltas[t.teamId]) || 0;
                return (
                  <li
                    key={t.teamId}
                    className={`flex items-center gap-3 rounded-xl border px-5 py-3 text-2xl ${
                      delta > 0
                        ? 'border-emerald-400/60 bg-emerald-400/10'
                        : delta < 0
                          ? 'border-red-400/60 bg-red-400/10'
                          : 'border-white/10'
                    }`}
                  >
                    <span className="size-3 rounded-full" style={{ background: t.color }} />
                    <span className="font-semibold">{t.name}</span>
                    <span className="font-mono font-bold tabular-nums">
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="text-center text-2xl text-white/40">
            {g.qState === 'selecting'
              ? 'Waiting for the Host to start the timer.'
              : g.allContest
                ? 'Every Team may answer.'
                : `Only ${g.activeTeamName} may answer.`}
          </p>
        )}
      </Frame>
    );
  }

  // --- A Team is choosing a difficulty (V2-14's claim carries the Category). -
  if (g.claim && g.claim.slug) {
    const meta = g.categoryMeta[g.claim.slug] || {};
    return (
      <Frame>
        <StageStrip g={g} />
        <div className="flex flex-1 flex-col justify-center gap-8">
          <div className="text-center">
            <p className="text-2xl text-white/50">
              {g.activeTeamName} · {g.selectorName} is choosing
            </p>
            <h2 className="mt-2 text-6xl font-bold">{meta.name || g.claim.slug}</h2>
          </div>
          <DifficultyGrid
            counts={tierCounts(g.board, g.claim.slug)}
            multiplier={g.stage.multiplier}
            scale="lg"
          />
        </div>
      </Frame>
    );
  }

  // --- Home: scores, Stage settings, Categories still on the board -----------
  const items = liveSlugs(g.board, g.categories).map((slug) => {
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

  return (
    <Frame>
      <StageStrip g={g} />

      <div className="grid flex-1 grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
        <section>
          <h2 className="mb-3 text-2xl font-semibold">Scores</h2>
          <ScoreList teams={rows} activeTeam={g.activeTeam} scale="lg" />
          <p className="mt-6 text-2xl text-white/50">
            {g.activeTeamName ? `${g.activeTeamName} is choosing` : 'Waiting for a Team'}
          </p>
          <p className="mt-1 text-lg text-white/30">
            {contestantsLabel(contestantsOf(g.stage))} · {g.stage.penalty === 'on' ? 'Penalty On' : 'Penalty Off'}
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-2xl font-semibold">Categories</h2>
          {items.length === 0 ? (
            <p className="text-xl text-white/40">Every Category has been played out.</p>
          ) : (
            <CategoryGrid items={items} scale="lg" columns="grid-cols-4" />
          )}
        </section>
      </div>
    </Frame>
  );
}
