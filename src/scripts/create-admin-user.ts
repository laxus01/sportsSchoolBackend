import 'dotenv/config';
import { DataSource } from 'typeorm';
import { loadAppConfig } from '../config/app-config';
import { hashPassword } from '../common/admin-auth';
import { createId } from '../common/crypto';
import { createMysqlOptions } from '../database/typeorm-options';

const ALLOWED_ROLES = new Set(['ADMIN', 'SUPPORT']);

async function main(): Promise<void> {
  const email = process.env.ADMIN_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_USER_PASSWORD;
  const role = (process.env.ADMIN_USER_ROLE ?? '').trim().toUpperCase();
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length < 14 ||
    password.length > 1024 ||
    !ALLOWED_ROLES.has(role)
  ) {
    throw new Error(
      'Set ADMIN_USER_EMAIL, a 14-to-1024-character ADMIN_USER_PASSWORD, and ADMIN_USER_ROLE as ADMIN or SUPPORT',
    );
  }

  const dataSource = new DataSource(
    createMysqlOptions(loadAppConfig()),
  );
  await dataSource.initialize();
  try {
    const existing = (await dataSource.query(
      `SELECT COUNT(*) AS total FROM admin_users WHERE email = ?`,
      [email],
    )) as Array<{ total: number | string }>;
    if (Number(existing[0]?.total ?? 0) > 0) {
      throw new Error(`An admin account already exists for ${email}`);
    }
    await dataSource.query(
      `INSERT INTO admin_users (id, email, password_hash, admin_role)
       VALUES (?, ?, ?, ?)`,
      [createId(), email, await hashPassword(password), role],
    );
    console.info(`Created ${role} account for ${email}.`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
