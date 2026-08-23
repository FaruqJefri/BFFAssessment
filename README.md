# BFFAssessment — Backend for Frontend

The only service the customer portal talks to. A **Nest.JS** tier that sits between the
Next.JS portal and the core API, and answers one question the layers on either side
cannot answer for themselves: *is this really our portal, acting for a real user?*

```
Browser ──► Next.JS (httpOnly session) ──► BFF ──► Core API ──TCP──► users microservice
                                            │
                              verify identity · audit · throttle · shape
```

| Repository              | Role                                                          |
| ----------------------- | ------------------------------------------------------------- |
| `FrontendAssessment`    | Next.JS portal — Google OAuth2, Redux, rendering only          |
| `ComponentsAssessment`  | Shared UI component package                                    |
| **`BFFAssessment`**     | **This service — identity, audit, rate limiting, shaping**     |
| `BackendAssessment`     | Core API gateway + users microservice — all business logic     |

## Why this tier exists

A Next.JS route handler could call the core API directly. It should not, for three reasons:

**Identity is verified by someone who can be trusted to do it.** The portal knows who
signed in, but the portal is also the layer nearest the browser and the most exposed. So
this service does not take its word: it verifies the Google ID token against Google's
JWKS itself — signature, issuer, audience, expiry — and derives the user from the
verified claims. A compromised frontend cannot mint an identity; it would need a token
Google actually signed for our client id.

**Two credentials, neither sufficient alone.** Every request carries `x-portal-key`
(proving the *caller* is our portal server) **and** a Google ID token (proving the *user*).
A leaked portal key is worthless without a real Google token; a stolen Google token is
worthless without the key.

**Secrets get one home.** `CORE_API_SERVICE_KEY` lives here and nowhere else. The portal
never holds it, so a Next.JS build artefact leaking cannot expose it.

## Endpoints

| Method | Route              | Notes                                            |
| ------ | ------------------ | ------------------------------------------------ |
| `GET`  | `/health`          | Liveness. Unauthenticated.                        |
| `GET`  | `/auth/me`         | The verified end user, for session checks.        |
| `GET`  | `/users`           | Filtered, masked, paginated. 100 req/min.         |
| `GET`  | `/users/:id/email` | Reveals one address. **Audited.** 20 req/min.     |

Interactive API documentation: **<http://localhost:5000/docs>** (`SWAGGER_ENABLED=true`).

### The filter is not negotiable

`GET /users` takes `page` and `perPage` — and nothing else. There is deliberately no
`filtered` parameter: the G/W rule is pinned on inside this service before the core API
is called, so no request shape exists that returns the unfiltered directory.

### Revealing an address is the audited path

`GET /users/:id/email` is the only route through which a real address leaves the
platform, so it is the one place an audit record is mandatory — written whether the read
was allowed or refused. **The address itself is not in the audit record.** The trail
proves access happened without becoming a second copy of the data.

It is also throttled to a fifth of the general budget. Revealing one address is a normal
click; revealing thirty in a minute is someone harvesting the directory.

## Running it

```bash
npm install
cp .env.example .env      # fill in GOOGLE_CLIENT_ID and the two secrets
npm run start:dev
```

`CORE_API_SERVICE_KEY` must match `SERVICE_API_KEY` in the BackendAssessment `.env`, and
`PORTAL_API_KEY` must match `BFF_PORTAL_KEY` in the FrontendAssessment `.env.local`.

Start order: users microservice → core gateway → BFF → portal.

## Security posture

| Concern                   | How it is handled                                                     |
| ------------------------- | --------------------------------------------------------------------- |
| Forged identity           | Google ID token verified against JWKS — signature, `iss`, `aud`, `exp`. |
| Untrusted caller          | `x-portal-key` compared in **constant time** over SHA-256 digests.      |
| Key rotation at Google    | `jose` caches JWKS and refetches on an unknown `kid`; no restart needed. |
| Unverified Google account | Rejected unless `REQUIRE_VERIFIED_EMAIL=false`.                        |
| Wrong tenant              | Optional `ALLOWED_EMAIL_DOMAINS` allow-list, matched on the real domain. |
| Oracle attacks            | A rejected token is never told *why* it was rejected.                   |
| Directory harvesting      | Reveals audited and throttled to 20/min; listing to 100/min.            |
| Parameter tampering       | `ValidationPipe` with `whitelist` **and** `forbidNonWhitelisted`.        |
| Upstream detail leakage   | Non-actionable upstream failures collapse to a flat 502.                |
| Traceability              | Correlation id on every request — **middleware**, so 401s carry one too. |
| Secret sprawl             | The core service key lives only in `CoreApiClient`.                     |
| Boot-time safety          | Missing `GOOGLE_CLIENT_ID`, `PORTAL_API_KEY` or `CORE_API_SERVICE_KEY` fails startup. |
| Doc exposure              | Swagger is opt-in via `SWAGGER_ENABLED`; turn it off in production.     |

## Tests

```bash
npm test
```

53 unit tests. The identity suite signs **real RS256 tokens** and verifies them through
the genuine `jose` path — only the network fetch of Google's key set is stubbed — so the
tests prove a token signed by the wrong key, minted for the wrong audience, issued by the
wrong issuer, or already expired is actually rejected, rather than proving a mock was
called.

Also covered: the two-credential guard (including a portal key that is a *prefix* of the
real one), token caching, burst collapsing, single-retry-on-401, upstream status
translation, audit records on both allow and deny, and the absence of the revealed
address from the audit trail.

## Layout

```
src/
  auth/         Google ID token verification, the two-credential guard
  core/         the only component holding the core API service key
  audit/        structured, append-only access records
  users/        the portal-facing surface
  common/       correlation id middleware, edge exception filter
  swagger.ts    OpenAPI document, opt-in
```
