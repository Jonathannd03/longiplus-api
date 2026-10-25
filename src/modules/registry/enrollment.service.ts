import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { TxDB } from '../../db/client.js';
import { enrollment } from '../../db/schema.js';

@Injectable()
export class EnrollmentService {
  async create(tx: TxDB, schoolId: string, studentId: string, classSectionId: string, yearId: string) {
    const [row] = await tx.insert(enrollment).values({
      schoolId,
      studentId,
      classSectionId,
      yearId,
      status: 'active',
    }).returning();
    return row!;
  }

  async findActiveByStudent(tx: TxDB, studentId: string) {
    return tx
      .select()
      .from(enrollment)
      .where(and(eq(enrollment.studentId, studentId), eq(enrollment.status, 'active')));
  }
}
