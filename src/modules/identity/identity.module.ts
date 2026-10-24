import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard.js';
import { AuditService } from './audit.service.js';
import { IdentityController } from './identity.controller.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';

@Module({
  imports: [TenancyModule],
  controllers: [IdentityController],
  providers: [AuditService, JwtAuthGuard],
  exports: [AuditService, JwtAuthGuard],
})
export class IdentityModule {}
