# RN-3B1C Phase 20 — Signed Customer Session and Order Ownership Verification

**DRAFT / isolated. Real customer authentication is NOT yet available or enabled.**

## Verified baseline
Phase 19 PR #41 independently passed 15/15 targeted, 293/293 full regression, Astro 11 pages, Git clean. Earlier Phase17 browser tests verified desktop/mobile with intercepted contact requests, not real authentication, mail, or payment.

## What Phase 20 implements
- A route-independent signed customer-session verifier using the actual WebCrypto Ed25519 signature verification API, a pinned explicit test keyring, exact issuer/audience and one-hour maximum lifetime. It reads one __Host-rn_dtf_session cookie and fails closed for missing or duplicate cookies, invalid JOSE algorithm/key ID/signature, expired/not-yet-valid claims, role/subject/workspace/epoch mismatch.
- A strict POST + same Origin check, Sec-Fetch-Site check, and synchronizer-CSRF token SHA-256 matching an independently stored local D1 session row.
- Disposable D1 session state with session_id, owner subject, workspace, epoch, expiry, revocation, and CSRF hash. Epoch rotation and revocation reject previously signed tokens. Only the local synthetic migrations are permitted in tests.
- Real cryptographic test signatures are generated using an ephemeral test key; no production signing authority, real JWT issuer, or customer secrets are configured.
- Four local D1 integration tests connect a signed session to the already verified Phase19 acceptance function, including owner mismatch, revocation and epoch rotation. Accepted records remain review-only, never checkout permission.
- The verifier is **not** a live route, not an account system, and never grants payment/production/deletion authority.

## Critical production blockers — do not bypass
1. Choose and independently verify a real production identity issuer and customer signup/login, secure cookie issuance, account verification, logout/revocation, key rotation, recovery and customer-account support. The module DOES NOT create accounts or cookies.
2. Production keys must come from a trusted managed key-distribution path; untrusted JWKS or arbitrary caller-provided keys are not authority. Verify issuer configuration, audience, pinning and key revocation.
3. Add a real CSRF nonce lifecycle, SameSite/Secure/HttpOnly cookie flags, origin policy, browser interaction testing, rate limiting, tenant/workspace mapping and trustworthy customer-to-quote binding.
4. **Revocation race:** This phase checks D1 session revocation before calling Phase19's acceptance INSERT, but Phase19's INSERT does not atomically fence the same session epoch. Revocation between the verifier SELECT and the acceptance write can escape notice. A future integration gate must bind revocation/session epoch and order status together at the D1 write decision, test concurrent revoke-versus-accept, and fail closed before live wiring.
5. Current real /api/contact remains anonymous quote-first; it creates no canonical verified customer order. The Phase18/19 D1 tables are synthetic and MUST NOT be applied live.
6. Actual DTF pricing catalog approval, customer acceptance UI, live order mapping, Stripe-specific payment idempotency/webhook isolation, and separate staging/provider E2E tests are outstanding.
7. Npm dependency vulnerability remediation is a separate pending item.

## Windows independent verification
Use the existing ReasonableNoise repo and isolated Miniflare install. Do NOT run any live D1 migrations or Cloudflare/Stripe calls.

$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase20-signed-customer-session-20261116
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\dtf-signed-customer-session-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE20_SIGNED_SESSION_FAILED' }
node --test .\tests\dtf-auth-acceptance-integration-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE20_ORDER_BOUNDARY_FAILED' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE20_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE20_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase19-catalog-and-acceptance-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE20_GIT_INTEGRITY_FAILED' }
git status --short

**Pending gates:** 16/16 signed-session tests; 4/4 Phase20 order-boundary tests; **313/313** full regression (293 independently verified baseline); Astro 11 static pages and Git clean. No Phase20 tests have been independently run. Keep PR draft/unmerged/undeployed. Direct DTF checkout and automatic artwork deletion are disabled.