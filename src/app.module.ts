import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { AcademicsModule } from './modules/academics/academics.module.js';
import { RegistryModule } from './modules/registry/registry.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TenancyModule,
    IdentityModule,
    AcademicsModule,
    RegistryModule,
  ],
})
export class AppModule {}
