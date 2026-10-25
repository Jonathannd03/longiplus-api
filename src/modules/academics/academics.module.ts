import { Module } from '@nestjs/common';
import { AcademicYearService } from './academic-year.service.js';
import { ClassSectionService } from './class-section.service.js';
import { SubjectService } from './subject.service.js';
import { AcademicsController } from './academics.controller.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';

@Module({
  controllers: [AcademicsController],
  providers: [AcademicYearService, ClassSectionService, SubjectService, AuditService, RolesGuard],
  exports: [AcademicYearService, ClassSectionService, SubjectService],
})
export class AcademicsModule {}
