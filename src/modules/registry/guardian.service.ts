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

  async findByPhone(tx: TxDB, schoolId: string, phone: string) {
    const [row] = await tx
      .select()
      .from(guardian)
      .where(and(eq(guardian.schoolId, schoolId), eq(guardian.phoneE164, phone)))
      .limit(1);
    return row ?? null;
  }

  async linkOrCreate(
    tx: TxDB,
    schoolId: string,
    studentId: string,
    dto: { phoneE164: string; fullName?: string; relationship?: string },
  ) {
    const existing = await this.findByPhone(tx, schoolId, dto.phoneE164);
    let g = existing;
    if (!g) {
      const [created] = await tx.insert(guardian).values({
        schoolId,
        fullName: dto.fullName ?? 'Parent',
        phoneE164: dto.phoneE164,
        relationship: dto.relationship ?? 'guardian',
      }).returning();
      g = created!;
    }
    await tx
      .insert(studentGuardian)
      .values({ studentId, guardianId: g.id })
      .onConflictDoNothing();
    return g;
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
