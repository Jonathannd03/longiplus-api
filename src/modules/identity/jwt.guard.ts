import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { IS_PUBLIC_KEY } from './auth.decorator.js';
import type { AuthenticatedUser, StaffRole } from './authenticated-user.interface.js';
import { MembershipService } from '../tenancy/membership.service.js';

interface KcJwtPayload {
  sub: string;
  email: string;
  realm_access?: { roles?: string[] };
  iss: string;
  exp: number;
}

const STAFF_ROLES = new Set<string>([
  'owner', 'director', 'bursar', 'secretary', 'teacher', 'class_teacher', 'longiplus_admin',
]);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwksClient: jwksRsa.JwksClient;
  private readonly issuer: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly membershipService: MembershipService,
  ) {
    const jwksUri =
      process.env['KEYCLOAK_JWKS_URL'] ??
      'http://localhost:8080/realms/longiplus/protocol/openid-connect/certs';
    this.issuer =
      process.env['KEYCLOAK_ISSUER'] ??
      'http://localhost:8080/realms/longiplus';

    this.jwksClient = jwksRsa({
      jwksUri,
      cache: true,
      cacheMaxEntries: 10,
      cacheMaxAge: 600_000,
    });
  }

  async canActivate(ctx: ExecutionContext): Promise<true> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const payload = await this.verifyToken(token);

    const schoolId = (request.headers['x-school-id'] as string | undefined)?.trim();

    let resolvedRole: string;
    let resolvedSchoolId: string;

    if (schoolId) {
      const membership = await this.membershipService.findByUserAndSchool(payload.sub, schoolId);
      if (!membership) throw new ForbiddenException('No active membership for this school');
      resolvedRole = membership.role;
      resolvedSchoolId = schoolId;
    } else {
      // First login — no school selected yet; pick the user's first active school
      const schools = await this.membershipService.findAllSchoolsForUser(payload.sub);
      if (schools.length === 0) throw new ForbiddenException('No active membership');
      resolvedRole = schools[0]!.role;
      resolvedSchoolId = schools[0]!.schoolId;
    }

    const user: AuthenticatedUser = {
      keycloakUserId: payload.sub,
      email: payload.email,
      role: resolvedRole as StaffRole,
      schoolId: resolvedSchoolId,
    };
    request.user = user;
    return true;
  }

  private extractToken(request: FastifyRequest): string | null {
    const authHeader = request.headers['authorization'];
    if (typeof authHeader !== 'string') return null;
    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }

  private async verifyToken(token: string): Promise<KcJwtPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
      throw new UnauthorizedException('Invalid token structure');
    }
    const kid = decoded.header.kid;

    const signingKey = await this.jwksClient.getSigningKey(kid).catch(() => {
      throw new UnauthorizedException('Unable to fetch signing key');
    });
    const publicKey = signingKey.getPublicKey();

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, publicKey, {
        issuer: this.issuer,
        algorithms: ['RS256'],
        clockTolerance: 60,
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Token verification failed');
    }

    if (
      typeof payload['sub'] !== 'string' ||
      typeof payload['email'] !== 'string'
    ) {
      throw new UnauthorizedException('Missing required token claims');
    }

    const roles: string[] =
      (payload['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
    const staffRole = roles.find((r) => STAFF_ROLES.has(r));
    if (!staffRole) throw new ForbiddenException('No staff role in token');

    return {
      sub: payload['sub'],
      email: payload['email'],
      realm_access: { roles },
      iss: payload['iss'] ?? '',
      exp: payload['exp'] ?? 0,
    };
  }
}
