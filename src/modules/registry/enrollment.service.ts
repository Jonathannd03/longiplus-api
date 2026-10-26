import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { enrollment } from '../../db/schema.js';

export interface ReenrollDecision {
  studentId: string;
  toSectionId: string | null;
}

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

  async findActiveForStudentInSchool(schoolId: string, studentId: string) {
    const [row] = await dbOwner
      .select()
      .from(enrollment)
      .where(
        and(
          eq(enrollment.studentId, studentId),
          eq(enrollment.schoolId, schoolId),
          eq(enrollment.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async withdraw(tx: TxDB, schoolId: string, studentId: string, reason: string) {
    const [row] = await dbOwner
      .select()
      .from(enrollment)
      .where(
        and(
          eq(enrollment.studentId, studentId),
          eq(enrollment.schoolId, schoolId),
          eq(enrollment.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('No active enrollment found for this student');
    if (!reason.trim()) throw new BadRequestException('Withdrawal reason is required');

    const [updated] = await tx
      .update(enrollment)
      .set({ status: 'withdrawn', withdrawalReason: reason.trim(), withdrawnAt: new Date() })
      .where(eq(enrollment.id, row.id))
      .returning();
    return updated!;
  }

  async reenroll(
    tx: TxDB,
    schoolId: string,
    toYearId: string,
    decisions: ReenrollDecision[],
  ) {
    const admitted = decisions.filter((d) => d.toSectionId !== null);
    const withdrawn = decisions.filter((d) => d.toSectionId === null);

    let reEnrolled = 0;
    if (admitted.length > 0) {
      const rows = admitted.map((d) => ({
        schoolId,
        studentId: d.studentId,
        classSectionId: d.toSectionId!,
        yearId: toYearId,
        status: 'active' as const,
      }));
      await tx.insert(enrollment).values(rows).onConflictDoNothing();
      reEnrolled = admitted.length;
    }

    if (withdrawn.length > 0) {
      await tx
        .update(enrollment)
        .set({ status: 'withdrawn' })
        .where(
          and(
            eq(enrollment.schoolId, schoolId),
            eq(enrollment.yearId, toYearId),
            inArray(enrollment.studentId, withdrawn.map((d) => d.studentId)),
          ),
        );
    }

    return { reEnrolled, withdrawn: withdrawn.length };
  }
}
