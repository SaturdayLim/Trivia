/**
 * @file Player screen (PRD §3.3, steps 1 and the lobby it lands in).
 *
 * v1 defect #10 — "Player cannot join after room creation" — is fixed here and
 * asserted by `canJoin`: the only states that refuse a Player are a closed room
 * and a finished Game. Joining during play is not an edge case, it is V2-13, so
 * the mid-Game join uses the same form and the same two writes as a lobby join;
 * the only difference is a banner explaining when they'll get a turn.
 *
 * One name field, not two. Typing a Team name that already exists joins that
 * Team (`matchTeam` on the derived `teamKey`); typing a new one creates it at
 * 0 points, slotted below the existing Teams. This is what makes tapping a
 * Team tile and typing its name the same gesture.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Card, Connecting, ErrorScreen, PresenceDot, Screen, TextInput } from '../components/ui.jsx';
import { Lobby } from '../components/Lobby.jsx';
import { useLobby, useRoom } from '../app/useRoom.js';
import { ROLE } from '../app/driver.js';
import { forgetRoom, loadIdentity, saveIdentity } from '../app/identity.js';
import { canJoin, matchTeam, nextTeamColor, nextTeamOrder, teamKey } from '../state/lobby.js';
import { createTeam, joinTeam, registerClient, touchActivity } from '../engine/actions.js';
import PlayGame from './PlayGame.jsx';

function JoinForm({ room, lobby, onSubmit, busy, error, initialName, initialTeam }) {
  const [playerName, setPlayerName] = useState(initialName || '');
  const [teamName, setTeamName] = useState(initialTeam || '');
  const existing = matchTeam(room.teams, teamName);

  return (
    <Screen center className="px-6 py-10">
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ playerName: playerName.trim(), teamName: teamName.trim() });
        }}
      >
        <h1 className="text-2xl font-semibold">Join the Game</h1>

        {lobby.inProgress && (
          <Banner tone="warn">
            This Game is already under way. Your Team joins at 0 points and takes its turn
            after the Teams already playing.
          </Banner>
        )}

        <TextInput
          label="Your Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={24}
          autoFocus
          required
        />

        <TextInput
          label="Team Name"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          maxLength={24}
          required
          hint={
            existing
              ? `You will join the existing Team "${lobby.teams.find((t) => t.teamId === existing)?.name}".`
              : 'A new Team will be created.'
          }
        />

        {lobby.teams.length > 0 && (
          <div>
            <p className="mb-2 text-sm text-white/50">Or tap a Team to join it</p>
            <div className="flex flex-wrap gap-2">
              {lobby.teams.map((t) => (
                <button
                  key={t.teamId}
                  type="button"
                  onClick={() => setTeamName(t.name)}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 px-3 text-sm hover:bg-white/5"
                >
                  <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                  {t.name}
                  <span className="text-white/40">
                    {t.players.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        <Button type="submit" disabled={busy || !playerName.trim() || !teamName.trim()}>
          {busy ? 'Joining…' : 'Confirm'}
        </Button>
      </form>
    </Screen>
  );
}

export default function Play() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const roomCode = params.get('room');

  const { phase, error, sync, room, roster, clientId, expired, retry } = useRoom(roomCode, ROLE.PLAYER);
  const lobby = useLobby(room, roster);

  const [identity, setIdentity] = useState(() => (roomCode ? loadIdentity(roomCode) : null));
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [editing, setEditing] = useState(false);

  const seated = Boolean(identity && identity.teamId && room && room.teams && room.teams[identity.teamId]);

  // Refresh-resume (PRD §6): a returning phone re-announces itself so its
  // presence dot goes green again. `registerClient` is idempotent, and the team
  // roster in the room tree already remembers them.
  useEffect(() => {
    if (phase !== 'ready' || !sync || !seated) return;
    registerClient(sync, {
      clientId,
      role: ROLE.PLAYER,
      name: identity.name,
      teamId: identity.teamId,
    }).catch(() => {});
  }, [phase, sync, seated, clientId, identity]);

  if (!roomCode) return <ErrorScreen title="No Room Code" onHome={() => navigate('/')} />;
  if (phase === 'connecting') return <Connecting />;
  if (phase === 'error') {
    return (
      <ErrorScreen
        title="Could not join the Game"
        detail={`No Game answered on Room Code ${roomCode}. It may have ended.`}
        onRetry={retry}
        onHome={() => navigate('/')}
      />
    );
  }

  if (expired) {
    return (
      <ErrorScreen
        title="This Game has ended"
        detail="The Host closed the Room, or it sat idle for 24 hours."
        onHome={() => { forgetRoom(roomCode); navigate('/'); }}
      />
    );
  }

  const gate = canJoin(room);
  if (!seated && !gate.allowed) {
    return (
      <ErrorScreen
        title={gate.reason === 'game-over' ? 'This Game is over' : 'This Room is closed'}
        detail="Ask the Host to start a new Game."
        onHome={() => navigate('/')}
      />
    );
  }

  async function handleJoin({ playerName, teamName }) {
    setBusy(true);
    setJoinError(null);
    try {
      const existingId = matchTeam(room.teams, teamName);
      let teamId = existingId;

      if (existingId) {
        const res = await joinTeam(sync, { teamId: existingId, playerId: clientId, playerName });
        if (!res.committed) throw new Error('That Team just disappeared. Try again.');
      } else {
        teamId = teamKey(teamName);
        const res = await createTeam(sync, {
          teamId,
          name: teamName,
          color: nextTeamColor(room.teams),
          order: nextTeamOrder(room.teams),
          playerId: clientId,
          playerName,
        });
        // Lost the race: someone created the same Team name a tick earlier.
        // That's a join, not an error — it's the outcome the player wanted.
        if (!res.committed && res.reason === 'team-id-taken') {
          const join = await joinTeam(sync, { teamId, playerId: clientId, playerName });
          if (!join.committed) throw new Error('Could not join that Team.');
        } else if (!res.committed) {
          throw new Error(
            res.reason === 'registration-locked'
              ? 'The Host has closed registration for new Teams.'
              : 'Could not create that Team.'
          );
        }
      }

      const next = { role: ROLE.PLAYER, playerId: clientId, name: playerName, teamId };
      saveIdentity(roomCode, next);
      setIdentity(next);
      setEditing(false);
      touchActivity(sync).catch(() => {});
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!seated || editing) {
    return (
      <JoinForm
        room={room}
        lobby={lobby}
        onSubmit={handleJoin}
        busy={busy}
        error={joinError}
        initialName={identity?.name}
        initialTeam={editing ? lobby.teams.find((t) => t.teamId === identity?.teamId)?.name : ''}
      />
    );
  }

  // The Game has begun: the lobby gives way to the live screens (PRD §3.3).
  // A Player who joins mid-Game (V2-13) lands here the moment they Confirm —
  // there is no separate "wait for the next Game" state, because there isn't one.
  if (lobby.status === 'playing' || lobby.status === 'ended') {
    return (
      <PlayGame
        sync={sync}
        room={room}
        roomCode={roomCode}
        clientId={clientId}
        teamId={identity.teamId}
        onExit={() => {
          forgetRoom(roomCode);
          navigate('/');
        }}
      />
    );
  }

  const myTeam = lobby.teams.find((t) => t.teamId === identity.teamId);

  return (
    <Screen>
      <Lobby lobby={lobby} roomCode={roomCode}>
        <Card className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <PresenceDot connected />
            <span className="text-white/60">You are</span>
            <strong>{identity.name}</strong>
            <span className="text-white/60">on</span>
            <span className="flex items-center gap-1.5 font-semibold" style={{ color: myTeam?.color }}>
              {myTeam?.name}
            </span>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Back
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                forgetRoom(roomCode);
                navigate('/');
              }}
            >
              Exit
            </Button>
          </div>
        </Card>

        <p className="pb-8 text-center text-sm text-white/40">
          {lobby.inProgress
            ? 'The Game is under way. Your turn comes around in the next Rotation.'
            : 'Waiting for the Host to begin the Game.'}
        </p>
      </Lobby>
    </Screen>
  );
}
