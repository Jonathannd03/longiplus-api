import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller.js';
import { StudentService } from './student.service.js';
import { GuardianService } from './guardian.service.js';
import { EnrollmentService } from './enrollment.service.js';
import { ImportService } from './import.service.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';

@Module({
  controllers: [RegistryController],
  providers: [StudentService, GuardianService, EnrollmentService, ImportService, AuditService, RolesGuard],
  exports: [StudentService],
})
export class RegistryModule {}
