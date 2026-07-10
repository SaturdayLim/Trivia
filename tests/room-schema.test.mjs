// Pure room-schema rules (src/state/room.js): auto room codes (V2-20), host
// PIN (V2-19), lifecycle + 24h expiry (V2-20), selection claim (V2-14).
import assert from 'node:assert';
import { test } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_TTL_MS,
  generateHostPin,
  generateRoomCode,
  holdsClaim,
  initialLifecycle,
  isLockedOut,
  isRoomExpired,
  isValidRoomCode,
  makeSelectionClaim,
  msUntilExpiry,
  normalizeRoomCode,
  pickFreeRoomCode,
  pinMatches,
} from '../src/state/room.js';

/** Deterministic rng cycling through `values`. */
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('room codes: generated from the unambiguous alphabet, round-trip validation', () => {
  const code = generateRoomCode(seq([0, 0.5, 0.99, 0.2]));
  assert.equal(code.length, ROOM_CODE_LENGTH);
  assert.ok(isValidRoomCode(code), `${code} should validate`);

  for (const confusable of ['0', 'O', '1', 'I', 'L', '2', 'Z', '5', 'S', '8', 'B']) {
    assert.ok(!ROOM_CODE_ALPHABET.includes(confusable), `alphabet must exclude ${confusable}`);
  }

  assert.ok(!isValidRoomCode('ABC'), 'too short');
  assert.ok(!isValidRoomCode('ABCDE'), 'too long');
  assert.ok(!isValidRoomCode('AB0D'), '0 is not in the alphabet');
  assert.ok(!isValidRoomCode(null));
});

test('room codes: normalization trims, uppercases, strips punctuation', () => {
  assert.equal(normalizeRoomCode('  a3c-d '), 'A3CD');
  assert.equal(normalizeRoomCode('a3 cd'), 'A3CD');
  assert.equal(normalizeRoomCode(null), '');
});

test('room codes: pickFreeRoomCode retries past collisions, then gives up loudly', async () => {
  // rng yields index 0 four times (-> "3333"), then index 1 (-> "4444").
  const rng = seq([0, 0, 0, 0, 1 / ROOM_CODE_ALPHABET.length + 1e-9]);
  const taken = new Set(['3333']);
  const code = await pickFreeRoomCode(async (c) => taken.has(c), { rng, maxAttempts: 4 });
  assert.notEqual(code, '3333', 'must not hand back an occupied code');

  await assert.rejects(
    () => pickFreeRoomCode(async () => true, { rng: seq([0]), maxAttempts: 3 }),
    /no free room code after 3 attempts/
  );
});

test('host PIN: 4 digits; matching is exact and type-safe', () => {
  const pin = generateHostPin(seq([0.1, 0.9, 0.5, 0.0]));
  assert.match(pin, /^\d{4}$/);

  assert.ok(pinMatches('4821', '4821'));
  assert.ok(!pinMatches('4821', '4822'));
  assert.ok(!pinMatches('4821', '482'), 'length mismatch');
  assert.ok(!pinMatches(null, '4821'), 'a room with no PIN accepts nothing');
  assert.ok(!pinMatches('4821', null));
  assert.ok(!pinMatches(4821, 4821), 'numbers are not PINs');
  assert.ok(!pinMatches('', ''), 'an empty PIN is still no PIN');
});

test('lifecycle: expires on close, or after 24h idle; mid-game breaks survive', () => {
  const t0 = 1_700_000_000_000;
  const lifecycle = initialLifecycle(t0);
  assert.deepEqual(lifecycle, { createdAt: t0, lastActivityAt: t0 });

  const open = { meta: { status: 'playing' }, lifecycle };

  assert.ok(!isRoomExpired(open, t0), 'fresh room is live');
  assert.ok(!isRoomExpired(open, t0 + 6 * 3600_000), 'a 6h dinner break survives');
  assert.ok(!isRoomExpired(open, t0 + ROOM_TTL_MS - 1), 'one ms short of the TTL');
  assert.ok(isRoomExpired(open, t0 + ROOM_TTL_MS), 'exactly at the TTL');

  assert.ok(isRoomExpired({ meta: { status: 'closed' }, lifecycle }, t0), 'closed beats a fresh clock');
  assert.ok(isRoomExpired({ status: 'closed', lifecycle }, t0), 'bare {status} shape also accepted');
  assert.ok(isRoomExpired(null, t0), 'a missing room is expired');
  assert.ok(!isRoomExpired({ meta: { status: 'lobby' } }, t0), 'no lifecycle recorded -> never reaped');

  assert.equal(msUntilExpiry(open, t0), ROOM_TTL_MS);
  assert.equal(msUntilExpiry(open, t0 + ROOM_TTL_MS + 5), -5, 'negative once past');
  assert.equal(msUntilExpiry({ meta: { status: 'closed' }, lifecycle }, t0), -Infinity);
  assert.equal(msUntilExpiry({ meta: { status: 'lobby' } }, t0), Infinity);
});

test('selection claim: holder drives, teammates lock out, other teams unaffected', () => {
  const claim = makeSelectionClaim('p1', 't1', 999, 'category');
  assert.deepEqual(claim, { playerId: 'p1', teamId: 't1', screen: 'category', at: 999 });

  assert.ok(holdsClaim(claim, 'p1', 't1'), 'the claimant holds it');
  assert.ok(!holdsClaim(claim, 'p2', 't1'), 'a teammate does not');
  assert.ok(isLockedOut(claim, 'p2', 't1'), 'the teammate is locked out (V2-14)');
  assert.ok(!isLockedOut(claim, 'p1', 't1'), 'the claimant is not locked out of their own claim');

  // A claim from a previous turn must never gate the incoming team's screen.
  assert.ok(!holdsClaim(claim, 'p1', 't2'), 'stale claim grants nothing on t2 turn');
  assert.ok(!isLockedOut(claim, 'p9', 't2'), 'stale claim locks nobody on t2 turn');

  assert.ok(!holdsClaim(null, 'p1', 't1'));
  assert.ok(!isLockedOut(null, 'p1', 't1'), 'no claim locks nobody');
});
