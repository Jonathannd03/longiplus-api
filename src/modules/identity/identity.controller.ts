import { Controller, Get, Inject, Post } from '@nestjs/common';
import { CurrentUser } from './auth.decorator.js';
import { AuditService } from './audit.service.js';
import { MembershipService } from '../tenancy/membership.service.js';
import { withSchoolContext } from '../../db/client.js';
import { uuidv7 } from 'uuidv7';
import type { AuthenticatedUser } from './authenticated-user.interface.js';

@Controller('auth')
export class IdentityController {
  constructor(
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(MembershipService) private readonly membershipService: MembershipService,
  ) {}

  /**
   * Called once after Keycloak redirects back to the SPA.
   * Writes a login audit event and returns the user + all schools they belong to.
   */
  @Post('session')
  async createSession(@CurrentUser() user: AuthenticatedUser) {
    await withSchoolContext(user.schoolId, async (tx) => {
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'user.login',
        entity: 'user',
        entityId: uuidv7(),
      });
    });

    const schools = await this.membershipService.findAllSchoolsForUser(user.keycloakUserId);
    return {
      user: {
        keycloakUserId: user.keycloakUserId,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
      },
      schools: schools.map((s) => ({ id: s.schoolId, name: s.schoolName })),
    };
  }

  /** Used by the SPA on reload to rehydrate the auth store */
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const schools = await this.membershipService.findAllSchoolsForUser(user.keycloakUserId);
    return {
      user: {
        keycloakUserId: user.keycloakUserId,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
      },
      schools: schools.map((s) => ({ id: s.schoolId, name: s.schoolName })),
    };
  }
}
