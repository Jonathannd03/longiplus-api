import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { membership, school } from '../../db/schema.js';
import { uuidv7 } from 'uuidv7';

interface InviteMemberDto {
  email: string;
  role: 'director' | 'bursar' | 'secretary' | 'teacher' | 'class_teacher';
  keycloakUserId?: string;
}

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

  async findBySchool(schoolId: string) {
    return dbOwner
      .select({
        id: membership.id,
        keycloakUserId: membership.keycloakUserId,
        email: membership.email,
        role: membership.role,
        status: membership.status,
        createdAt: membership.createdAt,
      })
      .from(membership)
      .where(eq(membership.schoolId, schoolId));
  }

  async invite(tx: TxDB, schoolId: string, dto: InviteMemberDto) {
    const [row] = await tx
      .insert(membership)
      .values({
        id: uuidv7(),
        schoolId,
        keycloakUserId: dto.keycloakUserId ?? '',
        email: dto.email,
        role: dto.role,
        status: 'invited',
      })
      .returning();
    return row!;
  }
}
