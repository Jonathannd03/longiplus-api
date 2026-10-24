import { Injectable } from '@nestjs/common';
import { auditEvent } from '../../db/schema.js';
import type { TxDB } from '../../db/client.js';
import { uuidv7 } from 'uuidv7';

interface AuditEventInput {
  schoolId?: string;
  actor: string;
  action: string;
  entity: string;
  entityId?: string;
  after?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async writeEvent(tx: TxDB, event: AuditEventInput): Promise<void> {
    await tx.insert(auditEvent).values({
      id: uuidv7(),
      schoolId: event.schoolId,
      actor: event.actor,
      action: event.action,
      entity: event.entity,
      entityId: event.entityId,
      after: event.after,
    });
  }
}
