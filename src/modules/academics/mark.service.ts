import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { mark, subject, period, student, enrollment } from '../../db/schema.js';

interface MarkRecord {
  studentId: string;
  score: number | null;
}

@Injectable()
export class MarkService {
  async batchUpsert(
    tx: TxDB,
    schoolId: string,
    subjectId: string,
    periodId: string,
    records: MarkRecord[],
    recordedBy: string,
  ) {
    const [sub] = await dbOwner
      .select({ maxPeriod: subject.maxPeriod, maxExam: subject.maxExam })
      .from(subject)
      .where(and(eq(subject.id, subjectId), eq(subject.schoolId, schoolId)))
      .limit(1);
    if (!sub) throw new BadRequestException('Subject not found');

    const [per] = await dbOwner
      .select({ kind: period.kind, status: period.status })
      .from(period)
      .where(and(eq(period.id, periodId), eq(period.schoolId, schoolId)))
      .limit(1);
    if (!per) throw new BadRequestException('Period not found');
    if (per.status === 'locked') throw new ForbiddenException('Period is locked. Use a correction request.');

    const maxScore = per.kind === 'exam' ? (sub.maxExam ?? sub.maxPeriod) : sub.maxPeriod;

    for (const r of records) {
      if (r.score !== null && r.score !== undefined && (r.score < 0 || r.score > maxScore)) {
        throw new BadRequestException(`Score ${r.score} exceeds maximum ${maxScore}`);
      }
    }

    if (records.length === 0) return [];

    const now = new Date();
    return tx
      .insert(mark)
      .values(
        records.map((r) => ({
          schoolId,
          studentId: r.studentId,
          subjectId,
          periodId,
          score: r.score ?? null,
          recordedBy,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [mark.studentId, mark.subjectId, mark.periodId],
        set: {
          score: sql`EXCLUDED.score`,
          recordedBy: sql`EXCLUDED.recorded_by`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
  }

  async listBySubjectAndPeriod(schoolId: string, subjectId: string, periodId: string) {
    const [sub] = await dbOwner
      .select()
      .from(subject)
      .where(and(eq(subject.id, subjectId), eq(subject.schoolId, schoolId)))
      .limit(1);
    if (!sub) return null;

    const [per] = await dbOwner
      .select()
      .from(period)
      .where(and(eq(period.id, periodId), eq(period.schoolId, schoolId)))
      .limit(1);
    if (!per) return null;

    const maxScore = per.kind === 'exam' ? (sub.maxExam ?? sub.maxPeriod) : sub.maxPeriod;

    const marks = await dbOwner
      .select({
        studentId: mark.studentId,
        score: mark.score,
        updatedAt: mark.updatedAt,
      })
      .from(mark)
      .where(and(eq(mark.subjectId, subjectId), eq(mark.periodId, periodId), eq(mark.schoolId, schoolId)));

    return { subject: sub, period: per, maxScore, marks };
  }

  async computeResults(schoolId: string, classSectionId: string, periodId: string) {
    const [per] = await dbOwner
      .select()
      .from(period)
      .where(and(eq(period.id, periodId), eq(period.schoolId, schoolId)))
      .limit(1);
    if (!per) return null;

    const subjects = await dbOwner
      .select()
      .from(subject)
      .where(and(eq(subject.classSectionId, classSectionId), eq(subject.schoolId, schoolId)));

    const subjectIds = subjects.map((s) => s.id);
    if (subjectIds.length === 0) return { period: per, rows: [] };

    const enrolledStudents = await dbOwner
      .select({ id: student.id, lastName: student.lastName, postName: student.postName, firstName: student.firstName })
      .from(student)
      .innerJoin(enrollment, eq(enrollment.studentId, student.id))
      .where(
        and(
          eq(enrollment.classSectionId, classSectionId),
          eq(enrollment.schoolId, schoolId),
          eq(enrollment.status, 'active'),
        ),
      );

    const marks = await dbOwner
      .select()
      .from(mark)
      .where(
        and(
          eq(mark.periodId, periodId),
          eq(mark.schoolId, schoolId),
          inArray(mark.subjectId, subjectIds),
        ),
      );

    const maxPerSubject = Object.fromEntries(
      subjects.map((s) => [s.id, per.kind === 'exam' ? (s.maxExam ?? s.maxPeriod) : s.maxPeriod]),
    );
    const totalMax = Object.values(maxPerSubject).reduce((a, b) => a + b, 0);

    // Build mark map: studentId → subjectId → score
    const markMap = new Map<string, Map<string, number | null>>();
    for (const m of marks) {
      if (!markMap.has(m.studentId)) markMap.set(m.studentId, new Map());
      markMap.get(m.studentId)!.set(m.subjectId, m.score);
    }

    const rows = enrolledStudents.map((stu) => {
      const stuMarks = markMap.get(stu.id) ?? new Map();
      const subjectScores = subjects.map((s) => ({
        subjectId: s.id,
        subjectName: s.name,
        max: maxPerSubject[s.id]!,
        score: stuMarks.get(s.id) ?? null,
      }));
      const total = subjectScores.reduce((sum, s) => sum + (s.score ?? 0), 0);
      const missing = subjectScores.some((s) => s.score === null || s.score === undefined);
      const pct = totalMax > 0 ? Math.round((total / totalMax) * 100 * 10) / 10 : 0;
      return { student: stu, subjectScores, total, totalMax, pct, missing };
    });

    // Rank — ties share a rank, missing marks excluded from ranking
    const ranked = [...rows].sort((a, b) => b.total - a.total);
    let rank = 1;
    for (let i = 0; i < ranked.length; i++) {
      if (i > 0 && ranked[i]!.total !== ranked[i - 1]!.total) rank = i + 1;
      (ranked[i] as typeof ranked[number] & { rank: number | null }).rank = ranked[i]!.missing ? null : rank;
    }

    return { period: per, subjects, totalMax, rows: ranked };
  }

  async listByStudent(schoolId: string, studentId: string, yearId: string) {
    const periods = await dbOwner
      .select()
      .from(period)
      .where(and(eq(period.yearId, yearId), eq(period.schoolId, schoolId)));

    const periodIds = periods.map((p) => p.id);
    if (periodIds.length === 0) return [];

    const marks = await dbOwner
      .select({
        markId: mark.id,
        score: mark.score,
        updatedAt: mark.updatedAt,
        subjectId: mark.subjectId,
        periodId: mark.periodId,
        subjectName: subject.name,
        maxPeriod: subject.maxPeriod,
        maxExam: subject.maxExam,
        periodLabel: period.label,
        periodKind: period.kind,
        periodSeq: period.sequence,
      })
      .from(mark)
      .innerJoin(subject, eq(subject.id, mark.subjectId))
      .innerJoin(period, eq(period.id, mark.periodId))
      .where(
        and(
          eq(mark.studentId, studentId),
          eq(mark.schoolId, schoolId),
          inArray(mark.periodId, periodIds),
        ),
      )
      .orderBy(period.sequence, subject.name);

    return marks;
  }

  async findById(schoolId: string, markId: string) {
    const [m] = await dbOwner
      .select()
      .from(mark)
      .where(and(eq(mark.id, markId), eq(mark.schoolId, schoolId)))
      .limit(1);
    return m ?? null;
  }

  async applyCorrection(tx: TxDB, markId: string, newScore: number, reviewedBy: string) {
    await tx
      .update(mark)
      .set({ score: newScore, recordedBy: reviewedBy, updatedAt: new Date() })
      .where(eq(mark.id, markId));
  }
}
