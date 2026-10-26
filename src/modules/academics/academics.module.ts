import { Module } from '@nestjs/common';
import { AcademicYearService } from './academic-year.service.js';
import { ClassSectionService } from './class-section.service.js';
import { SubjectService } from './subject.service.js';
import { MarkService } from './mark.service.js';
import { CorrectionService } from './correction.service.js';
import { BulletinService } from './bulletin.service.js';
import { AcademicsController } from './academics.controller.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [AcademicsController],
  providers: [AcademicYearService, ClassSectionService, SubjectService, MarkService, CorrectionService, BulletinService, AuditService, RolesGuard],
  exports: [AcademicYearService, ClassSectionService, SubjectService, MarkService, CorrectionService],
})
export class AcademicsModule {}
