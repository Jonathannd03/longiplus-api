import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';

@Module({
  imports: [TenancyModule],
  controllers: [IdentityController],
  providers: [],
  exports: [],
})
export class IdentityModule {}
