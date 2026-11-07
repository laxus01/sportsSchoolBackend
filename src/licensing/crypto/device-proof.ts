import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  KeyObject,
} from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export interface DevicePublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

export function normalizeDevicePublicKey(jwk: DevicePublicJwk): KeyObject {
  if (
    !jwk ||
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    'd' in jwk
  ) {
    throw new BadRequestException('DEVICE_KEY_INVALID');
  }

  try {
    const key = createPublicKey({
      key: jwk as unknown as import('node:crypto').JsonWebKey,
      format: 'jwk',
    });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
    ) {
      throw new Error('Unexpected device key type');
    }
    return key;
  } catch {
    throw new BadRequestException('DEVICE_KEY_INVALID');
  }
}

export function getDeviceKeyThumbprint(jwk: DevicePublicJwk): string {
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

export interface DeviceProofPayload {
  purpose: 'ACTIVATION' | 'REFRESH' | 'DEACTIVATION';
  challengeId: string;
  nonce: string;
  currentRevision?: number | null;
  installationId?: string;
  publicKeyThumbprint?: string;
  appVersion?: string;
}

export function buildDeviceProofMessage(
  payload: DeviceProofPayload,
): string {
  return JSON.stringify({
    appVersion: payload.appVersion ?? '',
    challengeId: payload.challengeId,
    currentRevision: payload.currentRevision ?? null,
    installationId: payload.installationId ?? '',
    nonce: payload.nonce,
    publicKeyThumbprint: payload.publicKeyThumbprint ?? '',
    purpose: payload.purpose,
  });
}

export function verifyDeviceProof(
  publicKey: KeyObject,
  proof: string,
  payload: DeviceProofPayload,
): boolean {
  if (typeof proof !== 'string' || proof.length > 512) return false;
  try {
    return verifySignature(
      'sha256',
      Buffer.from(buildDeviceProofMessage(payload)),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(proof, 'base64url'),
    );
  } catch {
    return false;
  }
}
