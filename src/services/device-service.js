import { createId, createRandomToken, sha256 } from '../utils/crypto.js';
import { HttpError } from '../utils/http-error.js';
import {
  getDeviceKeyThumbprint,
  normalizeDevicePublicKey,
  verifyDeviceProof,
} from '../utils/device-proof.js';
import { isUuid } from '../utils/validation.js';
import { withTransaction } from '../db/transaction.js';
import {
  issueAndRecordLicense,
  recordLicenseEvent,
  selectLicenseForIssue,
} from './license-issuer.js';

export function createDeviceService({
  pool,
  config,
  privateKey,
  now = () => new Date(),
}) {
  return {
    createChallenge: async ({ purpose, activationCode, installationId }) => {
      const normalizedPurpose = String(purpose ?? '').toUpperCase();
      if (
        !['ACTIVATION', 'REFRESH', 'DEACTIVATION'].includes(
          normalizedPurpose,
        )
      ) {
        throw new HttpError(400, 'CHALLENGE_PURPOSE_INVALID');
      }

      let activationCodeId = null;
      let boundInstallationId = null;
      if (normalizedPurpose === 'ACTIVATION') {
        if (
          typeof activationCode !== 'string' ||
          activationCode.length < 20 ||
          activationCode.length > 256
        ) {
          throw new HttpError(400, 'ACTIVATION_CODE_INVALID');
        }
        const codeResult = await pool.query(
          `SELECT ac.id
           FROM activation_codes ac
           JOIN schools sc ON sc.id = ac.school_id
           JOIN licenses s ON s.school_id = sc.id
           WHERE ac.code_hash = $1
             AND ac.consumed_at IS NULL
             AND ac.expires_at > $2
             AND sc.status = 'ACTIVE'
             AND s.status = 'ACTIVE'`,
          [sha256(activationCode), now()],
        );
        activationCodeId = codeResult.rows[0]?.id ?? null;
        if (!activationCodeId) {
          throw new HttpError(400, 'ACTIVATION_CODE_INVALID');
        }
      } else {
        if (!isUuid(installationId)) {
          throw new HttpError(400, 'INSTALLATION_NOT_FOUND');
        }
        const installationResult = await pool.query(
          'SELECT id FROM installations WHERE id = $1',
          [installationId],
        );
        boundInstallationId = installationResult.rows[0]?.id ?? null;
        if (!boundInstallationId) {
          throw new HttpError(400, 'INSTALLATION_NOT_FOUND');
        }
      }

      const challengeId = createId();
      const nonce = createRandomToken(32);
      const expiresAt = new Date(
        now().valueOf() + config.challengeTtlSeconds * 1000,
      );
      await pool.query(
        `INSERT INTO device_challenges
          (id, purpose, nonce, activation_code_id, installation_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          challengeId,
          normalizedPurpose,
          nonce,
          activationCodeId,
          boundInstallationId,
          expiresAt,
        ],
      );

      return { challengeId, nonce, expiresAt: expiresAt.toISOString() };
    },

    activate: async ({
      challengeId,
      installationPublicKeyJwk,
      proof,
      appVersion,
    }) => {
      if (!isUuid(challengeId)) {
        throw new HttpError(400, 'CHALLENGE_INVALID');
      }
      if (
        typeof appVersion !== 'string' ||
        appVersion.trim().length < 1 ||
        appVersion.length > 64
      ) {
        throw new HttpError(400, 'APP_VERSION_INVALID');
      }

      const publicKey = normalizeDevicePublicKey(installationPublicKeyJwk);
      const storedJwk = {
        crv: 'P-256',
        kty: 'EC',
        x: installationPublicKeyJwk.x,
        y: installationPublicKeyJwk.y,
      };
      const thumbprint = getDeviceKeyThumbprint(storedJwk);

      return withTransaction(pool, async (client) => {
        const challengeResult = await client.query(
          `SELECT id, purpose, nonce, activation_code_id, expires_at,
                  consumed_at
           FROM device_challenges
           WHERE id = $1
           FOR UPDATE`,
          [challengeId],
        );
        const challenge = challengeResult.rows[0];
        if (
          !challenge ||
          challenge.purpose !== 'ACTIVATION' ||
          challenge.consumed_at ||
          new Date(challenge.expires_at) <= now()
        ) {
          throw new HttpError(400, 'CHALLENGE_EXPIRED_OR_USED');
        }

        if (
          !verifyDeviceProof({
            publicKey,
            proof,
            purpose: 'ACTIVATION',
            challengeId,
            nonce: challenge.nonce,
            publicKeyThumbprint: thumbprint,
            appVersion: appVersion.trim(),
          })
        ) {
          throw new HttpError(401, 'DEVICE_PROOF_INVALID');
        }

        const codeResult = await client.query(
          `SELECT ac.id, ac.school_id, sc.status AS school_status,
                  s.id AS license_id, s.status AS license_status,
                  s.license_type
           FROM activation_codes ac
           JOIN schools sc ON sc.id = ac.school_id
           JOIN licenses s ON s.school_id = sc.id
           WHERE ac.id = $1
             AND ac.consumed_at IS NULL
             AND ac.expires_at > $2
           FOR UPDATE OF ac, sc, s`,
          [challenge.activation_code_id, now()],
        );
        const activation = codeResult.rows[0];
        if (!activation) {
          throw new HttpError(400, 'ACTIVATION_CODE_INVALID');
        }
        if (
          activation.school_status !== 'ACTIVE' ||
          activation.license_status !== 'ACTIVE'
        ) {
          throw new HttpError(403, 'LICENSE_NOT_ACTIVE');
        }

        const occupiedResult = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM installations
             WHERE school_id = $1 AND status IN ('ACTIVE', 'SUSPENDED')
           ) AS occupied`,
          [activation.school_id],
        );
        if (occupiedResult.rows[0].occupied) {
          throw new HttpError(409, 'SCHOOL_INSTALLATION_LIMIT_REACHED');
        }

        const installationId = createId();
        const installationResult = await client.query(
          `INSERT INTO installations
            (id, school_id, license_id, public_key_jwk,
             public_key_thumbprint, app_version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)
           RETURNING *`,
          [
            installationId,
            activation.school_id,
            activation.license_id,
            JSON.stringify(storedJwk),
            thumbprint,
            appVersion.trim(),
          ],
        );

        await client.query(
          `UPDATE activation_codes SET consumed_at = $1 WHERE id = $2`,
          [now(), activation.id],
        );
        await client.query(
          `UPDATE device_challenges SET consumed_at = $1 WHERE id = $2`,
          [now(), challengeId],
        );

        const license = await selectLicenseForIssue(
          client,
          activation.license_id,
        );
        const issuedAt = now();
        const issued = await issueAndRecordLicense({
          client,
          config,
          privateKey,
          license,
          installation: installationResult.rows[0],
          challengeNonce: challenge.nonce,
          now: issuedAt,
        });
        await recordLicenseEvent(client, {
          schoolId: activation.school_id,
          licenseId: activation.license_id,
          installationId,
          eventType: 'INSTALLATION_ACTIVATED',
          details: { appVersion: appVersion.trim() },
        });

        return {
          installationId,
          licenseJws: issued.token,
          requestId: createId(),
        };
      });
    },

    refresh: async ({
      challengeId,
      installationId,
      currentRevision,
      proof,
      appVersion,
    }) => {
      if (!isUuid(challengeId) || !isUuid(installationId)) {
        throw new HttpError(400, 'CHALLENGE_INVALID');
      }
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw new HttpError(400, 'LICENSE_REVISION_INVALID');
      }
      if (
        typeof appVersion !== 'string' ||
        appVersion.trim().length < 1 ||
        appVersion.length > 64
      ) {
        throw new HttpError(400, 'APP_VERSION_INVALID');
      }

      return withTransaction(pool, async (client) => {
        const challengeResult = await client.query(
          `SELECT id, purpose, nonce, installation_id, expires_at, consumed_at
           FROM device_challenges
           WHERE id = $1
           FOR UPDATE`,
          [challengeId],
        );
        const challenge = challengeResult.rows[0];
        if (
          !challenge ||
          challenge.purpose !== 'REFRESH' ||
          challenge.installation_id !== installationId ||
          challenge.consumed_at ||
          new Date(challenge.expires_at) <= now()
        ) {
          throw new HttpError(400, 'CHALLENGE_EXPIRED_OR_USED');
        }

        const installationResult = await client.query(
          `SELECT * FROM installations WHERE id = $1 FOR UPDATE`,
          [installationId],
        );
        const installation = installationResult.rows[0];
        if (!installation) {
          throw new HttpError(404, 'INSTALLATION_NOT_FOUND');
        }

        const publicKey = normalizeDevicePublicKey(
          installation.public_key_jwk,
        );
        if (
          !verifyDeviceProof({
            publicKey,
            proof,
            purpose: 'REFRESH',
            challengeId,
            nonce: challenge.nonce,
            currentRevision,
            installationId,
            publicKeyThumbprint: installation.public_key_thumbprint,
            appVersion: appVersion.trim(),
          })
        ) {
          throw new HttpError(401, 'DEVICE_PROOF_INVALID');
        }

        await client.query(
          `UPDATE device_challenges SET consumed_at = $1 WHERE id = $2`,
          [now(), challengeId],
        );
        const revisedResult = await client.query(
          `UPDATE installations
           SET license_revision = license_revision + 1,
               last_validation_at = $1,
               app_version = $3
           WHERE id = $2
           RETURNING *`,
          [now(), installationId, appVersion.trim()],
        );
        const revisedInstallation = revisedResult.rows[0];
        const license = await selectLicenseForIssue(
          client,
          revisedInstallation.license_id,
        );
        const issuedAt = now();
        const issued = await issueAndRecordLicense({
          client,
          config,
          privateKey,
          license,
          installation: revisedInstallation,
          challengeNonce: challenge.nonce,
          now: issuedAt,
        });
        await recordLicenseEvent(client, {
          schoolId: revisedInstallation.school_id,
          licenseId: revisedInstallation.license_id,
          installationId,
          eventType: 'LICENSE_REFRESHED',
          details: { previousRevision: currentRevision },
        });
        return { licenseJws: issued.token, requestId: createId() };
      });
    },

    deactivate: async ({
      challengeId,
      installationId,
      proof,
      currentRevision,
      appVersion,
    }) => {
      if (!isUuid(challengeId) || !isUuid(installationId)) {
        throw new HttpError(400, 'CHALLENGE_INVALID');
      }
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw new HttpError(400, 'LICENSE_REVISION_INVALID');
      }
      if (
        typeof appVersion !== 'string' ||
        appVersion.trim().length < 1 ||
        appVersion.length > 64
      ) {
        throw new HttpError(400, 'APP_VERSION_INVALID');
      }

      return withTransaction(pool, async (client) => {
        const challengeResult = await client.query(
          `SELECT id, purpose, nonce, installation_id, expires_at, consumed_at
           FROM device_challenges
           WHERE id = $1
           FOR UPDATE`,
          [challengeId],
        );
        const challenge = challengeResult.rows[0];
        if (
          !challenge ||
          challenge.purpose !== 'DEACTIVATION' ||
          challenge.installation_id !== installationId ||
          challenge.consumed_at ||
          new Date(challenge.expires_at) <= now()
        ) {
          throw new HttpError(400, 'CHALLENGE_EXPIRED_OR_USED');
        }

        const installationResult = await client.query(
          `SELECT * FROM installations WHERE id = $1 FOR UPDATE`,
          [installationId],
        );
        const installation = installationResult.rows[0];
        if (!installation) {
          throw new HttpError(404, 'INSTALLATION_NOT_FOUND');
        }
        const publicKey = normalizeDevicePublicKey(
          installation.public_key_jwk,
        );
        if (
          !verifyDeviceProof({
            publicKey,
            proof,
            purpose: 'DEACTIVATION',
            challengeId,
            nonce: challenge.nonce,
            currentRevision,
            installationId,
            publicKeyThumbprint: installation.public_key_thumbprint,
            appVersion: appVersion.trim(),
          })
        ) {
          throw new HttpError(401, 'DEVICE_PROOF_INVALID');
        }

        await client.query(
          `UPDATE device_challenges SET consumed_at = $1 WHERE id = $2`,
          [now(), challengeId],
        );
        const revokedResult = await client.query(
          `UPDATE installations
           SET status = 'REVOKED',
               deactivated_at = COALESCE(deactivated_at, $1),
               license_revision = license_revision + 1
           WHERE id = $2
           RETURNING *`,
          [now(), installationId],
        );
        const revokedInstallation = revokedResult.rows[0];
        const license = await selectLicenseForIssue(
          client,
          revokedInstallation.license_id,
        );
        const issued = await issueAndRecordLicense({
          client,
          config,
          privateKey,
          license,
          installation: revokedInstallation,
          challengeNonce: challenge.nonce,
          now: now(),
        });
        await recordLicenseEvent(client, {
          schoolId: revokedInstallation.school_id,
          licenseId: revokedInstallation.license_id,
          installationId,
          eventType: 'INSTALLATION_REVOKED_BY_DEVICE',
        });
        return { licenseJws: issued.token, requestId: createId() };
      });
    },
  };
}
