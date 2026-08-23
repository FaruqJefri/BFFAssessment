import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

import { GoogleIdentityService, PortalUser } from './google-identity.service';

export interface AuthenticatedRequest extends Request {
  portalUser: PortalUser;
}

/**
 * Two independent checks, both of which must pass:
 *
 *  1. The **caller** is our own portal server - it presents `x-portal-key`, a
 *     secret that lives only in the Next.JS server process and never in a browser.
 *  2. The **end user** is who the portal says - their Google ID token is verified
 *     against Google JWKS here, not trusted on the frontend's say-so.
 *
 * Either alone would be weaker: a leaked portal key gets an attacker nothing
 * without a real Google token, and a stolen Google token gets them nothing
 * without the key.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  private readonly portalKeyDigest: Buffer;

  constructor(
    private readonly identity: GoogleIdentityService,
    config: ConfigService,
  ) {
    const key = config.get<string>('PORTAL_API_KEY');
    if (!key) {
      throw new Error('PORTAL_API_KEY is not configured');
    }
    this.portalKeyDigest = createHash('sha256').update(key).digest();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    this.assertTrustedCaller(request.header('x-portal-key'));

    const authorization = request.header('authorization') ?? '';
    const [scheme, token] = authorization.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing identity token');
    }

    request.portalUser = await this.identity.verify(token);
    return true;
  }

  /** Constant-time over equal-length digests, so neither value nor length leaks. */
  private assertTrustedCaller(presented?: string): void {
    if (!presented) {
      throw new UnauthorizedException('Missing portal credentials');
    }

    const candidate = createHash('sha256').update(presented).digest();

    if (!timingSafeEqual(candidate, this.portalKeyDigest)) {
      throw new UnauthorizedException('Invalid portal credentials');
    }
  }
}
