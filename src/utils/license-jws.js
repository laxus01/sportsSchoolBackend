import {
  createPrivateKey,
  sign as signSignature,
} from 'node:crypto';
import { createId } from './crypto.js';
import { computeOfflineUntil } from './license-time.js';

const encodeJson = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export function loadLicenseSigningKey(config) {
  if (
    !config.licenseSigningKeyId ||
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
}) {
  if (license.status === 'PENDING_PAYMENT') {
    throw new Error('Cannot issue a license before payment confirmation');
  }
  const issuedAt = new Date(now);
  const licenseType = license.licenseType ?? 'SUBSCRIPTION';
  let temporalClaims = {};
  if (licenseType === 'SUBSCRIPTION') {
    const paidThrough = new Date(license.paidThrough);
    const graceUntil = new Date(license.graceUntil);
    const boundedOfflineUntil = computeOfflineUntil(
      graceUntil,
      issuedAt,
      Number(license.offlineDays ?? 30),
    );
    const offlineUntil = new Date(
      Math.floor(boundedOfflineUntil.valueOf() / 1000) * 1000,
    );
    temporalClaims = {
      exp: Math.floor(offlineUntil.valueOf() / 1000),
      paidThrough: paidThrough.toISOString(),
      graceUntil: graceUntil.toISOString(),
      offlineUntil: offlineUntil.toISOString(),
    };
  } else if (licenseType !== 'PERPETUAL') {
    throw new Error('Unsupported license type');
  }
  const status =
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
    licenseType,
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
  const signingInput = `${encodeJson(protectedHeader)}.${encodeJson(claims)}`;
  const signature = signSignature(
    null,
    Buffer.from(signingInput),
    privateKey,
  ).toString('base64url');

  return {
    token: `${signingInput}.${signature}`,
    claims,
    keyId: config.licenseSigningKeyId,
  };
}
