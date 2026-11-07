import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/admin-auth.js';

test('Express API serves health checks and protects admin routes', async (t) => {
  const calls = [];
  const passwordHash = await hashPassword('An-integration-admin-password-42!');
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM admin_users')) {
        return {
          rows: [{
            id: 'admin-id',
            email: 'owner@example.test',
            role: 'OWNER',
            password_hash: passwordHash,
          }],
        };
      }
      if (sql.includes('FROM schools sc')) return { rows: [] };
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const { privateKey } = generateKeyPairSync('ed25519');
  const app = createApp({
    pool,
    privateKey,
    config: {
      allowedOrigins: ['http://allowed.example.test'],
      adminJwtSecret: 'integration-test-secret-with-32-bytes',
      activationCodeTtlHours: 72,
      challengeTtlSeconds: 300,
      licenseAudience: 'SPORTS_SCHOOL',
      licenseIssuer: 'https://licenses.example.test',
      licenseSigningKeyId: 'test-key',
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const live = await fetch(`${baseUrl}/health/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });

  const ready = await fetch(`${baseUrl}/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  assert.equal(calls[0], 'SELECT 1');

  const protectedRoute = await fetch(`${baseUrl}/v1/admin/schools`);
  assert.equal(protectedRoute.status, 401);
  assert.equal((await protectedRoute.json()).error, 'ADMIN_AUTH_REQUIRED');

  const login = await fetch(`${baseUrl}/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@example.test',
      password: 'An-integration-admin-password-42!',
    }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const schools = await fetch(`${baseUrl}/v1/admin/schools`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(schools.status, 200);
  assert.deepEqual(await schools.json(), { schools: [] });

  const deniedOrigin = await fetch(`${baseUrl}/health/live`, {
    headers: { Origin: 'https://untrusted.example.test' },
  });
  assert.equal(deniedOrigin.status, 403);
  assert.equal((await deniedOrigin.json()).error, 'ORIGIN_NOT_ALLOWED');
});
