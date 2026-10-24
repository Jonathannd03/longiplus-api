import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './db/schema.js';
import { relayOutbox } from './modules/outbox/relay.js';

const connectionString =
  process.env['DATABASE_APP_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://longiplus:longiplus@localhost:5433/longiplus';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const qc = postgres(connectionString);
const db = drizzle(qc, { schema });

async function start() {
  console.log('LongiPlus worker started. Polling outbox…');

  const interval = setInterval(() => {
    relayOutbox(db, redisUrl).catch((err: unknown) => {
      console.error('Outbox relay error:', err);
    });
  }, 5_000);

  process.on('SIGTERM', () => {
    console.log('Worker shutting down…');
    clearInterval(interval);
    void qc.end().then(() => process.exit(0));
  });
}

start().catch((err: unknown) => {
  console.error('Worker failed to start:', err);
  process.exit(1);
});
