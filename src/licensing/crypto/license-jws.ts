import {
  createPrivateKey,
  KeyObject,
  sign as signSignature,
} from 'node:crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { computeOfflineUntil } from '../../common/date-policy';
import { createId } from '../../common/crypto';

export type LicenseType = 'SUBSCRIPTION' | 'PERPETUAL';
export type SignedLicenseStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface LicenseForIssuance {
  id: string;
  schoolId: string;
  licenseType: LicenseType;
  status: string;
  schoolStatus: string;
  paidThrough?: Date | string | null;
  graceUntil?: Date | string | null;
  offlineDays?: number | null;
}

export interface InstallationForIssuance {
  id: string;
  status: string;
  licenseRevision: number | string;
  publicKeyThumbprint: string;
}

const encodeJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export function loadLicenseSigningKey(config: AppConfig): KeyObject {
  if (
    !/^[A-Za-z0-9._-]{1,64}$/.test(config.licenseSigningKeyId) ||
    !config.licenseSigningPrivateKeyBase64
  ) {
    throw new Error('License signing key configuration is required');
  }
  const pem = Buffer.from(
    config.licenseSigningPrivateKeyBase64,
    'base64',
  );
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('License signing key must be Ed25519');
  }
  return privateKey;
}

export function issueLicense({
  config,
  privateKey,
  license,
  installation,
  challengeNonce,
  now = new Date(),
}: {
  config: AppConfig;
  privateKey: KeyObject;
  license: LicenseForIssuance;
  installation: InstallationForIssuance;
  challengeNonce?: string;
  now?: Date;
}): { token: string; claims: Record<string, unknown>; keyId: string } {
  if (license.status === 'PENDING_PAYMENT') {
    throw new InternalServerErrorException(
      'Cannot issue a license before payment confirmation',
    );
  }
  const issuedAt = new Date(now);
  let temporalClaims: Record<string, unknown> = {};
  if (license.licenseType === 'SUBSCRIPTION') {
    if (!license.paidThrough || !license.graceUntil) {
      throw new InternalServerErrorException(
        'Subscription dates are missing',
      );
    }
    const paidThrough = new Date(license.paidThrough);
    const graceUntil = new Date(license.graceUntil);
    const bounded = computeOfflineUntil(
      graceUntil,
      issuedAt,
      Number(license.offlineDays ?? 30),
    );
    const offlineUntil = new Date(
      Math.floor(bounded.valueOf() / 1000) * 1000,
    );
    temporalClaims = {
      exp: Math.floor(offlineUntil.valueOf() / 1000),
      paidThrough: paidThrough.toISOString(),
      graceUntil: graceUntil.toISOString(),
      offlineUntil: offlineUntil.toISOString(),
    };
  } else if (license.licenseType !== 'PERPETUAL') {
    throw new InternalServerErrorException('Unsupported license type');
  }

  const status: SignedLicenseStatus =
    installation.status === 'REVOKED' ||
    license.status === 'CANCELLED' ||
    license.schoolStatus === 'CLOSED'
      ? 'REVOKED'
      : installation.status === 'SUSPENDED' ||
          license.status === 'SUSPENDED' ||
          license.schoolStatus === 'SUSPENDED'
        ? 'SUSPENDED'
        : 'ACTIVE';

  const claims = {
    iss: config.licenseIssuer,
    aud: config.licenseAudience,
    licenseId: license.id,
    schoolId: license.schoolId,
    installationId: installation.id,
    product: 'SPORTS_SCHOOL',
    licenseType: license.licenseType,
    status,
    iat: Math.floor(issuedAt.valueOf() / 1000),
    ...temporalClaims,
    licenseVersion: 1,
    revision: Number(installation.licenseRevision),
    jti: createId(),
    cnf: { jkt: installation.publicKeyThumbprint },
    ...(challengeNonce ? { requestNonce: challengeNonce } : {}),
  };

  const protectedHeader = {
    alg: 'EdDSA',
    kid: config.licenseSigningKeyId,
    typ: 'JWT',
  };
  const input = `${encodeJson(protectedHeader)}.${encodeJson(claims)}`;
  const signature = signSignature(
    null,
    Buffer.from(input),
    privateKey,
  ).toString('base64url');
  return {
    token: `${input}.${signature}`,
    claims,
    keyId: config.licenseSigningKeyId,
  };
}
