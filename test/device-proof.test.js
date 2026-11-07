import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signSignature,
} from 'node:crypto';
import {
  buildDeviceProofMessage,
  getDeviceKeyThumbprint,
  normalizeDevicePublicKey,
  verifyDeviceProof,
} from '../src/utils/device-proof.js';

test('P-256 proof binds the activation challenge to a device key', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const thumbprint = getDeviceKeyThumbprint(publicJwk);
  const challenge = {
    purpose: 'ACTIVATION',
    challengeId: 'challenge-id',
    nonce: 'one-time-nonce',
    publicKeyThumbprint: thumbprint,
    appVersion: '1.0.0',
  };
  const proof = signSignature(
    'sha256',
    Buffer.from(buildDeviceProofMessage(challenge)),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');

  assert.equal(normalizeDevicePublicKey(publicJwk).asymmetricKeyType, 'ec');
  assert.equal(verifyDeviceProof({ ...challenge, publicKey, proof }), true);
  assert.equal(
    verifyDeviceProof({
      ...challenge,
      publicKey,
      proof,
      appVersion: '1.0.1',
    }),
    false,
  );
});

test('private device key material is rejected by the public-key parser', () => {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const privateJwk = privateKey.export({ format: 'jwk' });
  assert.throws(
    () => normalizeDevicePublicKey(privateJwk),
    { code: 'DEVICE_KEY_INVALID' },
  );
});
