/**
 * @file Room creation (V2-19, V2-20). Deliberately NOT a hook and NOT an
 * effect: it runs once, from a button press.
 *
 * The sequence matters.
 *   1. Pick a code nobody holds. `connect({create: true})` does a `set()` on
 *      `rooms/<code>`, which would evict a live game on a collision — so the
 *      probe comes first, and `pickFreeRoomCode` retries.
 *   2. Write the tree, seat the host, remember the PIN on this device.
 *   3. Close the session and hand back the code.
 *
 * Step 3 looks wasteful and isn't. The screen then navigates to
 * `/host?room=<code>` and `useRoom` connects with `create: false` — which is
 * exactly the path a refresh takes. Creation and resume therefore share one
 * code path, so "does the host survive F5" is answered by the same lines that
 * ran a second ago, not by a second implementation that only runs on Tuesdays.
 */

import { createSync } from '../sync/adapter.js';
import { createRoomState, registerClient } from '../engine/actions.js';
import { generateHostPin, pickFreeRoomCode } from '../state/room.js';
import { defaultStages, DEFAULT_TIER_SIZE } from '../state/stages.js';
import { loadDriver, ROLE } from './driver.js';
import { saveHostPin, saveIdentity } from './identity.js';

/** The host's display name in the roster. Proper case (v1 defect #6). */
export const HOST_NAME = 'Host';

/**
 * The settings a room is born with. Not `scoring.DEFAULT_ROUNDS`: those are v1's
 * four rounds, and round 3 of them is `contest`, which V2-9 excludes from the
 * game. `defaultStages()` is the v2 four, and every field of them is editable in
 * Stage setup before Begin.
 *
 * `orderRecalc: 'perRotation'` is what makes each Stage's "Who Selects Next"
 * (V2-10) mean anything at all — under `perRound` the scheduler holds one order
 * for the whole Stage and never consults it.
 */
function initialSettings() {
  return {
    rounds: defaultStages(),
    orderRecalc: 'perRotation',
    tierSize: DEFAULT_TIER_SIZE,
    categories: [],
    excludeUsed: true,
  };
}

/**
 * Create a fresh room and seat this device as its host.
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {Object} [opts.settings] - overrides merged over `initialSettings()`.
 * @returns {Promise<{roomCode: string, hostPin: string}>}
 */
export async function createRoom({ clientId, settings = {} }) {
  const driver = await loadDriver();
  const roomCode = await pickFreeRoomCode(driver.roomExists);
  const hostPin = generateHostPin();

  const sync = await createSync({
    driver,
    roomCode,
    clientId,
    role: ROLE.HOST,
    create: true,
    initialState: {},
  });

  try {
    // No teams at creation: teams are what players make of themselves (V2-13).
    await createRoomState(sync, ROLE.HOST, {
      clientId,
      hostPin,
      teams: [],
      settings: { ...initialSettings(), ...settings },
    });
    await registerClient(sync, { clientId, role: ROLE.HOST, name: HOST_NAME });
  } finally {
    sync.close();
  }

  saveIdentity(roomCode, { role: ROLE.HOST, playerId: clientId, name: HOST_NAME, teamId: null });
  saveHostPin(roomCode, hostPin);

  return { roomCode, hostPin };
}
