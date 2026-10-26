import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service.js';
import { SchoolService } from './school.service.js';
import { PayoutAccountService } from './payout-account.service.js';
import { TenancyController } from './tenancy.controller.js';
import { RegistrationController } from './registration.controller.js';
import { RegistrationService } from './registration.service.js';
import { AuditService } from '../identity/audit.service.js';
import { RolesGuard } from '../identity/roles.guard.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [OutboxModule, NotificationsModule],
  controllers: [TenancyController, RegistrationController],
  providers: [MembershipService, SchoolService, PayoutAccountService, RegistrationService, AuditService, RolesGuard],
  exports: [MembershipService, SchoolService, PayoutAccountService, AuditService],
})
export class TenancyModule {}
