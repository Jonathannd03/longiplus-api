import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  IsString, IsOptional, IsIn, IsDateString, IsArray, IsNumber,
  ValidateNested, MaxLength, MinLength, IsUUID, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles, CurrentUser } from '../identity/auth.decorator.js';
import { AcademicYearService } from './academic-year.service.js';
import { ClassSectionService } from './class-section.service.js';
import { SubjectService } from './subject.service.js';
import { MarkService } from './mark.service.js';
import { CorrectionService } from './correction.service.js';
import { BulletinService } from './bulletin.service.js';
import { AuditService } from '../identity/audit.service.js';
import { withSchoolContext } from '../../db/client.js';
import { dbOwner } from '../../db/client.js';
import { period } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';

class CreateAcademicYearDto {
  @IsString() @MinLength(1) @MaxLength(50) label!: string;
  @IsDateString() startsOn!: string;
  @IsDateString() endsOn!: string;
  @IsIn(['primary', 'secondary']) gradingType!: 'primary' | 'secondary';
}

class CreateClassSectionDto {
  @IsString() @MinLength(1) @MaxLength(50) level!: string;
  @IsOptional() @IsString() @MaxLength(50) option?: string;
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsUUID() classTeacherId?: string;
}

class CreateSubjectDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) maxPeriod?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) maxExam?: number;
  @IsOptional() @IsUUID() teacherId?: string;
}

class UpdateSubjectDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) maxPeriod?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) maxExam?: number;
  @IsOptional() @IsUUID() teacherId?: string;
}

class MarkRecord {
  @IsUUID() studentId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10000) score!: number | null;
}

class BatchMarksDto {
  @IsUUID() periodId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MarkRecord) records!: MarkRecord[];
}

class CreateCorrectionDto {
  @IsUUID() markId!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsNumber() @Min(0) @Max(10000) newScore!: number;
}

class RejectCorrectionDto {
  @IsString() @MinLength(1) @MaxLength(500) note!: string;
}

class GenerateBulletinsDto {
  @IsUUID() classSectionId!: string;
  @IsUUID() periodId!: string;
  @IsUUID() yearId!: string;
}

@Controller()
@UseGuards(RolesGuard)
export class AcademicsController {
  constructor(
    private readonly yearService: AcademicYearService,
    private readonly sectionService: ClassSectionService,
    private readonly subjectService: SubjectService,
    private readonly markService: MarkService,
    private readonly correctionService: CorrectionService,
    private readonly bulletinService: BulletinService,
    private readonly auditService: AuditService,
  ) {}

  @Post('academic-years')
  @Roles('owner', 'director')
  async createYear(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAcademicYearDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const year = await this.yearService.create(tx, user.schoolId, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'academic_year.created',
        entity: 'academic_year',
        entityId: year.id,
        after: { label: dto.label, gradingType: dto.gradingType },
      });
      return year;
    });
  }

  @Get('academic-years')
  async listYears(@CurrentUser() user: AuthenticatedUser) {
    return this.yearService.findBySchool(user.schoolId);
  }

  @Get('academic-years/:id')
  async getYear(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const year = await this.yearService.findById(id);
    if (!year || year.schoolId !== user.schoolId) throw new NotFoundException();
    return year;
  }

  @Post('academic-years/:yearId/class-sections')
  @Roles('owner', 'director')
  async createSection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('yearId') yearId: string,
    @Body() dto: CreateClassSectionDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const section = await this.sectionService.create(tx, user.schoolId, yearId, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'class_section.created',
        entity: 'class_section',
        entityId: section.id,
        after: { level: dto.level, name: dto.name },
      });
      return section;
    });
  }

  @Get('academic-years/:yearId/class-sections')
  async listSections(
    @CurrentUser() user: AuthenticatedUser,
    @Param('yearId') yearId: string,
  ) {
    return this.sectionService.findByYear(yearId);
  }

  @Post('class-sections/:id/subjects')
  @Roles('owner', 'director')
  async createSubject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') classSectionId: string,
    @Body() dto: CreateSubjectDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const sub = await this.subjectService.create(tx, user.schoolId, classSectionId, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'subject.created',
        entity: 'subject',
        entityId: sub.id,
        after: { name: dto.name, maxPeriod: dto.maxPeriod },
      });
      return sub;
    });
  }

  @Patch('subjects/:id')
  @Roles('owner', 'director')
  async updateSubject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const sub = await this.subjectService.update(tx, id, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'subject.updated',
        entity: 'subject',
        entityId: id,
        after: dto as Record<string, unknown>,
      });
      return sub;
    });
  }

  // ─── Periods ───────────────────────────────────────────────────────────────

  @Get('academic-years/:yearId/periods')
  async listPeriods(
    @CurrentUser() user: AuthenticatedUser,
    @Param('yearId') yearId: string,
  ) {
    return dbOwner
      .select()
      .from(period)
      .where(and(eq(period.yearId, yearId), eq(period.schoolId, user.schoolId)))
      .orderBy(period.sequence);
  }

  @Patch('periods/:id/close')
  @Roles('director', 'owner')
  async closePeriod(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const [p] = await dbOwner
        .select()
        .from(period)
        .where(and(eq(period.id, id), eq(period.schoolId, user.schoolId)))
        .limit(1);
      if (!p) throw new NotFoundException('Period not found');
      const [updated] = await tx.update(period).set({ status: 'closed' }).where(eq(period.id, id)).returning();
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'period.closed',
        entity: 'period',
        entityId: id,
      });
      return updated;
    });
  }

  @Patch('periods/:id/lock')
  @Roles('director', 'owner')
  async lockPeriod(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const [p] = await dbOwner
        .select()
        .from(period)
        .where(and(eq(period.id, id), eq(period.schoolId, user.schoolId)))
        .limit(1);
      if (!p) throw new NotFoundException('Period not found');
      const [updated] = await tx.update(period).set({ status: 'locked' }).where(eq(period.id, id)).returning();
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'period.locked',
        entity: 'period',
        entityId: id,
      });
      return updated;
    });
  }

  // ─── Marks ─────────────────────────────────────────────────────────────────

  @Get('subjects/:subjectId/marks')
  async listMarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId') subjectId: string,
    @Query('periodId') periodId: string,
  ) {
    const result = await this.markService.listBySubjectAndPeriod(user.schoolId, subjectId, periodId);
    if (!result) throw new NotFoundException('Subject or period not found');
    return result;
  }

  @Put('subjects/:subjectId/marks/batch')
  @Roles('teacher', 'class_teacher', 'director', 'owner', 'secretary')
  async batchMarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId') subjectId: string,
    @Body() dto: BatchMarksDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      return this.markService.batchUpsert(tx, user.schoolId, subjectId, dto.periodId, dto.records, user.keycloakUserId);
    });
  }

  @Get('class-sections/:id/results')
  async sectionResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') classSectionId: string,
    @Query('periodId') periodId: string,
  ) {
    const result = await this.markService.computeResults(user.schoolId, classSectionId, periodId);
    if (!result) throw new NotFoundException('Period not found');
    return result;
  }

  @Get('students/:studentId/marks')
  async studentMarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
    @Query('yearId') yearId: string,
  ) {
    return this.markService.listByStudent(user.schoolId, studentId, yearId);
  }

  // ─── Corrections ───────────────────────────────────────────────────────────

  @Post('corrections')
  @Roles('teacher', 'class_teacher', 'director')
  async createCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCorrectionDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      return this.correctionService.create(tx, user.schoolId, dto, user.keycloakUserId);
    });
  }

  @Get('corrections')
  @Roles('director', 'owner', 'teacher', 'class_teacher')
  async listCorrections(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('classSectionId') classSectionId?: string,
  ) {
    const filters: { status?: string; classSectionId?: string } = {};
    if (status) filters.status = status;
    if (classSectionId) filters.classSectionId = classSectionId;
    return this.correctionService.list(user.schoolId, filters);
  }

  @Patch('corrections/:id/approve')
  @Roles('director', 'owner')
  async approveCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const result = await this.correctionService.approve(tx, user.schoolId, id, user.keycloakUserId);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'correction.approved',
        entity: 'correction_request',
        entityId: id,
      });
      return result;
    });
  }

  @Patch('corrections/:id/reject')
  @Roles('director', 'owner')
  async rejectCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectCorrectionDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const result = await this.correctionService.reject(tx, user.schoolId, id, user.keycloakUserId, dto.note);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'correction.rejected',
        entity: 'correction_request',
        entityId: id,
      });
      return result;
    });
  }

  // ─── Bulletins ─────────────────────────────────────────────────────────────

  @Get('bulletins/status')
  @Roles('director', 'owner', 'secretary')
  async bulletinStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('yearId') yearId: string,
  ) {
    if (!yearId) throw new NotFoundException('yearId required');
    return this.bulletinService.sectionStatus(user.schoolId, yearId);
  }

  @Post('bulletins/generate')
  @Roles('director', 'owner')
  async generateBulletins(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateBulletinsDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const generated = await this.bulletinService.generate(
        tx,
        user.schoolId,
        dto.classSectionId,
        dto.periodId,
        dto.yearId,
        user.keycloakUserId,
      );
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'bulletins.generated',
        entity: 'bulletin',
        after: { classSectionId: dto.classSectionId, periodId: dto.periodId, count: generated.length },
      });
      return { generated: generated.length, bulletins: generated };
    });
  }

  @Get('bulletins/public/:token')
  @Roles()
  async getBulletinByToken(@Param('token') token: string) {
    const b = await this.bulletinService.getByToken(token);
    if (!b) throw new NotFoundException('Bulletin not found');
    return b;
  }
}
