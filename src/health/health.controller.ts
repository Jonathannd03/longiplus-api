import { Controller, Get, HttpCode } from '@nestjs/common';
import { db, redis } from '../db/client.js';
import { sql } from 'drizzle-orm';
import { Public } from '../modules/identity/auth.decorator.js';

type HealthStatus = 'ok' | 'error';

interface HealthResponse {
  status: HealthStatus;
  database: HealthStatus;
  redis: HealthStatus;
}

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @HttpCode(200)
  async check(): Promise<HealthResponse> {
    const [database, redisStatus] = await Promise.all([
      this.pingDatabase(),
      this.pingRedis(),
    ]);

    const status: HealthStatus = database === 'ok' && redisStatus === 'ok' ? 'ok' : 'error';

    return { status, database, redis: redisStatus };
  }

  private async pingDatabase(): Promise<HealthStatus> {
    try {
      await db.execute(sql`SELECT 1`);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async pingRedis(): Promise<HealthStatus> {
    try {
      await redis.connect().catch(() => {});
      const pong = await redis.ping();
      return pong === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
