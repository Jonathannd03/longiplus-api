import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller.js';
import { StudentService } from './student.service.js';
import { GuardianService } from './guardian.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { ImportService } from './import.service.js';
import { AttendanceService } from './attendance.service.js';
import { AnnouncementService } from './announcement.service.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  controllers: [RegistryController],
  providers: [StudentService, GuardianService, EnrollmentService, ImportService, AttendanceService, AnnouncementService, AuditService, RolesGuard],
  exports: [StudentService, EnrollmentService],
})
export class RegistryModule {}
