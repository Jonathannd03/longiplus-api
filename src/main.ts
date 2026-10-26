import 'reflect-metadata';
import { NestFactory, type HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import multipart from '@fastify/multipart';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { JwtAuthGuard } from './modules/identity/jwt.guard.js';

const REQUIRED_ENV = ['DATABASE_URL', 'REDIS_URL', 'KEYCLOAK_JWKS_URL', 'KEYCLOAK_ISSUER'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

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
  await app.register(helmet as Parameters<typeof app.register>[0], {
    contentSecurityPolicy: false, // allow API responses without CSP overhead
  });

  // CORS — allow only the configured origin (or localhost in dev)
  app.enableCors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  });

  app.setGlobalPrefix('v1');
  app.useGlobalGuards(app.get(JwtAuthGuard));
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
