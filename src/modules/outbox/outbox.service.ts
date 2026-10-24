import { Injectable } from '@nestjs/common';
import { outbox } from '../../db/schema.js';
import type { TxDB } from '../../db/client.js';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class OutboxService {
  async write(
    tx: TxDB,
    event: { topic: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await tx.insert(outbox).values({
      id: uuidv7(),
      topic: event.topic,
      payload: event.payload,
    });
  }
}
