/**
 * @file The three wire-level role names, in one neutral place.
 *
 * The protocol says `gm`; the user-facing word is "Host" (V2-23). They are not
 * interchangeable and neither can be renamed without the other's consent:
 * `driver-mock` promotes exactly the `gm`-role tab to serializer on recovery,
 * and every authority check in `engine/actions.js` compares against `'gm'`.
 *
 * This lives in `state/` rather than `app/` so the pure layers can name a role
 * without importing the driver-selection machinery (and so a test that stubs
 * the driver doesn't accidentally stub the alphabet).
 */

export const ROLE = Object.freeze({ HOST: 'gm', PLAYER: 'player', DISPLAY: 'display' });
