# RN-3B1C Phase26 — Official Provider Staging Integration Preflight

**Design and offline preflight only. No real staging tenant or official SDK is configured or exercised by this change.**

## Pinned baseline
Phase25 PR #47 R1 was independently verified on Windows: 15/15 new tests, 382/382 regressions, Astro 11 pages, syntax/Git diff and clean working tree. Its synthetic Clerk-shaped RS256 and Supabase-shaped ES256 verifier is **not** an official provider integration and grants no DTF customer authority.

## Current official documentation reviewed on November 16, 2026
- Clerk `authenticateRequest()` supports networkless signed-token verification with a pinned `jwtKey`, recommends explicitly configuring `authorizedParties`, and defaults to accepting session tokens. The exact authenticated RequestState and revocation characteristics must be verified against an actual disposable Clerk instance. https://clerk.com/docs/reference/backend/authenticate-request
- Supabase differentiates `@supabase/ssr` for cookies/refresh from `@supabase/server` for per-request Bearer + apikey verification, and notes these are not interchangeable. `@supabase/ssr` cookie-backed PKCE flows and token refresh require independent cross-browser and Worker verification. https://supabase.com/docs/guides/auth/choosing-a-server-package ; https://supabase.com/docs/guides/auth/server-side ; https://supabase.com/docs/guides/auth/server-side/advanced-guide

## Phase26 purpose
Prepare a concrete, auditable, least-privilege staging authorization review before anyone creates or accesses any provider account. Two candidates are permitted for proposal: Clerk and Supabase Auth. Auth0 remains an unevaluated fallback. Neither is selected.

New source `functions/lib/dtf-provider-staging-preflight-rn3b1c.js` contains 16 staging proof categories and a pure, read-only inventory function. Its outputs always say NO_GO and never approve staging credentials, account creation, authentication endpoints, production deployment, customer quote acceptance, payments or object deletion. Even complete self-attested status cannot become a release flag.

## Clerk-specific controlled trial (separate future authorization)
1. Obtain approval for a disposable nonproduction Clerk instance and scoped operator access. Keep signing/public keys out of Git, logs, browser response bodies and screenshots.
2. Pin the official package versions and verify exact Cloudflare Pages Functions/Workerd bundling in a separate branch without customer-facing routes.
3. Exercise `authenticateRequest()` with explicit allowed origins/authorizedParties, trusted public verification key and expected audience/token type. Reject expired, altered, misissued and machine tokens where a customer session is expected.
4. Verify actual signup/login, verified account subject, logout, session revocation and recovery with synthetic accounts. Do not assume networkless JWT validation performs live revocation checks; define refresh or local session fencing as needed.
5. Prove customer ID never comes from request body, email, anonymous quote ID or unverified Access admin claims.

## Supabase Auth-specific controlled trial (separate future authorization)
1. Obtain approval for a disposable nonproduction Supabase project or supported local Auth environment. Never target the existing production account/project by inference.
2. Make an explicit choice of cookie/PKCE SSR (`@supabase/ssr`) versus bearer-based Workers (`@supabase/server`). Pin versions and demonstrate the chosen flow on real Pages Functions and supported runtime.
3. Verify project issuer, audience, verified signature/JWKS/key rotation, allowed redirects, PKCE code verifier, session refresh and replay defense.
4. Test signup/confirmation/recovery, logout/refresh revocation and availability failure; disable privileged/service-role keys and prevent JWT role `authenticated` alone from becoming DTF order ownership.
5. Keep Supabase identities distinct from local D1 subject/workspace and use a separately reviewed auditable account-mapping authority.

## Cross-provider identity-to-DTF authority contract
- Trusted provider JWT or SDK RequestState proves only an external provider identity. It is **not** the local Phase20 `__Host-rn_dtf_session` issuer, CSRF nonce or Phase21 D1 session epoch.
- Require audited mapping from immutable provider-subject tuple to a canonical local ReasonableNoise customer and workspace; do not claim anonymous DTF quotes by matching email, phone, reference, Stripe customer or artwork link.
- Enforce Origin/CSRF/cookie path, issuer/key and session revocation; ensure logout, recoveries and account suspension invalidate durable local D1 epoch **before** any same-statement Phase21 acceptance.
- Keep review-only acceptance, immutable approved price/version, explicit customer consent and no checkout authority. Real DTF pricing approval, customer UI, payment rails and live D1 migration require separate explicit authorization.

## Phase26 16-gate inventory
Test-tenant separation, disposable accounts, safe secrets and rotation, official SDK pinning, actual Worker bundle, issuer/audience, JWKS rotation, PKCE/state/nonce, cookie/CSRF/Origin, revocation/recovery, local ownership mapping, D1 write-time fence, anonymous quote manual claim, staging rollback, rate limits/logging and external independent security review.

## Independent Windows offline verification
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase26-provider-staging-preflight-20261116
node --check .\tests\dtf-provider-staging-preflight-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE26_SYNTAX_FAILED' }
node --test .\tests\dtf-provider-staging-preflight-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE26_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE26_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE26_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase25-idp-offline-crypto-poc-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE26_GIT_FAILED' }
git status --short

**Acceptance targets, not yet independently verified:** 15/15 new preflight tests, 397/397 full regressions (382 verified baseline), Astro 11 pages, Git diff PASS and clean tree.

## Strict NO-GO scope
No real provider registrations, credentials, SDK installations, external API calls, login/callback routes, customer identities, Cloudflare D1/R2 live accesses, Stripe/Resend/Turnstile calls, sticker checkout changes, DTF checkout, production approval, deletion automation, merge or deploy. Keep PR DRAFT.