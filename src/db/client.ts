import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

// Owner connection — used by migrations and seed scripts (bypasses RLS)
const ownerConnectionString =
  process.env['DATABASE_URL'] ?? 'postgres://longiplus:longiplus@localhost:5433/longiplus';

// App connection — used by the API process (longiplus_app_user, subject to RLS)
const appUrl = process.env['DATABASE_APP_URL'];
if (!appUrl) {
  console.warn('[DB] DATABASE_APP_URL not set — falling back to owner connection. RLS will NOT be enforced.');
}
const appConnectionString =
  appUrl ?? process.env['DATABASE_URL'] ?? 'postgres://longiplus:longiplus@localhost:5433/longiplus';

const queryClient = postgres(appConnectionString);
export const db = drizzle(queryClient, { schema });

// Owner-connection Drizzle instance — only for seed/migration helpers that need to bypass RLS
const ownerQueryClient = postgres(ownerConnectionString);
export const dbOwner = drizzle(ownerQueryClient, { schema });

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
export const redis = new Redis(redisUrl, { lazyConnect: true });

// ─── Shared DB transaction type ───────────────────────────────────────────────
// Use this type for any service method that accepts a Drizzle transaction object
export type TxDB = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── RLS transaction wrapper ──────────────────────────────────────────────────
// Sets app.school_id for the duration of the transaction so RLS policies fire correctly
export async function withSchoolContext<T>(
  schoolId: string,
  fn: (tx: TxDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}
