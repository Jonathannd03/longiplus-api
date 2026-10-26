import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import type { INestApplication } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { FakeJwtGuard } from '../helpers/fake-jwt.guard.js';
import { validateCode } from '../../src/modules/registry/luhn.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const SCHOOL_ID = '01960000-0000-7000-8000-000000000088';
const YEAR_ID   = '01960000-0000-7000-8000-000000000077';
const SECTION_ID = '01960000-0000-7000-8000-000000000066';
const OWNER_ID  = 'test-kc-owner-m3';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let app: INestApplication;
let appUrl: string;

function ownerHeader() {
  return JSON.stringify({ keycloakUserId: OWNER_ID, email: 'owner@m3.cd', role: 'owner', schoolId: SCHOOL_ID });
}

function buildExcel(rows: Record<string, string>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Élèves');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
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
    '0004_m3_registry.sql',
    '0005_m3_rls.sql',
    '0006_m3b_attendance.sql',
    '0007_m3b_rls.sql',
    '0008_m7_marks.sql',
    '0009_m7_marks_rls.sql',
    '0010_m8_schema.sql',
    '0011_m8_rls.sql',
  ]) {
    const sql = await readFile(resolve(__dirname, `../../drizzle/${file}`), 'utf8');
    if (file.endsWith('_rls.sql') || file.endsWith('_grants.sql') || file.endsWith('_rls_grants.sql')) {
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
    VALUES (${SCHOOL_ID}, 'École M3', 'Kinshasa', 'Gombe', false)
  `;
  await ownerSql`
    INSERT INTO membership (id, school_id, keycloak_user_id, email, role, status)
    VALUES (gen_random_uuid(), ${SCHOOL_ID}, ${OWNER_ID}, 'owner@m3.cd', 'owner', 'active')
  `;
  await ownerSql`
    INSERT INTO academic_year (id, school_id, label, starts_on, ends_on, grading_type, status)
    VALUES (${YEAR_ID}, ${SCHOOL_ID}, '2026-2027', '2026-09-01', '2027-07-01', 'secondary', 'active')
  `;
  await ownerSql`
    INSERT INTO class_section (id, school_id, year_id, level, name)
    VALUES (${SECTION_ID}, ${SCHOOL_ID}, ${YEAR_ID}, '4ème secondaire', '4S A')
  `;
  await ownerSql.end();

  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication(new FastifyAdapter({ logger: false }));
  await app.register(multipart as unknown as Parameters<typeof app.register>[0], { limits: { fileSize: 5 * 1024 * 1024 } });
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

describe('Student enrollment', () => {
  it('enrolls a student and returns a valid 9-digit Luhn code', async () => {
    const res = await fetch(`${appUrl}/v1/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': ownerHeader() },
      body: JSON.stringify({
        lastName: 'KABONGO',
        postName: 'Mwamba',
        firstName: 'Grace',
        sex: 'F',
        birthDate: '2010-03-15',
        birthPlace: 'Kinshasa',
        classSectionId: SECTION_ID,
        yearId: YEAR_ID,
        guardianPhone: '+243810001111',
        guardianName: 'KABONGO Jean',
      }),
    });
    expect(res.status).toBe(201);
    const student = await res.json() as { studentCode: string; duplicate: null };
    expect(student.studentCode).toHaveLength(9);
    expect(validateCode(student.studentCode)).toBe(true);
    expect(student.duplicate).toBeNull();
  });

  it('warns duplicate on same name + birthdate', async () => {
    // Enroll same student again
    const res = await fetch(`${appUrl}/v1/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': ownerHeader() },
      body: JSON.stringify({
        lastName: 'KABONGO',
        postName: 'Mwamba',
        firstName: 'Grace',
        sex: 'F',
        birthDate: '2010-03-15',
        birthPlace: 'Kinshasa',
        classSectionId: SECTION_ID,
        yearId: YEAR_ID,
      }),
    });
    expect(res.status).toBe(201);
    const student = await res.json() as { duplicate: { studentCode: string } | null };
    expect(student.duplicate).not.toBeNull();
    expect(student.duplicate?.studentCode).toHaveLength(9);
  });

  it('lists students for the school', async () => {
    const res = await fetch(`${appUrl}/v1/students`, {
      headers: { 'X-Test-User': ownerHeader() },
    });
    expect(res.status).toBe(200);
    const list = await res.json() as unknown[];
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Excel import', () => {
  let batchId: string;

  it('preview returns parsed rows with stats', async () => {
    const rows = [
      { 'Nom': 'TSHIMANGA', 'Post-nom': 'Bukasa', 'Prénom': 'Jonas', 'Sexe': 'M',
        'Date de naissance': '2009-06-10', 'Lieu de naissance': 'Lubumbashi',
        'Téléphone tuteur': '+243820002222', 'Classe': '4S A' },
      { 'Nom': 'NGOY', 'Post-nom': 'Kalala', 'Prénom': 'Marie', 'Sexe': 'F',
        'Date de naissance': '2010-01-20', 'Lieu de naissance': 'Kinshasa',
        'Téléphone tuteur': '+243830003333', 'Classe': '4S A' },
      { 'Nom': '', 'Post-nom': '', 'Prénom': '', 'Sexe': 'X',
        'Date de naissance': 'invalid', 'Lieu de naissance': '',
        'Téléphone tuteur': '', 'Classe': 'INEXISTANTE' },
    ];
    const fileBuffer = buildExcel(rows);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');

    const res = await fetch(`${appUrl}/v1/students/import/preview?yearId=${YEAR_ID}`, {
      method: 'POST',
      headers: { 'X-Test-User': ownerHeader() },
      body: form,
    });
    expect(res.status).toBe(201);
    const preview = await res.json() as { rows: unknown[]; stats: { ok: number; errors: number } };
    expect(preview.rows).toHaveLength(3);
    expect(preview.stats.ok).toBe(2);
    expect(preview.stats.errors).toBe(1);
  });

  it('commit imports valid rows, returns batchId', async () => {
    const rows = [
      { 'Nom': 'MUTOMBO', 'Post-nom': 'Dikembe', 'Prénom': 'Paul', 'Sexe': 'M',
        'Date de naissance': '2009-03-05', 'Lieu de naissance': 'Mbuji-Mayi',
        'Téléphone tuteur': '+243840004444', 'Classe': '4S A' },
      { 'Nom': 'KASONGO', 'Post-nom': 'Lunda', 'Prénom': 'Claire', 'Sexe': 'F',
        'Date de naissance': '2010-08-12', 'Lieu de naissance': 'Goma',
        'Téléphone tuteur': '+243850005555', 'Classe': '4S A' },
    ];
    const fileBuffer = buildExcel(rows);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'import.xlsx');

    const res = await fetch(`${appUrl}/v1/students/import/commit?yearId=${YEAR_ID}`, {
      method: 'POST',
      headers: { 'X-Test-User': ownerHeader() },
      body: form,
    });
    expect(res.status).toBe(201);
    const result = await res.json() as { batchId: string; inserted: number };
    expect(result.batchId).toBeTruthy();
    expect(result.inserted).toBe(2);
    batchId = result.batchId;
  });

  it('all imported student codes are valid Luhn codes', async () => {
    const res = await fetch(`${appUrl}/v1/students`, {
      headers: { 'X-Test-User': ownerHeader() },
    });
    const list = await res.json() as { studentCode: string }[];
    for (const s of list) {
      expect(validateCode(s.studentCode), `Code ${s.studentCode} should be valid`).toBe(true);
    }
  });

  it('undo deletes all students from the batch', async () => {
    const countBefore = await (await fetch(`${appUrl}/v1/students`, {
      headers: { 'X-Test-User': ownerHeader() },
    })).json() as unknown[];

    const res = await fetch(`${appUrl}/v1/students/import/${batchId}`, {
      method: 'DELETE',
      headers: { 'X-Test-User': ownerHeader() },
    });
    expect(res.status).toBe(200);
    const result = await res.json() as { deleted: number };
    expect(result.deleted).toBe(2);

    const countAfter = await (await fetch(`${appUrl}/v1/students`, {
      headers: { 'X-Test-User': ownerHeader() },
    })).json() as unknown[];
    expect((countAfter as unknown[]).length).toBe((countBefore as unknown[]).length - 2);
  });
});
