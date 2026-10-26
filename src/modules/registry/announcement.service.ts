import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { announcement, guardian, studentGuardian, enrollment, classSection } from '../../db/schema.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';

interface SendAnnouncementDto {
  message: string;
  audience: 'all' | 'section';
  classSectionId?: string;
  yearId: string;
}

@Injectable()
export class AnnouncementService {
  constructor(@Inject(SMS_SENDER) private readonly sms: SmsSender) {}

  async list(schoolId: string) {
    return dbOwner
      .select()
      .from(announcement)
      .where(eq(announcement.schoolId, schoolId))
      .orderBy(desc(announcement.createdAt))
      .limit(50);
  }

  async send(tx: TxDB, schoolId: string, dto: SendAnnouncementDto, authorId: string) {
    const [row] = await tx
      .insert(announcement)
      .values({
        schoolId,
        authorId,
        message: dto.message,
        audience: dto.audience,
        classSectionId: dto.classSectionId ?? null,
        sentAt: new Date(),
      })
      .returning();

    const phones = await this.resolvePhones(schoolId, dto);
    for (const phone of phones) {
      await this.sms.send(phone, dto.message).catch(() => undefined);
    }

    await tx
      .update(announcement)
      .set({ recipientCount: phones.length })
      .where(eq(announcement.id, row!.id));

    return { ...row!, recipientCount: phones.length };
  }

  private async resolvePhones(schoolId: string, dto: SendAnnouncementDto): Promise<string[]> {
    let studentIds: string[];

    if (dto.audience === 'section' && dto.classSectionId) {
      const rows = await dbOwner
        .select({ studentId: enrollment.studentId })
        .from(enrollment)
        .where(
          eq(enrollment.classSectionId, dto.classSectionId),
        );
      studentIds = rows.map((r) => r.studentId);
    } else {
      const rows = await dbOwner
        .select({ studentId: enrollment.studentId })
        .from(enrollment)
        .innerJoin(classSection, eq(classSection.id, enrollment.classSectionId))
        .where(eq(enrollment.schoolId, schoolId));
      studentIds = rows.map((r) => r.studentId);
    }

    if (!studentIds.length) return [];

    const guardianRows = await dbOwner
      .selectDistinct({ phone: guardian.phoneE164 })
      .from(studentGuardian)
      .innerJoin(guardian, eq(guardian.id, studentGuardian.guardianId))
      .where(
        and(
          eq(guardian.schoolId, schoolId),
          inArray(studentGuardian.studentId, studentIds),
        ),
      );

    return guardianRows.map((r) => r.phone);
  }
}
