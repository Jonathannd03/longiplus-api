import { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, isNull, inArray } from 'drizzle-orm';
import { outbox } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';

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
      const queue = new Queue(row.topic, { connection: { url: redisUrl } });
      await queue.add(row.topic, row.payload, { jobId: row.id });
      await queue.close();
    }

    const ids = rows.map((r) => r.id);
    await tx
      .update(outbox)
      .set({ sentAt: sql`now()` })
      .where(inArray(outbox.id, ids));
  });
  return relayed;
}
