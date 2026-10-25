import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles, CurrentUser } from '../identity/auth.decorator.js';
import { AcademicYearService } from './academic-year.service.js';
import { ClassSectionService } from './class-section.service.js';
import { SubjectService } from './subject.service.js';
import { AuditService } from '../identity/audit.service.js';
import { withSchoolContext } from '../../db/client.js';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';

interface CreateAcademicYearDto {
  label: string;
  startsOn: string;
  endsOn: string;
  gradingType: 'primary' | 'secondary';
}

interface CreateClassSectionDto {
  level: string;
  option?: string;
  name: string;
  classTeacherId?: string;
}

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

@Controller()
@UseGuards(RolesGuard)
export class AcademicsController {
  constructor(
    private readonly yearService: AcademicYearService,
    private readonly sectionService: ClassSectionService,
    private readonly subjectService: SubjectService,
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
}
