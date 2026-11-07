import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  issueAdminToken,
  verifyAdminToken,
  verifyPassword,
} from '../src/services/admin-auth.js';

test('admin password uses salted scrypt and verifies without plaintext storage', async () => {
  const hash = await hashPassword('A-long-admin-password-42!');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('A-long-admin-password-42!', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('admin token checks signature, role, audience and expiry', () => {
  const secret = 'this-is-a-test-secret-with-at-least-32-bytes';
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const token = issueAdminToken(
    { id: 'admin-id', role: 'OWNER' },
    secret,
    now,
  );
  assert.equal(verifyAdminToken(token, secret, now)?.role, 'OWNER');
  assert.equal(verifyAdminToken(token, 'incorrect-secret', now), null);
  assert.equal(
    verifyAdminToken(token, secret, now + 21 * 60 * 1000),
    null,
  );
});
