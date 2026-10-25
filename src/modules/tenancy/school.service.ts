import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { dbOwner } from '../../db/client.js';
import type { TxDB } from '../../db/client.js';
import { school } from '../../db/schema.js';

interface UpdateProfileDto {
  name?: string;
  province?: string;
  city?: string;
  address?: string;
  contactPhone?: string;
  logoRef?: string;
  acceptCdfForUsd?: boolean;
  cdfPerUsdRate?: bigint;
}

@Injectable()
export class SchoolService {
  async findById(schoolId: string) {
    const [row] = await dbOwner
      .select({
        id: school.id,
        name: school.name,
        province: school.province,
        city: school.city,
        address: school.address,
        contactPhone: school.contactPhone,
        logoRef: school.logoRef,
        acceptCdfForUsd: school.acceptCdfForUsd,
        cdfPerUsdRate: school.cdfPerUsdRate,
      })
      .from(school)
      .where(eq(school.id, schoolId))
      .limit(1);
    return row ?? null;
  }

  async updateProfile(tx: TxDB, schoolId: string, dto: UpdateProfileDto) {
    const [updated] = await tx
      .update(school)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.province !== undefined && { province: dto.province }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.contactPhone !== undefined && { contactPhone: dto.contactPhone }),
        ...(dto.logoRef !== undefined && { logoRef: dto.logoRef }),
        ...(dto.acceptCdfForUsd !== undefined && { acceptCdfForUsd: dto.acceptCdfForUsd }),
        ...(dto.cdfPerUsdRate !== undefined && { cdfPerUsdRate: dto.cdfPerUsdRate }),
      })
      .where(eq(school.id, schoolId))
      .returning({ id: school.id });
    return updated ?? null;
  }
}
