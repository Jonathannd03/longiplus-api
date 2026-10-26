import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  bigint,
  integer,
  date,
  jsonb,
  timestamp,
  uniqueIndex,
  varchar,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum('role', [
  'owner',
  'director',
  'bursar',
  'secretary',
  'teacher',
  'class_teacher',
  'kelasi_admin',
]);

export const membershipStatusEnum = pgEnum('membership_status', [
  'active',
  'invited',
  'suspended',
]);

export const payoutAccountKindEnum = pgEnum('payout_account_kind', [
  'mobile_money',
  'bank',
]);

export const payoutAccountStatusEnum = pgEnum('payout_account_status', [
  'pending',
  'active',
  'suspended',
]);

export const academicYearStatusEnum = pgEnum('academic_year_status', [
  'draft',
  'active',
  'closed',
]);

export const gradingTypeEnum = pgEnum('grading_type', ['primary', 'secondary']);

export const periodKindEnum = pgEnum('period_kind', ['period', 'exam']);

export const periodStatusEnum = pgEnum('period_status', [
  'open',
  'closed',
  'locked',
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const school = pgTable('school', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  province: text('province').notNull(),
  city: text('city').notNull(),
  address: text('address'),
  contactPhone: text('contact_phone'),
  logoRef: text('logo_ref'),
  settings: jsonb('settings'),
  cdfPerUsdRate: bigint('cdf_per_usd_rate', { mode: 'bigint' }),
  acceptCdfForUsd: boolean('accept_cdf_for_usd').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const membership = pgTable(
  'membership',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id),
    keycloakUserId: text('keycloak_user_id').notNull(),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    phone: text('phone'),
    inviteCode: varchar('invite_code', { length: 6 }),
    inviteCodeExpiresAt: timestamp('invite_code_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('membership_user_school_uidx').on(t.schoolId, t.keycloakUserId)],
);

export const payoutAccount = pgTable('payout_account', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => school.id),
  kind: payoutAccountKindEnum('kind').notNull(),
  operator: text('operator'),
  numberMasked: text('number_masked').notNull(),
  status: payoutAccountStatusEnum('status').notNull().default('pending'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  activatesAt: timestamp('activates_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: no UPDATE/DELETE grant for longiplus_app role
export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: uuid('entity_id'),
  beforeHash: text('before_hash'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

// Cross-tenant relay — no RLS
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

// ─── M2: Academic structure ───────────────────────────────────────────────────

export const academicYear = pgTable('academic_year', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => school.id),
  label: text('label').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  gradingType: gradingTypeEnum('grading_type').notNull(),
  status: academicYearStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const period = pgTable('period', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => school.id),
  yearId: uuid('year_id')
    .notNull()
    .references(() => academicYear.id),
  kind: periodKindEnum('kind').notNull(),
  sequence: integer('sequence').notNull(),
  // which trimester (1–3) or semester (1–2) this belongs to
  semesterOrTrimester: integer('semester_or_trimester'),
  label: text('label').notNull(),
  startsOn: date('starts_on'),
  endsOn: date('ends_on'),
  status: periodStatusEnum('status').notNull().default('open'),
});

export const classSection = pgTable('class_section', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => school.id),
  yearId: uuid('year_id')
    .notNull()
    .references(() => academicYear.id),
  level: text('level').notNull(),
  option: text('option'),
  name: text('name').notNull(),
  classTeacherId: uuid('class_teacher_id').references(() => membership.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sexEnum = pgEnum('sex', ['M', 'F']);

export const enrollmentStatusEnum = pgEnum('enrollment_status', [
  'active',
  'transferred',
  'withdrawn',
]);

export const subject = pgTable('subject', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id')
    .notNull()
    .references(() => school.id),
  classSectionId: uuid('class_section_id')
    .notNull()
    .references(() => classSection.id),
  name: text('name').notNull(),
  maxPeriod: integer('max_period').notNull().default(10),
  maxExam: integer('max_exam'),
  teacherId: uuid('teacher_id').references(() => membership.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── M3: Registry ─────────────────────────────────────────────────────────────

// student_code_seq is defined in the migration (not in Drizzle schema)
export const studentImportBatch = pgTable('student_import_batch', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  fileName: text('file_name').notNull(),
  rowCount: integer('row_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const student = pgTable('student', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  studentCode: varchar('student_code', { length: 9 }).notNull().unique(),
  lastName: text('last_name').notNull(),
  postName: text('post_name').notNull(),
  firstName: text('first_name').notNull(),
  sex: sexEnum('sex').notNull(),
  birthDate: date('birth_date').notNull(),
  birthPlace: text('birth_place').notNull(),
  photoRef: text('photo_ref'),
  importBatchId: uuid('import_batch_id').references(() => studentImportBatch.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guardian = pgTable('guardian', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  fullName: text('full_name').notNull(),
  phoneE164: text('phone_e164').notNull(),
  relationship: text('relationship').notNull().default('guardian'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const studentGuardian = pgTable(
  'student_guardian',
  {
    studentId: uuid('student_id').notNull().references(() => student.id),
    guardianId: uuid('guardian_id').notNull().references(() => guardian.id),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.guardianId] })],
);

export const enrollment = pgTable('enrollment', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  studentId: uuid('student_id').notNull().references(() => student.id),
  classSectionId: uuid('class_section_id').notNull().references(() => classSection.id),
  yearId: uuid('year_id').notNull().references(() => academicYear.id),
  status: enrollmentStatusEnum('status').notNull().default('active'),
  withdrawalReason: text('withdrawal_reason'),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── M7: Grades ───────────────────────────────────────────────────────────────

export const mark = pgTable(
  'mark',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    schoolId: uuid('school_id').notNull().references(() => school.id),
    studentId: uuid('student_id').notNull().references(() => student.id),
    subjectId: uuid('subject_id').notNull().references(() => subject.id),
    periodId: uuid('period_id').notNull().references(() => period.id),
    score: integer('score'),
    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mark_student_subject_period_uidx').on(t.studentId, t.subjectId, t.periodId)],
);

export const correctionStatusEnum = pgEnum('correction_status', ['pending', 'approved', 'rejected']);

export const correctionRequest = pgTable('correction_request', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  markId: uuid('mark_id').notNull().references(() => mark.id),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason').notNull(),
  newScore: integer('new_score').notNull(),
  status: correctionStatusEnum('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── M3b: Attendance ──────────────────────────────────────────────────────────

export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'absent',
  'late',
  'excused',
]);

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    schoolId: uuid('school_id').notNull().references(() => school.id),
    studentId: uuid('student_id').notNull().references(() => student.id),
    classSectionId: uuid('class_section_id').notNull().references(() => classSection.id),
    date: date('date').notNull(),
    status: attendanceStatusEnum('status').notNull().default('absent'),
    recordedBy: text('recorded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attendance_student_date_section_uidx').on(t.studentId, t.classSectionId, t.date),
  ],
);

// ─── M8: Announcements, Bulletins, Public sign-up ────────────────────────────

export const announcementAudienceEnum = pgEnum('announcement_audience', [
  'all',
  'section',
]);

export const announcement = pgTable('announcement', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  authorId: text('author_id').notNull(),
  message: text('message').notNull(),
  audience: announcementAudienceEnum('audience').notNull().default('all'),
  classSectionId: uuid('class_section_id').references(() => classSection.id),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  recipientCount: integer('recipient_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bulletin = pgTable('bulletin', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolId: uuid('school_id').notNull().references(() => school.id),
  studentId: uuid('student_id').notNull().references(() => student.id),
  classSectionId: uuid('class_section_id').notNull().references(() => classSection.id),
  periodId: uuid('period_id').notNull().references(() => period.id),
  yearId: uuid('year_id').notNull().references(() => academicYear.id),
  pdfRef: text('pdf_ref'),
  publicToken: varchar('public_token', { length: 64 }).unique(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'approved',
  'rejected',
]);

export const schoolApplication = pgTable('school_application', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  schoolName: text('school_name').notNull(),
  province: text('province').notNull(),
  city: text('city').notNull(),
  address: text('address'),
  directorName: text('director_name').notNull(),
  directorPhone: text('director_phone').notNull(),
  email: text('email'),
  estimatedStudents: integer('estimated_students'),
  activationCode: varchar('activation_code', { length: 8 }),
  activationCodeExpiresAt: timestamp('activation_code_expires_at', { withTimezone: true }),
  status: applicationStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
