/**
 * @file Host screen (PRD §3.2 steps 1 and 4 — Category selection and Stage
 * setup land in S4).
 *
 * THE HOST SEAT (V2-19). `meta.gmClientId` is a single chair, and this screen
 * is the only thing that sits in it. Three ways to arrive:
 *
 *   1. Fresh from `createRoom` — already seated, PIN shown once.
 *   2. Refresh on the same device — the PIN is in localStorage, so `claimHost`
 *      runs silently and the host never sees a prompt for a secret they've
 *      already proven they hold.
 *   3. A different device (the host's phone died) — the PIN must be typed.
 *
 * `claimHost` refuses while the seated host is still live on the presence
 * roster, so case 3 can't quietly evict a working host who merely opened a
 * second tab. Presence is the only thing that can tell "gone" from "quiet",
 * and it lives in the driver, so this screen reads it and passes it down.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Card, Connecting, ErrorScreen, RoomCode, Screen, TextInput } from '../components/ui.jsx';
import { Lobby } from '../components/Lobby.jsx';
import { useLobby, useRoom } from '../app/useRoom.js';
import { ROLE } from '../app/driver.js';
import { forgetRoom, loadHostPin, saveHostPin } from '../app/identity.js';
import { HOST_NAME } from '../app/createRoom.js';
import { claimHost, closeRoom, registerClient, touchActivity } from '../engine/actions.js';

/** Shown once, at creation. The one moment the PIN is ever on screen. */
function PinReveal({ pin, onDismiss }) {
  return (
    <Card className="border-[var(--stack-accent)]/40 bg-[var(--stack-accent)]/[0.06]">
      <h2 className="mb-1 text-lg font-semibold">Save Your Host PIN</h2>
      <p className="mb-3 text-sm text-white/60">
        You need this only if you continue as Host on a different phone. This device remembers it.
      </p>
      <p className="mb-4 font-mono text-4xl font-bold tracking-[0.4em] text-[var(--stack-accent)]">{pin}</p>
      <Button variant="secondary" onClick={onDismiss}>
        I have saved it
      </Button>
    </Card>
  );
}

function PinPrompt({ onSubmit, busy, error }) {
  const [pin, setPin] = useState('');
  return (
    <Screen center className="px-6">
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(pin.trim());
        }}
      >
        <h1 className="text-2xl font-semibold">Continue as Host</h1>
        <p className="text-sm text-white/60">
          Enter the Host PIN shown when this Game was created.
        </p>
        <TextInput
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          maxLength={4}
          // inputMode numeric gives a keypad; typing still works everywhere
          // (v1 defect #9 — never arrow-keys-only).
          inputMode="numeric"
          autoFocus
          placeholder="0000"
          className="text-center font-mono text-3xl tracking-[0.4em]"
        />
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" disabled={busy || pin.length !== 4}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </Screen>
  );
}

export default function Host() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const roomCode = params.get('room');

  const { phase, sync, room, roster, clientId, expired, retry } = useRoom(roomCode, ROLE.HOST);
  const lobby = useLobby(room, roster);

  const [showPin, setShowPin] = useState(Boolean(location.state?.justCreated));
  const [claimError, setClaimError] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const autoClaimed = useRef(false);

  const seated = Boolean(room?.meta?.gmClientId === clientId);
  const otherHostLive = Boolean(
    lobby.host.clientId && lobby.host.clientId !== clientId && lobby.host.connected
  );

  // Silent reclaim on refresh (case 2 above). Runs once per connection: the
  // ref guard stops a re-render — or StrictMode's second mount — from firing a
  // second transaction at the seat.
  useEffect(() => {
    if (phase !== 'ready' || !sync || seated || autoClaimed.current) return;
    const savedPin = loadHostPin(roomCode);
    if (!savedPin) {
      setNeedsPin(true);
      return;
    }
    autoClaimed.current = true;
    claimHost(sync, { clientId, pin: savedPin, hostPresent: otherHostLive })
      .then((res) => {
        if (res.committed) {
          registerClient(sync, { clientId, role: ROLE.HOST, name: HOST_NAME }).catch(() => {});
          touchActivity(sync).catch(() => {});
        } else {
          autoClaimed.current = false;
          setNeedsPin(res.reason === 'bad-pin');
          setClaimError(
            res.reason === 'host-present'
              ? 'Another device is currently hosting this Game.'
              : 'The saved Host PIN was rejected.'
          );
        }
      })
      .catch(() => {
        autoClaimed.current = false;
      });
  }, [phase, sync, seated, clientId, roomCode, otherHostLive]);

  async function handlePinSubmit(pin) {
    setClaiming(true);
    setClaimError(null);
    const res = await claimHost(sync, { clientId, pin, hostPresent: otherHostLive });
    if (res.committed) {
      saveHostPin(roomCode, pin);
      await registerClient(sync, { clientId, role: ROLE.HOST, name: HOST_NAME }).catch(() => {});
      touchActivity(sync).catch(() => {});
      setNeedsPin(false);
    } else {
      setClaimError(
        res.reason === 'host-present'
          ? 'Another device is currently hosting this Game. Ask it to leave first.'
          : 'That PIN is not right.'
      );
    }
    setClaiming(false);
  }

  async function handleClose() {
    if (!window.confirm('Close this Room? Every Player and Display is disconnected and the Game ends.')) return;
    await closeRoom(sync, ROLE.HOST);
    forgetRoom(roomCode);
    navigate('/');
  }

  if (!roomCode) return <ErrorScreen title="No Room Code" onHome={() => navigate('/')} />;
  if (phase === 'connecting') return <Connecting label="Opening your Game" />;
  if (phase === 'error') {
    return (
      <ErrorScreen
        title="Could not open the Game"
        detail={`No Game answered on Room Code ${roomCode}.`}
        onRetry={retry}
        onHome={() => navigate('/')}
      />
    );
  }
  if (expired) {
    return (
      <ErrorScreen
        title="This Room has expired"
        detail="A Room closes when the Host closes it, or after 24 hours of inactivity."
        onHome={() => { forgetRoom(roomCode); navigate('/'); }}
      />
    );
  }

  if (!seated && needsPin) {
    return <PinPrompt onSubmit={handlePinSubmit} busy={claiming} error={claimError} />;
  }
  if (!seated) return <Connecting label="Taking the Host seat" />;

  return (
    <Screen>
      <Lobby lobby={lobby} roomCode={roomCode} showQr>
        {showPin && loadHostPin(roomCode) && (
          <PinReveal pin={loadHostPin(roomCode)} onDismiss={() => setShowPin(false)} />
        )}

        {claimError && <Banner tone="warn">{claimError}</Banner>}

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Ready to begin?</h2>
          <p className="mb-4 text-sm text-white/50">
            A Game has four Stages. Choose your Categories and set up each Stage next.
          </p>
          <div className="flex flex-wrap gap-3">
            {/* Category selection + Stage setup are S4. Disabled rather than
                hidden so the Host can see where the flow goes. */}
            <Button disabled title="Category selection and Stage setup arrive next">
              Begin Game
            </Button>
            <Button variant="danger" onClick={handleClose}>
              Close Room
            </Button>
          </div>
        </Card>

        <div className="pb-8 text-center text-sm text-white/40">
          Players join at any time — before the Game and during it.
          <div className="mt-2">
            Room Code <RoomCode code={roomCode} size="md" />
          </div>
        </div>
      </Lobby>
    </Screen>
  );
}
