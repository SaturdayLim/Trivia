/**
 * @file Host screen: the seat, the setup wizard, the lobby, and the live loop.
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
 *
 * THE SETUP WIZARD (PRD §3.2 steps 2–4). Categories, then Stages, then the
 * lobby with Begin. Each step Confirms into the room tree rather than into
 * React state, so `view` below is only ever a question of *which* screen the
 * Host is looking at, never of what the Game is. A refresh mid-setup lands back
 * on the lobby with every choice intact.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Card, Connecting, ErrorScreen, RoomCode, Screen, TextInput } from '../components/ui.jsx';
import { Lobby } from '../components/Lobby.jsx';
import { useLobby, useRoom } from '../app/useRoom.js';
import { useCatalog, useExposure, useGameDefaults } from '../app/useCatalog.js';
import { ROLE } from '../app/driver.js';
import { forgetRoom, loadHostPin, saveHostPin } from '../app/identity.js';
import { HOST_NAME } from '../app/createRoom.js';
import {
  claimHost,
  closeRoom,
  openTapIn,
  registerClient,
  releaseHost,
  setBoard,
  startGame,
  touchActivity,
  updateBoardSettings,
  updateRoundSettings,
} from '../engine/actions.js';
import { buildBoard } from '../engine/board.js';
import { buildCategoryMeta } from '../content/catalog.js';
import { DEFAULT_TIER_SIZE } from '../state/stages.js';
import { CategorySelect, StageSetup, stagesFromRoom } from './HostSetup.jsx';
import HostGame from './HostGame.jsx';

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
  const catalog = useCatalog();
  const exposure = useExposure();
  const gameDefaults = useGameDefaults();

  const [showPin, setShowPin] = useState(Boolean(location.state?.justCreated));
  const [claimError, setClaimError] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const autoClaimed = useRef(false);

  // Which setup screen is on the Host's phone. `null` = the lobby.
  const [view, setView] = useState(null);
  const routed = useRef(false);

  // Draft state for the wizard. Seeded from the room tree so Back-to-revise
  // reopens what was Confirmed, not what the component was born with.
  const [draftCats, setDraftCats] = useState({ selected: [], tierSizes: {} });
  const [draftStages, setDraftStages] = useState(null);

  const seated = Boolean(room?.meta?.gmClientId === clientId);
  const otherHostLive = Boolean(
    lobby.host.clientId && lobby.host.clientId !== clientId && lobby.host.connected
  );
  const status = room?.meta?.status || 'lobby';
  const chosenCategories = useMemo(() => (room?.settings?.categories) || [], [room]);

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

  // Opening a wizard step seeds its draft from the tree, synchronously — Back to
  // revise must reopen what was Confirmed, and a draft seeded in an effect would
  // render one frame of the wrong thing first.
  function openCategories() {
    setDraftCats({
      selected: room?.settings?.categories || [],
      tierSizes: room?.settings?.tierSizes || {},
    });
    setError(null);
    setView('categories');
  }

  function openStages() {
    setDraftStages(stagesFromRoom(room));
    setError(null);
    setView('stages');
  }

  // A freshly created Game has no Categories, so its Host starts in the
  // wizard. One-shot: once they have been routed, `view` is theirs to drive.
  // R8: that first landing preselects the Quickstart ten (still fully
  // editable) rather than an empty grid — waiting one tick for the preset to
  // load rather than opening to nothing and repopulating under the Host.
  useEffect(() => {
    if (!seated || routed.current || status !== 'lobby' || !room) return;
    if (chosenCategories.length === 0 && gameDefaults.loading) return;
    routed.current = true;
    if (chosenCategories.length === 0) {
      setDraftCats({ selected: gameDefaults.slugs, tierSizes: {} });
      setError(null);
      setView('categories');
    }
  }, [seated, status, chosenCategories, room, gameDefaults.loading, gameDefaults.slugs]);

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

  async function handleReturnHome() {
    // Vacate the seat rather than merely navigating away, so the Host can pick
    // the Game back up from another phone without waiting out a presence timeout.
    await releaseHost(sync, ROLE.HOST, clientId).catch(() => {});
    navigate('/');
  }

  /** Confirm step 1: Categories + their Questions per Tier (V2-17). */
  async function handleConfirmCategories() {
    setBusy(true);
    setError(null);
    try {
      const tierSizes = {};
      for (const slug of draftCats.selected) {
        tierSizes[slug] = draftCats.tierSizes[slug] || DEFAULT_TIER_SIZE;
      }
      const res = await updateBoardSettings(sync, ROLE.HOST, {
        categories: draftCats.selected,
        tierSizes,
        categoryMeta: buildCategoryMeta(catalog.categories, draftCats.selected),
      });
      if (!res.committed) throw new Error('Categories cannot change while a question is live.');
      openStages();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Confirm step 2: the four Stages. */
  async function handleConfirmStages() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateRoundSettings(sync, ROLE.HOST, {
        rounds: draftStages,
        // Every Stage now carries its own "Who Selects Next" (V2-10), and the
        // scheduler only consults it when it recomputes each rotation.
        orderRecalc: 'perRotation',
      });
      if (!res.committed) throw new Error('Stages cannot change while a question is live.');
      setView(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Draw the board, seat round 1, open the first tap-in. */
  async function handleBegin() {
    setBusy(true);
    setError(null);
    try {
      const settings = {
        categories: chosenCategories,
        tierSize: DEFAULT_TIER_SIZE,
        tierSizes: room.settings?.tierSizes || {},
        excludeUsed: true,
      };
      const { board, drawn } = buildBoard({
        categories: catalog.categories,
        settings,
        usedRefs: exposure.store ? exposure.store.usedRefs() : [],
      });
      if (drawn.length === 0) {
        throw new Error('No unplayed questions were drawn. Reset a Category or choose another.');
      }
      await setBoard(sync, ROLE.HOST, board);
      const started = await startGame(sync, ROLE.HOST);
      // `startGame` seats round 1 but deliberately does not open the gate.
      await openTapIn(sync, ROLE.HOST, started.activeTeam);
      await touchActivity(sync);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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

  // --- Setup wizard ---------------------------------------------------------
  // Ahead of the live loop on purpose: PRD §3.1 gives the Host a Round Settings
  // peripheral at all times, and `updateRoundSettings` is the one that decides
  // whether an edit is legal right now (it refuses mid-question), not this
  // render order.
  if (view === 'categories') {
    if (catalog.loading) return <Connecting label="Loading the Question Bank" />;
    if (catalog.error) {
      return (
        <ErrorScreen
          title="Could not load the Question Bank"
          detail={catalog.error.message}
          onRetry={() => window.location.reload()}
          onHome={() => setView(null)}
        />
      );
    }
    return (
      <CategorySelect
        catalog={catalog.categories}
        exposure={exposure}
        selected={draftCats.selected}
        tierSizes={draftCats.tierSizes}
        onChange={setDraftCats}
        onConfirm={handleConfirmCategories}
        onBack={() => setView(null)}
        busy={busy}
      />
    );
  }

  if (view === 'stages' && draftStages) {
    const backTo = status === 'playing' || status === 'ended' ? () => setView(null) : openCategories;
    const boardSize = chosenCategories.reduce((n, slug) => {
      const cat = catalog.categories.find((c) => c.slug === slug);
      if (!cat) return n;
      const perTier = room.settings?.tierSizes?.[slug] || DEFAULT_TIER_SIZE;
      for (const dif of ['E', 'M', 'H']) {
        n += Math.min(perTier, cat.questions.filter((q) => q.dif === dif).length);
      }
      return n;
    }, 0);

    return (
      <StageSetup
        stages={draftStages}
        teamCount={lobby.teams.length}
        questionsOnBoard={catalog.loading ? null : boardSize}
        onChange={setDraftStages}
        onConfirm={handleConfirmStages}
        onBack={backTo}
        busy={busy}
      />
    );
  }

  // --- The Game is under way (or over) --------------------------------------
  if (status === 'playing' || status === 'ended') {
    if (catalog.loading) return <Connecting label="Loading the Question Bank" />;
    return (
      <HostGame
        sync={sync}
        room={room}
        roomCode={roomCode}
        catalog={catalog.categories}
        exposure={exposure}
        onEditStages={openStages}
        onReturnHome={handleReturnHome}
        onCloseRoom={handleClose}
      />
    );
  }

  // --- Lobby ----------------------------------------------------------------
  const canBegin = lobby.teams.length > 0 && chosenCategories.length > 0;

  return (
    <Screen>
      <Lobby lobby={lobby} roomCode={roomCode} showQr>
        {showPin && loadHostPin(roomCode) && (
          <PinReveal pin={loadHostPin(roomCode)} onDismiss={() => setShowPin(false)} />
        )}

        {claimError && <Banner tone="warn">{claimError}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}

        <Card>
          <h2 className="mb-1 text-lg font-semibold">Ready to begin?</h2>
          <p className="mb-4 text-sm text-white/50">
            {chosenCategories.length === 0
              ? 'A Game has four Stages. Choose your Categories and set up each Stage.'
              : `${chosenCategories.length} ${chosenCategories.length === 1 ? 'Category' : 'Categories'} chosen. You can revise anything before you begin.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleBegin} disabled={busy || !canBegin}>
              {busy ? 'Drawing the Board…' : 'Begin Game'}
            </Button>
            <Button variant="secondary" onClick={openCategories}>
              Categories
            </Button>
            <Button variant="secondary" onClick={openStages}>
              Stages
            </Button>
            <Button variant="danger" onClick={handleClose}>
              Close Room
            </Button>
          </div>
          {!canBegin && (
            <p className="mt-3 text-xs text-white/40">
              {chosenCategories.length === 0
                ? 'Choose at least one Category first.'
                : 'Waiting for at least one Team to join.'}
            </p>
          )}
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
