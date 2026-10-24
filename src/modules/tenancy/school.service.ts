import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { school } from '../../db/schema.js';

@Injectable()
export class SchoolService {
  async findById(schoolId: string) {
    const [row] = await db
      .select({ id: school.id, name: school.name })
      .from(school)
      .where(eq(school.id, schoolId))
      .limit(1);
    return row ?? null;
  }
}
