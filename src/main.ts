import 'reflect-metadata';
import { NestFactory, type HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';

if (!process.env['DATABASE_APP_URL'] && process.env['NODE_ENV'] === 'production') {
  throw new Error('DATABASE_APP_URL is required in production');
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  // Security headers
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS — in prod use CORS_ORIGIN (comma-separated list); in dev allow any localhost port
  const corsOrigin: string | RegExp | (string | RegExp)[] = process.env['CORS_ORIGIN']
    ? process.env['CORS_ORIGIN'].split(',').map((s) => s.trim())
    : /^https?:\/\/localhost(:\d+)?$/;
  app.enableCors({ origin: corsOrigin, credentials: true });

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = Number(process.env['API_PORT'] ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://0.0.0.0:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
