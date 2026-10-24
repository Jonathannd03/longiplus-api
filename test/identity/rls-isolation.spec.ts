import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import { FakeJwtGuard } from '../helpers/fake-jwt.guard.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SCHOOL_A_ID = '01960000-0000-7000-8000-000000000001';
const SCHOOL_B_ID = '01960000-0000-7000-8000-000000000002';
const USER_1_ID = 'test-kc-user-school-a';
const USER_2_ID = 'test-kc-user-school-b';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let app: INestApplication;
let appUrl: string;
let appUserConnStr: string;

function makeUserHeader(keycloakUserId: string, schoolId: string, role: string) {
  return JSON.stringify({ keycloakUserId, email: `${keycloakUserId}@test.cd`, role, schoolId });
}

beforeAll(async () => {
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('longiplus_test')
      .withUsername('longiplus')
      .withPassword('longiplus')
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
  ]);

  const ownerUrl = pgContainer.getConnectionUri();
  const host = pgContainer.getHost();
  const port = pgContainer.getMappedPort(5432);
  appUserConnStr = `postgres://longiplus_app_user:longiplus_app_dev@${host}:${port}/longiplus_test`;

  process.env['DATABASE_URL'] = ownerUrl;
  process.env['DATABASE_APP_URL'] = appUserConnStr;
  process.env['REDIS_URL'] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  process.env['KEYCLOAK_JWKS_URL'] = 'http://stub/certs';
  process.env['KEYCLOAK_ISSUER'] = 'http://stub';

  // Run table-creation migration
  const ownerSql = postgres(ownerUrl);
  const ddl = await readFile(
    resolve(__dirname, '../../drizzle/0000_confused_senator_kelly.sql'),
    'utf8',
  );
  for (const stmt of ddl.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (s) await ownerSql.unsafe(s);
  }
  // Run RLS + roles migration
  const rls = await readFile(
    resolve(__dirname, '../../drizzle/0001_m1_roles_rls.sql'),
    'utf8',
  );
  await ownerSql.unsafe(rls);

  // Seed two schools + two memberships (owner bypasses RLS)
  await ownerSql`
    INSERT INTO school (id, name, province, city, accept_cdf_for_usd) VALUES
      (${SCHOOL_A_ID}, 'School Alpha', 'Kinshasa', 'Lingwala', false),
      (${SCHOOL_B_ID}, 'School Beta', 'Kinshasa', 'Gombe', false)
    ON CONFLICT DO NOTHING
  `;
  await ownerSql`
    INSERT INTO membership (id, school_id, keycloak_user_id, email, role, status) VALUES
      (gen_random_uuid(), ${SCHOOL_A_ID}, ${USER_1_ID}, 'user1@alpha.cd', 'director', 'active'),
      (gen_random_uuid(), ${SCHOOL_B_ID}, ${USER_2_ID}, 'user2@beta.cd', 'bursar', 'active')
    ON CONFLICT DO NOTHING
  `;
  await ownerSql.end();

  // Boot NestJS with FakeJwtGuard as the global guard
  // Dynamic import AFTER env vars are set so client.ts connects to the test container
  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication(new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix('v1');
  app.useGlobalGuards(new FakeJwtGuard());
  await app.init();
  await app.listen(0);
  appUrl = await app.getUrl();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await Promise.all([pgContainer?.stop(), redisContainer?.stop()]);
});

describe('HTTP guard — access control', () => {
  it('allows user1 to call GET /v1/auth/me for school A', async () => {
    const res = await fetch(`${appUrl}/v1/auth/me`, {
      headers: {
        'Authorization': 'Bearer fake',
        'X-School-Id': SCHOOL_A_ID,
        'X-Test-User': makeUserHeader(USER_1_ID, SCHOOL_A_ID, 'director'),
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { schoolId: string } };
    expect(body.user.schoolId).toBe(SCHOOL_A_ID);
  });

  it('health endpoint is public and needs no auth', async () => {
    const res = await fetch(`${appUrl}/v1/health`);
    expect(res.status).toBe(200);
  });
});

describe('SQL-level RLS isolation', () => {
  it('app user with school A context sees only school A membership rows', async () => {
    const appSql = postgres(appUserConnStr);
    try {
      const rows = await appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.school_id', ${SCHOOL_A_ID}, true)`;
        return tx`SELECT school_id FROM membership`;
      });
      for (const row of rows) {
        expect(row['school_id']).toBe(SCHOOL_A_ID);
      }
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await appSql.end();
    }
  });

  it('app user with school B context sees only school B membership rows', async () => {
    const appSql = postgres(appUserConnStr);
    try {
      const rows = await appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.school_id', ${SCHOOL_B_ID}, true)`;
        return tx`SELECT school_id FROM membership`;
      });
      for (const row of rows) {
        expect(row['school_id']).toBe(SCHOOL_B_ID);
      }
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await appSql.end();
    }
  });

  it('app user with school A context sees only school A in the school table', async () => {
    const appSql = postgres(appUserConnStr);
    try {
      const rows = await appSql.begin(async (tx) => {
        await tx`SELECT set_config('app.school_id', ${SCHOOL_A_ID}, true)`;
        return tx`SELECT id FROM school`;
      });
      expect(rows.length).toBe(1);
      expect(rows[0]?.['id']).toBe(SCHOOL_A_ID);
    } finally {
      await appSql.end();
    }
  });
});

describe('Audit event written on session creation', () => {
  it('POST /v1/auth/session writes a login audit event', async () => {
    const res = await fetch(`${appUrl}/v1/auth/session`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer fake',
        'X-School-Id': SCHOOL_A_ID,
        'X-Test-User': makeUserHeader(USER_1_ID, SCHOOL_A_ID, 'director'),
      },
    });
    expect(res.status).toBe(201);

    // Verify via owner connection (bypasses RLS)
    const ownerSql = postgres(pgContainer.getConnectionUri());
    const rows = await ownerSql`
      SELECT action FROM audit_event
      WHERE actor = ${USER_1_ID} AND action = 'user.login'
      LIMIT 1
    `;
    await ownerSql.end();
    expect(rows.length).toBe(1);
  });
});
