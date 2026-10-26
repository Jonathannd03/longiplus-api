import { Injectable } from '@nestjs/common';
import { eq, and, count, sql } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import {
  enrollment,
  attendance,
  mark,
  correctionRequest,
  membership,
  classSection,
  subject,
  period,
  student,
  guardian,
  studentGuardian,
} from '../../db/schema.js';

@Injectable()
export class ReportingService {
  async dashboard(schoolId: string, yearId: string) {
    const today = new Date().toISOString().slice(0, 10);

    const [studentCount, presentToday, missingRollCount, pendingCorrections, pendingInvites] =
      await Promise.all([
        // total enrolled students
        dbOwner
          .select({ n: count() })
          .from(enrollment)
          .where(and(eq(enrollment.schoolId, schoolId), eq(enrollment.yearId, yearId), eq(enrollment.status, 'active')))
          .then((r) => r[0]?.n ?? 0),

        // present today (sum across all sections with roll done)
        dbOwner
          .select({ n: count() })
          .from(attendance)
          .where(
            and(
              eq(attendance.schoolId, schoolId),
              eq(attendance.date, today),
              eq(attendance.status, 'present'),
            ),
          )
          .then((r) => r[0]?.n ?? 0),

        // sections without any roll call today
        dbOwner
          .select({ id: classSection.id })
          .from(classSection)
          .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)))
          .then(async (sections) => {
            const doneSections = await dbOwner
              .selectDistinct({ s: attendance.classSectionId })
              .from(attendance)
              .where(and(eq(attendance.schoolId, schoolId), eq(attendance.date, today)));
            const doneIds = new Set(doneSections.map((r) => r.s));
            return sections.filter((s) => !doneIds.has(s.id)).length;
          }),

        // pending correction requests
        dbOwner
          .select({ n: count() })
          .from(correctionRequest)
          .where(and(eq(correctionRequest.schoolId, schoolId), eq(correctionRequest.status, 'pending')))
          .then((r) => r[0]?.n ?? 0),

        // pending invites (invited memberships)
        dbOwner
          .select({ n: count() })
          .from(membership)
          .where(and(eq(membership.schoolId, schoolId), eq(membership.status, 'invited')))
          .then((r) => r[0]?.n ?? 0),
      ]);

    // marks progress for active period
    const activePeriod = await dbOwner
      .select({ id: period.id, label: period.label, status: period.status })
      .from(period)
      .where(and(eq(period.schoolId, schoolId), eq(period.yearId, yearId)))
      .orderBy(period.sequence)
      .then((rows) => rows.find((p) => p.status === 'open') ?? rows[0] ?? null);

    let marksFilled = 0;
    let marksTotal = 0;

    if (activePeriod) {
      const subjects = await dbOwner
        .select({ id: subject.id })
        .from(subject)
        .innerJoin(classSection, eq(classSection.id, subject.classSectionId))
        .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)));

      const enrolled = await dbOwner
        .select({ n: count() })
        .from(enrollment)
        .where(and(eq(enrollment.schoolId, schoolId), eq(enrollment.yearId, yearId), eq(enrollment.status, 'active')))
        .then((r) => Number(r[0]?.n ?? 0));

      marksTotal = subjects.length * enrolled;

      if (marksTotal > 0) {
        const filled = await dbOwner
          .select({ n: count() })
          .from(mark)
          .where(
            and(
              eq(mark.schoolId, schoolId),
              eq(mark.periodId, activePeriod.id),
              sql`${mark.score} IS NOT NULL`,
            ),
          )
          .then((r) => Number(r[0]?.n ?? 0));
        marksFilled = filled;
      }
    }

    const marksPercent = marksTotal > 0 ? Math.round((marksFilled / marksTotal) * 100) : 0;

    return {
      studentCount: Number(studentCount),
      presentToday: Number(presentToday),
      missingRollCount,
      pendingCorrections: Number(pendingCorrections),
      pendingInvites: Number(pendingInvites),
      activePeriod,
      marksPercent,
      marksFilled,
      marksTotal,
    };
  }

  async studentsCSV(schoolId: string, yearId: string): Promise<string> {
    const rows = await dbOwner
      .select({
        code: student.studentCode,
        lastName: student.lastName,
        postName: student.postName,
        firstName: student.firstName,
        sex: student.sex,
        birthDate: student.birthDate,
        className: classSection.name,
        guardianPhone: guardian.phoneE164,
      })
      .from(enrollment)
      .innerJoin(student, eq(student.id, enrollment.studentId))
      .innerJoin(classSection, eq(classSection.id, enrollment.classSectionId))
      .leftJoin(studentGuardian, eq(studentGuardian.studentId, student.id))
      .leftJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
      .where(and(eq(enrollment.schoolId, schoolId), eq(enrollment.yearId, yearId), eq(enrollment.status, 'active')))
      .orderBy(classSection.name, student.lastName);

    const header = 'Code,Nom,Post-nom,Prénom,Sexe,Date naissance,Classe,Téléphone tuteur';
    const lines = rows.map((r) =>
      [
        r.code,
        csvEscape(r.lastName),
        csvEscape(r.postName),
        csvEscape(r.firstName),
        r.sex,
        r.birthDate,
        csvEscape(r.className),
        r.guardianPhone ?? '',
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  async attendanceCSV(schoolId: string, yearId: string): Promise<string> {
    const rows = await dbOwner
      .select({
        date: attendance.date,
        status: attendance.status,
        lastName: student.lastName,
        firstName: student.firstName,
        code: student.studentCode,
        className: classSection.name,
      })
      .from(attendance)
      .innerJoin(student, eq(student.id, attendance.studentId))
      .innerJoin(classSection, eq(classSection.id, attendance.classSectionId))
      .where(and(eq(attendance.schoolId, schoolId), eq(classSection.yearId, yearId)))
      .orderBy(attendance.date, classSection.name, student.lastName);

    const header = 'Date,Code,Nom,Prénom,Classe,Statut';
    const lines = rows.map((r) =>
      [r.date, r.code, csvEscape(r.lastName), csvEscape(r.firstName), csvEscape(r.className), r.status].join(','),
    );
    return [header, ...lines].join('\n');
  }

  async marksCSV(schoolId: string, periodId: string): Promise<string> {
    const rows = await dbOwner
      .select({
        code: student.studentCode,
        lastName: student.lastName,
        firstName: student.firstName,
        className: classSection.name,
        subjectName: subject.name,
        score: mark.score,
      })
      .from(mark)
      .innerJoin(student, eq(student.id, mark.studentId))
      .innerJoin(subject, eq(subject.id, mark.subjectId))
      .innerJoin(classSection, eq(classSection.id, subject.classSectionId))
      .where(and(eq(mark.schoolId, schoolId), eq(mark.periodId, periodId)))
      .orderBy(classSection.name, student.lastName, subject.name);

    const header = 'Code,Nom,Prénom,Classe,Matière,Note';
    const lines = rows.map((r) =>
      [r.code, csvEscape(r.lastName), csvEscape(r.firstName), csvEscape(r.className), csvEscape(r.subjectName), r.score ?? ''].join(','),
    );
    return [header, ...lines].join('\n');
  }
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
