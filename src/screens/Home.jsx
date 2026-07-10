/**
 * @file Entry screen (PRD §3.1): Start (become Host) or Join (Room Code ->
 * Player or Display).
 *
 * The Join path validates the code twice, on purpose: `isValidRoomCode` catches
 * a typo instantly with no network at all, and `roomExists` catches a
 * well-formed code for a room that never existed. Without the second check a
 * wrong-but-plausible code buys you a 10 second connect timeout and then a
 * mystery — v1's join experience.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, Screen, TextInput } from '../components/ui.jsx';
import { isValidRoomCode, normalizeRoomCode } from '../state/room.js';
import { createRoom } from '../app/createRoom.js';
import { getOrCreateClientId } from '../app/identity.js';
import { isMockDriver, roomExists } from '../app/driver.js';

function Logo() {
  return (
    <div className="mb-8 flex flex-col items-center gap-2">
      <img src="/icons/Logo_Stack.png" alt="" className="h-20 w-auto" aria-hidden="true" />
      <h1 className="sr-only">Stack</h1>
      <p className="text-sm text-white/40">A Saturday Solutions Game</p>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('entry'); // entry | join | role
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const { roomCode } = await createRoom({ clientId: getOrCreateClientId() });
      // `justCreated` tells the Host screen to surface the PIN once, with a
      // save prompt. It is never shown again — the device remembers it.
      navigate(`/host?room=${roomCode}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err.message || 'Could not create a Game.');
      setBusy(false);
    }
  }

  async function handleJoinCode(e) {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!isValidRoomCode(normalized)) {
      setError('That Room Code does not look right. It is four characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await roomExists(normalized))) {
        setError(`No Game is running under Room Code ${normalized}.`);
        setBusy(false);
        return;
      }
      setCode(normalized);
      setMode('role');
    } catch (err) {
      setError(err.message || 'Could not reach the Game.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center className="px-6">
      <div className="w-full max-w-sm">
        <Logo />

        {error && (
          <div className="mb-4">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        {mode === 'entry' && (
          <div className="flex flex-col gap-3">
            <Button onClick={handleStart} disabled={busy}>
              {busy ? 'Creating Your Game…' : 'Start a Game'}
            </Button>
            <Button variant="secondary" onClick={() => { setMode('join'); setError(null); }}>
              Join a Game
            </Button>
          </div>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoinCode} className="flex flex-col gap-3">
            <TextInput
              label="Room Code"
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              placeholder="ABCD"
              maxLength={4}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className="text-center font-mono text-2xl tracking-[0.4em]"
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Looking for the Game…' : 'Continue'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => { setMode('entry'); setError(null); }}>
              Back
            </Button>
          </form>
        )}

        {mode === 'role' && (
          <div className="flex flex-col gap-3">
            <Card className="mb-2 text-center">
              <p className="text-sm text-white/50">Joining Room</p>
              <p className="font-mono text-2xl font-bold tracking-[0.3em] text-[var(--stack-accent)]">{code}</p>
            </Card>
            <Button onClick={() => navigate(`/play?room=${code}`)}>Join as a Player</Button>
            <Button variant="secondary" onClick={() => navigate(`/display?room=${code}`)}>
              Use This Screen as a Display
            </Button>
            <Button variant="ghost" onClick={() => { setMode('join'); setError(null); }}>
              Back
            </Button>
          </div>
        )}

        {isMockDriver() && (
          <p className="mt-8 text-center text-xs text-white/30">
            Offline mode — this Game lives in this browser only.
          </p>
        )}
      </div>
    </Screen>
  );
}
