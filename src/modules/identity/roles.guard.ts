import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY } from './auth.decorator.js';
import type { StaffRole } from './authenticated-user.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): true {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!request.user || !required.includes(request.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
