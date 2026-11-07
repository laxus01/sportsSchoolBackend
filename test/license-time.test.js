import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOfflineUntil } from '../src/utils/license-time.js';

test('offline authorization is capped at grace end', () => {
  const issuedAt = new Date('2026-11-01T00:00:00.000Z');
  const graceUntil = new Date('2026-11-20T00:00:00.000Z');
  assert.equal(
    computeOfflineUntil(graceUntil, issuedAt).toISOString(),
    graceUntil.toISOString(),
  );
});

test('offline authorization never exceeds 30 exact days from issuance', () => {
  const issuedAt = new Date('2026-11-01T12:00:00.000Z');
  const graceUntil = new Date('2026-12-20T00:00:00.000Z');
  assert.equal(
    computeOfflineUntil(graceUntil, issuedAt).toISOString(),
    '2026-12-01T12:00:00.000Z',
  );
});

test('invalid dates are rejected', () => {
  assert.throws(
    () => computeOfflineUntil('not-a-date', new Date()),
    /Invalid license time/,
  );
});
