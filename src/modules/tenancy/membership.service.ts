import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import { membership, school } from '../../db/schema.js';

@Injectable()
export class MembershipService {
  /** Used by JwtAuthGuard — must bypass RLS (no school context set yet) */
  async findByUserAndSchool(keycloakUserId: string, schoolId: string) {
    const [row] = await dbOwner
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.keycloakUserId, keycloakUserId),
          eq(membership.schoolId, schoolId),
          eq(membership.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Returns all active memberships + school name for the school-switcher — cross-tenant, must bypass RLS */
  async findAllSchoolsForUser(keycloakUserId: string) {
    return dbOwner
      .select({
        schoolId: membership.schoolId,
        role: membership.role,
        schoolName: school.name,
      })
      .from(membership)
      .innerJoin(school, eq(membership.schoolId, school.id))
      .where(
        and(
          eq(membership.keycloakUserId, keycloakUserId),
          eq(membership.status, 'active'),
        ),
      );
  }
}
