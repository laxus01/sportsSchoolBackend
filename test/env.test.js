import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/licenses',
  ADMIN_JWT_SECRET: 'development-secret-with-more-than-thirty-two-chars',
  LICENSE_ISSUER: 'https://licenses.example.test',
  ALLOWED_ORIGINS: 'http://localhost:4200, capacitor://localhost',
};

test('configuration parses PostgreSQL URL and allowed origins', () => {
  const config = loadConfig(validEnvironment);
  assert.equal(config.port, 3001);
  assert.deepEqual(config.allowedOrigins, [
    'http://localhost:4200',
    'capacitor://localhost',
  ]);
  assert.equal(config.databaseSsl, false);
  assert.equal(config.databaseSslRejectUnauthorized, true);
  assert.equal(config.trustProxyHops, 0);
});

test('configuration supports Railway proxy and self-signed database certificates', () => {
  const config = loadConfig({
    ...validEnvironment,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
    TRUST_PROXY_HOPS: '1',
  });
  assert.equal(config.databaseSslRejectUnauthorized, false);
  assert.equal(config.trustProxyHops, 1);
});

test('production requires HTTPS, database TLS and explicit CORS origins', () => {
  assert.throws(
    () =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        DATABASE_SSL: 'false',
      }),
    /DATABASE_SSL=true/,
  );
});
