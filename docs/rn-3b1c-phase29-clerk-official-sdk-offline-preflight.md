# RN-3B1C Phase29 — Clerk official SDK trial technical preflight

**Source-only, OFFLINE / NO-GO. No official Clerk SDK was installed or executed. No hosted provider, customer account, credentials, tokens, provider calls, Cloudflare deployment, or production modification.**

## Verified baseline
Phase28 PR #50 independently verified: Phase28 targeted **15/15**, full suite **427/427**, Astro **11 pages**, syntax, Git diff and clean tree. Phase28 recommended a Clerk-FIRST *test sequence*, NOT provider selection or provisioning authority.

## Current documented Clerk API requirements (read November 16, 2026)
- Clerk Backend SDK package for generic server-side environments: `@clerk/backend`, created by `createClerkClient(...)`. `authenticateRequest(request,options)` requires a publishable key for session-token authentication. The API supports `authorizedParties`, `audience`, `acceptsToken='session_token'`, and `jwtKey` (networkless verification). With no `jwtKey`, it can fetch JWKS remotely and is therefore inappropriate for a no-network offline test. References: https://clerk.com/docs/reference/backend/overview and https://clerk.com/docs/reference/backend/authenticate-request
- Authentication request state and session semantics cannot be inferred from injected mocks alone. A real package/Worker bundle with authorized disposable fixture keys must be independently proven in a new bounded phase. Offline signature verification does not by itself guarantee revocation freshness. Clerk docs: https://clerk.com/docs/reference/backend/verify-token

## Phase29 source and tests
Pure, non-routed `functions/lib/dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.js` validates a hypothetical **offline-local, localhost-only, workerd, `@clerk/backend` exact-version** trial manifest. It refuses `jwtKey`, `secretKey`, `publishableKey` or token material embedded in the manifest; explicitly enforces session-token-only and an intended networkless trial. No SDK import is performed. These are design predicates only, not an implementation of `authenticateRequest()`.

The 14-probe checklist covers actual SDK import/bundle, networkless JWT-key verification, authorized-party/audience mismatch, session-token-only denial of M2M, invalid signatures/exp/key rotation, revocation/epoch, CSRF, recovery, local mapping, D1 write-time fence, provider outage and disposal. All self-attested probes are classified CLAIM_ONLY and all outputs stay NO_GO.

`tests/dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.test.mjs` authors 15 tests. No real SDK is installed or invoked; independent Windows results pending.

## Mandatory controls for future actual official SDK test — SEPARATE AUTHORIZATION REQUIRED
1. Authorize a disposable Clerk *nonproduction* instance with a named operator and cost/cleanup owner, or provide a trustworthy isolated fixture from an authorized provider test environment. Do not use an existing real customer project. Do not place signing keys, secrets, session JWTs, or other credentials into Git or PR comments.
2. In a separate branch and outside production dependency installs, pin actual `@clerk/backend` version and dependency integrity, check package export resolution, and run Worker bundling under a disposable local runtime.
3. Supply valid disposable test public JWT verification material to the SDK via an isolated runtime-only secret injection. Verify actual `authenticateRequest()` behavior with correctly signed test fixture, wrong `authorizedParties`, wrong `audience`, altered/expired tokens, unknown key, no credential, and network-outage denial. **Do not assume a locally signed arbitrary RSA fixture is accepted as a real Clerk session without proving exact token claims.**
4. Validate `RequestState` fields against the actual installed version and explicitly fail non-session machine types. Never treat an externally verified provider `sub` as a ReasonableNoise customer or DTF order owner.
5. A future real-account staging trial (if separately approved) must also prove logout/revocation, cookie/CSRF, recovery/callback integrity and the existing Phase21 durable D1 write-time session fence. A valid JWT alone does not create same-statement revocation protection.

## Strict negative trust boundary
Phase29 returns `offlineSdkExecuted=false`, `realTokenVerified=false`, `customerPrincipal=null`, `localSessionAuthorized=false`, `dtfQuoteAcceptanceAuthorized=false`, `dtfCheckoutEnabled=false`, `paymentAuthorized=false`, `artworkDeletionAuthorized=false`, `deploymentAuthorized=false`. PR is DRAFT/unmerged/undeployed. USDOT stickers remain untouched; DTF quote-first path unchanged.

## Independent Windows PowerShell verification
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase29-clerk-sdk-trial-preflight-20261116
node --check .\tests\dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE29_SYNTAX_FAILED' }
node --test .\tests\dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE29_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE29_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE29_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase28-staging-trial-decision-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE29_GIT_FAILED' }
git status --short

**Targets only, not independently verified yet:** Phase29 15/15 targeted, **442/442** full (427 last independently verified), 11 pages, JS syntax/Git diff/clean tree PASS. If test failure, block and repair in this branch; do not authorize live integration.