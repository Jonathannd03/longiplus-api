import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { payoutAccount } from '../../db/schema.js';
import { uuidv7 } from 'uuidv7';

interface CreatePayoutAccountDto {
  kind: 'mobile_money' | 'bank';
  operator?: string;
  numberMasked: string;
}

@Injectable()
export class PayoutAccountService {
  async create(tx: TxDB, schoolId: string, dto: CreatePayoutAccountDto) {
    const [row] = await tx
      .insert(payoutAccount)
      .values({
        id: uuidv7(),
        schoolId,
        kind: dto.kind,
        operator: dto.operator,
        numberMasked: dto.numberMasked,
        status: 'pending',
      })
      .returning();
    return row!;
  }

  async approve(tx: TxDB, id: string, approvedBy: string) {
    const now = new Date();
    const activatesAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [row] = await tx
      .update(payoutAccount)
      .set({ approvedBy, approvedAt: now, activatesAt, status: 'pending' })
      .where(eq(payoutAccount.id, id))
      .returning();

    if (!row) throw new NotFoundException('Payout account not found');
    return row;
  }

  async findBySchool(schoolId: string) {
    return dbOwner
      .select()
      .from(payoutAccount)
      .where(eq(payoutAccount.schoolId, schoolId));
  }
}
