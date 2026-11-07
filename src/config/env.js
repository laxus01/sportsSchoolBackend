const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = Number(env.PORT ?? 3001);
  const challengeTtlSeconds = Number(env.DEVICE_CHALLENGE_TTL_SECONDS ?? 300);
  const activationCodeTtlHours = Number(env.ACTIVATION_CODE_TTL_HOURS ?? 72);
  const adminJwtSecret = env.ADMIN_JWT_SECRET ?? '';
  const databaseUrl = env.DATABASE_URL ?? '';
  const licenseIssuer = env.LICENSE_ISSUER ?? '';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  if (!Number.isInteger(challengeTtlSeconds) || challengeTtlSeconds < 30) {
    throw new Error('DEVICE_CHALLENGE_TTL_SECONDS must be at least 30');
  }
  if (!Number.isInteger(activationCodeTtlHours) || activationCodeTtlHours < 1) {
    throw new Error('ACTIVATION_CODE_TTL_HOURS must be a positive integer');
  }
  if (adminJwtSecret.length < 32) {
    throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
  }
  if (databaseUrl && !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }
  let issuer;
  try {
    issuer = new URL(licenseIssuer);
  } catch {
    throw new Error('LICENSE_ISSUER must be a valid URL');
  }
  if (nodeEnv === 'production' && issuer.protocol !== 'https:') {
    throw new Error('LICENSE_ISSUER must use HTTPS in production');
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    nodeEnv === 'production' &&
    (adminJwtSecret.toLowerCase().includes('replace') ||
      !parseBoolean(env.DATABASE_SSL) ||
      !databaseUrl ||
      !allowedOrigins.length)
  ) {
    throw new Error(
      'Production requires real secrets, DATABASE_SSL=true, DATABASE_URL, and ALLOWED_ORIGINS',
    );
  }

  return Object.freeze({
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port,
    databaseUrl,
    databaseSsl: parseBoolean(env.DATABASE_SSL),
    allowedOrigins,
    adminJwtSecret,
    licenseIssuer,
    licenseAudience: env.LICENSE_AUDIENCE ?? 'SPORTS_SCHOOL',
    licenseSigningKeyId: env.LICENSE_SIGNING_KEY_ID ?? '',
    licenseSigningPrivateKeyBase64:
      env.LICENSE_SIGNING_PRIVATE_KEY_BASE64 ?? '',
    activationCodeTtlHours,
    challengeTtlSeconds,
  });
}
