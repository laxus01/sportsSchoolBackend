import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { loadAppConfig } from '../../config/app-config';
import { createId, createRandomToken, sha256 } from '../../common/crypto';
import { getSubscriptionBounds } from '../../common/date-policy';
import { isUuid } from '../../common/validation';
import {
  DevicePublicJwk,
  getDeviceKeyThumbprint,
  normalizeDevicePublicKey,
  verifyDeviceProof,
} from '../crypto/device-proof';
import {
  InstallationForIssuance,
  issueLicense,
  LicenseForIssuance,
  loadLicenseSigningKey,
} from '../crypto/license-jws';
import { DeviceChallengeDto } from './dto/device-challenge.dto';
import { ActivateInstallationDto } from './dto/activate-installation.dto';
import { RefreshLicenseDto } from './dto/refresh-license.dto';
import { DeactivateInstallationDto } from './dto/deactivate-installation.dto';

@Injectable()
export class DeviceService {
  private readonly config = loadAppConfig();
  private readonly privateKey = loadLicenseSigningKey(this.config);

  constructor(private readonly dataSource: DataSource) {}

  async createChallenge(input: DeviceChallengeDto) {
    const purpose = input.purpose.toUpperCase();
    let activationCodeId: string | null = null;
    let installationId: string | null = null;

    if (purpose === 'ACTIVATION') {
      if (!input.activationCode) {
        throw new BadRequestException('ACTIVATION_CODE_INVALID');
      }
      const codes = (await this.dataSource.query(
        `SELECT ac.id
         FROM activation_codes ac
         JOIN schools sc ON sc.id = ac.school_id
         JOIN licenses l ON l.school_id = sc.id
         WHERE ac.code_hash = ?
           AND ac.consumed_at IS NULL
           AND ac.expires_at > UTC_TIMESTAMP(3)
           AND sc.status = 'ACTIVE'
           AND l.status = 'ACTIVE'
         LIMIT 1`,
        [sha256(input.activationCode)],
      )) as Array<{ id: string }>;
      activationCodeId = codes[0]?.id ?? null;
      if (!activationCodeId) {
        throw new BadRequestException('ACTIVATION_CODE_INVALID');
      }
    } else {
      if (!isUuid(input.installationId)) {
        throw new BadRequestException('INSTALLATION_NOT_FOUND');
      }
      const installations = (await this.dataSource.query(
        `SELECT id FROM installations WHERE id = ? LIMIT 1`,
        [input.installationId],
      )) as Array<{ id: string }>;
      installationId = installations[0]?.id ?? null;
      if (!installationId) {
        throw new BadRequestException('INSTALLATION_NOT_FOUND');
      }
    }

    const challengeId = createId();
    const nonce = createRandomToken(32);
    const expiresAt = new Date(
      Date.now() + this.config.challengeTtlSeconds * 1000,
    );
    await this.dataSource.query(
      `INSERT INTO device_challenges
        (id, purpose, nonce, activation_code_id, installation_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        challengeId,
        purpose,
        nonce,
        activationCodeId,
        installationId,
        expiresAt,
      ],
    );
    return { challengeId, nonce, expiresAt: expiresAt.toISOString() };
  }

  async activate(input: ActivateInstallationDto) {
    const publicJwk = input.installationPublicKeyJwk as unknown as DevicePublicJwk;
    const publicKey = normalizeDevicePublicKey(publicJwk);
    const storedJwk = {
      crv: 'P-256',
      kty: 'EC',
      x: publicJwk.x,
      y: publicJwk.y,
    };
    const thumbprint = getDeviceKeyThumbprint(storedJwk);

    return this.inTransaction(async (queryRunner) => {
      const challenges = (await queryRunner.query(
        `SELECT id, purpose, nonce, activation_code_id, expires_at, consumed_at
         FROM device_challenges
         WHERE id = ?
           AND purpose = 'ACTIVATION'
           AND consumed_at IS NULL
           AND expires_at > UTC_TIMESTAMP(3)
         FOR UPDATE`,
        [input.challengeId],
      )) as Array<Record<string, any>>;
      const challenge = challenges[0];
      if (
        !challenge ||
        challenge.purpose !== 'ACTIVATION' ||
        challenge.consumed_at
      ) {
        throw new BadRequestException('CHALLENGE_EXPIRED_OR_USED');
      }
      if (
        !verifyDeviceProof(publicKey, input.proof, {
          purpose: 'ACTIVATION',
          challengeId: input.challengeId,
          nonce: challenge.nonce,
          publicKeyThumbprint: thumbprint,
          appVersion: input.appVersion.trim(),
        })
      ) {
        throw new UnauthorizedException('DEVICE_PROOF_INVALID');
      }

      const activationRows = (await queryRunner.query(
        `SELECT ac.id AS activationCodeId, ac.school_id AS schoolId,
                sc.status AS schoolStatus, l.id AS licenseId,
                l.status AS licenseStatus
         FROM activation_codes ac
         JOIN schools sc ON sc.id = ac.school_id
         JOIN licenses l ON l.school_id = sc.id
         WHERE ac.id = ?
           AND ac.consumed_at IS NULL
           AND ac.expires_at > UTC_TIMESTAMP(3)
         FOR UPDATE`,
        [challenge.activation_code_id],
      )) as Array<Record<string, string>>;
      const activation = activationRows[0];
      if (!activation) {
        throw new BadRequestException('ACTIVATION_CODE_INVALID');
      }
      if (
        activation.schoolStatus !== 'ACTIVE' ||
        activation.licenseStatus !== 'ACTIVE'
      ) {
        throw new ConflictException('LICENSE_NOT_ACTIVE');
      }

      const existing = (await queryRunner.query(
        `SELECT COUNT(*) AS total
         FROM installations
         WHERE school_id = ? AND status IN ('ACTIVE', 'SUSPENDED')`,
        [activation.schoolId],
      )) as Array<{ total: number | string }>;
      if (Number(existing[0]?.total ?? 0) > 0) {
        throw new ConflictException('SCHOOL_INSTALLATION_LIMIT_REACHED');
      }

      const installationId = createId();
      await queryRunner.query(
        `INSERT INTO installations
          (id, school_id, license_id, public_key_jwk,
           public_key_thumbprint, app_version)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          installationId,
          activation.schoolId,
          activation.licenseId,
          JSON.stringify(storedJwk),
          thumbprint,
          input.appVersion.trim(),
        ],
      );
      await queryRunner.query(
        `UPDATE activation_codes SET consumed_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [activation.activationCodeId],
      );
      await queryRunner.query(
        `UPDATE device_challenges SET consumed_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [input.challengeId],
      );

      const license = await this.selectLicenseForIssue(
        queryRunner,
        activation.licenseId,
      );
      const installation = {
        id: installationId,
        status: 'ACTIVE',
        licenseRevision: 0,
        publicKeyThumbprint: thumbprint,
      };
      const result = await this.issueAndRecord(
        queryRunner,
        license,
        installation,
        challenge.nonce,
      );
      await this.recordEvent(queryRunner, {
        schoolId: activation.schoolId,
        licenseId: activation.licenseId,
        installationId,
        eventType: 'INSTALLATION_ACTIVATED',
        details: { appVersion: input.appVersion.trim() },
      });
      return {
        installationId,
        licenseJws: result.token,
        requestId: createId(),
      };
    });
  }

  async refresh(input: RefreshLicenseDto) {
    return this.inTransaction(async (queryRunner) => {
      const challenge = await this.getChallenge(
        queryRunner,
        input.challengeId,
        'REFRESH',
        input.installationId,
      );
      const installations = (await queryRunner.query(
        `SELECT * FROM installations WHERE id = ? FOR UPDATE`,
        [input.installationId],
      )) as Array<Record<string, any>>;
      const installation = installations[0];
      if (!installation) throw new NotFoundException('INSTALLATION_NOT_FOUND');

      const publicKey = normalizeDevicePublicKey(
        installation.public_key_jwk,
      );
      if (
        !verifyDeviceProof(publicKey, input.proof, {
          purpose: 'REFRESH',
          challengeId: input.challengeId,
          nonce: challenge.nonce,
          currentRevision: input.currentRevision,
          installationId: input.installationId,
          publicKeyThumbprint: installation.public_key_thumbprint,
          appVersion: input.appVersion.trim(),
        })
      ) {
        throw new UnauthorizedException('DEVICE_PROOF_INVALID');
      }

      await queryRunner.query(
        `UPDATE device_challenges SET consumed_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [input.challengeId],
      );
      await queryRunner.query(
        `UPDATE installations
         SET license_revision = license_revision + 1,
             last_validation_at = UTC_TIMESTAMP(3),
             app_version = ?
         WHERE id = ?`,
        [input.appVersion.trim(), input.installationId],
      );
      const [updatedInstallation] = (await queryRunner.query(
        `SELECT * FROM installations WHERE id = ?`,
        [input.installationId],
      )) as Array<Record<string, any>>;
      const license = await this.selectLicenseForIssue(
        queryRunner,
        updatedInstallation.license_id,
      );
      const result = await this.issueAndRecord(
        queryRunner,
        license,
        this.mapInstallation(updatedInstallation),
        challenge.nonce,
      );
      await this.recordEvent(queryRunner, {
        schoolId: updatedInstallation.school_id,
        licenseId: updatedInstallation.license_id,
        installationId: input.installationId,
        eventType: 'LICENSE_REFRESHED',
        details: { previousRevision: input.currentRevision },
      });
      return { licenseJws: result.token, requestId: createId() };
    });
  }

  async deactivate(
    installationId: string,
    input: DeactivateInstallationDto,
  ) {
    if (!isUuid(installationId)) {
      throw new BadRequestException('INSTALLATION_ID_INVALID');
    }
    return this.inTransaction(async (queryRunner) => {
      const challenge = await this.getChallenge(
        queryRunner,
        input.challengeId,
        'DEACTIVATION',
        installationId,
      );
      const [installation] = (await queryRunner.query(
        `SELECT * FROM installations WHERE id = ? FOR UPDATE`,
        [installationId],
      )) as Array<Record<string, any>>;
      if (!installation) throw new NotFoundException('INSTALLATION_NOT_FOUND');
      const publicKey = normalizeDevicePublicKey(installation.public_key_jwk);
      if (
        !verifyDeviceProof(publicKey, input.proof, {
          purpose: 'DEACTIVATION',
          challengeId: input.challengeId,
          nonce: challenge.nonce,
          currentRevision: input.currentRevision,
          installationId,
          publicKeyThumbprint: installation.public_key_thumbprint,
          appVersion: input.appVersion.trim(),
        })
      ) {
        throw new UnauthorizedException('DEVICE_PROOF_INVALID');
      }
      await queryRunner.query(
        `UPDATE device_challenges SET consumed_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [input.challengeId],
      );
      await queryRunner.query(
        `UPDATE installations
         SET status = 'REVOKED',
             deactivated_at = COALESCE(deactivated_at, UTC_TIMESTAMP(3)),
             license_revision = license_revision + 1
         WHERE id = ?`,
        [installationId],
      );
      const [revoked] = (await queryRunner.query(
        `SELECT * FROM installations WHERE id = ?`,
        [installationId],
      )) as Array<Record<string, any>>;
      const license = await this.selectLicenseForIssue(
        queryRunner,
        revoked.license_id,
      );
      const result = await this.issueAndRecord(
        queryRunner,
        license,
        this.mapInstallation(revoked),
        challenge.nonce,
      );
      await this.recordEvent(queryRunner, {
        schoolId: revoked.school_id,
        licenseId: revoked.license_id,
        installationId,
        eventType: 'INSTALLATION_REVOKED_BY_DEVICE',
      });
      return { licenseJws: result.token, requestId: createId() };
    });
  }

  private async getChallenge(
    queryRunner: QueryRunner,
    challengeId: string,
    purpose: string,
    installationId: string,
  ) {
    const rows = (await queryRunner.query(
      `SELECT id, purpose, nonce, installation_id, expires_at, consumed_at
       FROM device_challenges
       WHERE id = ?
         AND purpose = ?
         AND installation_id = ?
         AND consumed_at IS NULL
         AND expires_at > UTC_TIMESTAMP(3)
       FOR UPDATE`,
      [challengeId, purpose, installationId],
    )) as Array<Record<string, any>>;
    const challenge = rows[0];
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.installation_id !== installationId ||
      challenge.consumed_at
    ) {
      throw new BadRequestException('CHALLENGE_EXPIRED_OR_USED');
    }
    return challenge;
  }

  private async selectLicenseForIssue(
    queryRunner: QueryRunner,
    licenseId: string,
  ): Promise<LicenseForIssuance> {
    const rows = (await queryRunner.query(
      `SELECT l.id, l.school_id AS schoolId,
              l.license_type AS licenseType, l.status,
              l.offline_days AS offlineDays,
              CAST(l.paid_through_date AS CHAR) AS paidThroughDate,
              l.grace_days AS graceDays,
              sc.status AS schoolStatus, sc.billing_timezone AS billingTimezone
       FROM licenses l
       JOIN schools sc ON sc.id = l.school_id
       WHERE l.id = ?`,
      [licenseId],
    )) as Array<Record<string, any>>;
    const row = rows[0];
    if (!row) throw new NotFoundException('LICENSE_NOT_FOUND');
    if (row.licenseType === 'PERPETUAL') {
      return {
        id: row.id,
        schoolId: row.schoolId,
        licenseType: row.licenseType,
        status: row.status,
        schoolStatus: row.schoolStatus,
      };
    }
    const bounds = getSubscriptionBounds(
      row.paidThroughDate,
      Number(row.graceDays),
    );
    return {
      id: row.id,
      schoolId: row.schoolId,
      licenseType: row.licenseType,
      status: row.status,
      schoolStatus: row.schoolStatus,
      offlineDays: Number(row.offlineDays),
      paidThrough: bounds.paidThrough,
      graceUntil: bounds.graceUntil,
    };
  }

  private async issueAndRecord(
    queryRunner: QueryRunner,
    license: LicenseForIssuance,
    installation: InstallationForIssuance,
    challengeNonce: string,
  ) {
    const issued = issueLicense({
      config: this.config,
      privateKey: this.privateKey,
      license,
      installation,
      challengeNonce,
    });
    await queryRunner.query(
      `INSERT INTO license_issuances
        (jti, license_id, installation_id, license_type, key_id, revision,
         status, issued_at, offline_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issued.claims.jti,
        license.id,
        installation.id,
        issued.claims.licenseType,
        issued.keyId,
        issued.claims.revision,
        issued.claims.status,
        new Date(Number(issued.claims.iat) * 1000),
        issued.claims.offlineUntil ?? null,
      ],
    );
    return issued;
  }

  private mapInstallation(row: Record<string, any>): InstallationForIssuance {
    return {
      id: row.id,
      status: row.status,
      licenseRevision: Number(row.license_revision),
      publicKeyThumbprint: row.public_key_thumbprint,
    };
  }

  private async recordEvent(
    queryRunner: QueryRunner,
    event: {
      schoolId?: string;
      licenseId?: string;
      installationId?: string;
      actorAdminId?: string;
      eventType: string;
      details?: Record<string, unknown>;
    },
  ) {
    await queryRunner.query(
      `INSERT INTO license_events
        (id, school_id, license_id, installation_id, actor_admin_id,
         event_type, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        createId(),
        event.schoolId ?? null,
        event.licenseId ?? null,
        event.installationId ?? null,
        event.actorAdminId ?? null,
        event.eventType,
        JSON.stringify(event.details ?? {}),
      ],
    );
  }

  private async inTransaction<T>(
    operation: (queryRunner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

}
