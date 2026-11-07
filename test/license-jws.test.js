import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  verify as verifySignature,
} from 'node:crypto';
import { issueLicense } from '../src/utils/license-jws.js';

const decodePart = (part) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('license JWS uses EdDSA and carries bounded signed claims', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const result = issueLicense({
    config: {
      licenseIssuer: 'https://licenses.example.test',
      licenseAudience: 'SPORTS_SCHOOL',
      licenseSigningKeyId: 'test-key',
    },
    privateKey,
    license: {
      id: 'license-id',
      schoolId: 'school-id',
      licenseType: 'SUBSCRIPTION',
      status: 'ACTIVE',
      schoolStatus: 'ACTIVE',
      paidThrough: '2026-12-02T08:00:00.000Z',
      graceUntil: '2026-12-12T08:00:00.000Z',
      offlineDays: 30,
    },
    installation: {
      id: 'installation-id',
      status: 'ACTIVE',
      licenseRevision: 3,
      publicKeyThumbprint: 'device-key-thumbprint',
    },
    challengeNonce: 'fresh-nonce',
    now: new Date('2026-11-06T12:00:00.000Z'),
  });

  const [encodedHeader, encodedClaims, encodedSignature] =
    result.token.split('.');
  const header = decodePart(encodedHeader);
  const claims = decodePart(encodedClaims);
  assert.deepEqual(header, { alg: 'EdDSA', kid: 'test-key', typ: 'JWT' });
  assert.equal(claims.status, 'ACTIVE');
  assert.equal(claims.revision, 3);
  assert.equal(claims.requestNonce, 'fresh-nonce');
  assert.equal(claims.exp, Date.parse(claims.offlineUntil) / 1000);
  assert.equal(
    verifySignature(
      null,
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      publicKey,
      Buffer.from(encodedSignature, 'base64url'),
    ),
    true,
  );
});

test('license status reflects administrative suspension', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const result = issueLicense({
    config: {
      licenseIssuer: 'issuer',
      licenseAudience: 'SPORTS_SCHOOL',
      licenseSigningKeyId: 'test-key',
    },
    privateKey,
    license: {
      id: 'license-id',
      schoolId: 'school-id',
      licenseType: 'SUBSCRIPTION',
      status: 'SUSPENDED',
      schoolStatus: 'ACTIVE',
      paidThrough: '2026-12-02T08:00:00.000Z',
      graceUntil: '2026-12-12T08:00:00.000Z',
      offlineDays: 30,
    },
    installation: {
      id: 'installation-id',
      status: 'ACTIVE',
      licenseRevision: 4,
      publicKeyThumbprint: 'device-key-thumbprint',
    },
    now: new Date('2026-11-06T12:00:00.000Z'),
  });
  assert.equal(decodePart(result.token.split('.')[1]).status, 'SUSPENDED');
});

test('perpetual license JWS has no commercial or offline expiration', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const result = issueLicense({
    config: {
      licenseIssuer: 'issuer',
      licenseAudience: 'SPORTS_SCHOOL',
      licenseSigningKeyId: 'test-key',
    },
    privateKey,
    license: {
      id: 'license-id',
      schoolId: 'school-id',
      licenseType: 'PERPETUAL',
      status: 'ACTIVE',
      schoolStatus: 'ACTIVE',
      paidThrough: null,
      graceUntil: null,
      offlineDays: null,
    },
    installation: {
      id: 'installation-id',
      status: 'ACTIVE',
      licenseRevision: 1,
      publicKeyThumbprint: 'device-key-thumbprint',
    },
    now: new Date('2026-11-06T12:00:00.000Z'),
  });

  const claims = decodePart(result.token.split('.')[1]);
  assert.equal(claims.licenseType, 'PERPETUAL');
  assert.equal(claims.status, 'ACTIVE');
  assert.equal('exp' in claims, false);
  assert.equal('paidThrough' in claims, false);
  assert.equal('offlineUntil' in claims, false);
});
