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
import { loadDriver, ROLE } from './driver.js';
import { saveHostPin, saveIdentity } from './identity.js';

/** The host's display name in the roster. Proper case (v1 defect #6). */
export const HOST_NAME = 'Host';

/**
 * Create a fresh room and seat this device as its host.
 * @param {Object} opts
 * @param {string} opts.clientId
 * @param {Object} [opts.settings] - partial settings; Stage setup lands in S4.
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
    await createRoomState(sync, ROLE.HOST, { clientId, hostPin, teams: [], settings });
    await registerClient(sync, { clientId, role: ROLE.HOST, name: HOST_NAME });
  } finally {
    sync.close();
  }

  saveIdentity(roomCode, { role: ROLE.HOST, playerId: clientId, name: HOST_NAME, teamId: null });
  saveHostPin(roomCode, hostPin);

  return { roomCode, hostPin };
}
