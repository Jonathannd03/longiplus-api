import { pgTable, pgEnum, uuid, text, boolean, bigint, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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

// ─── Tables ──────────────────────────────────────────────────────────────────

export const school = pgTable('school', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  province: text('province').notNull(),
  city: text('city').notNull(),
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

// Append-only: no UPDATE/DELETE grant for kelasi_app role
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

