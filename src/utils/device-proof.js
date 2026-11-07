import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { HttpError } from './http-error.js';

const decodeBase64Url = (value) => Buffer.from(value, 'base64url');

export function normalizeDevicePublicKey(jwk) {
  if (
    !jwk ||
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    'd' in jwk
  ) {
    throw new HttpError(400, 'DEVICE_KEY_INVALID');
  }

  try {
    const keyObject = createPublicKey({ key: jwk, format: 'jwk' });
    if (
      keyObject.asymmetricKeyType !== 'ec' ||
      keyObject.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new Error('Unexpected device key type');
    }
    return keyObject;
  } catch {
    throw new HttpError(400, 'DEVICE_KEY_INVALID');
  }
}

export function getDeviceKeyThumbprint(jwk) {
  const normalized = {
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('base64url');
}

export function buildDeviceProofMessage({
  purpose,
  challengeId,
  nonce,
  currentRevision = null,
  installationId = '',
  publicKeyThumbprint = '',
  appVersion = '',
}) {
  return JSON.stringify({
    appVersion,
    challengeId,
    currentRevision,
    installationId,
    nonce,
    publicKeyThumbprint,
    purpose,
  });
}

export function verifyDeviceProof({
  publicKey,
  proof,
  purpose,
  challengeId,
  nonce,
  currentRevision = null,
  installationId = '',
  publicKeyThumbprint = '',
  appVersion = '',
}) {
  if (typeof proof !== 'string' || proof.length > 512) return false;
  try {
    const message = buildDeviceProofMessage({
      purpose,
      challengeId,
      nonce,
      currentRevision,
      installationId,
      publicKeyThumbprint,
      appVersion,
    });
    return verifySignature(
      'sha256',
      Buffer.from(message),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      decodeBase64Url(proof),
    );
  } catch {
    return false;
  }
}
