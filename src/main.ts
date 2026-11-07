import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1');
  app.use(helmet());
  app.enableCors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
    ],
    maxAge: 600,
  });
  app.use(
    '/v1',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/v1/device-challenges',
    rateLimit({
      windowMs: 60_000,
      limit: 12,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/v1/admin/auth/login',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 8,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

void bootstrap();
