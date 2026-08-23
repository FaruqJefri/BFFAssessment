import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';

export interface PortalUser {
  /** Google account subject - stable, and the only durable identifier. */
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Verifies the Google ID token the portal presents.
 *
 * The BFF does not take the frontend at its word about who is calling. It
 * verifies the token signature against Google JWKS and checks issuer, audience
 * and expiry itself. A compromised or spoofed frontend therefore cannot mint an
 * identity: it would need a token Google actually signed for our client id.
 */
@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);
  private readonly audience: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly requireVerifiedEmail: boolean;
  private readonly allowedDomains: string[];

  constructor(config: ConfigService) {
    const audience = config.get<string>('GOOGLE_CLIENT_ID');
    if (!audience) {
      throw new Error('GOOGLE_CLIENT_ID is not configured');
    }

    this.audience = audience;
    this.requireVerifiedEmail = config.get('REQUIRE_VERIFIED_EMAIL', 'true') !== 'false';
    this.allowedDomains = (config.get<string>('ALLOWED_EMAIL_DOMAINS') ?? '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);

    // jose caches the key set and refreshes it on an unknown kid, so a key
    // rotation at Google does not require a restart here.
    this.jwks = createRemoteJWKSet(
      new URL(
        config.get<string>('GOOGLE_JWKS_URI', 'https://www.googleapis.com/oauth2/v3/certs'),
      ),
    );
  }

  async verify(idToken: string): Promise<PortalUser> {
    if (!idToken) {
      throw new UnauthorizedException('Missing identity token');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.audience,
        clockTolerance: 30,
      }));
    } catch (error) {
      // The reason is logged but never returned: a caller learning *why* a token
      // failed is a caller being told how to forge a better one.
      this.logger.warn(
        `Identity token rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Invalid identity token');
    }

    return this.toPortalUser(payload);
  }

  private toPortalUser(payload: JWTPayload): PortalUser {
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;

    if (!payload.sub || !email) {
      throw new UnauthorizedException('Identity token is missing required claims');
    }

    if (this.requireVerifiedEmail && payload.email_verified !== true) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    if (this.allowedDomains.length > 0) {
      const domain = email.slice(email.lastIndexOf('@') + 1);
      if (!this.allowedDomains.includes(domain)) {
        this.logger.warn(`Rejected sign-in from disallowed domain: ${domain}`);
        throw new UnauthorizedException('Account is not permitted to use this portal');
      }
    }

    return {
      id: String(payload.sub),
      email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    };
  }
}
