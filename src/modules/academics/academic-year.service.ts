import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { academicYear, period } from '../../db/schema.js';
import { uuidv7 } from 'uuidv7';

interface CreateAcademicYearDto {
  label: string;
  startsOn: string;
  endsOn: string;
  gradingType: 'primary' | 'secondary';
}

interface PeriodSeed {
  kind: 'period' | 'exam';
  sequence: number;
  semesterOrTrimester: number;
  label: string;
}

function seedPeriods(gradingType: 'primary' | 'secondary'): PeriodSeed[] {
  if (gradingType === 'primary') {
    // 3 trimesters, each with a study period + exam session
    return [
      { kind: 'period', sequence: 1, semesterOrTrimester: 1, label: 'Trimestre 1' },
      { kind: 'exam', sequence: 2, semesterOrTrimester: 1, label: 'Examen T1' },
      { kind: 'period', sequence: 3, semesterOrTrimester: 2, label: 'Trimestre 2' },
      { kind: 'exam', sequence: 4, semesterOrTrimester: 2, label: 'Examen T2' },
      { kind: 'period', sequence: 5, semesterOrTrimester: 3, label: 'Trimestre 3' },
      { kind: 'exam', sequence: 6, semesterOrTrimester: 3, label: 'Examen T3' },
    ];
  }
  // 2 semesters, each with 2 study periods + 1 exam session
  return [
    { kind: 'period', sequence: 1, semesterOrTrimester: 1, label: 'Période 1' },
    { kind: 'period', sequence: 2, semesterOrTrimester: 1, label: 'Période 2' },
    { kind: 'exam', sequence: 3, semesterOrTrimester: 1, label: 'Examen S1' },
    { kind: 'period', sequence: 4, semesterOrTrimester: 2, label: 'Période 3' },
    { kind: 'period', sequence: 5, semesterOrTrimester: 2, label: 'Période 4' },
    { kind: 'exam', sequence: 6, semesterOrTrimester: 2, label: 'Examen S2' },
  ];
}

@Injectable()
export class AcademicYearService {
  async create(tx: TxDB, schoolId: string, dto: CreateAcademicYearDto) {
    const yearId = uuidv7();
    const [year] = await tx
      .insert(academicYear)
      .values({
        id: yearId,
        schoolId,
        label: dto.label,
        startsOn: dto.startsOn,
        endsOn: dto.endsOn,
        gradingType: dto.gradingType,
        status: 'draft',
      })
      .returning();

    const seeds = seedPeriods(dto.gradingType);
    await tx.insert(period).values(
      seeds.map((s) => ({
        id: uuidv7(),
        schoolId,
        yearId,
        kind: s.kind,
        sequence: s.sequence,
        semesterOrTrimester: s.semesterOrTrimester,
        label: s.label,
        status: 'open' as const,
      })),
    );

    return year!;
  }

  async findBySchool(schoolId: string) {
    return dbOwner
      .select()
      .from(academicYear)
      .where(eq(academicYear.schoolId, schoolId));
  }

  async findById(yearId: string) {
    const [year] = await dbOwner
      .select()
      .from(academicYear)
      .where(eq(academicYear.id, yearId))
      .limit(1);
    if (!year) return null;

    const periods = await dbOwner
      .select()
      .from(period)
      .where(eq(period.yearId, yearId));

    return { ...year, periods };
  }
}
