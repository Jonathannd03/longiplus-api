import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service.js';
import { SchoolService } from './school.service.js';
import { PayoutAccountService } from './payout-account.service.js';
import { TenancyController } from './tenancy.controller.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { OutboxModule } from '../outbox/outbox.module.js';

@Module({
  imports: [OutboxModule],
  controllers: [TenancyController],
  // AuditService and RolesGuard are stateless — safe to provide here independently
  providers: [MembershipService, SchoolService, PayoutAccountService, AuditService, RolesGuard],
  exports: [MembershipService, SchoolService, PayoutAccountService],
})
export class TenancyModule {}
