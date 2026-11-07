export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  dbHost: string;
  dbPort: number;
  dbUsername: string;
  dbPassword: string;
  dbDatabase: string;
  dbSsl: boolean;
  allowedOrigins: string[];
  adminJwtSecret: string;
  licenseIssuer: string;
  licenseAudience: string;
  licenseSigningKeyId: string;
  licenseSigningPrivateKeyBase64: string;
  activationCodeTtlHours: number;
  challengeTtlSeconds: number;
}

const parseBoolean = (value: string | undefined): boolean =>
  value?.toLowerCase() === 'true';

export function loadAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = Number(env.PORT ?? 3001);
  const dbPort = Number(env.DB_PORT ?? 3306);
  const activationCodeTtlHours = Number(
    env.ACTIVATION_CODE_TTL_HOURS ?? 72,
  );
  const challengeTtlSeconds = Number(
    env.DEVICE_CHALLENGE_TTL_SECONDS ?? 300,
  );
  const adminJwtSecret = env.ADMIN_JWT_SECRET ?? '';
  const licenseIssuer = env.LICENSE_ISSUER ?? '';
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error('DB_PORT must be an integer from 1 to 65535');
  }
  if (!Number.isInteger(activationCodeTtlHours) || activationCodeTtlHours < 1) {
    throw new Error('ACTIVATION_CODE_TTL_HOURS must be positive');
  }
  if (!Number.isInteger(challengeTtlSeconds) || challengeTtlSeconds < 30) {
    throw new Error('DEVICE_CHALLENGE_TTL_SECONDS must be at least 30');
  }
  if (adminJwtSecret.length < 32) {
    throw new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
  }

  let issuer: URL;
  try {
    issuer = new URL(licenseIssuer);
  } catch {
    throw new Error('LICENSE_ISSUER must be a valid URL');
  }
  if (nodeEnv === 'production') {
    if (issuer.protocol !== 'https:') {
      throw new Error('LICENSE_ISSUER must use HTTPS in production');
    }
    if (
      !env.DB_HOST ||
      !env.DB_USERNAME ||
      !env.DB_PASSWORD ||
      !env.DB_DATABASE ||
      !parseBoolean(env.DB_SSL) ||
      !allowedOrigins.length ||
      adminJwtSecret.toLowerCase().includes('replace')
    ) {
      throw new Error(
        'Production requires MySQL credentials, DB_SSL=true, CORS origins, and real secrets',
      );
    }
  }

  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port,
    dbHost: env.DB_HOST ?? '127.0.0.1',
    dbPort,
    dbUsername: env.DB_USERNAME ?? '',
    dbPassword: env.DB_PASSWORD ?? '',
    dbDatabase: env.DB_DATABASE ?? '',
    dbSsl: parseBoolean(env.DB_SSL),
    allowedOrigins,
    adminJwtSecret,
    licenseIssuer,
    licenseAudience: env.LICENSE_AUDIENCE ?? 'SPORTS_SCHOOL',
    licenseSigningKeyId: env.LICENSE_SIGNING_KEY_ID ?? '',
    licenseSigningPrivateKeyBase64:
      env.LICENSE_SIGNING_PRIVATE_KEY_BASE64 ?? '',
    activationCodeTtlHours,
    challengeTtlSeconds,
  };
}
