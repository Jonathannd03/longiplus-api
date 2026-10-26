import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

// vi.hoisted ensures these exist before vi.mock factories run
const { mockAdd, mockClose, MockQueue } = vi.hoisted(() => {
  const mockAdd = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const MockQueue = vi.fn().mockImplementation(() => ({ add: mockAdd, close: mockClose }));
  return { mockAdd, mockClose, MockQueue };
});

vi.mock('bullmq', () => ({ Queue: MockQueue }));

import { Queue } from 'bullmq';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import { relayOutbox } from '../../src/modules/outbox/relay.js';
import { uuidv7 } from 'uuidv7';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pgContainer: StartedPostgreSqlContainer;
let ownerSql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('longiplus_test')
    .withUsername('longiplus')
    .withPassword('longiplus')
    .start();

  ownerSql = postgres(pgContainer.getConnectionUri());
  db = drizzle(ownerSql, { schema });

  const ddl = await readFile(
    resolve(__dirname, '../../drizzle/0000_confused_senator_kelly.sql'),
    'utf8',
  );
  for (const stmt of ddl.split('--> statement-breakpoint')) {
    const s = stmt.trim();
    if (s) await ownerSql.unsafe(s);
  }
  const rls = await readFile(
    resolve(__dirname, '../../drizzle/0001_m1_roles_rls.sql'),
    'utf8',
  );
  await ownerSql.unsafe(rls);
}, 60_000);

afterAll(async () => {
  await ownerSql?.end();
  await pgContainer?.stop();
});

describe('relayOutbox', () => {
  it('does nothing when outbox is empty', async () => {
    vi.clearAllMocks();
    const relayed = await relayOutbox(db as Parameters<typeof relayOutbox>[0], 'redis://stub');
    expect(relayed).toBe(0);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('relays pending rows, calls Queue.add, and marks sent_at', async () => {
    vi.clearAllMocks();

    const rowId = uuidv7();
    await ownerSql`
      INSERT INTO outbox (id, topic, payload)
      VALUES (${rowId}, 'fee.invoice.created', ${JSON.stringify({ studentId: 'stu-1', amount: 5000 })}::jsonb)
    `;

    const relayed = await relayOutbox(db as Parameters<typeof relayOutbox>[0], 'redis://stub');

    expect(relayed).toBe(1);
    expect(Queue).toHaveBeenCalledWith('fee.invoice.created', { connection: { url: 'redis://stub' } });
    expect(mockAdd).toHaveBeenCalledWith(
      'fee.invoice.created',
      { studentId: 'stu-1', amount: 5000 },
      { jobId: rowId },
    );

    const rows = await ownerSql`SELECT sent_at FROM outbox WHERE id = ${rowId}`;
    expect(rows[0]?.['sent_at']).not.toBeNull();
  });

  it('does not re-relay already-sent rows', async () => {
    vi.clearAllMocks();
    const relayed = await relayOutbox(db as Parameters<typeof relayOutbox>[0], 'redis://stub');
    expect(relayed).toBe(0);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('relays multiple rows in one pass', async () => {
    vi.clearAllMocks();

    await ownerSql`
      INSERT INTO outbox (id, topic, payload) VALUES
        (${uuidv7()}, 'topic.a', ${JSON.stringify({ n: 1 })}::jsonb),
        (${uuidv7()}, 'topic.b', ${JSON.stringify({ n: 2 })}::jsonb),
        (${uuidv7()}, 'topic.c', ${JSON.stringify({ n: 3 })}::jsonb)
    `;

    const relayed = await relayOutbox(db as Parameters<typeof relayOutbox>[0], 'redis://stub');
    expect(relayed).toBe(3);
    expect(mockAdd).toHaveBeenCalledTimes(3);
  });
});
