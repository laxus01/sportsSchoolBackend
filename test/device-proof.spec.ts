import {
  generateKeyPairSync,
  sign as signSignature,
} from 'node:crypto';
import {
  buildDeviceProofMessage,
  DevicePublicJwk,
  getDeviceKeyThumbprint,
  normalizeDevicePublicKey,
  verifyDeviceProof,
} from '../src/licensing/crypto/device-proof';

describe('device proof', () => {
  it('binds a one-time challenge to a P-256 installation key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicJwk = publicKey.export({
      format: 'jwk',
    }) as unknown as DevicePublicJwk;
    const publicKeyThumbprint = getDeviceKeyThumbprint(publicJwk);
    const payload = {
      purpose: 'ACTIVATION' as const,
      challengeId: 'challenge-id',
      nonce: 'random-nonce',
      publicKeyThumbprint,
      appVersion: '1.0.0',
    };
    const proof = signSignature(
      'sha256',
      Buffer.from(buildDeviceProofMessage(payload)),
      { key: privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');

    expect(normalizeDevicePublicKey(publicJwk).asymmetricKeyType).toBe('ec');
    expect(verifyDeviceProof(publicKey, proof, payload)).toBe(true);
    expect(
      verifyDeviceProof(publicKey, proof, {
        ...payload,
        appVersion: '1.0.1',
      }),
    ).toBe(false);
  });
});
