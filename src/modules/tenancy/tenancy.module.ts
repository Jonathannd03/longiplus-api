import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service.js';
import { SchoolService } from './school.service.js';

@Module({
  providers: [MembershipService, SchoolService],
  exports: [MembershipService, SchoolService],
})
export class TenancyModule {}
