import { MigrationInterface, QueryRunner } from 'typeorm';

const INITIAL_SCHEMA_SQL = [
  `CREATE TABLE admin_users (
    id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    admin_role VARCHAR(16) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_users_email (email),
    CONSTRAINT chk_admin_users_role
      CHECK (admin_role IN ('OWNER', 'ADMIN', 'SUPPORT'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE schools (
    id CHAR(36) NOT NULL,
    name VARCHAR(160) NOT NULL,
    tax_identifier VARCHAR(40) NULL,
    billing_timezone VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT chk_schools_status
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE licenses (
    id CHAR(36) NOT NULL,
    school_id CHAR(36) NOT NULL,
    product VARCHAR(32) NOT NULL DEFAULT 'SPORTS_SCHOOL',
    license_type VARCHAR(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
    paid_through_date DATE NULL,
    grace_days SMALLINT NULL DEFAULT 10,
    offline_days SMALLINT NULL DEFAULT 30,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_licenses_school (school_id),
    CONSTRAINT fk_licenses_school
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
    CONSTRAINT chk_licenses_product CHECK (product = 'SPORTS_SCHOOL'),
    CONSTRAINT chk_licenses_type
      CHECK (license_type IN ('SUBSCRIPTION', 'PERPETUAL')),
    CONSTRAINT chk_licenses_status
      CHECK (status IN ('PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
    CONSTRAINT chk_licenses_term
      CHECK (
        (license_type = 'SUBSCRIPTION'
          AND paid_through_date IS NOT NULL
          AND grace_days = 10
          AND offline_days = 30)
        OR
        (license_type = 'PERPETUAL'
          AND paid_through_date IS NULL
          AND grace_days IS NULL
          AND offline_days IS NULL)
      )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE installations (
    id CHAR(36) NOT NULL,
    school_id CHAR(36) NOT NULL,
    license_id CHAR(36) NOT NULL,
    public_key_jwk JSON NOT NULL,
    public_key_thumbprint VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    app_version VARCHAR(64) NOT NULL,
    license_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    active_school_id CHAR(36)
      GENERATED ALWAYS AS (
        CASE WHEN status IN ('ACTIVE', 'SUSPENDED') THEN school_id ELSE NULL END
      ) STORED,
    activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_validation_at DATETIME(3) NULL,
    deactivated_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_installations_public_key (public_key_thumbprint),
    UNIQUE KEY uq_installations_one_active_school (active_school_id),
    KEY ix_installations_license (license_id, activated_at),
    CONSTRAINT fk_installations_school
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installations_license
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE RESTRICT,
    CONSTRAINT chk_installations_status
      CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE activation_codes (
    id CHAR(36) NOT NULL,
    school_id CHAR(36) NOT NULL,
    code_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_activation_codes_hash (code_hash),
    KEY ix_activation_codes_school_expiry (school_id, expires_at),
    CONSTRAINT fk_activation_codes_school
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
    CONSTRAINT fk_activation_codes_admin
      FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE device_challenges (
    id CHAR(36) NOT NULL,
    purpose VARCHAR(16) NOT NULL,
    nonce VARCHAR(64) NOT NULL,
    activation_code_id CHAR(36) NULL,
    installation_id CHAR(36) NULL,
    expires_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_device_challenges_nonce (nonce),
    KEY ix_device_challenges_expiry (expires_at),
    CONSTRAINT fk_device_challenges_activation_code
      FOREIGN KEY (activation_code_id)
      REFERENCES activation_codes(id) ON DELETE RESTRICT,
    CONSTRAINT fk_device_challenges_installation
      FOREIGN KEY (installation_id)
      REFERENCES installations(id) ON DELETE RESTRICT,
    CONSTRAINT chk_device_challenges_purpose
      CHECK (purpose IN ('ACTIVATION', 'REFRESH', 'DEACTIVATION')),
    CONSTRAINT chk_device_challenges_binding
      CHECK (
        (purpose = 'ACTIVATION'
          AND activation_code_id IS NOT NULL
          AND installation_id IS NULL)
        OR
        (purpose IN ('REFRESH', 'DEACTIVATION')
          AND activation_code_id IS NULL
          AND installation_id IS NOT NULL)
      )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE payments (
    id CHAR(36) NOT NULL,
    license_id CHAR(36) NOT NULL,
    amount_cop BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'COP',
    payment_type VARCHAR(32) NOT NULL,
    payment_method VARCHAR(24) NOT NULL,
    reference VARCHAR(160) NULL,
    period_start_date DATE NULL,
    period_end_date DATE NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    recorded_by CHAR(36) NOT NULL,
    perpetual_license_id CHAR(36)
      GENERATED ALWAYS AS (
        CASE WHEN payment_type = 'PERPETUAL_LICENSE' THEN license_id ELSE NULL END
      ) STORED,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_payments_idempotency (license_id, idempotency_key),
    UNIQUE KEY uq_payments_perpetual_license (perpetual_license_id),
    KEY ix_payments_license_created (license_id, created_at),
    CONSTRAINT fk_payments_license
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payments_admin
      FOREIGN KEY (recorded_by) REFERENCES admin_users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_payments_amount CHECK (amount_cop > 0),
    CONSTRAINT chk_payments_currency CHECK (currency = 'COP'),
    CONSTRAINT chk_payments_type
      CHECK (payment_type IN ('SUBSCRIPTION_RENEWAL', 'PERPETUAL_LICENSE')),
    CONSTRAINT chk_payments_method
      CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER')),
    CONSTRAINT chk_payments_period
      CHECK (
        (payment_type = 'SUBSCRIPTION_RENEWAL'
          AND period_start_date IS NOT NULL
          AND period_end_date IS NOT NULL
          AND period_end_date >= period_start_date)
        OR
        (payment_type = 'PERPETUAL_LICENSE'
          AND period_start_date IS NULL
          AND period_end_date IS NULL)
      )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE license_issuances (
    jti CHAR(36) NOT NULL,
    license_id CHAR(36) NOT NULL,
    installation_id CHAR(36) NOT NULL,
    license_type VARCHAR(16) NOT NULL,
    key_id VARCHAR(64) NOT NULL,
    revision BIGINT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL,
    issued_at DATETIME(3) NOT NULL,
    offline_until DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (jti),
    KEY ix_license_issuances_installation (installation_id, created_at),
    CONSTRAINT fk_license_issuances_license
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_license_issuances_installation
      FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE RESTRICT,
    CONSTRAINT chk_license_issuances_type
      CHECK (license_type IN ('SUBSCRIPTION', 'PERPETUAL')),
    CONSTRAINT chk_license_issuances_offline
      CHECK (
        (license_type = 'SUBSCRIPTION' AND offline_until IS NOT NULL)
        OR
        (license_type = 'PERPETUAL' AND offline_until IS NULL)
      )
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE license_events (
    id CHAR(36) NOT NULL,
    school_id CHAR(36) NULL,
    license_id CHAR(36) NULL,
    installation_id CHAR(36) NULL,
    actor_admin_id CHAR(36) NULL,
    event_type VARCHAR(64) NOT NULL,
    details JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_license_events_school_created (school_id, created_at),
    CONSTRAINT fk_license_events_school
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
    CONSTRAINT fk_license_events_license
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_license_events_installation
      FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_license_events_admin
      FOREIGN KEY (actor_admin_id) REFERENCES admin_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

export class InitialLicensingSchema1730000000000
  implements MigrationInterface
{
  name = 'InitialLicensingSchema1730000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of INITIAL_SCHEMA_SQL) {
      await queryRunner.query(sql);
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'This initial schema migration is intentionally irreversible; review an explicit rollback plan instead.',
    );
  }
}
