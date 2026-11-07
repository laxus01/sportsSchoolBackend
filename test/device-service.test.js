import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signSignature,
  verify as verifySignature,
} from 'node:crypto';
import { createDeviceService } from '../src/services/device-service.js';
import {
  buildDeviceProofMessage,
  getDeviceKeyThumbprint,
} from '../src/utils/device-proof.js';

const challengeId = '11111111-1111-4111-8111-111111111111';
const activationCodeId = '22222222-2222-4222-8222-222222222222';
const schoolId = '33333333-3333-4333-8333-333333333333';
const licenseId = '44444444-4444-4444-8444-444444444444';
const challengeNonce = 'device-challenge-nonce';
const fixedNow = new Date('2026-11-06T12:00:00.000Z');

test('activation consumes one challenge and issues a device-bound JWS', async () => {
  const { publicKey, privateKey: devicePrivateKey } = generateKeyPairSync(
    'ec',
    { namedCurve: 'prime256v1' },
  );
  const devicePublicJwk = publicKey.export({ format: 'jwk' });
  const thumbprint = getDeviceKeyThumbprint(devicePublicJwk);
  const appVersion = '1.0.0';
  const proof = signSignature(
    'sha256',
    Buffer.from(
      buildDeviceProofMessage({
        purpose: 'ACTIVATION',
        challengeId,
        nonce: challengeNonce,
        publicKeyThumbprint: thumbprint,
        appVersion,
      }),
    ),
    { key: devicePrivateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  const { privateKey: licensePrivateKey, publicKey: licensePublicKey } =
    generateKeyPairSync('ed25519');
  const calls = [];

  const client = {
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      calls.push(query);
      if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
        return { rows: [] };
      }
      if (query.startsWith('SELECT id, purpose, nonce, activation_code_id')) {
        return {
          rows: [{
            id: challengeId,
            purpose: 'ACTIVATION',
            nonce: challengeNonce,
            activation_code_id: activationCodeId,
            expires_at: new Date(fixedNow.valueOf() + 60_000),
            consumed_at: null,
          }],
        };
      }
      if (query.startsWith('SELECT ac.id, ac.school_id')) {
        return {
          rows: [{
            id: activationCodeId,
            school_id: schoolId,
            school_status: 'ACTIVE',
            license_id: licenseId,
            license_status: 'ACTIVE',
            license_type: 'SUBSCRIPTION',
          }],
        };
      }
      if (query.startsWith('SELECT EXISTS')) {
        return { rows: [{ occupied: false }] };
      }
      if (query.startsWith('INSERT INTO installations')) {
        return {
          rows: [{
            id: values[0],
            status: 'ACTIVE',
            license_revision: '0',
            public_key_thumbprint: values[4],
          }],
        };
      }
      if (query.startsWith('SELECT l.id, l.school_id AS')) {
        return {
          rows: [{
            id: licenseId,
            schoolId,
            licenseType: 'SUBSCRIPTION',
            status: 'ACTIVE',
            offlineDays: 30,
            schoolStatus: 'ACTIVE',
            paidThrough: new Date('2026-12-02T08:00:00.000Z'),
            graceUntil: new Date('2026-12-12T08:00:00.000Z'),
          }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
  };
  const service = createDeviceService({
    pool,
    config: {
      challengeTtlSeconds: 300,
      licenseIssuer: 'https://licenses.example.test',
      licenseAudience: 'SPORTS_SCHOOL',
      licenseSigningKeyId: 'test-key',
    },
    privateKey: licensePrivateKey,
    now: () => new Date(fixedNow),
  });

  const result = await service.activate({
    challengeId,
    installationPublicKeyJwk: devicePublicJwk,
    proof,
    appVersion,
  });
  const [encodedHeader, encodedClaims, encodedSignature] =
    result.licenseJws.split('.');
  const header = JSON.parse(
    Buffer.from(encodedHeader, 'base64url').toString('utf8'),
  );
  const claims = JSON.parse(
    Buffer.from(encodedClaims, 'base64url').toString('utf8'),
  );
  assert.match(
    result.installationId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(header.alg, 'EdDSA');
  assert.equal(claims.installationId, result.installationId);
  assert.equal(claims.cnf.jkt, thumbprint);
  assert.equal(claims.requestNonce, challengeNonce);
  assert.equal(
    verifySignature(
      null,
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      licensePublicKey,
      Buffer.from(encodedSignature, 'base64url'),
    ),
    true,
  );
  assert.ok(calls.some((call) => call.startsWith('UPDATE activation_codes')));
  assert.ok(calls.some((call) => call.startsWith('UPDATE device_challenges')));
});
