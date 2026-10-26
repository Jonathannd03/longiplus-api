import 'reflect-metadata';
import { dbOwner } from './client.js';
import {
  school,
  membership,
  auditEvent,
  academicYear,
  period,
  classSection,
  student,
  guardian,
  studentGuardian,
  enrollment,
  subject,
  mark,
  correctionRequest,
  attendance,
  announcement,
  payoutAccount,
} from './schema.js';
import { uuidv7 } from 'uuidv7';
import { sql, and, eq } from 'drizzle-orm';
import { generateCode } from '../modules/registry/luhn.js';

// ── Fixed IDs ────────────────────────────────────────────────────────────────

const SCHOOL_A_ID = '01960000-0000-7000-8000-000000000001';
const SCHOOL_B_ID = '01960000-0000-7000-8000-000000000002';

// These match infra/keycloak/realm-export.json
const USER_1_ID = 'a0000001-0000-4000-8000-000000000001'; // director.mwinda
const USER_2_ID = 'a0000002-0000-4000-8000-000000000002'; // bursar.beza

const YEAR_ID = '01970000-0000-7000-8000-000000000001';

const SECTION_IDS = [
  '01970000-0000-7000-8000-000000000011', // 1S A
  '01970000-0000-7000-8000-000000000012', // 1S B
  '01970000-0000-7000-8000-000000000013', // 2S A
  '01970000-0000-7000-8000-000000000014', // 2S B
  '01970000-0000-7000-8000-000000000015', // 3S A
  '01970000-0000-7000-8000-000000000016', // 3S B
  '01970000-0000-7000-8000-000000000017', // 4S A
  '01970000-0000-7000-8000-000000000018', // 4S B
  '01970000-0000-7000-8000-000000000019', // 5S A
  '01970000-0000-7000-8000-000000000020', // 5S B
  '01970000-0000-7000-8000-000000000021', // 6S A
  '01970000-0000-7000-8000-000000000022', // 6S B
];

// Periods — secondary: 4 cours + 2 examens (P1, P2, ExamS1, P3, P4, ExamS2)
const PERIOD_P1 = '01970000-0000-7001-8000-000000000001';
const PERIOD_P2 = '01970000-0000-7001-8000-000000000002';
const PERIOD_EXAM_S1 = '01970000-0000-7001-8000-000000000003';
const PERIOD_P3 = '01970000-0000-7001-8000-000000000004';
const PERIOD_P4 = '01970000-0000-7001-8000-000000000005';
const PERIOD_EXAM_S2 = '01970000-0000-7001-8000-000000000006';

// Additional Mwinda members (placeholder Keycloak IDs — display only)
const KC = {
  bursar: 'b0000001-0000-4000-8000-000000000001',
  secretary: 'b0000002-0000-4000-8000-000000000001',
  teacher1: 'b0000003-0000-4000-8000-000000000001', // Maths
  teacher2: 'b0000004-0000-4000-8000-000000000001', // Français
  teacher3: 'b0000005-0000-4000-8000-000000000001', // Sciences
};

const MEMBER_ID = {
  bursar: '01970000-0000-7002-8000-000000000001',
  secretary: '01970000-0000-7002-8000-000000000002',
  teacher1: '01970000-0000-7002-8000-000000000003',
  teacher2: '01970000-0000-7002-8000-000000000004',
  teacher3: '01970000-0000-7002-8000-000000000005',
};

const PAYOUT_ID = '01970000-0000-7002-8000-000000000010';

// ── Name pools ────────────────────────────────────────────────────────────────

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

// 7 subjects across all secondary classes
const SUBJECTS = [
  { name: 'Français',                      maxPeriod: 10, maxExam: 20, teacherMemberId: MEMBER_ID.teacher2 },
  { name: 'Mathématiques',                 maxPeriod: 10, maxExam: 20, teacherMemberId: MEMBER_ID.teacher1 },
  { name: 'Sciences Naturelles',           maxPeriod: 10, maxExam: 20, teacherMemberId: MEMBER_ID.teacher3 },
  { name: 'Histoire-Géographie',           maxPeriod: 10, maxExam: 20, teacherMemberId: null },
  { name: 'Religion / Morale',             maxPeriod: 10, maxExam: 20, teacherMemberId: null },
  { name: 'Anglais',                       maxPeriod: 10, maxExam: 20, teacherMemberId: null },
  { name: 'Éducation Physique et Sportive', maxPeriod: 10, maxExam: 10, teacherMemberId: null },
];

// Last 10 school days from Oct 26 2026 (weekdays, no DRC public holidays in this window)
const SCHOOL_DAYS = [
  '2026-10-26', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20',
  '2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Student ability tier: 0=strong, 1=average, 2=weak
function tier(studentSeed: number): number {
  return hash(studentSeed + 42) % 3;
}

function periodScore(studentSeed: number, subjIdx: number, pIdx: number): number {
  const h = hash(studentSeed * 100 + subjIdx * 10 + pIdx);
  const t = tier(studentSeed);
  if (t === 0) return Math.min(10, 7 + (h % 4));  // 7–10
  if (t === 1) return Math.min(10, 5 + (h % 4));  // 5–8
  return Math.max(0, 2 + (h % 5));                 // 2–6
}

function examScore(studentSeed: number, subjIdx: number): number {
  const h = hash(studentSeed * 200 + subjIdx * 10 + 99);
  const t = tier(studentSeed);
  if (t === 0) return Math.min(20, 14 + (h % 7)); // 14–20
  if (t === 1) return Math.min(20, 10 + (h % 7)); // 10–16
  return Math.max(0, 4 + (h % 9));                 // 4–12
}

function makeSubjectId(sectionIdx: number, subjIdx: number): string {
  return `01970000-0000-7003-8000-${String(sectionIdx).padStart(6, '0')}${String(subjIdx).padStart(6, '0')}`;
}

async function batchInsert<T extends object>(
  table: Parameters<typeof dbOwner.insert>[0],
  rows: T[],
  chunkSize = 100,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await dbOwner.insert(table).values(rows.slice(i, i + chunkSize) as T[]).onConflictDoNothing();
  }
}

// ── Main seed ─────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding demo data…');

  // ── Schools and memberships ───────────────────────────────────────────────

  await dbOwner
    .insert(school)
    .values([
      {
        id: SCHOOL_A_ID,
        name: 'Complexe Scolaire Mwinda',
        province: 'Kinshasa',
        city: 'Lingwala',
        address: 'Av. des Écoles, n° 12',
        contactPhone: '+243812345678',
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

  // Additional Mwinda staff
  await dbOwner
    .insert(membership)
    .values([
      {
        id: MEMBER_ID.bursar,
        schoolId: SCHOOL_A_ID,
        keycloakUserId: KC.bursar,
        email: 'economat@mwinda.cd',
        role: 'bursar',
        status: 'active',
      },
      {
        id: MEMBER_ID.secretary,
        schoolId: SCHOOL_A_ID,
        keycloakUserId: KC.secretary,
        email: 'secretariat@mwinda.cd',
        role: 'secretary',
        status: 'active',
      },
      {
        id: MEMBER_ID.teacher1,
        schoolId: SCHOOL_A_ID,
        keycloakUserId: KC.teacher1,
        email: 'kayembe.p@mwinda.cd',
        role: 'teacher',
        status: 'active',
      },
      {
        id: MEMBER_ID.teacher2,
        schoolId: SCHOOL_A_ID,
        keycloakUserId: KC.teacher2,
        email: 'maloba.j@mwinda.cd',
        role: 'teacher',
        status: 'active',
      },
      {
        id: MEMBER_ID.teacher3,
        schoolId: SCHOOL_A_ID,
        keycloakUserId: KC.teacher3,
        email: 'tshimanga.d@mwinda.cd',
        role: 'teacher',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // Payout account (Airtel Money) — active for demo payments
  await dbOwner
    .insert(payoutAccount)
    .values({
      id: PAYOUT_ID,
      schoolId: SCHOOL_A_ID,
      kind: 'mobile_money',
      operator: 'Airtel Money',
      numberMasked: '+243 8X XXX 0012',
      status: 'active',
      approvedBy: USER_1_ID,
      approvedAt: new Date('2026-09-01T08:00:00Z'),
      activatesAt: new Date('2026-09-01T08:00:00Z'),
    })
    .onConflictDoNothing();

  await dbOwner
    .insert(auditEvent)
    .values({
      id: uuidv7(),
      schoolId: SCHOOL_A_ID,
      actor: USER_1_ID,
      action: 'seed.created',
      entity: 'school',
      entityId: SCHOOL_A_ID,
    });

  // ── Academic year and sections ────────────────────────────────────────────

  await dbOwner
    .insert(academicYear)
    .values({
      id: YEAR_ID,
      schoolId: SCHOOL_A_ID,
      label: '2026-2027',
      startsOn: '2026-09-01',
      endsOn: '2027-07-02',
      gradingType: 'secondary',
      status: 'active',
    })
    .onConflictDoNothing();

  // Periods (secondary: 4 cours + 2 examens)
  // P1 + P2 + ExamS1 are locked (S1 complete), P3 open (current), P4 + ExamS2 open (upcoming)
  await dbOwner
    .insert(period)
    .values([
      {
        id: PERIOD_P1,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'period',
        sequence: 1,
        semesterOrTrimester: 1,
        label: 'Période 1',
        startsOn: '2026-09-01',
        endsOn: '2026-10-03',
        status: 'locked',
      },
      {
        id: PERIOD_P2,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'period',
        sequence: 2,
        semesterOrTrimester: 1,
        label: 'Période 2',
        startsOn: '2026-10-06',
        endsOn: '2026-11-07',
        status: 'locked',
      },
      {
        id: PERIOD_EXAM_S1,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'exam',
        sequence: 3,
        semesterOrTrimester: 1,
        label: 'Examen S1',
        startsOn: '2026-11-10',
        endsOn: '2026-12-05',
        status: 'locked',
      },
      {
        id: PERIOD_P3,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'period',
        sequence: 4,
        semesterOrTrimester: 2,
        label: 'Période 3',
        startsOn: '2027-01-13',
        endsOn: '2027-02-28',
        status: 'open',
      },
      {
        id: PERIOD_P4,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'period',
        sequence: 5,
        semesterOrTrimester: 2,
        label: 'Période 4',
        startsOn: '2027-03-08',
        endsOn: '2027-04-23',
        status: 'open',
      },
      {
        id: PERIOD_EXAM_S2,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        kind: 'exam',
        sequence: 6,
        semesterOrTrimester: 2,
        label: 'Examen S2',
        startsOn: '2027-05-05',
        endsOn: '2027-06-04',
        status: 'open',
      },
    ])
    .onConflictDoNothing();

  for (let i = 0; i < SECTIONS.length; i++) {
    await dbOwner
      .insert(classSection)
      .values({
        id: SECTION_IDS[i]!,
        schoolId: SCHOOL_A_ID,
        yearId: YEAR_ID,
        level: SECTIONS[i]!.level,
        name: SECTIONS[i]!.name,
      })
      .onConflictDoNothing();
  }

  // Subjects (7 per section × 12 sections = 84 subjects)
  const subjectRows = SECTIONS.flatMap((_, si) =>
    SUBJECTS.map((sub, ji) => ({
      id: makeSubjectId(si, ji),
      schoolId: SCHOOL_A_ID,
      classSectionId: SECTION_IDS[si]!,
      name: sub.name,
      maxPeriod: sub.maxPeriod,
      maxExam: sub.maxExam,
      teacherId: sub.teacherMemberId,
    })),
  );
  await batchInsert(subject, subjectRows);

  // ── Students and enrollments ──────────────────────────────────────────────

  const [countRow] = (await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM enrollment WHERE school_id = ${SCHOOL_A_ID} AND year_id = ${YEAR_ID}`,
  )) as Array<{ cnt: string }>;

  const studentsAlreadySeeded = Number(countRow?.cnt ?? 0) > 0;

  if (studentsAlreadySeeded) {
    console.log(`  Students already seeded (${countRow?.cnt} enrollments) — skipping student generation.`);
  } else {
    const TOTAL = 400;
    const perClass = Math.floor(TOTAL / SECTIONS.length);
    let studentCount = 0;
    let guardianCount = 0;

    for (let ci = 0; ci < SECTIONS.length; ci++) {
      const sectionId = SECTION_IDS[ci]!;
      const classCount = ci < TOTAL % SECTIONS.length ? perClass + 1 : perClass;

      for (let si = 0; si < classCount; si++) {
        const s = ci * 1000 + si;
        const isFemale = hash(s + 1) % 3 === 0;
        const sex = isFemale ? 'F' : 'M';
        const firstNames = isFemale ? FIRST_NAMES_F : FIRST_NAMES_M;

        const lastName = pick(LAST_NAMES, hash(s));
        const postName = pick(POST_NAMES, hash(s + 2));
        const firstName = pick(firstNames, hash(s + 3));
        const birthYear = 2006 + (ci % 6);
        const birthMonth = String((hash(s + 4) % 12) + 1).padStart(2, '0');
        const birthDay = String((hash(s + 5) % 28) + 1).padStart(2, '0');
        const birthDate = `${birthYear}-${birthMonth}-${birthDay}`;
        const birthPlace = pick(BIRTH_PLACES, hash(s + 6));

        const seqRows = (await dbOwner.execute(
          sql`SELECT nextval('student_code_seq') AS val`,
        )) as Array<{ val: string | bigint }>;
        const code = generateCode(String(seqRows[0]!.val).padStart(8, '0'));

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

        if (hash(s + 7) % 10 < 7) {
          const gLastName = pick(LAST_NAMES, hash(s + 8));
          const gFirstName = pick(FIRST_NAMES_M, hash(s + 9));
          const suffix = String(hash(s + 11) % 10000000).padStart(7, '0');
          const prefix = 8 + (hash(s + 10) % 2);
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
  }

  // ── Marks ─────────────────────────────────────────────────────────────────
  // Locked periods: 100% of students have complete marks (S1 done)
  // P3 (open/current): 65% of students, first 5 subjects only (teachers mid-entry)

  const [markCountRow] = (await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM mark WHERE school_id = ${SCHOOL_A_ID}`,
  )) as Array<{ cnt: string }>;

  if (Number(markCountRow?.cnt ?? 0) > 0) {
    console.log(`  Marks already seeded (${markCountRow?.cnt}) — skipping.`);
  } else {
    console.log('  Seeding marks…');

    // Fetch all enrollments grouped by section
    const allEnrollments = await dbOwner
      .select({ studentId: enrollment.studentId, classSectionId: enrollment.classSectionId })
      .from(enrollment)
      .where(
        and(eq(enrollment.schoolId, SCHOOL_A_ID), eq(enrollment.yearId, YEAR_ID), eq(enrollment.status, 'active')),
      );

    const bySection = new Map<string, string[]>();
    for (const e of allEnrollments) {
      if (!bySection.has(e.classSectionId)) bySection.set(e.classSectionId, []);
      bySection.get(e.classSectionId)!.push(e.studentId);
    }

    const lockedPeriods: Array<{ id: string; kind: 'period' | 'exam'; pIdx: number }> = [
      { id: PERIOD_P1, kind: 'period', pIdx: 0 },
      { id: PERIOD_P2, kind: 'period', pIdx: 1 },
      { id: PERIOD_EXAM_S1, kind: 'exam', pIdx: 2 },
    ];

    let markCount = 0;

    for (let si = 0; si < SECTION_IDS.length; si++) {
      const sectionId = SECTION_IDS[si]!;
      const sectionStudents = bySection.get(sectionId) ?? [];

      // Locked periods — all students, all subjects
      for (const { id: periodId, kind, pIdx } of lockedPeriods) {
        const batch = [];
        for (let stIdx = 0; stIdx < sectionStudents.length; stIdx++) {
          const studentSeed = si * 1000 + stIdx;
          for (let ji = 0; ji < SUBJECTS.length; ji++) {
            const score =
              kind === 'exam'
                ? examScore(studentSeed, ji)
                : periodScore(studentSeed, ji, pIdx);
            batch.push({
              id: uuidv7(),
              schoolId: SCHOOL_A_ID,
              studentId: sectionStudents[stIdx]!,
              subjectId: makeSubjectId(si, ji),
              periodId,
              score,
              recordedBy: USER_1_ID,
            });
          }
        }
        await batchInsert(mark, batch);
        markCount += batch.length;
      }

      // P3 (open) — 65% of students, 5 of 7 subjects (active entry simulation)
      const p3Batch = [];
      for (let stIdx = 0; stIdx < sectionStudents.length; stIdx++) {
        if (hash(si * 500 + stIdx) % 100 >= 65) continue;
        const studentSeed = si * 1000 + stIdx;
        for (let ji = 0; ji < 5; ji++) {
          p3Batch.push({
            id: uuidv7(),
            schoolId: SCHOOL_A_ID,
            studentId: sectionStudents[stIdx]!,
            subjectId: makeSubjectId(si, ji),
            periodId: PERIOD_P3,
            score: periodScore(studentSeed, ji, 3),
            recordedBy: KC.teacher1,
          });
        }
      }
      await batchInsert(mark, p3Batch);
      markCount += p3Batch.length;
    }

    console.log(`  ${markCount} marks seeded`);
  }

  // ── Attendance (last 10 school days) ─────────────────────────────────────

  const [attCountRow] = (await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM attendance WHERE school_id = ${SCHOOL_A_ID}`,
  )) as Array<{ cnt: string }>;

  if (Number(attCountRow?.cnt ?? 0) > 0) {
    console.log(`  Attendance already seeded (${attCountRow?.cnt}) — skipping.`);
  } else {
    console.log('  Seeding attendance…');

    const allEnrollments2 = await dbOwner
      .select({ studentId: enrollment.studentId, classSectionId: enrollment.classSectionId })
      .from(enrollment)
      .where(
        and(eq(enrollment.schoolId, SCHOOL_A_ID), eq(enrollment.yearId, YEAR_ID), eq(enrollment.status, 'active')),
      );

    const bySection2 = new Map<string, string[]>();
    for (const e of allEnrollments2) {
      if (!bySection2.has(e.classSectionId)) bySection2.set(e.classSectionId, []);
      bySection2.get(e.classSectionId)!.push(e.studentId);
    }

    let attCount = 0;
    for (const [dayIdx, day] of SCHOOL_DAYS.entries()) {
      const batch = [];
      for (let si = 0; si < SECTION_IDS.length; si++) {
        const sectionId = SECTION_IDS[si]!;
        const students = bySection2.get(sectionId) ?? [];
        for (let stIdx = 0; stIdx < students.length; stIdx++) {
          const h = hash(si * 10000 + stIdx * 100 + dayIdx);
          let status: 'present' | 'absent' | 'late' | 'excused';
          const r = h % 100;
          if (r < 88) status = 'present';
          else if (r < 94) status = 'absent';
          else if (r < 97) status = 'late';
          else status = 'excused';

          batch.push({
            id: uuidv7(),
            schoolId: SCHOOL_A_ID,
            studentId: students[stIdx]!,
            classSectionId: sectionId,
            date: day,
            status,
            recordedBy: USER_1_ID,
          });
        }
      }
      await batchInsert(attendance, batch, 200);
      attCount += batch.length;
    }

    console.log(`  ${attCount} attendance records seeded`);
  }

  // ── Correction requests (pending, on Examen S1 marks) ────────────────────

  const [crCountRow] = (await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM correction_request WHERE school_id = ${SCHOOL_A_ID}`,
  )) as Array<{ cnt: string }>;

  if (Number(crCountRow?.cnt ?? 0) > 0) {
    console.log(`  Correction requests already seeded — skipping.`);
  } else {
    // Pick Français Examen S1 marks from section 0 (1S A) for corrections
    const candidateMarks = await dbOwner
      .select({ id: mark.id, score: mark.score })
      .from(mark)
      .where(
        and(
          eq(mark.schoolId, SCHOOL_A_ID),
          eq(mark.periodId, PERIOD_EXAM_S1),
          eq(mark.subjectId, makeSubjectId(0, 0)), // Français, 1S A
        ),
      )
      .limit(5);

    if (candidateMarks.length > 0) {
      const reasons = [
        "Erreur de report — la copie porte 16, la liste affiche 14.",
        "Absence justifiée lors de l'examen, session de rattrapage accordée.",
        "Feuille mal lue — score réel confirmé par le professeur.",
        "Calcul incorrect lors de la correction par le titulaire.",
        "Doublon de saisie corrigé après vérification du procès-verbal.",
      ];
      await dbOwner.insert(correctionRequest).values(
        candidateMarks.map((m, i) => ({
          id: uuidv7(),
          schoolId: SCHOOL_A_ID,
          markId: m.id,
          requestedBy: KC.teacher2,
          reason: reasons[i % reasons.length]!,
          newScore: Math.min(20, (m.score ?? 10) + 2),
          status: 'pending' as const,
        })),
      );
      console.log(`  ${candidateMarks.length} correction requests seeded`);
    }
  }

  // ── Announcements ─────────────────────────────────────────────────────────

  const [annCountRow] = (await dbOwner.execute(
    sql`SELECT COUNT(*) AS cnt FROM announcement WHERE school_id = ${SCHOOL_A_ID}`,
  )) as Array<{ cnt: string }>;

  if (Number(annCountRow?.cnt ?? 0) > 0) {
    console.log(`  Announcements already seeded — skipping.`);
  } else {
    await dbOwner.insert(announcement).values([
      {
        id: uuidv7(),
        schoolId: SCHOOL_A_ID,
        authorId: USER_1_ID,
        message:
          "Chers parents, nous avons le plaisir de vous annoncer l'ouverture officielle de l'année scolaire 2026-2027 au Complexe Scolaire Mwinda. Les cours débutent ce lundi 1er septembre. Bienvenue à toutes les familles.",
        audience: 'all',
        sentAt: new Date('2026-09-01T07:30:00Z'),
        recipientCount: 280,
      },
      {
        id: uuidv7(),
        schoolId: SCHOOL_A_ID,
        authorId: USER_1_ID,
        message:
          "Rappel : les examens du premier semestre (S1) débuteront le lundi 10 novembre 2026. Les élèves sont priés d'apporter leur carte d'identité scolaire. Aucun retard ne sera toléré.",
        audience: 'all',
        sentAt: new Date('2026-10-20T16:00:00Z'),
        recipientCount: 285,
      },
      {
        id: uuidv7(),
        schoolId: SCHOOL_A_ID,
        authorId: USER_1_ID,
        message:
          "Réunion parents-professeurs prévue le samedi 15 novembre 2026 de 8h à 12h. La présence de tous les parents est fortement souhaitée. Programme disponible à la direction.",
        audience: 'all',
        scheduledAt: new Date('2026-11-15T06:00:00Z'),
        recipientCount: 0,
      },
    ]);
    console.log('  3 announcements seeded');
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
