import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

// vi.hoisted ensures these exist before vi.mock factories run
const { mockGetSigningKey, mockDecode, mockVerify } = vi.hoisted(() => ({
  mockGetSigningKey: vi.fn(),
  mockDecode: vi.fn(),
  mockVerify: vi.fn(),
}));

vi.mock('jwks-rsa', () => ({
  default: vi.fn(() => ({ getSigningKey: mockGetSigningKey })),
}));

vi.mock('jsonwebtoken', () => ({
  decode: mockDecode,
  verify: mockVerify,
}));

import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/modules/identity/jwt.guard.js';
import type { MembershipService } from '../../src/modules/tenancy/membership.service.js';

const SCHOOL_ID = '01960000-0000-7000-8000-000000000001';
const KC_USER_ID = 'kc-user-abc';

function makeContext(headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers, user: undefined }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(membershipRow: unknown = { role: 'director' }) {
  process.env['KEYCLOAK_JWKS_URL'] = 'http://stub/certs';
  process.env['KEYCLOAK_ISSUER'] = 'http://stub';

  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

  const membershipService = {
    findByUserAndSchool: vi.fn().mockResolvedValue(membershipRow),
  } as unknown as MembershipService;

  const guard = new JwtAuthGuard(reflector, membershipService);
  guard.onModuleInit();
  return { guard, membershipService };
}

function setupValidToken() {
  mockGetSigningKey.mockResolvedValue({ getPublicKey: () => 'pub-key' });
  mockDecode.mockReturnValue({
    header: { kid: 'key-1', alg: 'RS256' },
    payload: {},
  });
  mockVerify.mockReturnValue({
    sub: KC_USER_ID,
    email: 'test@school.cd',
    realm_access: { roles: ['director'] },
    iss: 'http://stub',
    exp: Math.floor(Date.now() / 1000) + 300,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JwtAuthGuard', () => {
  it('throws 401 when no Authorization header', async () => {
    const { guard } = makeGuard();
    const ctx = makeContext({ 'x-school-id': SCHOOL_ID });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when token cannot be decoded', async () => {
    const { guard } = makeGuard();
    mockDecode.mockReturnValue(null);
    const ctx = makeContext({
      authorization: 'Bearer bad.token.value',
      'x-school-id': SCHOOL_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when JWT signature verification fails', async () => {
    const { guard } = makeGuard();
    mockDecode.mockReturnValue({ header: { kid: 'key-1' }, payload: {} });
    mockGetSigningKey.mockResolvedValue({ getPublicKey: () => 'pub-key' });
    mockVerify.mockImplementation(() => { throw new Error('invalid signature'); });
    const ctx = makeContext({
      authorization: 'Bearer bad.sig.token',
      'x-school-id': SCHOOL_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 403 when no active membership for the school', async () => {
    const { guard } = makeGuard(null);
    setupValidToken();
    const ctx = makeContext({
      authorization: 'Bearer valid.token.here',
      'x-school-id': SCHOOL_ID,
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws 403 when X-School-Id header is missing', async () => {
    const { guard } = makeGuard();
    setupValidToken();
    const ctx = makeContext({ authorization: 'Bearer valid.token.here' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('returns true and attaches user to request when token and membership are valid', async () => {
    const { guard } = makeGuard({ role: 'director' });
    setupValidToken();

    const request = {
      headers: { authorization: 'Bearer valid.token.here', 'x-school-id': SCHOOL_ID },
      user: undefined,
    } as unknown as { user: unknown };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request.user).toMatchObject({
      keycloakUserId: KC_USER_ID,
      email: 'test@school.cd',
      role: 'director',
      schoolId: SCHOOL_ID,
    });
  });

  it('skips auth for @Public() routes', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const membershipService = { findByUserAndSchool: vi.fn() } as unknown as MembershipService;
    const guard = new JwtAuthGuard(reflector, membershipService);
    guard.onModuleInit();

    const ctx = makeContext({});
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(membershipService.findByUserAndSchool).not.toHaveBeenCalled();
  });
});
