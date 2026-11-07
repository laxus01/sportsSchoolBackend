CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'SUPPORT')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE schools (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  tax_identifier TEXT,
  billing_timezone TEXT NOT NULL DEFAULT 'America/Bogota',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE licenses (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL UNIQUE REFERENCES schools(id) ON DELETE RESTRICT,
  product TEXT NOT NULL DEFAULT 'SPORTS_SCHOOL'
    CHECK (product = 'SPORTS_SCHOOL'),
  license_type TEXT NOT NULL DEFAULT 'SUBSCRIPTION'
    CHECK (license_type IN ('SUBSCRIPTION', 'PERPETUAL')),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'CANCELLED')),
  paid_through_date DATE,
  grace_days SMALLINT DEFAULT 10,
  offline_days SMALLINT DEFAULT 30,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (license_type = 'SUBSCRIPTION' AND paid_through_date IS NOT NULL
      AND grace_days = 10 AND offline_days = 30)
    OR
    (license_type = 'PERPETUAL' AND paid_through_date IS NULL
      AND grace_days IS NULL AND offline_days IS NULL)
  )
);

CREATE TABLE installations (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  public_key_jwk JSONB NOT NULL,
  public_key_thumbprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  app_version TEXT NOT NULL,
  license_revision BIGINT NOT NULL DEFAULT 0 CHECK (license_revision >= 0),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_validation_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX installations_one_active_per_school
  ON installations (school_id)
  WHERE status IN ('ACTIVE', 'SUSPENDED');

CREATE TABLE activation_codes (
  id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE device_challenges (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('ACTIVATION', 'REFRESH', 'DEACTIVATION')),
  nonce TEXT NOT NULL UNIQUE,
  activation_code_id UUID REFERENCES activation_codes(id) ON DELETE RESTRICT,
  installation_id UUID REFERENCES installations(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (purpose = 'ACTIVATION' AND activation_code_id IS NOT NULL
      AND installation_id IS NULL)
    OR
    (purpose IN ('REFRESH', 'DEACTIVATION') AND installation_id IS NOT NULL
      AND activation_code_id IS NULL)
  )
);

CREATE TABLE payments (
  id UUID PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  amount_cop BIGINT NOT NULL CHECK (amount_cop > 0),
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  payment_type TEXT NOT NULL
    CHECK (payment_type IN ('SUBSCRIPTION_RENEWAL', 'PERPETUAL_LICENSE')),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER')),
  reference TEXT,
  period_start_date DATE,
  period_end_date DATE,
  idempotency_key TEXT NOT NULL,
  recorded_by UUID NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (payment_type = 'SUBSCRIPTION_RENEWAL'
      AND period_start_date IS NOT NULL
      AND period_end_date IS NOT NULL
      AND period_end_date >= period_start_date)
    OR
    (payment_type = 'PERPETUAL_LICENSE'
      AND period_start_date IS NULL
      AND period_end_date IS NULL)
  ),
  UNIQUE (license_id, idempotency_key)
);

CREATE TABLE license_issuances (
  jti UUID PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES licenses(id) ON DELETE RESTRICT,
  installation_id UUID NOT NULL REFERENCES installations(id) ON DELETE RESTRICT,
  license_type TEXT NOT NULL CHECK (license_type IN ('SUBSCRIPTION', 'PERPETUAL')),
  key_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  issued_at TIMESTAMPTZ NOT NULL,
  offline_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (license_type = 'SUBSCRIPTION' AND offline_until IS NOT NULL)
    OR
    (license_type = 'PERPETUAL' AND offline_until IS NULL)
  )
);

CREATE TABLE license_events (
  id UUID PRIMARY KEY,
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  license_id UUID REFERENCES licenses(id) ON DELETE RESTRICT,
  installation_id UUID REFERENCES installations(id) ON DELETE RESTRICT,
  actor_admin_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activation_codes_school_expiry
  ON activation_codes (school_id, expires_at);
CREATE INDEX device_challenges_expiry
  ON device_challenges (expires_at);
CREATE INDEX payments_license_created
  ON payments (license_id, created_at DESC);
CREATE UNIQUE INDEX payments_one_perpetual_license
  ON payments (license_id)
  WHERE payment_type = 'PERPETUAL_LICENSE';
CREATE INDEX license_events_school_created
  ON license_events (school_id, created_at DESC);
CREATE INDEX license_issuances_installation_created
  ON license_issuances (installation_id, created_at DESC);
