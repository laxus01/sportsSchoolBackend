import 'dotenv/config';
import { DataSource } from 'typeorm';
import { loadAppConfig } from '../config/app-config';
import { hashPassword } from '../common/admin-auth';
import { createId } from '../common/crypto';
import { createMysqlOptions } from '../database/typeorm-options';

async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' ||
    password.length < 14 ||
    password.length > 1024
  ) {
    throw new Error(
      'Set ADMIN_BOOTSTRAP_EMAIL and a 14-to-1024-character ADMIN_BOOTSTRAP_PASSWORD',
    );
  }

  const dataSource = new DataSource(
    createMysqlOptions(loadAppConfig()),
  );
  await dataSource.initialize();
  try {
    const owners = (await dataSource.query(
      `SELECT COUNT(*) AS total FROM admin_users WHERE admin_role = 'OWNER'`,
  )) as Array<{ total: number | string }>;
    if (Number(owners[0]?.total ?? 0) > 0) {
      throw new Error('An OWNER account already exists');
    }
    await dataSource.query(
      `INSERT INTO admin_users (id, email, password_hash, admin_role)
       VALUES (?, ?, ?, 'OWNER')`,
      [createId(), email, await hashPassword(password)],
    );
    console.info(`Created initial OWNER account for ${email}.`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
