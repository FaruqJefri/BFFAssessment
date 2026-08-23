import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GoogleIdentityService, PortalUser } from './google-identity.service';
import { AuthenticatedRequest, PortalAuthGuard } from './portal-auth.guard';

const PORTAL_KEY = 'portal-key-value';

const VERIFIED_USER: PortalUser = {
  id: 'google-sub-1',
  email: 'ada@example.com',
  name: 'Ada',
};

function contextFor(headers: Record<string, string>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  } as AuthenticatedRequest;

  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext,
  };
}

function buildGuard(verify = jest.fn().mockResolvedValue(VERIFIED_USER)): {
  guard: PortalAuthGuard;
  verify: jest.Mock;
} {
  const identity = { verify } as unknown as GoogleIdentityService;
  const config = {
    get: (key: string) => (key === 'PORTAL_API_KEY' ? PORTAL_KEY : undefined),
  } as ConfigService;

  return { guard: new PortalAuthGuard(identity, config), verify };
}

describe('PortalAuthGuard', () => {
  it('refuses to start without a portal key configured', () => {
    const identity = {} as GoogleIdentityService;
    const config = { get: () => undefined } as unknown as ConfigService;

    expect(() => new PortalAuthGuard(identity, config)).toThrow(
      'PORTAL_API_KEY is not configured',
    );
  });

  it('admits a request carrying both the portal key and a valid identity token', async () => {
    const { guard, verify } = buildGuard();
    const { context, request } = contextFor({
      'x-portal-key': PORTAL_KEY,
      authorization: 'Bearer google-id-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('google-id-token');
    expect(request.portalUser).toEqual(VERIFIED_USER);
  });

  it('accepts a lowercase bearer scheme', async () => {
    const { guard } = buildGuard();
    const { context } = contextFor({
      'x-portal-key': PORTAL_KEY,
      authorization: 'bearer google-id-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['no portal key', { authorization: 'Bearer t' }],
    ['a wrong portal key', { 'x-portal-key': 'nope', authorization: 'Bearer t' }],
    [
      'a prefix of the portal key',
      { 'x-portal-key': 'portal-key', authorization: 'Bearer t' },
    ],
  ])('rejects a request with %s', async (_label, headers) => {
    const { guard, verify } = buildGuard();

    await expect(guard.canActivate(contextFor(headers).context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // The identity token is never even inspected once the caller is untrusted.
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    ['no authorization header', {}],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
    ['a bearer scheme with no token', { authorization: 'Bearer' }],
  ])('rejects a trusted caller presenting %s', async (_label, headers) => {
    const { guard } = buildGuard();
    const { context } = contextFor({ 'x-portal-key': PORTAL_KEY, ...headers });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propagates a rejection from identity verification', async () => {
    const verify = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('Invalid identity token'));
    const { guard } = buildGuard(verify);
    const { context } = contextFor({
      'x-portal-key': PORTAL_KEY,
      authorization: 'Bearer forged',
    });

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid identity token');
  });
});
