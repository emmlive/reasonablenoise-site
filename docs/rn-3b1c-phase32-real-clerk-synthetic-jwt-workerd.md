# RN-3B1C Phase32 — official Clerk JWT cryptographic fixture tests in isolated Workerd

## Baseline
Phase31 R2 PR #53 independently verified: **12/12 targeted**, **462/462 full**, **11 Astro pages**, Git diff/CLEAN and three passing actual SDK Workerd CI runs #7, #8, #9 on final head `38c741c`. This proves the official SDK's missing-secret fail-closed behavior **inside actual isolated Miniflare/Workerd**, not session authentication.

## Scope and explicit nonproof
Phase32 calls **actual `verifyToken()` from pinned `@clerk/backend@3.29.0` inside real Workerd** to check cryptography against **locally minted synthetic RS256 JWTs**. The RSA signing key is ephemeral in the Node test process and **never uploaded to Clerk or stored in Git**. A locally signed token is NOT provider-issued, and any SDK verification result is **CRYPTO_FIXTURE_ONLY**, never a ReasonableNoise authenticated customer, session, order owner, payment authority, checkout, or production approval. This tests the lower-level `verifyToken()` primitive, not complete `authenticateRequest()` or browser login. Clerk official documentation distinguishes these methods. https://clerk.com/docs/reference/backend/verify-token and https://clerk.com/docs/reference/backend/authenticate-request

## Implemented isolated CI and fixtures
- `.github/workflows/rn-phase32-clerk-synthetic-jwt-workerd.yml`: feature-branch-only, read-only Actions job with Node 22; exact pinned test dependencies in disposable `$RUNNER_TEMP`: Clerk backend 3.29.0, Miniflare 4.20260730.0, esbuild 0.28.2; no site package/lockfile modifications or provider credentials.
- `scripts/phase32/real-clerk-workerd-synthetic-jwt.test.mjs`: builds real Clerk SDK into module Worker, uses supported compatibility date **2026-08-06** and `modulesRoot` aligned to temp bundle. Node generates ephemeral RSA2048 key pairs and synthetic Clerk-shaped JWTs, signs with RS256 and sends fixtures to Workerd. The Worker calls the real `verifyToken()` with explicit public PEM, issuer, audience, authorized party, and zero clock skew. It checks positive synthetic verification and negative tampering, foreign key, expired token, future nbf, wrong audience, wrong authorized party, wrong issuer, and missing token.
- Every result is checked at the Node test boundary; the Worker sets `customerPrincipal:null`, `localSessionAuthorized:false`, `dtfCheckoutEnabled:false`, `paymentAuthorized:false`, `artworkDeletionAuthorized:false`, `productionApproved:false`, and refuses outgoing provider fetch. Unknown routes return 404.
- `tests/dtf-phase32-clerk-synthetic-jwt-workerd-contract-rn3b1c.test.mjs`: **14 offline source contracts** validating pinned tooling, cryptographic signing/verification, runtime, denial cases, zero trust, and no production side effects. These tests inspect the CI/harness and DO NOT execute official Clerk SDK inside Workerd.

## Acceptance targets — not yet independently verified
- Phase32 targeted local source contracts **14/14**; full regression **476/476** (Phase31 verified 462); Astro **11 pages**; JS syntax, Git diff and clean tree PASS.
- **Separate** GitHub Actions Workerd test must PASS, proving real pinned Clerk `verifyToken()` processed both locally generated synthetic positive and negative JWT fixtures in the actual runtime. If it fails, inspect exact logs and apply a bounded correction without substituting mocks, silently skipping the positive fixture or weakening security claims.
- This does not prove actual Clerk-issued sessions, verified revocation/logout, callback/CSRF, real provider keys, or canonical D1 customer/order ownership. Those require separate authorization and independently verified staging credentials. No production provider selection or auth activation.

## Independent Windows PowerShell verification
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase32-clerk-synthetic-jwt-workerd-20261116
node --check .\tests\dtf-phase32-clerk-synthetic-jwt-workerd-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE32_SYNTAX_FAILED' }
node --test .\tests\dtf-phase32-clerk-synthetic-jwt-workerd-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE32_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE32_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE32_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase31-clerk-workerd-compat-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE32_GIT_FAILED' }
git status --short

## Strict NO-GO
PR stays DRAFT/unmerged/undeployed. No Clerk account, real credentials/provider endpoints, customer login route, live D1/R2/Stripe/Resend, production Cloudflare deployment, DTF direct checkout, automatic artwork deletion or USDOT sticker checkout modification. No real session authority from synthetic JWTs.