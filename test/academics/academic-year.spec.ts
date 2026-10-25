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

const SCHOOL_ID = '01960000-0000-7000-8000-000000000001';
const USER_ID = 'test-kc-director';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let app: INestApplication;
let appUrl: string;

function userHeader(role = 'director') {
  return JSON.stringify({ keycloakUserId: USER_ID, email: 'dir@school.cd', role, schoolId: SCHOOL_ID });
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

  // Run migrations
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

  // Seed school
  await ownerSql`
    INSERT INTO school (id, name, province, city, accept_cdf_for_usd)
    VALUES (${SCHOOL_ID}, 'École Test', 'Kinshasa', 'Gombe', false)
    ON CONFLICT DO NOTHING
  `;
  // Seed membership
  await ownerSql`
    INSERT INTO membership (id, school_id, keycloak_user_id, email, role, status)
    VALUES (gen_random_uuid(), ${SCHOOL_ID}, ${USER_ID}, 'dir@school.cd', 'director', 'active')
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

describe('Academic year creation', () => {
  it('creates a primary academic year and seeds 6 periods (3 study + 3 exam)', async () => {
    const res = await fetch(`${appUrl}/v1/academic-years`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-User': userHeader(),
      },
      body: JSON.stringify({
        label: '2024-2025',
        startsOn: '2024-09-01',
        endsOn: '2025-06-30',
        gradingType: 'primary',
      }),
    });

    expect(res.status).toBe(201);
    const year = await res.json() as { id: string; label: string };
    expect(year.label).toBe('2024-2025');

    // Verify periods via the detail endpoint
    const detail = await fetch(`${appUrl}/v1/academic-years/${year.id}`, {
      headers: { 'X-Test-User': userHeader() },
    });
    const body = await detail.json() as { periods: { kind: string; label: string }[] };
    expect(body.periods).toHaveLength(6);
    expect(body.periods.filter((p) => p.kind === 'period')).toHaveLength(3);
    expect(body.periods.filter((p) => p.kind === 'exam')).toHaveLength(3);
    expect(body.periods[0]?.label).toBe('Trimestre 1');
    expect(body.periods[5]?.label).toBe('Examen T3');
  });

  it('creates a secondary academic year and seeds 6 periods (4 study + 2 exam)', async () => {
    const res = await fetch(`${appUrl}/v1/academic-years`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-User': userHeader(),
      },
      body: JSON.stringify({
        label: '2024-2025 Sec',
        startsOn: '2024-09-01',
        endsOn: '2025-06-30',
        gradingType: 'secondary',
      }),
    });

    expect(res.status).toBe(201);
    const year = await res.json() as { id: string };

    const detail = await fetch(`${appUrl}/v1/academic-years/${year.id}`, {
      headers: { 'X-Test-User': userHeader() },
    });
    const body = await detail.json() as { periods: { kind: string; label: string }[] };
    expect(body.periods).toHaveLength(6);
    expect(body.periods.filter((p) => p.kind === 'period')).toHaveLength(4);
    expect(body.periods.filter((p) => p.kind === 'exam')).toHaveLength(2);
    expect(body.periods[0]?.label).toBe('Période 1');
    expect(body.periods[5]?.label).toBe('Examen S2');
  });

  it('lists academic years for the school', async () => {
    const res = await fetch(`${appUrl}/v1/academic-years`, {
      headers: { 'X-Test-User': userHeader() },
    });
    expect(res.status).toBe(200);
    const years = await res.json() as unknown[];
    expect(years.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Class section and subject management', () => {
  let yearId: string;

  beforeAll(async () => {
    const res = await fetch(`${appUrl}/v1/academic-years`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': userHeader() },
      body: JSON.stringify({
        label: '2024-2025 Classes',
        startsOn: '2024-09-01',
        endsOn: '2025-06-30',
        gradingType: 'secondary',
      }),
    });
    const y = await res.json() as { id: string };
    yearId = y.id;
  });

  it('creates a class section and attaches subjects', async () => {
    const sectionRes = await fetch(`${appUrl}/v1/academic-years/${yearId}/class-sections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': userHeader() },
      body: JSON.stringify({ level: '4ème Secondaire', option: 'Scientifique', name: '4Sc A' }),
    });
    expect(sectionRes.status).toBe(201);
    const section = await sectionRes.json() as { id: string; name: string };
    expect(section.name).toBe('4Sc A');

    const subjectRes = await fetch(`${appUrl}/v1/class-sections/${section.id}/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': userHeader() },
      body: JSON.stringify({ name: 'Mathématiques', maxPeriod: 10, maxExam: 20 }),
    });
    expect(subjectRes.status).toBe(201);
    const sub = await subjectRes.json() as { name: string; maxPeriod: number };
    expect(sub.name).toBe('Mathématiques');
    expect(sub.maxPeriod).toBe(10);

    // List sections includes subjects
    const listRes = await fetch(`${appUrl}/v1/academic-years/${yearId}/class-sections`, {
      headers: { 'X-Test-User': userHeader() },
    });
    const sections = await listRes.json() as { id: string; subjects: unknown[] }[];
    const found = sections.find((s) => s.id === section.id);
    expect(found?.subjects).toHaveLength(1);
  });
});
