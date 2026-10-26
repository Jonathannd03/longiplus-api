import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { correctionRequest, mark, period, student, subject } from '../../db/schema.js';

interface CreateCorrectionDto {
  markId: string;
  reason: string;
  newScore: number;
}

@Injectable()
export class CorrectionService {
  async create(tx: TxDB, schoolId: string, dto: CreateCorrectionDto, requestedBy: string) {
    const [m] = await dbOwner
      .select({ id: mark.id, subjectId: mark.subjectId, periodId: mark.periodId, schoolId: mark.schoolId })
      .from(mark)
      .where(and(eq(mark.id, dto.markId), eq(mark.schoolId, schoolId)))
      .limit(1);
    if (!m) throw new NotFoundException('Mark not found');

    const [per] = await dbOwner
      .select({ status: period.status, kind: period.kind })
      .from(period)
      .where(eq(period.id, m.periodId))
      .limit(1);
    if (!per || per.status !== 'locked') {
      throw new BadRequestException('Corrections only allowed when period is locked');
    }

    const [sub] = await dbOwner
      .select({ maxPeriod: subject.maxPeriod, maxExam: subject.maxExam })
      .from(subject)
      .where(eq(subject.id, m.subjectId))
      .limit(1);
    if (!sub) throw new BadRequestException('Subject not found');

    const maxScore = per.kind === 'exam' ? (sub.maxExam ?? sub.maxPeriod) : sub.maxPeriod;
    if (dto.newScore < 0 || dto.newScore > maxScore) {
      throw new BadRequestException(`Score ${dto.newScore} exceeds maximum ${maxScore}`);
    }

    const [req] = await tx
      .insert(correctionRequest)
      .values({
        schoolId,
        markId: dto.markId,
        requestedBy,
        reason: dto.reason,
        newScore: dto.newScore,
        status: 'pending',
      })
      .returning();

    return req!;
  }

  async list(schoolId: string, filters: { status?: string; classSectionId?: string }) {
    const rows = await dbOwner
      .select({
        id: correctionRequest.id,
        markId: correctionRequest.markId,
        requestedBy: correctionRequest.requestedBy,
        reason: correctionRequest.reason,
        newScore: correctionRequest.newScore,
        status: correctionRequest.status,
        reviewedBy: correctionRequest.reviewedBy,
        reviewedAt: correctionRequest.reviewedAt,
        reviewNote: correctionRequest.reviewNote,
        createdAt: correctionRequest.createdAt,
        currentScore: mark.score,
        subjectName: subject.name,
        periodId: mark.periodId,
        periodLabel: period.label,
        studentLastName: student.lastName,
        studentFirstName: student.firstName,
      })
      .from(correctionRequest)
      .innerJoin(mark, eq(mark.id, correctionRequest.markId))
      .innerJoin(subject, eq(subject.id, mark.subjectId))
      .innerJoin(period, eq(period.id, mark.periodId))
      .innerJoin(student, eq(student.id, mark.studentId))
      .where(eq(correctionRequest.schoolId, schoolId));

    return rows.filter((r) => !filters.status || r.status === filters.status);
  }

  async approve(tx: TxDB, schoolId: string, id: string, reviewedBy: string) {
    const [req] = await dbOwner
      .select()
      .from(correctionRequest)
      .where(and(eq(correctionRequest.id, id), eq(correctionRequest.schoolId, schoolId)))
      .limit(1);
    if (!req) throw new NotFoundException('Correction request not found');
    if (req.status !== 'pending') throw new BadRequestException('Already reviewed');

    await tx
      .update(correctionRequest)
      .set({ status: 'approved', reviewedBy, reviewedAt: new Date() })
      .where(eq(correctionRequest.id, id));

    await tx
      .update(mark)
      .set({ score: req.newScore, recordedBy: reviewedBy, updatedAt: new Date() })
      .where(eq(mark.id, req.markId));

    return { id, status: 'approved' };
  }

  async reject(tx: TxDB, schoolId: string, id: string, reviewedBy: string, note: string) {
    const [req] = await dbOwner
      .select()
      .from(correctionRequest)
      .where(and(eq(correctionRequest.id, id), eq(correctionRequest.schoolId, schoolId)))
      .limit(1);
    if (!req) throw new NotFoundException('Correction request not found');
    if (req.status !== 'pending') throw new BadRequestException('Already reviewed');

    await tx
      .update(correctionRequest)
      .set({ status: 'rejected', reviewedBy, reviewedAt: new Date(), reviewNote: note })
      .where(eq(correctionRequest.id, id));

    return { id, status: 'rejected' };
  }
}
