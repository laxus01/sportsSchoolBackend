import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { loadLicenseSigningKey } from './utils/license-jws.js';

const config = loadConfig();
const pool = createPool(config);
const privateKey = loadLicenseSigningKey(config);
const app = createApp({ pool, config, privateKey });
const server = app.listen(config.port, config.host, () => {
  console.info(`Licensing API listening on ${config.host}:${config.port}`);
});

async function shutdown(signal) {
  console.info(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
