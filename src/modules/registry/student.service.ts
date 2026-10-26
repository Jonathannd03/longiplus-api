import { Injectable } from '@nestjs/common';
import { eq, and, or, ne, ilike, inArray, sql } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { student, enrollment, classSection, studentGuardian } from '../../db/schema.js';
import { generateCode } from './luhn.js';

export interface CreateStudentDto {
  lastName: string;
  postName: string;
  firstName: string;
  sex: 'M' | 'F';
  birthDate: string; // YYYY-MM-DD
  birthPlace: string;
  importBatchId?: string;
}

export interface StudentWithClass {
  id: string;
  studentCode: string;
  lastName: string;
  postName: string;
  firstName: string;
  sex: 'M' | 'F';
  birthDate: string;
  birthPlace: string;
  className: string | null;
  createdAt: Date;
}

@Injectable()
export class StudentService {
  async generateStudentCode(): Promise<string> {
    const rows = await dbOwner.execute(sql`SELECT nextval('student_code_seq') AS val`);
    const val = (rows as unknown as Array<{ val: string | bigint }>)[0]?.val;
    const payload = String(val).padStart(8, '0');
    return generateCode(payload);
  }

  async findDuplicate(tx: TxDB, schoolId: string, dto: Pick<CreateStudentDto, 'lastName' | 'postName' | 'firstName' | 'birthDate'>) {
    const [row] = await tx
      .select({ id: student.id, studentCode: student.studentCode })
      .from(student)
      .where(and(
        eq(student.schoolId, schoolId),
        ilike(student.lastName, dto.lastName),
        ilike(student.postName, dto.postName),
        ilike(student.firstName, dto.firstName),
        eq(student.birthDate, dto.birthDate),
      ))
      .limit(1);
    return row ?? null;
  }

  async create(tx: TxDB, schoolId: string, dto: CreateStudentDto, code: string) {
    const values: typeof student.$inferInsert = {
      schoolId,
      studentCode: code,
      lastName: dto.lastName,
      postName: dto.postName,
      firstName: dto.firstName,
      sex: dto.sex,
      birthDate: dto.birthDate,
      birthPlace: dto.birthPlace,
    };
    if (dto.importBatchId !== undefined) values.importBatchId = dto.importBatchId;
    const [row] = await tx.insert(student).values(values).returning();
    return row!;
  }

  async list(schoolId: string, opts: { q?: string; classSectionId?: string; yearId?: string } = {}) {
    const rows = await dbOwner
      .select({
        id: student.id,
        studentCode: student.studentCode,
        lastName: student.lastName,
        postName: student.postName,
        firstName: student.firstName,
        sex: student.sex,
        birthDate: student.birthDate,
        birthPlace: student.birthPlace,
        className: classSection.name,
        createdAt: student.createdAt,
      })
      .from(student)
      .leftJoin(enrollment, and(
        eq(enrollment.studentId, student.id),
        eq(enrollment.schoolId, schoolId),
        eq(enrollment.status, 'active'),
        opts.yearId ? eq(enrollment.yearId, opts.yearId) : sql`TRUE`,
      ))
      .leftJoin(classSection, eq(classSection.id, enrollment.classSectionId))
      .where(and(
        eq(student.schoolId, schoolId),
        opts.q ? or(
          ilike(student.lastName, `%${opts.q}%`),
          ilike(student.firstName, `%${opts.q}%`),
          ilike(student.studentCode, `%${opts.q}%`),
        ) : undefined,
        opts.classSectionId ? eq(enrollment.classSectionId, opts.classSectionId) : undefined,
      ))
      .limit(500);
    return rows;
  }

  async findById(schoolId: string, id: string) {
    const [row] = await dbOwner
      .select()
      .from(student)
      .where(and(eq(student.id, id), eq(student.schoolId, schoolId)))
      .limit(1);
    return row ?? null;
  }

  async update(tx: TxDB, schoolId: string, id: string, dto: Partial<{
    lastName: string; postName: string; firstName: string;
    sex: 'M' | 'F'; birthDate: string; birthPlace: string;
  }>) {
    const [row] = await tx
      .update(student)
      .set(dto)
      .where(and(eq(student.id, id), eq(student.schoolId, schoolId)))
      .returning();
    return row ?? null;
  }

  async findSiblings(schoolId: string, studentId: string) {
    const sharedGuardianSq = dbOwner
      .select({ guardianId: studentGuardian.guardianId })
      .from(studentGuardian)
      .where(eq(studentGuardian.studentId, studentId));

    return dbOwner
      .selectDistinct({
        id: student.id,
        studentCode: student.studentCode,
        lastName: student.lastName,
        postName: student.postName,
        firstName: student.firstName,
        sex: student.sex,
        className: classSection.name,
      })
      .from(student)
      .innerJoin(studentGuardian, eq(studentGuardian.studentId, student.id))
      .leftJoin(enrollment, and(
        eq(enrollment.studentId, student.id),
        eq(enrollment.schoolId, schoolId),
        eq(enrollment.status, 'active'),
      ))
      .leftJoin(classSection, eq(classSection.id, enrollment.classSectionId))
      .where(and(
        eq(student.schoolId, schoolId),
        ne(student.id, studentId),
        inArray(studentGuardian.guardianId, sharedGuardianSq),
      ));
  }

  async deleteByBatchId(tx: TxDB, schoolId: string, batchId: string) {
    const students = await tx
      .select({ id: student.id })
      .from(student)
      .where(and(eq(student.schoolId, schoolId), eq(student.importBatchId, batchId)));
    if (students.length === 0) return 0;
    const ids = students.map(s => s.id);
    await tx.delete(studentGuardian).where(inArray(studentGuardian.studentId, ids));
    await tx.delete(enrollment).where(inArray(enrollment.studentId, ids));
    await tx.delete(student).where(and(eq(student.schoolId, schoolId), eq(student.importBatchId, batchId)));
    return ids.length;
  }
}
