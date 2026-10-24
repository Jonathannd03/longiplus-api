import { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../../src/modules/identity/authenticated-user.interface.js';

/**
 * Test-only guard. Always allows requests through.
 * Attaches request.user from the X-Test-User header (JSON-encoded AuthenticatedUser)
 * when present, so protected endpoints can read the user.
 * Never imported in production code.
 *
 * No @Injectable() — avoids emitDecoratorMetadata issues since test/ is excluded
 * from tsconfig. Use with .overrideProvider(JwtAuthGuard).useValue(new FakeJwtGuard()).
 */
export class FakeJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): true {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const raw = request.headers['x-test-user'];
    if (typeof raw === 'string') {
      request.user = JSON.parse(raw) as AuthenticatedUser;
    }
    return true;
  }
}
