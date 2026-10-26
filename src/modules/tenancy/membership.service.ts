import { BadRequestException, Injectable } from '@nestjs/common';
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

export interface PhoneInviteDto {
  phone: string;
  role: 'teacher' | 'class_teacher' | 'secretary';
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
        phone: membership.phone,
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

  /** FR-11: invite a teacher by phone number; returns the generated code so caller can send SMS */
  async phoneInvite(tx: TxDB, schoolId: string, dto: PhoneInviteDto): Promise<{ id: string; code: string }> {
    if (!dto.phone?.trim()) throw new BadRequestException('phone required');
    const code = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const [row] = await tx
      .insert(membership)
      .values({
        id: uuidv7(),
        schoolId,
        keycloakUserId: '',
        email: dto.phone.trim(),
        role: dto.role,
        status: 'invited',
        phone: dto.phone.trim(),
        inviteCode: code,
        inviteCodeExpiresAt: expiresAt,
      })
      .returning({ id: membership.id });

    return { id: row!.id, code };
  }

  /** FR-17: activate a phone-invited membership by verifying the SMS code */
  async verifyInvite(phone: string, code: string) {
    const now = new Date();
    const [row] = await dbOwner
      .select()
      .from(membership)
      .where(and(eq(membership.phone, phone), eq(membership.inviteCode, code)))
      .limit(1);

    if (!row) throw new BadRequestException('Code invalide ou numéro introuvable');
    if (row.status === 'active') throw new BadRequestException('Ce compte est déjà activé');
    if (row.inviteCodeExpiresAt && row.inviteCodeExpiresAt < now) {
      throw new BadRequestException('Code expiré — demandez un nouvel envoi à votre directeur');
    }

    const [updated] = await dbOwner
      .update(membership)
      .set({ status: 'active', keycloakUserId: phone, inviteCode: null, inviteCodeExpiresAt: null })
      .where(eq(membership.id, row.id))
      .returning({
        id: membership.id,
        role: membership.role,
        schoolId: membership.schoolId,
        status: membership.status,
      });

    return updated!;
  }
}
