import 'reflect-metadata';
import { dbOwner, withSchoolContext } from './client.js';
import {
  school,
  membership,
  auditEvent,
  academicYear,
  classSection,
  student,
  guardian,
  studentGuardian,
  enrollment,
} from './schema.js';
import { uuidv7 } from 'uuidv7';
import { sql } from 'drizzle-orm';
import { generateCode } from '../modules/registry/luhn.js';

const SCHOOL_A_ID = '01960000-0000-7000-8000-000000000001';
const SCHOOL_B_ID = '01960000-0000-7000-8000-000000000002';
const USER_1_ID = 'seed-kc-user-director-mwinda';
const USER_2_ID = 'seed-kc-user-bursar-beza';

// Fixed IDs for 2026-2027 academic year and sections (idempotent)
const YEAR_ID = '01970000-0000-7000-8000-000000000001';
const SECTION_IDS = [
  '01970000-0000-7000-8000-000000000011',
  '01970000-0000-7000-8000-000000000012',
  '01970000-0000-7000-8000-000000000013',
  '01970000-0000-7000-8000-000000000014',
  '01970000-0000-7000-8000-000000000015',
  '01970000-0000-7000-8000-000000000016',
  '01970000-0000-7000-8000-000000000017',
  '01970000-0000-7000-8000-000000000018',
  '01970000-0000-7000-8000-000000000019',
  '01970000-0000-7000-8000-000000000020',
  '01970000-0000-7000-8000-000000000021',
  '01970000-0000-7000-8000-000000000022',
];

const SECTIONS = [
  { level: '1ère secondaire', name: '1S A' },
  { level: '1ère secondaire', name: '1S B' },
  { level: '2ème secondaire', name: '2S A' },
  { level: '2ème secondaire', name: '2S B' },
  { level: '3ème secondaire', name: '3S A' },
  { level: '3ème secondaire', name: '3S B' },
  { level: '4ème secondaire', name: '4S A' },
  { level: '4ème secondaire', name: '4S B' },
  { level: '5ème secondaire', name: '5S A' },
  { level: '5ème secondaire', name: '5S B' },
  { level: '6ème secondaire', name: '6S A' },
  { level: '6ème secondaire', name: '6S B' },
];

// ─── Name pools ───────────────────────────────────────────────────────────────

const LAST_NAMES = [
  'KABONGO', 'MULUMBA', 'ILUNGA', 'KASONGO', 'BANZA', 'MWAMBA', 'MUTOMBO', 'NGOY',
  'KALALA', 'MUKENDI', 'TSHIMANGA', 'KYUNGU', 'MABIKA', 'NKUBA', 'LUBOYA', 'WEMBI',
  'MPIANA', 'KAYEMBE', 'NZUZI', 'NSIMBA', 'AMISI', 'BALUME', 'LUKUSA', 'MBUYI',
  'KALONJI', 'TSHILUMBA', 'MUAMBA', 'NGOYI', 'KANYINDA', 'NTUMBA', 'KASEYA',
  'TSHIBANDA', 'BINTU', 'NGANDU', 'MUTEBA', 'SUMBU', 'MALOBA', 'KITENGE', 'MUPEMBA',
  'KANDA', 'LUFUTA', 'MASUDI', 'WILA', 'KANGAJ', 'KAZADI', 'MWENE', 'KAPITA',
];

const POST_NAMES = [
  'Ilunga', 'Kayembe', 'Kabila', 'Nkongolo', 'Lufuta', 'Mwana', 'Tshala', 'Kateke',
  'Mbuyi', 'Kielo', 'Lukasa', 'Mpoto', 'Nkashama', 'Mulamba', 'Yanga', 'Ngandu',
  'Mfumu', 'Wambo', 'Kafula', 'Ntumba', 'Muya', 'Banza', 'Kasongo', 'Muteba',
];

const FIRST_NAMES_M = [
  'Jean', 'Pierre', 'Paul', 'Joseph', 'David', 'Daniel', 'Jonathan', 'Emmanuel',
  'Benjamin', 'Samuel', 'Nathan', 'Aaron', 'Joshua', 'Simon', 'Thomas', 'Mark',
  'Caleb', 'Kevin', 'Patrick', 'Richard', 'Olivier', 'Christophe', 'Didier',
  'Serge', 'Bruno', 'Cédric', 'Fabrice', 'Gaëtan', 'Hervé', 'Aimé',
];

const FIRST_NAMES_F = [
  'Marie', 'Sarah', 'Grace', 'Esther', 'Ruth', 'Naomi', 'Rebecca', 'Hannah',
  'Miriam', 'Rachel', 'Lydia', 'Christine', 'Catherine', 'Angélique', 'Chantal',
  'Brigitte', 'Claire', 'Denise', 'Félicité', 'Monique', 'Nicole', 'Pascale',
  'Rose', 'Sophie', 'Thérèse', 'Victorine', 'Aimée', 'Clarisse', 'Ornella', 'Joie',
];

const BIRTH_PLACES = [
  'Kinshasa', 'Lubumbashi', 'Mbuji-Mayi', 'Kananga', 'Kisangani', 'Goma',
  'Bukavu', 'Likasi', 'Kolwezi', 'Kalemie', 'Uvira', 'Butembo',
];

function pick<T>(arr: T[], idx: number): T {
  return arr[Math.abs(idx) % arr.length]!;
}

function hash(n: number): number {
  let s = n;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  return Math.abs(s);
}

async function seed() {
  console.log('Seeding demo data…');

  // ── M1: schools and memberships ───────────────────────────────────────────────
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

  // ── M3: academic year, sections, students ─────────────────────────────────────

  await dbOwner.insert(academicYear).values({
    id: YEAR_ID,
    schoolId: SCHOOL_A_ID,
    label: '2026-2027',
    startsOn: '2026-09-01',
    endsOn: '2027-07-01',
    gradingType: 'secondary',
    status: 'active',
  }).onConflictDoNothing();

  for (let i = 0; i < SECTIONS.length; i++) {
    await dbOwner.insert(classSection).values({
      id: SECTION_IDS[i]!,
      schoolId: SCHOOL_A_ID,
      yearId: YEAR_ID,
      level: SECTIONS[i]!.level,
      name: SECTIONS[i]!.name,
    }).onConflictDoNothing();
  }

  // Skip students if already seeded
  const [countRow] = await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM enrollment WHERE school_id = ${SCHOOL_A_ID} AND year_id = ${YEAR_ID}`,
  ) as Array<{ cnt: string }>;

  if (Number(countRow?.cnt ?? 0) > 0) {
    console.log(`  Students already seeded (${countRow?.cnt} enrollments found) — skipping.`);
    console.log('Seed complete.');
    process.exit(0);
  }

  // Generate student codes from sequence
  const TOTAL = 400;
  const perClass = Math.floor(TOTAL / SECTIONS.length);

  let studentCount = 0;
  let guardianCount = 0;

  for (let ci = 0; ci < SECTIONS.length; ci++) {
    const sectionId = SECTION_IDS[ci]!;
    const classCount = ci < TOTAL % SECTIONS.length ? perClass + 1 : perClass;

    for (let si = 0; si < classCount; si++) {
      const seed = ci * 1000 + si;
      const isFemale = hash(seed + 1) % 3 === 0;
      const sex = isFemale ? 'F' : 'M';
      const firstNames = isFemale ? FIRST_NAMES_F : FIRST_NAMES_M;

      const lastName = pick(LAST_NAMES, hash(seed));
      const postName = pick(POST_NAMES, hash(seed + 2));
      const firstName = pick(firstNames, hash(seed + 3));
      const birthYear = 2006 + (ci % 6);
      const birthMonth = String((hash(seed + 4) % 12) + 1).padStart(2, '0');
      const birthDay = String((hash(seed + 5) % 28) + 1).padStart(2, '0');
      const birthDate = `${birthYear}-${birthMonth}-${birthDay}`;
      const birthPlace = pick(BIRTH_PLACES, hash(seed + 6));

      // Get next sequence value for student code
      const seqRows = await dbOwner.execute(sql`SELECT nextval('student_code_seq') AS val`) as Array<{ val: string | bigint }>;
      const val = seqRows[0]?.val;
      const code = generateCode(String(val).padStart(8, '0'));

      const studentId = uuidv7();
      await dbOwner.insert(student).values({
        id: studentId,
        schoolId: SCHOOL_A_ID,
        studentCode: code,
        lastName,
        postName,
        firstName,
        sex,
        birthDate,
        birthPlace,
      });

      await dbOwner.insert(enrollment).values({
        id: uuidv7(),
        schoolId: SCHOOL_A_ID,
        studentId,
        classSectionId: sectionId,
        yearId: YEAR_ID,
        status: 'active',
      });

      // Guardian for ~70% of students
      if (hash(seed + 7) % 10 < 7) {
        const gLastName = pick(LAST_NAMES, hash(seed + 8));
        const gFirstName = pick(FIRST_NAMES_M, hash(seed + 9));
        const suffix = String(hash(seed + 11) % 10000000).padStart(7, '0');
        const prefix = 8 + (hash(seed + 10) % 2);
        const phone = `+243${prefix}${suffix}`;

        const guardianId = uuidv7();
        await dbOwner.insert(guardian).values({
          id: guardianId,
          schoolId: SCHOOL_A_ID,
          fullName: `${gLastName} ${gFirstName}`,
          phoneE164: phone,
          relationship: 'parent',
        });
        await dbOwner.insert(studentGuardian).values({ studentId, guardianId });
        guardianCount++;
      }

      studentCount++;
    }
  }

  console.log(`  ${studentCount} students, ${guardianCount} guardians seeded`);
  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
