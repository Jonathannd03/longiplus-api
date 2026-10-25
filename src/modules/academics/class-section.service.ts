import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { classSection, subject } from '../../db/schema.js';
import { uuidv7 } from 'uuidv7';

interface CreateClassSectionDto {
  level: string;
  option?: string;
  name: string;
  classTeacherId?: string;
}

@Injectable()
export class ClassSectionService {
  async create(tx: TxDB, schoolId: string, yearId: string, dto: CreateClassSectionDto) {
    const [section] = await tx
      .insert(classSection)
      .values({
        id: uuidv7(),
        schoolId,
        yearId,
        level: dto.level,
        option: dto.option,
        name: dto.name,
        classTeacherId: dto.classTeacherId,
      })
      .returning();
    return section!;
  }

  async findByYear(yearId: string) {
    const sections = await dbOwner
      .select()
      .from(classSection)
      .where(eq(classSection.yearId, yearId));

    if (sections.length === 0) return [];

    const sectionIds = sections.map((s) => s.id);
    const subjects = await dbOwner
      .select()
      .from(subject)
      .where(inArray(subject.classSectionId, sectionIds));

    return sections.map((s) => ({
      ...s,
      subjects: subjects.filter((sub) => sub.classSectionId === s.id),
    }));
  }
}
