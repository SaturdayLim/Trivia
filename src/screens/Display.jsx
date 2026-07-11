/**
 * @file Display screen (PRD §3.4). Read-only, landscape, projected — "flipped
 * phone" means landscape orientation, not mirrored output (V2-22).
 *
 * It registers itself as a client so the Host can see on their phone that the
 * projector is attached and alive, but it never writes game state: it holds no
 * authority, it takes no turn, and nothing here calls an action that mutates
 * `game/`. The lobby it shows is the same component the players see, at `lg`
 * scale so a room can read it from the sofa.
 */

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Connecting, ErrorScreen, Screen } from '../components/ui.jsx';
import { Lobby } from '../components/Lobby.jsx';
import { useLobby, useRoom } from '../app/useRoom.js';
import { ROLE } from '../app/driver.js';
import { registerClient } from '../engine/actions.js';
import DisplayGame from './DisplayGame.jsx';

/** Displays are unnamed hardware; number them so a Host with two can tell them apart. */
function displayName(clientId) {
  return `Display ${clientId.slice(-4).toUpperCase()}`;
}

export default function Display() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const roomCode = params.get('room');

  const { phase, sync, room, roster, clientId, expired, retry } = useRoom(roomCode, ROLE.DISPLAY);
  const lobby = useLobby(room, roster);

  // Announce (and re-announce after a refresh). Idempotent, and the only write
  // a Display ever makes.
  useEffect(() => {
    if (phase !== 'ready' || !sync) return;
    registerClient(sync, { clientId, role: ROLE.DISPLAY, name: displayName(clientId) }).catch(() => {});
  }, [phase, sync, clientId]);

  if (!roomCode) return <ErrorScreen title="No Room Code" onHome={() => navigate('/')} />;
  if (phase === 'connecting') return <Connecting label="Attaching this Display" />;
  if (phase === 'error') {
    return (
      <ErrorScreen
        title="Could not attach this Display"
        detail={`No Game answered on Room Code ${roomCode}.`}
        onRetry={retry}
        onHome={() => navigate('/')}
      />
    );
  }
  if (expired) {
    return <ErrorScreen title="This Game has ended" onHome={() => navigate('/')} />;
  }

  // Once the Game starts the Display stops being a lobby and becomes the board
  // the room reads from across the sofa (PRD §3.4).
  if (lobby.status === 'playing' || lobby.status === 'ended') {
    return <DisplayGame room={room} sync={sync} />;
  }

  return (
    <Screen>
      <Lobby lobby={lobby} roomCode={roomCode} showQr scale="lg">
        <p className="pb-10 text-center text-2xl text-white/40">
          {lobby.inProgress ? 'The Game is under way.' : 'Waiting for the Host to begin the Game.'}
        </p>
      </Lobby>
    </Screen>
  );
}
