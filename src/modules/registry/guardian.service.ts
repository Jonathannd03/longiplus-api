import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { TxDB } from '../../db/client.js';
import { guardian, studentGuardian } from '../../db/schema.js';

export interface CreateGuardianDto {
  fullName: string;
  phoneE164: string;
  relationship?: string;
}

@Injectable()
export class GuardianService {
  async createAndLink(tx: TxDB, schoolId: string, studentId: string, dto: CreateGuardianDto) {
    const [row] = await tx.insert(guardian).values({
      schoolId,
      fullName: dto.fullName,
      phoneE164: dto.phoneE164,
      relationship: dto.relationship ?? 'guardian',
    }).returning();
    await tx.insert(studentGuardian).values({ studentId, guardianId: row!.id });
    return row!;
  }

  async findByStudent(tx: TxDB, studentId: string) {
    return tx
      .select({ id: guardian.id, fullName: guardian.fullName, phoneE164: guardian.phoneE164, relationship: guardian.relationship })
      .from(guardian)
      .innerJoin(studentGuardian, and(
        eq(studentGuardian.guardianId, guardian.id),
        eq(studentGuardian.studentId, studentId),
      ));
  }
}
