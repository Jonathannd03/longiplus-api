import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let app: INestApplication;
let address: string;

beforeAll(async () => {
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('longiplus_test')
      .withUsername('longiplus')
      .withPassword('longiplus')
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
  ]);

  process.env['DATABASE_URL'] = pgContainer.getConnectionUri();
  process.env['DATABASE_APP_URL'] = pgContainer.getConnectionUri();
  process.env['REDIS_URL'] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  process.env['KEYCLOAK_JWKS_URL'] = 'http://stub/certs';
  process.env['KEYCLOAK_ISSUER'] = 'http://stub';

  const { AppModule } = await import('../src/app.module.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );
  app.setGlobalPrefix('v1');
  app.useGlobalGuards({ canActivate: () => true });
  await app.init();
  await app.listen(0);
  address = await app.getUrl();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await Promise.all([pgContainer?.stop(), redisContainer?.stop()]);
});

describe('GET /v1/health', () => {
  it('returns 200 with status ok when postgres and redis are up', async () => {
    const res = await fetch(`${address}/v1/health`);
    const body = await res.json() as { status: string; database: string; redis: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database).toBe('ok');
    expect(body.redis).toBe('ok');
  });
});
