import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createPool } from './pool.js';
import { withTransaction } from './transaction.js';

const migrationsDirectory = fileURLToPath(
  new URL('../../migrations/', import.meta.url),
);

export async function applyMigrations(pool) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  if (files.length === 0) {
    throw new Error('No migration files found');
  }

  const tableResult = await pool.query(
    `SELECT to_regclass('public.schema_migrations') AS table_name`,
  );
  const hasMigrationsTable = Boolean(tableResult.rows[0]?.table_name);
  const appliedResult = hasMigrationsTable
    ? await pool.query('SELECT version FROM schema_migrations')
    : { rows: [] };
  const appliedVersions = new Set(
    appliedResult.rows.map((row) => Number(row.version)),
  );

  for (const file of files) {
    const version = Number(file.split('_', 1)[0]);
    if (appliedVersions.has(version)) continue;
    const sql = await readFile(join(migrationsDirectory, file), 'utf8');

    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
        [version, basename(file, '.sql')],
      );
    });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await applyMigrations(pool);
    console.info('Database migrations applied.');
  } finally {
    await pool.end();
  }
}
