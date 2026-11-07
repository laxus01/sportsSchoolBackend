import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createAdminRouter } from './routes/admin.routes.js';
import { createDeviceRouter } from './routes/device.routes.js';
import { createAdminService } from './services/admin-service.js';
import { createDeviceService } from './services/device-service.js';
import { createId } from './utils/crypto.js';
import { asyncHandler } from './middleware/async-handler.js';
import { corsMiddleware } from './middleware/cors.js';
import {
  errorHandler,
  notFoundHandler,
} from './middleware/error-handler.js';

export function createApp({ pool, config, privateKey }) {
  const app = express();
  const adminService = createAdminService({ pool, config });
  const deviceService = createDeviceService({
    pool,
    config,
    privateKey,
  });
  const globalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: 'RATE_LIMITED',
        requestId: req.requestId,
      }),
  });
  const challengeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: 'RATE_LIMITED',
        requestId: req.requestId,
      }),
  });
  const deviceActionLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: 'RATE_LIMITED',
        requestId: req.requestId,
      }),
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: 'RATE_LIMITED',
        requestId: req.requestId,
      }),
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    req.requestId = createId();
    res.setHeader('X-Request-ID', req.requestId);
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      console.info({
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  });
  app.use(corsMiddleware(config.allowedOrigins));
  app.use(globalLimiter);
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    }),
  );

  app.use(
    '/v1',
    createDeviceRouter(
      deviceService,
      challengeLimiter,
      deviceActionLimiter,
    ),
  );
  app.use(
    '/v1/admin',
    createAdminRouter({ pool, config, adminService, loginLimiter }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
