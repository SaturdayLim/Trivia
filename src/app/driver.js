/**
 * @file The single SWAP POINT between the Firebase driver and the same-device
 * mock driver (V2-21). Nothing else in the app imports a driver module.
 *
 * Selection, highest priority first:
 *   1. `?driver=mock` / `?driver=firebase` in the URL — sticky: the choice is
 *      remembered so the query string doesn't have to survive every navigation
 *      (a player who scans a QR into `/play?driver=mock` stays on mock).
 *   2. Whatever was remembered last.
 *   3. Firebase.
 *
 * Both drivers are loaded lazily so a mock-driver session never pulls the
 * Firebase SDK off gstatic, and a Firebase session never touches
 * BroadcastChannel.
 *
 * ROLE NAMES: re-exported from `state/roles.js` for the screens' convenience —
 * they import the driver seam anyway. The pure layers import it from there.
 */

export { ROLE } from '../state/roles.js';

const STORAGE_KEY = 'stack-driver';
const VALID = new Set(['mock', 'firebase']);

function remembered() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

function remember(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private browsing — the choice just won't stick across reloads */
  }
}

/**
 * Which driver this session is using. Reads (and consumes) `?driver=` once.
 * @returns {'mock'|'firebase'}
 */
export function driverName() {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get('driver');
  } catch {
    /* no window (tests) */
  }
  if (VALID.has(fromUrl)) {
    remember(fromUrl);
    return fromUrl;
  }
  return remembered() || 'firebase';
}

/** @returns {boolean} true when running offline on the same-device mock driver. */
export function isMockDriver() {
  return driverName() === 'mock';
}

let driverPromise = null;

/**
 * The driver module for this session, loaded once.
 * @returns {Promise<Object>} conforms to the adapter's driver contract.
 */
export function loadDriver() {
  if (!driverPromise) {
    driverPromise = (isMockDriver()
      ? import('../sync/driver-mock.js')
      : import('../sync/driver-firebase.js')
    ).catch((err) => {
      driverPromise = null;
      throw err;
    });
  }
  return driverPromise;
}

/**
 * Does `rooms/<roomCode>` already hold a game? Used both to pick a free code at
 * creation and to tell a joiner "no such room" before a 10s connect timeout.
 * @param {string} roomCode
 * @returns {Promise<boolean>}
 */
export async function roomExists(roomCode) {
  const driver = await loadDriver();
  return driver.roomExists(roomCode);
}

/**
 * The exposure backend matching this session's driver (V2-5 / V2-21): the real
 * global RTDB tree, or localStorage when offline.
 * @returns {Promise<import('../state/exposure.js').ExposureBackend>}
 */
export async function loadExposureBackend() {
  const mod = await import('../state/exposure.js');
  return isMockDriver() ? mod.createLocalExposureBackend() : mod.createFirebaseExposureBackend();
}
