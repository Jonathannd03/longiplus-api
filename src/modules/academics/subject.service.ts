import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { TxDB } from '../../db/client.js';
import { subject } from '../../db/schema.js';
import { uuidv7 } from 'uuidv7';

interface CreateSubjectDto {
  name: string;
  maxPeriod?: number;
  maxExam?: number;
  teacherId?: string;
}

interface UpdateSubjectDto {
  name?: string;
  maxPeriod?: number;
  maxExam?: number;
  teacherId?: string;
}

@Injectable()
export class SubjectService {
  async create(tx: TxDB, schoolId: string, classSectionId: string, dto: CreateSubjectDto) {
    const [row] = await tx
      .insert(subject)
      .values({
        id: uuidv7(),
        schoolId,
        classSectionId,
        name: dto.name,
        maxPeriod: dto.maxPeriod ?? 10,
        maxExam: dto.maxExam,
        teacherId: dto.teacherId,
      })
      .returning();
    return row!;
  }

  async update(tx: TxDB, id: string, dto: UpdateSubjectDto) {
    const [row] = await tx
      .update(subject)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.maxPeriod !== undefined && { maxPeriod: dto.maxPeriod }),
        ...(dto.maxExam !== undefined && { maxExam: dto.maxExam }),
        ...(dto.teacherId !== undefined && { teacherId: dto.teacherId }),
      })
      .where(eq(subject.id, id))
      .returning();
    if (!row) throw new NotFoundException('Subject not found');
    return row;
  }
}
