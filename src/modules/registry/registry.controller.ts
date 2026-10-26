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

interface UpdateStudentDto {
  lastName?: string;
  postName?: string;
  firstName?: string;
  sex?: 'M' | 'F';
  birthDate?: string;
  birthPlace?: string;
}

interface LinkGuardianDto {
  phoneE164: string;
  fullName?: string;
  relationship?: string;
}

interface RecordAttendanceDto {
  classSectionId: string;
  date: string;
  records: Array<{ studentId: string; status: 'present' | 'absent' | 'late' | 'excused' }>;
}

interface ReenrollDto {
  fromYearId: string;
  toYearId: string;
  decisions: Array<{ studentId: string; toSectionId: string | null }>;
}

interface WithdrawDto {
  reason: string;
}

interface SendAnnouncementDto {
  message: string;
  audience: 'all' | 'section';
  classSectionId?: string;
  yearId: string;
}

@Controller()
@UseGuards(RolesGuard)
export class RegistryController {
  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(StudentService) private readonly studentService: StudentService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(EnrollmentService) private readonly enrollmentService: EnrollmentService,
    @Inject(ImportService) private readonly importService: ImportService,
    @Inject(AttendanceService) private readonly attendanceService: AttendanceService,
    @Inject(AnnouncementService) private readonly announcementService: AnnouncementService,
    @Inject(AuditService) private readonly auditService: AuditService,
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
    if (!dto.phoneE164) throw new BadRequestException('phoneE164 required');
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
    if (!dto.classSectionId) throw new BadRequestException('classSectionId required');
    if (!dto.date) throw new BadRequestException('date required');
    if (!Array.isArray(dto.records)) throw new BadRequestException('records array required');
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
    if (!dto.toYearId) throw new BadRequestException('toYearId required');
    if (!Array.isArray(dto.decisions)) throw new BadRequestException('decisions array required');
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
    if (!dto.reason?.trim()) throw new BadRequestException('reason is required');
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
    if (!dto.message?.trim()) throw new BadRequestException('message is required');
    if (!dto.yearId) throw new BadRequestException('yearId is required');
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

async function readMultipartFile(req: FastifyRequest): Promise<{ buffer: Buffer; filename: string }> {
  const data = await (req as unknown as { file: () => Promise<{ toBuffer: () => Promise<Buffer>; filename: string }> }).file();
  if (!data) throw new BadRequestException('No file uploaded');
  const buffer = await data.toBuffer();
  return { buffer, filename: data.filename };
}
