import pg from 'pg';

const { Pool } = pg;

export function createPool(config) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'sports-school-licensing-api',
  });
}
