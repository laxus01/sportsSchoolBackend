import { createId, createRandomToken, sha256 } from '../utils/crypto.js';
import { HttpError } from '../utils/http-error.js';
import { isDateOnly, isUuid } from '../utils/validation.js';
import { withTransaction } from '../db/transaction.js';
import { recordLicenseEvent } from './license-issuer.js';

const DEFAULT_TIMEZONE = 'America/Bogota';
const PAYMENT_METHODS = new Set([
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
]);

export function createAdminService({
  pool,
  config,
  now = () => new Date(),
}) {
  return {
    createSchool: async (
      {
        name,
        taxIdentifier,
        licenseType = 'SUBSCRIPTION',
        paidThroughDate,
      },
      adminId,
    ) => {
      if (
        typeof name !== 'string' ||
        name.trim().length < 2 ||
        name.trim().length > 160
      ) {
        throw new HttpError(400, 'SCHOOL_NAME_INVALID');
      }
      if (!['SUBSCRIPTION', 'PERPETUAL'].includes(licenseType)) {
        throw new HttpError(400, 'LICENSE_TYPE_INVALID');
      }
      if (
        licenseType === 'SUBSCRIPTION' &&
        !isDateOnly(paidThroughDate)
      ) {
        throw new HttpError(400, 'PAID_THROUGH_DATE_INVALID');
      }
      if (licenseType === 'PERPETUAL' && paidThroughDate != null) {
        throw new HttpError(400, 'PERPETUAL_LICENSE_HAS_NO_PAID_THROUGH_DATE');
      }
      if (
        taxIdentifier !== undefined &&
        taxIdentifier !== null &&
        (typeof taxIdentifier !== 'string' || taxIdentifier.length > 40)
      ) {
        throw new HttpError(400, 'TAX_IDENTIFIER_INVALID');
      }

      const schoolId = createId();
      const licenseId = createId();
      return withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO schools (id, name, tax_identifier, billing_timezone)
           VALUES ($1, $2, $3, $4)`,
          [
            schoolId,
            name.trim(),
            taxIdentifier?.trim() || null,
            DEFAULT_TIMEZONE,
          ],
        );
        await client.query(
          `INSERT INTO licenses
            (id, school_id, license_type, paid_through_date, grace_days,
             offline_days)
           VALUES ($1, $2, $3, $4::date, $5, $6)`,
          [
            licenseId,
            schoolId,
            licenseType,
            paidThroughDate ?? null,
            licenseType === 'SUBSCRIPTION' ? 10 : null,
            licenseType === 'SUBSCRIPTION' ? 30 : null,
          ],
        );
        await recordLicenseEvent(client, {
          schoolId,
          licenseId,
          actorAdminId: adminId,
          eventType: 'SCHOOL_CREATED',
          details: { name: name.trim(), licenseType },
        });
        return { schoolId, licenseId };
      });
    },

    createActivationCode: async (schoolId, adminId) => {
      if (!isUuid(schoolId)) throw new HttpError(400, 'SCHOOL_ID_INVALID');
      const schoolResult = await pool.query(
        `SELECT sc.id
         FROM schools sc
         JOIN licenses s ON s.school_id = sc.id
         WHERE sc.id = $1 AND sc.status = 'ACTIVE'
           AND s.status = 'ACTIVE'`,
        [schoolId],
      );
      if (!schoolResult.rows[0]) {
        throw new HttpError(404, 'ACTIVE_SCHOOL_NOT_FOUND');
      }

      const id = createId();
      const code = `SS-${createRandomToken(32)}`;
      const expiresAt = new Date(
        now().valueOf() + config.activationCodeTtlHours * 60 * 60 * 1000,
      );
      await withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO activation_codes
            (id, school_id, code_hash, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, schoolId, sha256(code), expiresAt, adminId],
        );
        await recordLicenseEvent(client, {
          schoolId,
          actorAdminId: adminId,
          eventType: 'ACTIVATION_CODE_CREATED',
          details: {
            activationCodeId: id,
            expiresAt: expiresAt.toISOString(),
          },
        });
      });
      return { code, expiresAt: expiresAt.toISOString() };
    },

    listSchools: async () => {
      const result = await pool.query(
        `SELECT sc.id, sc.name, sc.status, sc.billing_timezone AS "billingTimezone",
                s.id AS "licenseId", s.license_type AS "licenseType",
                s.status AS "licenseStatus",
                s.paid_through_date::text AS "paidThroughDate",
                s.revision, sc.created_at AS "createdAt"
         FROM schools sc
         JOIN licenses s ON s.school_id = sc.id
         ORDER BY sc.created_at DESC
         LIMIT 500`,
      );
      return result.rows;
    },

    listInstallations: async (schoolId) => {
      if (!isUuid(schoolId)) throw new HttpError(400, 'SCHOOL_ID_INVALID');
      const result = await pool.query(
        `SELECT id, status, app_version AS "appVersion",
                public_key_thumbprint AS "publicKeyThumbprint",
                license_revision AS "licenseRevision",
                activated_at AS "activatedAt",
                last_validation_at AS "lastValidationAt",
                deactivated_at AS "deactivatedAt"
         FROM installations
         WHERE school_id = $1
         ORDER BY activated_at DESC`,
        [schoolId],
      );
      return result.rows;
    },

    recordPayment: async (
      licenseId,
      {
        paymentType,
        amountCop,
        currency,
        paymentMethod,
        reference,
        periodStartDate,
        periodEndDate,
      },
      idempotencyKey,
      adminId,
    ) => {
      if (!isUuid(licenseId)) {
        throw new HttpError(400, 'LICENSE_ID_INVALID');
      }
      if (!Number.isSafeInteger(amountCop) || amountCop <= 0) {
        throw new HttpError(400, 'PAYMENT_AMOUNT_INVALID');
      }
      if (
        !['SUBSCRIPTION_RENEWAL', 'PERPETUAL_LICENSE'].includes(paymentType)
      ) {
        throw new HttpError(400, 'PAYMENT_TYPE_INVALID');
      }
      if (currency !== 'COP' || !PAYMENT_METHODS.has(paymentMethod)) {
        throw new HttpError(400, 'PAYMENT_DETAILS_INVALID');
      }
      if (paymentType === 'SUBSCRIPTION_RENEWAL') {
        if (
          !isDateOnly(periodStartDate) ||
          !isDateOnly(periodEndDate) ||
          periodEndDate < periodStartDate
        ) {
          throw new HttpError(400, 'PAYMENT_PERIOD_INVALID');
        }
      } else if (periodStartDate != null || periodEndDate != null) {
        throw new HttpError(400, 'PERPETUAL_PAYMENT_HAS_NO_PERIOD');
      }
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      ) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
      }
      if (reference !== undefined && reference !== null &&
          (typeof reference !== 'string' || reference.length > 160)) {
        throw new HttpError(400, 'PAYMENT_REFERENCE_INVALID');
      }

      return withTransaction(pool, async (client) => {
        const licenseResult = await client.query(
          `SELECT id, school_id, license_type, status
           FROM licenses
           WHERE id = $1
           FOR UPDATE`,
          [licenseId],
        );
        const license = licenseResult.rows[0];
        if (!license) {
          throw new HttpError(404, 'LICENSE_NOT_FOUND');
        }

        const duplicateResult = await client.query(
          `SELECT id, amount_cop, currency, payment_type, payment_method,
                  reference,
                  period_start_date::text AS period_start_date,
                  period_end_date::text AS period_end_date
           FROM payments
           WHERE license_id = $1 AND idempotency_key = $2`,
          [licenseId, idempotencyKey],
        );
        const duplicate = duplicateResult.rows[0];
        if (duplicate) {
          const matches =
            Number(duplicate.amount_cop) === amountCop &&
            duplicate.currency.trim() === currency &&
            duplicate.payment_type === paymentType &&
            duplicate.payment_method === paymentMethod &&
            duplicate.reference === (reference?.trim() || null) &&
            duplicate.period_start_date === (periodStartDate ?? null) &&
            duplicate.period_end_date === (periodEndDate ?? null);
          if (!matches) {
            throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED');
          }
          return { paymentId: duplicate.id, replayed: true };
        }

        if (license.status === 'CANCELLED') {
          throw new HttpError(409, 'LICENSE_CANCELLED');
        }
        if (
          (paymentType === 'SUBSCRIPTION_RENEWAL' &&
            license.license_type !== 'SUBSCRIPTION') ||
          (paymentType === 'PERPETUAL_LICENSE' &&
            license.license_type !== 'PERPETUAL')
        ) {
          throw new HttpError(409, 'PAYMENT_TYPE_LICENSE_MISMATCH');
        }

        const paymentId = createId();
        await client.query(
          `INSERT INTO payments
            (id, license_id, amount_cop, currency, payment_type, payment_method,
             reference, period_start_date, period_end_date, idempotency_key,
             recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11)`,
          [
            paymentId,
            licenseId,
            amountCop,
            currency,
            paymentType,
            paymentMethod,
            reference?.trim() || null,
            periodStartDate ?? null,
            periodEndDate ?? null,
            idempotencyKey,
            adminId,
          ],
        );
        if (paymentType === 'SUBSCRIPTION_RENEWAL') {
          await client.query(
            `UPDATE licenses
             SET paid_through_date = GREATEST(paid_through_date, $1::date),
                 status = 'ACTIVE',
                 revision = revision + 1,
                 updated_at = $2
             WHERE id = $3`,
            [periodEndDate, now(), licenseId],
          );
        } else {
          await client.query(
            `UPDATE licenses
             SET status = 'ACTIVE',
                 revision = revision + 1,
                 updated_at = $1
             WHERE id = $2`,
            [now(), licenseId],
          );
        }
        await recordLicenseEvent(client, {
          schoolId: license.school_id,
          licenseId,
          actorAdminId: adminId,
          eventType: 'LICENSE_PAYMENT_RECORDED',
          details: {
            paymentId,
            paymentType,
            amountCop,
            currency,
            periodEndDate: periodEndDate ?? null,
          },
        });
        return { paymentId, replayed: false };
      });
    },

    setInstallationStatus: async (
      installationId,
      status,
      adminId,
    ) => {
      if (!isUuid(installationId)) {
        throw new HttpError(400, 'INSTALLATION_ID_INVALID');
      }
      if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) {
        throw new HttpError(400, 'INSTALLATION_STATUS_INVALID');
      }

      return withTransaction(pool, async (client) => {
        const currentResult = await client.query(
          `SELECT i.school_id, l.status AS license_status,
                  sc.status AS school_status
           FROM installations i
           JOIN licenses l ON l.id = i.license_id
           JOIN schools sc ON sc.id = i.school_id
           WHERE i.id = $1
           FOR UPDATE OF i, l, sc`,
          [installationId],
        );
        const current = currentResult.rows[0];
        if (!current) {
          throw new HttpError(404, 'INSTALLATION_NOT_FOUND');
        }
        if (
          status === 'ACTIVE' &&
          (current.license_status !== 'ACTIVE' ||
            current.school_status !== 'ACTIVE')
        ) {
          throw new HttpError(409, 'LICENSE_NOT_ACTIVE');
        }
        if (status !== 'REVOKED') {
          const conflictResult = await client.query(
            `SELECT EXISTS (
               SELECT 1 FROM installations
               WHERE school_id = (
                 SELECT school_id FROM installations WHERE id = $1
               )
                 AND id <> $1
                 AND status IN ('ACTIVE', 'SUSPENDED')
             ) AS occupied`,
            [installationId],
          );
          if (conflictResult.rows[0]?.occupied) {
            throw new HttpError(409, 'SCHOOL_INSTALLATION_LIMIT_REACHED');
          }
        }
        const result = await client.query(
          `UPDATE installations
           SET status = $1,
               deactivated_at = CASE
                 WHEN $1 = 'REVOKED' THEN COALESCE(deactivated_at, $2)
                 WHEN $1 = 'ACTIVE' THEN NULL
                 ELSE deactivated_at
               END,
               license_revision = license_revision + 1
           WHERE id = $3
           RETURNING id, school_id, license_id, status`,
          [status, now(), installationId],
        );
        const installation = result.rows[0];
        if (!installation) {
          throw new HttpError(404, 'INSTALLATION_NOT_FOUND');
        }

        await recordLicenseEvent(client, {
          schoolId: installation.school_id,
          licenseId: installation.license_id,
          installationId,
          actorAdminId: adminId,
          eventType: `INSTALLATION_${status}`,
        });
        return { installationId, status };
      });
    },

    setLicenseStatus: async (licenseId, status, adminId) => {
      if (!isUuid(licenseId)) {
        throw new HttpError(400, 'LICENSE_ID_INVALID');
      }
      if (!['ACTIVE', 'SUSPENDED', 'CANCELLED'].includes(status)) {
        throw new HttpError(400, 'LICENSE_STATUS_INVALID');
      }
      return withTransaction(pool, async (client) => {
        const currentResult = await client.query(
          `SELECT status FROM licenses WHERE id = $1 FOR UPDATE`,
          [licenseId],
        );
        const current = currentResult.rows[0];
        if (!current) {
          throw new HttpError(404, 'LICENSE_NOT_FOUND');
        }
        if (status === 'ACTIVE' && current.status === 'PENDING_PAYMENT') {
          throw new HttpError(409, 'PAYMENT_REQUIRED');
        }
        const result = await client.query(
          `UPDATE licenses
           SET status = $1, revision = revision + 1, updated_at = $2
           WHERE id = $3
           RETURNING id, school_id, status`,
          [status, now(), licenseId],
        );
        const license = result.rows[0];
        await recordLicenseEvent(client, {
          schoolId: license.school_id,
          licenseId,
          actorAdminId: adminId,
          eventType: `LICENSE_${status}`,
        });
        return { licenseId, status };
      });
    },

    listEvents: async (licenseId) => {
      if (!isUuid(licenseId)) {
        throw new HttpError(400, 'LICENSE_ID_INVALID');
      }
      const result = await pool.query(
        `SELECT id, installation_id AS "installationId",
                actor_admin_id AS "actorAdminId", event_type AS "eventType",
                details, created_at AS "createdAt"
         FROM license_events
         WHERE license_id = $1
         ORDER BY created_at DESC
         LIMIT 500`,
        [licenseId],
      );
      return result.rows;
    },
  };
}
