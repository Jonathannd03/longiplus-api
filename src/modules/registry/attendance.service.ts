import { Injectable } from '@nestjs/common';
import { eq, and, count, sql, inArray } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { attendance, classSection, enrollment } from '../../db/schema.js';

export interface AttendanceRecord {
  studentId: string;
  status: 'present' | 'absent' | 'late' | 'excused';
}

@Injectable()
export class AttendanceService {
  async recordBatch(
    tx: TxDB,
    schoolId: string,
    classSectionId: string,
    date: string,
    records: AttendanceRecord[],
    recordedBy: string,
  ) {
    if (records.length === 0) return 0;
    const values = records.map((r) => ({
      schoolId,
      studentId: r.studentId,
      classSectionId,
      date,
      status: r.status,
      recordedBy,
    }));
    await tx
      .insert(attendance)
      .values(values)
      .onConflictDoUpdate({
        target: [attendance.studentId, attendance.classSectionId, attendance.date],
        set: { status: sql`EXCLUDED.status`, recordedBy: sql`EXCLUDED.recorded_by` },
      });
    return records.length;
  }

  async listByStudent(schoolId: string, studentId: string) {
    return dbOwner
      .select({
        id: attendance.id,
        classSectionId: attendance.classSectionId,
        date: attendance.date,
        status: attendance.status,
        recordedBy: attendance.recordedBy,
        createdAt: attendance.createdAt,
      })
      .from(attendance)
      .where(and(eq(attendance.schoolId, schoolId), eq(attendance.studentId, studentId)))
      .orderBy(sql`${attendance.date} DESC`)
      .limit(200);
  }

  async getStats(schoolId: string, studentId: string) {
    const rows = await dbOwner
      .select({ status: attendance.status, cnt: count() })
      .from(attendance)
      .where(and(eq(attendance.schoolId, schoolId), eq(attendance.studentId, studentId)))
      .groupBy(attendance.status);

    const stats = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
    for (const r of rows) {
      const n = Number(r.cnt);
      stats[r.status] = n;
      stats.total += n;
    }
    return {
      ...stats,
      presenceRate: stats.total > 0 ? (stats.present + stats.late) / stats.total : null,
    };
  }

  async listBySection(schoolId: string, classSectionId: string, date: string) {
    return dbOwner
      .select({
        studentId: attendance.studentId,
        status: attendance.status,
      })
      .from(attendance)
      .where(
        and(
          eq(attendance.schoolId, schoolId),
          eq(attendance.classSectionId, classSectionId),
          eq(attendance.date, date),
        ),
      );
  }

  async dailyStatus(schoolId: string, yearId: string, date: string) {
    const sections = await dbOwner
      .select({ id: classSection.id, name: classSection.name, level: classSection.level })
      .from(classSection)
      .where(and(eq(classSection.schoolId, schoolId), eq(classSection.yearId, yearId)));

    if (sections.length === 0) return [];

    const sectionIds = sections.map((s) => s.id);

    // Get roll call counts per section for the given date
    const rolls = await dbOwner
      .select({
        classSectionId: attendance.classSectionId,
        total: count(),
        present: count(sql`CASE WHEN ${attendance.status} = 'present' THEN 1 END`),
        absent: count(sql`CASE WHEN ${attendance.status} = 'absent' THEN 1 END`),
        late: count(sql`CASE WHEN ${attendance.status} = 'late' THEN 1 END`),
      })
      .from(attendance)
      .where(
        and(
          eq(attendance.schoolId, schoolId),
          eq(attendance.date, date),
          inArray(attendance.classSectionId, sectionIds),
        ),
      )
      .groupBy(attendance.classSectionId);

    const rollMap = new Map(rolls.map((r) => [r.classSectionId, r]));

    return sections.map((s) => {
      const roll = rollMap.get(s.id);
      return {
        classSectionId: s.id,
        name: s.name,
        level: s.level,
        rollDone: !!roll,
        present: roll ? Number(roll.present) : 0,
        absent: roll ? Number(roll.absent) : 0,
        late: roll ? Number(roll.late) : 0,
        total: roll ? Number(roll.total) : 0,
      };
    });
  }
}
