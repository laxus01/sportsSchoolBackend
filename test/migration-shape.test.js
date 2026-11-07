import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../migrations/001_initial_schema.sql',
  import.meta.url,
);

test('initial PostgreSQL migration declares the required licensing tables only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'schema_migrations',
    'admin_users',
    'schools',
    'licenses',
    'installations',
    'activation_codes',
    'device_challenges',
    'payments',
    'license_issuances',
    'license_events',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`, 'i'));
  }
  assert.doesNotMatch(
    sql,
    /(^|\n)\s*(DROP|ALTER|INSERT|UPDATE|DELETE|GRANT)\b/im,
  );
});
