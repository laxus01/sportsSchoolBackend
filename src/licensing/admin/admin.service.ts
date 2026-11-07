import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { createId, createRandomToken, sha256 } from '../../common/crypto';
import { isDateOnly, isUuid } from '../../common/validation';
import { loadAppConfig } from '../../config/app-config';
import { CreateSchoolDto } from './dto/create-school.dto';
import { RecordLicensePaymentDto } from './dto/record-license-payment.dto';

const DEFAULT_TIMEZONE = 'America/Bogota';

@Injectable()
export class AdminService {
  private readonly config = loadAppConfig();

  constructor(private readonly dataSource: DataSource) {}

  async createSchool(input: CreateSchoolDto, adminId: string) {
    const name = input.name.trim();
    const licenseType = input.licenseType;
    const paidThroughDate = input.paidThroughDate;

    if (!['SUBSCRIPTION', 'PERPETUAL'].includes(licenseType)) {
      throw new BadRequestException('LICENSE_TYPE_INVALID');
    }
    if (
      licenseType === 'SUBSCRIPTION' &&
      !isDateOnly(paidThroughDate)
    ) {
      throw new BadRequestException('PAID_THROUGH_DATE_INVALID');
    }
    if (licenseType === 'PERPETUAL' && paidThroughDate != null) {
      throw new BadRequestException(
        'PERPETUAL_LICENSE_HAS_NO_PAID_THROUGH_DATE',
      );
    }

    const schoolId = createId();
    const licenseId = createId();
    return this.inTransaction(async (queryRunner) => {
      await queryRunner.query(
        `INSERT INTO schools
          (id, name, tax_identifier, billing_timezone)
         VALUES (?, ?, ?, ?)`,
        [
          schoolId,
          name,
          input.taxIdentifier?.trim() || null,
          DEFAULT_TIMEZONE,
        ],
      );
      await queryRunner.query(
        `INSERT INTO licenses
          (id, school_id, license_type, paid_through_date, grace_days,
           offline_days)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          licenseId,
          schoolId,
          licenseType,
          paidThroughDate ?? null,
          licenseType === 'SUBSCRIPTION' ? 10 : null,
          licenseType === 'SUBSCRIPTION' ? 30 : null,
        ],
      );
      await this.recordEvent(queryRunner, {
        schoolId,
        licenseId,
        actorAdminId: adminId,
        eventType: 'SCHOOL_CREATED',
        details: { name, licenseType },
      });
      return { schoolId, licenseId, licenseType, status: 'PENDING_PAYMENT' };
    });
  }

  async createActivationCode(schoolId: string, adminId: string) {
    if (!isUuid(schoolId)) throw new BadRequestException('SCHOOL_ID_INVALID');
    const schools = (await this.dataSource.query(
      `SELECT sc.id
       FROM schools sc
       JOIN licenses l ON l.school_id = sc.id
       WHERE sc.id = ? AND sc.status = 'ACTIVE' AND l.status = 'ACTIVE'`,
      [schoolId],
    )) as Array<{ id: string }>;
    if (!schools[0]) throw new NotFoundException('ACTIVE_SCHOOL_NOT_FOUND');

    const id = createId();
    const code = `SS-${createRandomToken(32)}`;
    const expiresAt = new Date(
      Date.now() + this.config.activationCodeTtlHours * 60 * 60 * 1000,
    );
    await this.inTransaction(async (queryRunner) => {
      await queryRunner.query(
        `INSERT INTO activation_codes
          (id, school_id, code_hash, expires_at, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, schoolId, sha256(code), expiresAt, adminId],
      );
      await this.recordEvent(queryRunner, {
        schoolId,
        actorAdminId: adminId,
        eventType: 'ACTIVATION_CODE_CREATED',
        details: { activationCodeId: id, expiresAt: expiresAt.toISOString() },
      });
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async listSchools() {
    const schools = await this.dataSource.query(
      `SELECT sc.id, sc.name, sc.status,
              sc.billing_timezone AS billingTimezone,
              l.id AS licenseId, l.license_type AS licenseType,
              l.status AS licenseStatus,
              CAST(l.paid_through_date AS CHAR) AS paidThroughDate,
              l.revision, sc.created_at AS createdAt
       FROM schools sc
       JOIN licenses l ON l.school_id = sc.id
       ORDER BY sc.created_at DESC
       LIMIT 500`,
    );
    return { schools };
  }

  async listInstallations(schoolId: string) {
    if (!isUuid(schoolId)) throw new BadRequestException('SCHOOL_ID_INVALID');
    const installations = await this.dataSource.query(
      `SELECT id, status, app_version AS appVersion,
              public_key_thumbprint AS publicKeyThumbprint,
              license_revision AS licenseRevision,
              activated_at AS activatedAt,
              last_validation_at AS lastValidationAt,
              deactivated_at AS deactivatedAt
       FROM installations
       WHERE school_id = ?
       ORDER BY activated_at DESC`,
      [schoolId],
    );
    return { installations };
  }

  async recordPayment(
    licenseId: string,
    payment: RecordLicensePaymentDto,
    idempotencyKey: string | undefined,
    adminId: string,
  ) {
    if (!isUuid(licenseId)) {
      throw new BadRequestException('LICENSE_ID_INVALID');
    }
    this.validatePayment(payment, idempotencyKey);

    return this.inTransaction(async (queryRunner) => {
      const licenses = (await queryRunner.query(
        `SELECT id, school_id, license_type, status
         FROM licenses WHERE id = ? FOR UPDATE`,
        [licenseId],
      )) as Array<{
        id: string;
        school_id: string;
        license_type: 'SUBSCRIPTION' | 'PERPETUAL';
        status: string;
      }>;
      const license = licenses[0];
      if (!license) throw new NotFoundException('LICENSE_NOT_FOUND');

      const duplicates = (await queryRunner.query(
        `SELECT id, amount_cop AS amountCop, currency, payment_type AS paymentType,
                payment_method AS paymentMethod, reference,
                CAST(period_start_date AS CHAR) AS periodStartDate,
                CAST(period_end_date AS CHAR) AS periodEndDate
         FROM payments
         WHERE license_id = ? AND idempotency_key = ?`,
        [licenseId, idempotencyKey],
      )) as Array<Record<string, unknown>>;
      const duplicate = duplicates[0];
      if (duplicate) {
        const matches =
          Number(duplicate.amountCop) === payment.amountCop &&
          String(duplicate.currency).trim() === payment.currency &&
          duplicate.paymentType === payment.paymentType &&
          duplicate.paymentMethod === payment.paymentMethod &&
          duplicate.reference === (payment.reference?.trim() || null) &&
          duplicate.periodStartDate === (payment.periodStartDate ?? null) &&
          duplicate.periodEndDate === (payment.periodEndDate ?? null);
        if (!matches) throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        return { paymentId: duplicate.id, replayed: true };
      }

      if (license.status === 'CANCELLED') {
        throw new ConflictException('LICENSE_CANCELLED');
      }
      if (
        (payment.paymentType === 'SUBSCRIPTION_RENEWAL' &&
          license.license_type !== 'SUBSCRIPTION') ||
        (payment.paymentType === 'PERPETUAL_LICENSE' &&
          license.license_type !== 'PERPETUAL')
      ) {
        throw new ConflictException('PAYMENT_TYPE_LICENSE_MISMATCH');
      }

      const paymentId = createId();
      await queryRunner.query(
        `INSERT INTO payments
          (id, license_id, amount_cop, currency, payment_type,
           payment_method, reference, period_start_date, period_end_date,
           idempotency_key, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          licenseId,
          payment.amountCop,
          payment.currency,
          payment.paymentType,
          payment.paymentMethod,
          payment.reference?.trim() || null,
          payment.periodStartDate ?? null,
          payment.periodEndDate ?? null,
          idempotencyKey,
          adminId,
        ],
      );

      if (payment.paymentType === 'SUBSCRIPTION_RENEWAL') {
        await queryRunner.query(
          `UPDATE licenses
           SET paid_through_date = GREATEST(paid_through_date, ?),
               status = 'ACTIVE', revision = revision + 1
           WHERE id = ?`,
          [payment.periodEndDate, licenseId],
        );
      } else {
        await queryRunner.query(
          `UPDATE licenses
           SET status = 'ACTIVE', revision = revision + 1
           WHERE id = ?`,
          [licenseId],
        );
      }

      await this.recordEvent(queryRunner, {
        schoolId: license.school_id,
        licenseId,
        actorAdminId: adminId,
        eventType: 'LICENSE_PAYMENT_RECORDED',
        details: {
          paymentId,
          paymentType: payment.paymentType,
          amountCop: payment.amountCop,
          currency: payment.currency,
          periodEndDate: payment.periodEndDate ?? null,
        },
      });
      return { paymentId, replayed: false };
    });
  }

  async setInstallationStatus(
    installationId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
    adminId: string,
  ) {
    if (!isUuid(installationId)) {
      throw new BadRequestException('INSTALLATION_ID_INVALID');
    }
    return this.inTransaction(async (queryRunner) => {
      const rows = (await queryRunner.query(
        `SELECT i.school_id AS schoolId, l.id AS licenseId,
                l.status AS licenseStatus, sc.status AS schoolStatus
         FROM installations i
         JOIN licenses l ON l.id = i.license_id
         JOIN schools sc ON sc.id = i.school_id
         WHERE i.id = ? FOR UPDATE`,
        [installationId],
      )) as Array<Record<string, string>>;
      const current = rows[0];
      if (!current) throw new NotFoundException('INSTALLATION_NOT_FOUND');
      if (
        status === 'ACTIVE' &&
        (current.licenseStatus !== 'ACTIVE' ||
          current.schoolStatus !== 'ACTIVE')
      ) {
        throw new ConflictException('LICENSE_NOT_ACTIVE');
      }

      if (status !== 'REVOKED') {
        const conflicts = (await queryRunner.query(
          `SELECT COUNT(*) AS total
           FROM installations
           WHERE school_id = ? AND id <> ?
             AND status IN ('ACTIVE', 'SUSPENDED')`,
          [current.schoolId, installationId],
        )) as Array<{ total: number | string }>;
        if (Number(conflicts[0]?.total ?? 0) > 0) {
          throw new ConflictException('SCHOOL_INSTALLATION_LIMIT_REACHED');
        }
      }
      await queryRunner.query(
        `UPDATE installations
         SET status = ?,
             deactivated_at = CASE
               WHEN ? = 'REVOKED' THEN COALESCE(deactivated_at, UTC_TIMESTAMP(3))
               WHEN ? = 'ACTIVE' THEN NULL
               ELSE deactivated_at
             END,
             license_revision = license_revision + 1
         WHERE id = ?`,
        [status, status, status, installationId],
      );
      await this.recordEvent(queryRunner, {
        schoolId: current.schoolId,
        licenseId: current.licenseId,
        installationId,
        actorAdminId: adminId,
        eventType: `INSTALLATION_${status}`,
      });
      return { installationId, status };
    });
  }

  async setLicenseStatus(
    licenseId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED',
    adminId: string,
  ) {
    if (!isUuid(licenseId)) throw new BadRequestException('LICENSE_ID_INVALID');
    return this.inTransaction(async (queryRunner) => {
      const rows = (await queryRunner.query(
        `SELECT school_id AS schoolId, status
         FROM licenses WHERE id = ? FOR UPDATE`,
        [licenseId],
      )) as Array<{ schoolId: string; status: string }>;
      const current = rows[0];
      if (!current) throw new NotFoundException('LICENSE_NOT_FOUND');
      if (status === 'ACTIVE' && current.status === 'PENDING_PAYMENT') {
        throw new ConflictException('PAYMENT_REQUIRED');
      }
      await queryRunner.query(
        `UPDATE licenses
         SET status = ?, revision = revision + 1
         WHERE id = ?`,
        [status, licenseId],
      );
      await this.recordEvent(queryRunner, {
        schoolId: current.schoolId,
        licenseId,
        actorAdminId: adminId,
        eventType: `LICENSE_${status}`,
      });
      return { licenseId, status };
    });
  }

  async listEvents(licenseId: string) {
    if (!isUuid(licenseId)) throw new BadRequestException('LICENSE_ID_INVALID');
    const events = await this.dataSource.query(
      `SELECT id, installation_id AS installationId,
              actor_admin_id AS actorAdminId, event_type AS eventType,
              details, created_at AS createdAt
       FROM license_events
       WHERE license_id = ?
       ORDER BY created_at DESC
       LIMIT 500`,
      [licenseId],
    );
    return { events };
  }

  private validatePayment(
    payment: RecordLicensePaymentDto,
    idempotencyKey?: string,
  ) {
    if (!Number.isSafeInteger(payment.amountCop) || payment.amountCop <= 0) {
      throw new BadRequestException('PAYMENT_AMOUNT_INVALID');
    }
    if (payment.currency !== 'COP') {
      throw new BadRequestException('PAYMENT_CURRENCY_INVALID');
    }
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    }
    if (
      payment.reference !== undefined &&
      payment.reference !== null &&
      payment.reference.length > 160
    ) {
      throw new BadRequestException('PAYMENT_REFERENCE_INVALID');
    }
    if (payment.paymentType === 'SUBSCRIPTION_RENEWAL') {
      if (
        !isDateOnly(payment.periodStartDate) ||
        !isDateOnly(payment.periodEndDate) ||
        payment.periodEndDate < payment.periodStartDate
      ) {
        throw new BadRequestException('PAYMENT_PERIOD_INVALID');
      }
    } else if (
      payment.periodStartDate != null ||
      payment.periodEndDate != null
    ) {
      throw new BadRequestException('PERPETUAL_PAYMENT_HAS_NO_PERIOD');
    }
  }

  private async recordEvent(
    queryRunner: import('typeorm').QueryRunner,
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
    action: (queryRunner: import('typeorm').QueryRunner) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await action(queryRunner);
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
