import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPair, KeyLike, SignJWT } from 'jose';

// jwtVerify stays real - the point of these tests is that a genuine signature
// check happens. Only the network fetch of Google's key set is replaced.
jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return {
    ...actual,
    createRemoteJWKSet: jest.fn(() => (globalThis as never as TestKeys).__verificationKey),
  };
});

interface TestKeys {
  __verificationKey: () => Promise<KeyLike>;
}

const CLIENT_ID = 'client-id.apps.googleusercontent.com';

let privateKey: KeyLike;

async function tokenWith(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expiresIn?: string; key?: KeyLike } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.key ?? privateKey);
}

function build(overrides: Record<string, unknown> = {}) {
  // Required rather than imported so the jose mock above is installed before the
  // module under test evaluates - a top-level import would hoist past it.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GoogleIdentityService } = require('./google-identity.service');

  const settings: Record<string, unknown> = {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_JWKS_URI: 'https://www.googleapis.com/oauth2/v3/certs',
    REQUIRE_VERIFIED_EMAIL: 'true',
    ...overrides,
  };

  const config = {
    get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback),
  } as unknown as ConfigService;

  return new GoogleIdentityService(config);
}

const VALID_CLAIMS = {
  sub: '1234567890',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  picture: 'https://example.com/ada.png',
};

describe('GoogleIdentityService', () => {
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    (globalThis as never as TestKeys).__verificationKey = async () => pair.publicKey;
  });

  it('refuses to start without a client id', () => {
    expect(() => build({ GOOGLE_CLIENT_ID: undefined })).toThrow(
      'GOOGLE_CLIENT_ID is not configured',
    );
  });

  it('accepts a token Google signed for our client id', async () => {
    await expect(build().verify(await tokenWith(VALID_CLAIMS))).resolves.toEqual({
      id: '1234567890',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://example.com/ada.png',
    });
  });

  it('normalises the email to lower case so identity comparisons are stable', async () => {
    const user = await build().verify(await tokenWith(VALID_CLAIMS));
    expect(user.email).toBe('ada@example.com');
  });

  it('accepts the bare accounts.google.com issuer form', async () => {
    const token = await tokenWith(VALID_CLAIMS, { issuer: 'accounts.google.com' });
    await expect(build().verify(token)).resolves.toMatchObject({ id: '1234567890' });
  });

  it('rejects a token signed by someone else', async () => {
    const attacker = await generateKeyPair('RS256');
    const token = await tokenWith(VALID_CLAIMS, { key: attacker.privateKey });

    await expect(build().verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token minted for a different audience', async () => {
    const token = await tokenWith(VALID_CLAIMS, { audience: 'someone-elses-client-id' });
    await expect(build().verify(token)).rejects.toThrow('Invalid identity token');
  });

  it('rejects a token from an unexpected issuer', async () => {
    const token = await tokenWith(VALID_CLAIMS, { issuer: 'https://evil.example.com' });
    await expect(build().verify(token)).rejects.toThrow('Invalid identity token');
  });

  it('rejects an expired token', async () => {
    const token = await tokenWith(VALID_CLAIMS, { expiresIn: '-1h' });
    await expect(build().verify(token)).rejects.toThrow('Invalid identity token');
  });

  it('rejects an empty token without attempting verification', async () => {
    await expect(build().verify('')).rejects.toThrow('Missing identity token');
  });

  it('never explains why a token was rejected', async () => {
    const token = await tokenWith(VALID_CLAIMS, { audience: 'wrong' });

    await expect(build().verify(token)).rejects.toThrow(/^Invalid identity token$/);
  });

  it('rejects a token missing the claims we depend on', async () => {
    const token = await tokenWith({ sub: '1', email_verified: true });
    await expect(build().verify(token)).rejects.toThrow('missing required claims');
  });

  it('rejects an unverified Google email', async () => {
    const token = await tokenWith({ ...VALID_CLAIMS, email_verified: false });
    await expect(build().verify(token)).rejects.toThrow('email is not verified');
  });

  it('admits an unverified email when the check is switched off', async () => {
    const token = await tokenWith({ ...VALID_CLAIMS, email_verified: false });
    const service = build({ REQUIRE_VERIFIED_EMAIL: 'false' });

    await expect(service.verify(token)).resolves.toMatchObject({ id: '1234567890' });
  });

  describe('domain allow-list', () => {
    it('admits an address inside the allow-list', async () => {
      const service = build({ ALLOWED_EMAIL_DOMAINS: 'example.com, zurich.com' });
      await expect(service.verify(await tokenWith(VALID_CLAIMS))).resolves.toMatchObject({
        email: 'ada@example.com',
      });
    });

    it('turns away an address outside it', async () => {
      const service = build({ ALLOWED_EMAIL_DOMAINS: 'zurich.com' });

      await expect(service.verify(await tokenWith(VALID_CLAIMS))).rejects.toThrow(
        'not permitted to use this portal',
      );
    });

    it('is not fooled by a domain appearing earlier in the address', async () => {
      const service = build({ ALLOWED_EMAIL_DOMAINS: 'zurich.com' });
      const token = await tokenWith({ ...VALID_CLAIMS, email: 'zurich.com@evil.io' });

      await expect(service.verify(token)).rejects.toThrow('not permitted to use this portal');
    });
  });
});
