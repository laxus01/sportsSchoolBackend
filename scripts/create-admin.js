import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { hashPassword } from '../src/services/admin-auth.js';
import { createId } from '../src/utils/crypto.js';
import { asEmail } from '../src/utils/validation.js';

const config = loadConfig();
const email = asEmail(process.env.ADMIN_BOOTSTRAP_EMAIL);
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

if (
  !email ||
  typeof password !== 'string' ||
  password.length < 14 ||
  password.length > 1024
) {
  throw new Error(
    'Set ADMIN_BOOTSTRAP_EMAIL and an ADMIN_BOOTSTRAP_PASSWORD with 14 to 1024 characters',
  );
}

const pool = createPool(config);
try {
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO admin_users (id, email, password_hash, role)
     VALUES ($1, $2, $3, 'OWNER')`,
    [createId(), email, passwordHash],
  );
  console.info(`Created initial owner account for ${email}.`);
} finally {
  await pool.end();
}
