import { join } from 'node:path';
import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { loadAppConfig } from '../config/app-config';

export function createMysqlOptions(
  config = loadAppConfig(),
): MysqlConnectionOptions {
  return {
    type: 'mysql',
    host: config.dbHost,
    port: config.dbPort,
    username: config.dbUsername,
    password: config.dbPassword,
    database: config.dbDatabase,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    ssl: config.dbSsl ? { rejectUnauthorized: true } : undefined,
    synchronize: false,
    migrationsRun: false,
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
    migrationsTableName: 'typeorm_migrations',
    logging: false,
  };
}
