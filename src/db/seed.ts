import 'reflect-metadata';
import { dbOwner, withSchoolContext } from './client.js';
import { school, membership, auditEvent } from './schema.js';
import { uuidv7 } from 'uuidv7';

const SCHOOL_A_ID = '01960000-0000-7000-8000-000000000001';
const SCHOOL_B_ID = '01960000-0000-7000-8000-000000000002';
const USER_1_ID = 'seed-kc-user-director-mwinda';
const USER_2_ID = 'seed-kc-user-bursar-beza';

async function seed() {
  console.log('Seeding M1 data…');

  // Insert schools as owner (bypasses RLS)
  await dbOwner
    .insert(school)
    .values([
      {
        id: SCHOOL_A_ID,
        name: 'Complexe Scolaire Mwinda',
        province: 'Kinshasa',
        city: 'Lingwala',
        acceptCdfForUsd: false,
      },
      {
        id: SCHOOL_B_ID,
        name: 'Académie Scolaire Beza',
        province: 'Kinshasa',
        city: 'Gombe',
        acceptCdfForUsd: true,
        cdfPerUsdRate: 280000n,
      },
    ])
    .onConflictDoNothing();

  // Insert memberships as owner
  await dbOwner
    .insert(membership)
    .values([
      {
        id: uuidv7(),
        schoolId: SCHOOL_A_ID,
        keycloakUserId: USER_1_ID,
        email: 'directeur@mwinda.cd',
        role: 'director',
        status: 'active',
      },
      {
        id: uuidv7(),
        schoolId: SCHOOL_B_ID,
        keycloakUserId: USER_2_ID,
        email: 'economat@beza.cd',
        role: 'bursar',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // Write audit events via withSchoolContext to validate RLS is working at seed time
  await withSchoolContext(SCHOOL_A_ID, async (tx) => {
    await tx.insert(auditEvent).values({
      id: uuidv7(),
      schoolId: SCHOOL_A_ID,
      actor: USER_1_ID,
      action: 'seed.created',
      entity: 'school',
      entityId: SCHOOL_A_ID,
    });
  });

  await withSchoolContext(SCHOOL_B_ID, async (tx) => {
    await tx.insert(auditEvent).values({
      id: uuidv7(),
      schoolId: SCHOOL_B_ID,
      actor: USER_2_ID,
      action: 'seed.created',
      entity: 'school',
      entityId: SCHOOL_B_ID,
    });
  });

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
