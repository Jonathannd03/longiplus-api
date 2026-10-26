import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { JwtAuthGuard } from './modules/identity/jwt.guard.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { MembershipService } from './modules/tenancy/membership.service.js';
import { AcademicsModule } from './modules/academics/academics.module.js';
import { RegistryModule } from './modules/registry/registry.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limit: 100 req / 60 s per IP; public endpoints override with @Throttle
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    TenancyModule,
    IdentityModule,
    AcademicsModule,
    RegistryModule,
    ReportingModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector, membershipService: MembershipService) =>
        new JwtAuthGuard(reflector, membershipService),
      inject: [Reflector, MembershipService],
    },
  ],
})
export class AppModule {}
