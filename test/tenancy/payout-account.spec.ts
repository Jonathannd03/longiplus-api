import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { INestApplication } from '@nestjs/common';
import { FakeJwtGuard } from '../helpers/fake-jwt.guard.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SCHOOL_ID = '01960000-0000-7000-8000-000000000099';
const OWNER_ID = 'test-kc-owner';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let app: INestApplication;
let appUrl: string;

function ownerHeader() {
  return JSON.stringify({ keycloakUserId: OWNER_ID, email: 'owner@school.cd', role: 'owner', schoolId: SCHOOL_ID });
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
  const appUserUrl = `postgres://longiplus_app_user:longiplus_app_dev@${host}:${port}/longiplus_test`;

  process.env['DATABASE_URL'] = ownerUrl;
  process.env['DATABASE_APP_URL'] = appUserUrl;
  process.env['REDIS_URL'] = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  process.env['KEYCLOAK_JWKS_URL'] = 'http://stub/certs';
  process.env['KEYCLOAK_ISSUER'] = 'http://stub';

  const { default: postgres } = await import('postgres');
  const ownerSql = postgres(ownerUrl);

  for (const file of [
    '0000_confused_senator_kelly.sql',
    '0001_m1_roles_rls.sql',
    '0002_loving_power_man.sql',
    '0003_m2_rls_grants.sql',
  ]) {
    const sql = await readFile(resolve(__dirname, `../../drizzle/${file}`), 'utf8');
    if (file.endsWith('_rls.sql') || file.endsWith('_grants.sql')) {
      await ownerSql.unsafe(sql);
    } else {
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const s = stmt.trim();
        if (s) await ownerSql.unsafe(s);
      }
    }
  }

  await ownerSql`
    INSERT INTO school (id, name, province, city, accept_cdf_for_usd)
    VALUES (${SCHOOL_ID}, 'École Payout', 'Kinshasa', 'Gombe', false)
    ON CONFLICT DO NOTHING
  `;
  await ownerSql`
    INSERT INTO membership (id, school_id, keycloak_user_id, email, role, status)
    VALUES (gen_random_uuid(), ${SCHOOL_ID}, ${OWNER_ID}, 'owner@school.cd', 'owner', 'active')
    ON CONFLICT DO NOTHING
  `;
  await ownerSql.end();

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

describe('Payout account flow (BR-07)', () => {
  it('creates a payout account with status=pending', async () => {
    const res = await fetch(`${appUrl}/v1/payout-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': ownerHeader() },
      body: JSON.stringify({ kind: 'mobile_money', operator: 'M-Pesa', numberMasked: '****1234' }),
    });
    expect(res.status).toBe(201);
    const account = await res.json() as { status: string };
    expect(account.status).toBe('pending');
  });

  it('approve sets activates_at exactly 24h after approved_at (BR-07)', async () => {
    // Create account
    const createRes = await fetch(`${appUrl}/v1/payout-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': ownerHeader() },
      body: JSON.stringify({ kind: 'bank', numberMasked: '****5678' }),
    });
    const created = await createRes.json() as { id: string };

    const beforeApprove = new Date();

    // Approve
    const approveRes = await fetch(`${appUrl}/v1/payout-accounts/${created.id}/approve`, {
      method: 'POST',
      headers: { 'X-Test-User': ownerHeader() },
    });
    const afterApprove = new Date();

    expect(approveRes.status).toBe(200);
    const approved = await approveRes.json() as {
      approvedBy: string;
      approvedAt: string;
      activatesAt: string;
    };

    expect(approved.approvedBy).toBe(OWNER_ID);

    const approvedAt = new Date(approved.approvedAt);
    const activatesAt = new Date(approved.activatesAt);
    const diffMs = activatesAt.getTime() - approvedAt.getTime();
    const expectedMs = 24 * 60 * 60 * 1000;

    // Allow ±1 second tolerance for processing time
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(diffMs).toBeLessThanOrEqual(expectedMs + 1000);

    // activates_at must be in the future at time of creation
    expect(activatesAt.getTime()).toBeGreaterThan(beforeApprove.getTime());
    expect(activatesAt.getTime()).toBeGreaterThan(afterApprove.getTime());
  });

  it('lists payout accounts for the school', async () => {
    const res = await fetch(`${appUrl}/v1/payout-accounts`, {
      headers: { 'X-Test-User': ownerHeader() },
    });
    expect(res.status).toBe(200);
    const accounts = await res.json() as unknown[];
    expect(accounts.length).toBeGreaterThanOrEqual(2);
  });
});
