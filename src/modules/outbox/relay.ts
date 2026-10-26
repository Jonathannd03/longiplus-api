import { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, isNull, inArray } from 'drizzle-orm';
import { outbox } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';

// One Queue instance per topic — avoids opening/closing a Redis connection per outbox row
const queueCache = new Map<string, Queue>();

function getQueue(topic: string, redisUrl: string): Queue {
  let q = queueCache.get(topic);
  if (!q) {
    q = new Queue(topic, { connection: { url: redisUrl } });
    queueCache.set(topic, q);
  }
  return q;
}

export async function relayOutbox(
  db: PostgresJsDatabase<typeof schema>,
  redisUrl: string,
): Promise<number> {
  let relayed = 0;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(isNull(outbox.sentAt))
      .orderBy(outbox.createdAt)
      .limit(100)
      .for('update', { skipLocked: true });

    if (rows.length === 0) return;
    relayed = rows.length;

    for (const row of rows) {
      const queue = getQueue(row.topic, redisUrl);
      await queue.add(row.topic, row.payload, { jobId: row.id });
    }

    const ids = rows.map((r) => r.id);
    await tx
      .update(outbox)
      .set({ sentAt: sql`now()` })
      .where(inArray(outbox.id, ids));
  });
  return relayed;
}
