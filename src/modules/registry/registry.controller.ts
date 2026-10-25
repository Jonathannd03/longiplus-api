import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Req } from '@nestjs/common';
import { CurrentUser } from '../identity/auth.decorator.js';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';
import { withSchoolContext } from '../../db/client.js';
import { StudentService } from './student.service.js';
import { GuardianService } from './guardian.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { ImportService } from './import.service.js';

interface EnrollDto {
  lastName: string;
  postName: string;
  firstName: string;
  sex: 'M' | 'F';
  birthDate: string;
  birthPlace: string;
  classSectionId: string;
  yearId: string;
  guardianPhone?: string;
  guardianName?: string;
}

@Controller()
export class RegistryController {
  constructor(
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly enrollmentService: EnrollmentService,
    private readonly importService: ImportService,
  ) {}

  @Post('students')
  async enroll(@Body() dto: EnrollDto, @CurrentUser() user: AuthenticatedUser) {
    const { schoolId } = user;
    const code = await this.studentService.generateStudentCode();

    return withSchoolContext(schoolId, async (tx) => {
      const dup = await this.studentService.findDuplicate(tx, schoolId, {
        lastName: dto.lastName,
        postName: dto.postName,
        firstName: dto.firstName,
        birthDate: dto.birthDate,
      });

      const s = await this.studentService.create(tx, schoolId, {
        lastName: dto.lastName,
        postName: dto.postName,
        firstName: dto.firstName,
        sex: dto.sex,
        birthDate: dto.birthDate,
        birthPlace: dto.birthPlace,
      }, code);

      if (dto.guardianPhone) {
        await this.guardianService.createAndLink(tx, schoolId, s.id, {
          fullName: dto.guardianName ?? `${dto.lastName} ${dto.firstName} (tuteur)`,
          phoneE164: dto.guardianPhone,
        });
      }

      await this.enrollmentService.create(tx, schoolId, s.id, dto.classSectionId, dto.yearId);

      return { ...s, duplicate: dup !== null ? { id: dup.id, studentCode: dup.studentCode } : null };
    });
  }

  @Get('students')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('yearId') yearId?: string,
  ) {
    const opts: Parameters<StudentService['list']>[1] = {};
    if (q !== undefined) opts.q = q;
    if (classSectionId !== undefined) opts.classSectionId = classSectionId;
    if (yearId !== undefined) opts.yearId = yearId;
    return this.studentService.list(user.schoolId, opts);
  }

  @Get('students/:id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const s = await this.studentService.findById(user.schoolId, id);
    if (!s) throw new BadRequestException('Student not found');
    return s;
  }

  @Post('students/import/preview')
  async preview(@Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser, @Query('yearId') yearId?: string) {
    if (!yearId) throw new BadRequestException('yearId query param required');
    const { buffer, filename } = await readMultipartFile(req);
    return this.importService.preview(user.schoolId, yearId, buffer, filename);
  }

  @Post('students/import/commit')
  @HttpCode(201)
  async commit(@Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser, @Query('yearId') yearId?: string) {
    if (!yearId) throw new BadRequestException('yearId query param required');
    const { buffer, filename } = await readMultipartFile(req);
    return this.importService.commit(user.schoolId, yearId, buffer, filename);
  }

  @Delete('students/import/:batchId')
  @HttpCode(200)
  undo(@Param('batchId') batchId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.importService.undo(user.schoolId, batchId);
  }

  @Get('students/:id/guardians')
  async getGuardians(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const s = await this.studentService.findById(user.schoolId, id);
    if (!s) throw new BadRequestException('Student not found');
    return withSchoolContext(user.schoolId, (tx) => this.guardianService.findByStudent(tx, id));
  }
}

async function readMultipartFile(req: FastifyRequest): Promise<{ buffer: Buffer; filename: string }> {
  const data = await (req as unknown as { file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename: string }> }).file();
  if (!data) throw new BadRequestException('No file uploaded');
  const buffer = await data.toBuffer();
  return { buffer, filename: data.filename };
}
