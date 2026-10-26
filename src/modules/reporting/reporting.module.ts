import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';
import { RolesGuard } from '../identity/roles.guard.js';

@Module({
  controllers: [ReportingController],
  providers: [ReportingService, RolesGuard],
  exports: [ReportingService],
})
export class ReportingModule {}
