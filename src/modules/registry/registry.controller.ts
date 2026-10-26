import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  BadRequestException,
  UseGuards,
  Inject,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Req } from '@nestjs/common';
import {
  IsString, IsOptional, IsIn, IsDateString, IsArray, IsNumber,
  ValidateNested, MaxLength, MinLength, Matches, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { eq, and, inArray } from 'drizzle-orm';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles, CurrentUser } from '../identity/auth.decorator.js';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';
import { withSchoolContext, dbOwner } from '../../db/client.js';
import { student, guardian, studentGuardian } from '../../db/schema.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';
import { StudentService } from './student.service.js';
import { GuardianService } from './guardian.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { ImportService } from './import.service.js';
import { AttendanceService } from './attendance.service.js';
import { AnnouncementService } from './announcement.service.js';
import { AuditService } from '../identity/audit.service.js';

class EnrollDto {
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsString() @MinLength(1) @MaxLength(100) postName!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsIn(['M', 'F']) sex!: 'M' | 'F';
  @IsDateString() birthDate!: string;
  @IsString() @MinLength(1) @MaxLength(100) birthPlace!: string;
  @IsUUID() classSectionId!: string;
  @IsUUID() yearId!: string;
  @IsOptional() @Matches(/^\+\d{8,15}$/) guardianPhone?: string;
  @IsOptional() @IsString() @MaxLength(100) guardianName?: string;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() @MaxLength(100) postName?: string;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsIn(['M', 'F']) sex?: 'M' | 'F';
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(100) birthPlace?: string;
}

class LinkGuardianDto {
  @Matches(/^\+\d{8,15}$/) phoneE164!: string;
  @IsOptional() @IsString() @MaxLength(100) fullName?: string;
  @IsOptional() @IsString() @MaxLength(50) relationship?: string;
}

class AttendanceRecord {
  @IsUUID() studentId!: string;
  @IsIn(['present', 'absent', 'late', 'excused']) status!: 'present' | 'absent' | 'late' | 'excused';
}

class RecordAttendanceDto {
  @IsUUID() classSectionId!: string;
  @IsDateString() date!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AttendanceRecord) records!: AttendanceRecord[];
}

class ReenrollDecisionDto {
  @IsUUID() studentId!: string;
  @IsOptional() @IsUUID() toSectionId!: string | null;
}

class ReenrollDto {
  @IsUUID() fromYearId!: string;
  @IsUUID() toYearId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReenrollDecisionDto) decisions!: ReenrollDecisionDto[];
}

class WithdrawDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

class SendAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(500) message!: string;
  @IsIn(['all', 'section']) audience!: 'all' | 'section';
  @IsOptional() @IsUUID() classSectionId?: string;
  @IsUUID() yearId!: string;
}

@Controller()
@UseGuards(RolesGuard)
export class RegistryController {
  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly enrollmentService: EnrollmentService,
    private readonly importService: ImportService,
    private readonly attendanceService: AttendanceService,
    private readonly announcementService: AnnouncementService,
    private readonly auditService: AuditService,
  ) {}

  @Post('students')
  @Roles('director', 'owner', 'secretary')
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

      // FR-12: enrollment SMS to guardian
      if (dto.guardianPhone) {
        const msg = `LongiPlus : ${dto.firstName} ${dto.lastName} a été inscrit(e). Code élève : ${code}. Bienvenue à notre école !`;
        this.sms.send(dto.guardianPhone, msg).catch((err: unknown) => console.error('FR-12 SMS error', err));
      }

      return { ...s, duplicate: dup !== null ? { id: dup.id, studentCode: dup.studentCode } : null };
    });
  }

  @Get('students')
  @Roles('owner', 'director', 'secretary', 'teacher', 'class_teacher')
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

  @Patch('students/:id')
  @Roles('director', 'owner', 'secretary')
  async updateStudent(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const s = await this.studentService.findById(user.schoolId, id);
    if (!s) throw new BadRequestException('Student not found');
    return withSchoolContext(user.schoolId, (tx) =>
      this.studentService.update(tx, user.schoolId, id, dto),
    );
  }

  @Get('students/:id/siblings')
  getSiblings(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.studentService.findSiblings(user.schoolId, id);
  }

  @Get('students/:id/guardians')
  async getGuardians(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const s = await this.studentService.findById(user.schoolId, id);
    if (!s) throw new BadRequestException('Student not found');
    return withSchoolContext(user.schoolId, (tx) => this.guardianService.findByStudent(tx, id));
  }

  @Post('students/:id/guardians')
  @HttpCode(201)
  async linkGuardian(
    @Param('id') id: string,
    @Body() dto: LinkGuardianDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const s = await this.studentService.findById(user.schoolId, id);
    if (!s) throw new BadRequestException('Student not found');
    return withSchoolContext(user.schoolId, (tx) =>
      this.guardianService.linkOrCreate(tx, user.schoolId, id, dto),
    );
  }

  @Get('students/:id/attendance')
  getAttendance(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listByStudent(user.schoolId, id);
  }

  @Get('students/:id/attendance/stats')
  getAttendanceStats(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getStats(user.schoolId, id);
  }

  @Get('attendance')
  getAttendanceSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Query('classSectionId') classSectionId?: string,
    @Query('date') date?: string,
  ) {
    if (!classSectionId) throw new BadRequestException('classSectionId query param required');
    if (!date) throw new BadRequestException('date query param required');
    return this.attendanceService.listBySection(user.schoolId, classSectionId, date);
  }

  @Get('attendance/daily-status')
  getDailyStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('yearId') yearId?: string,
    @Query('date') date?: string,
  ) {
    if (!yearId) throw new BadRequestException('yearId query param required');
    const d = date ?? new Date().toISOString().slice(0, 10);
    return this.attendanceService.dailyStatus(user.schoolId, yearId, d);
  }

  @Post('attendance')
  @HttpCode(201)
  async recordAttendance(
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const count = await withSchoolContext(user.schoolId, (tx) =>
      this.attendanceService.recordBatch(
        tx,
        user.schoolId,
        dto.classSectionId,
        dto.date,
        dto.records,
        user.keycloakUserId,
      ),
    );
    // FR-20: SMS to guardians of absent students (fire-and-forget)
    const absentIds = dto.records.filter((r) => r.status === 'absent').map((r) => r.studentId);
    if (absentIds.length > 0) {
      this.sendAbsenceSms(user.schoolId, dto.date, absentIds).catch((err: unknown) =>
        console.error('FR-20 absence SMS error', err),
      );
    }
    return count;
  }

  private async sendAbsenceSms(schoolId: string, date: string, absentStudentIds: string[]) {
    const students = await dbOwner
      .select({ id: student.id, firstName: student.firstName, lastName: student.lastName })
      .from(student)
      .where(and(eq(student.schoolId, schoolId), inArray(student.id, absentStudentIds)));

    const guardians = await dbOwner
      .select({ studentId: studentGuardian.studentId, phoneE164: guardian.phoneE164 })
      .from(studentGuardian)
      .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
      .where(inArray(studentGuardian.studentId, absentStudentIds));

    const guardiansByStudent = new Map<string, string[]>();
    for (const g of guardians) {
      const phones = guardiansByStudent.get(g.studentId) ?? [];
      phones.push(g.phoneE164);
      guardiansByStudent.set(g.studentId, phones);
    }

    for (const s of students) {
      const phones = guardiansByStudent.get(s.id) ?? [];
      if (phones.length === 0) continue;
      const msg = `LongiPlus : ${s.firstName} ${s.lastName} était absent(e) le ${date}. Contactez l'école si nécessaire.`;
      for (const phone of phones) {
        await this.sms.send(phone, msg).catch(() => {});
      }
    }
  }

  @Post('students/import/preview')
  @Roles('director', 'owner', 'secretary')
  async preview(@Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser, @Query('yearId') yearId?: string) {
    if (!yearId) throw new BadRequestException('yearId query param required');
    const { buffer, filename } = await readMultipartFile(req);
    return this.importService.preview(user.schoolId, yearId, buffer, filename);
  }

  @Post('students/import/commit')
  @Roles('director', 'owner', 'secretary')
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

  @Post('enrollments/reenroll')
  @Roles('director', 'owner', 'secretary')
  @HttpCode(200)
  async reenroll(@Body() dto: ReenrollDto, @CurrentUser() user: AuthenticatedUser) {
    return withSchoolContext(user.schoolId, (tx) =>
      this.enrollmentService.reenroll(tx, user.schoolId, dto.toYearId, dto.decisions),
    );
  }

  @Patch('students/:id/withdraw')
  @Roles('director', 'owner', 'secretary')
  async withdraw(
    @Param('id') studentId: string,
    @Body() dto: WithdrawDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const row = await this.enrollmentService.withdraw(tx, user.schoolId, studentId, dto.reason);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'student.withdrawn',
        entity: 'enrollment',
        entityId: row.id,
        after: { reason: dto.reason },
      });
      return row;
    });
  }

  @Post('announcements')
  @Roles('director', 'owner')
  async sendAnnouncement(
    @Body() dto: SendAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return withSchoolContext(user.schoolId, (tx) =>
      this.announcementService.send(tx, user.schoolId, dto, user.keycloakUserId),
    );
  }

  @Get('announcements')
  @Roles('director', 'owner', 'secretary')
  listAnnouncements(@CurrentUser() user: AuthenticatedUser) {
    return this.announcementService.list(user.schoolId);
  }
}

const ALLOWED_XLSX_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

async function readMultipartFile(req: FastifyRequest): Promise<{ buffer: Buffer; filename: string }> {
  const data = await (req as unknown as {
    file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename: string; mimetype: string }>;
  }).file();
  if (!data) throw new BadRequestException('No file uploaded');
  if (!ALLOWED_XLSX_MIMES.includes(data.mimetype)) {
    throw new BadRequestException('File must be an Excel (.xlsx, .xls) or CSV file');
  }
  const buffer = await data.toBuffer();
  return { buffer, filename: data.filename };
}
