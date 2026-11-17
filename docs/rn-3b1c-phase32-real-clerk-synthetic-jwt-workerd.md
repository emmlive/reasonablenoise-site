# RN-3B1C Phase32 — official Clerk JWT cryptographic fixture tests in isolated Workerd

## Baseline
Phase31 R2 PR #53 independently verified: **12/12 targeted**, **462/462 full**, **11 Astro pages**, Git diff/CLEAN and three passing actual SDK Workerd CI runs #7, #8, #9 on final head `38c741c`. This proves the official SDK's missing-secret fail-closed behavior **inside actual isolated Miniflare/Workerd**, not session authentication.

## Scope and explicit nonproof
Phase32 calls **actual `verifyToken()` from pinned `@clerk/backend@3.29.0` inside real Workerd** to check cryptography against **locally minted synthetic RS256 JWTs**. The RSA signing key is ephemeral in the Node test process and **never uploaded to Clerk or stored in Git**. A locally signed token is NOT provider-issued, and any SDK verification result is **CRYPTO_FIXTURE_ONLY**, never a ReasonableNoise authenticated customer, session, order owner, payment authority, checkout, or production approval. This tests the lower-level `verifyToken()` primitive, not complete `authenticateRequest()` or browser login. Clerk official documentation distinguishes these methods. https://clerk.com/docs/reference/backend/verify-token and https://clerk.com/docs/reference/backend/authenticate-request

## Implemented isolated CI and fixtures
- `.github/workflows/rn-phase32-clerk-synthetic-jwt-workerd.yml`: feature-branch-only, read-only Actions job with Node 22; exact pinned test dependencies in disposable `$RUNNER_TEMP`: Clerk backend 3.29.0, Miniflare 4.20260730.0, esbuild 0.28.2; no site package/lockfile modifications or provider credentials.
- `scripts/phase32/real-clerk-workerd-synthetic-jwt.test.mjs`: builds real Clerk SDK into module Worker, uses supported compatibility date **2026-08-06** and `modulesRoot` aligned to temp bundle. Node generates ephemeral RSA2048 key pairs and synthetic Clerk-shaped JWTs, signs with RS256 and sends fixtures to Workerd. The Worker calls the real `verifyToken()` with explicit public PEM, issuer, audience, authorized party, and zero clock skew. It checks positive synthetic verification and negative tampering, foreign key, expired token, future nbf, wrong audience, wrong authorized party, wrong issuer, and missing token.
- Every result is checked at the Node test boundary; the Worker sets `customerPrincipal:null`, `localSessionAuthorized:false`, `dtfCheckoutEnabled:false`, `paymentAuthorized:false`, `artworkDeletionAuthorized:false`, `productionApproved:false`, and refuses outgoing provider fetch. Unknown routes return 404.
- `tests/dtf-phase32-clerk-synthetic-jwt-workerd-contract-rn3b1c.test.mjs`: **16 offline source contracts** validating pinned tooling, cryptographic signing/verification, runtime, denial cases, zero trust, and no production side effects. These tests inspect the CI/harness and DO NOT execute official Clerk SDK inside Workerd.

## Phase32 R1 — actual GitHub Actions positive-fixture failure and bounded correction
- User-uploaded latest failed CI archive `logs_119097884723.zip` shows the isolated official SDK installed, Workerd started and returned verdicts. All eight negative fixtures were rejected, but `valid` returned `verified:false`; the test assertion failed at line 106. The prior test swallowed SDK errors and assumed `verifyToken()` returned bare JWT claims.
- Clerk's `verifyToken()` API declares a `JwtReturnType<JwtPayload, TokenVerificationError>` return type. The R1 Workerd harness explicitly detects a structured result with `data`/`errors`, refuses nonempty SDK errors, and compares only the verified claim payload. It also retains compatibility with a bare claims return. SDK errors are never treated as successful verification.
- The R1 harness now reports **only a fixed, bounded diagnostic category** for the valid fixture if it is still rejected: `SDK_RETURNED_ERRORS`, `NO_CLAIMS`, `CLAIMS_MISMATCH`, `TOKEN_VERIFICATION_EXCEPTION`, `SDK_EXCEPTION`, or `UNKNOWN_EXCEPTION`. It does not print JWTs, claims, PEM keys, arbitrary SDK exception messages, or user information. A positive synthetic fixture is still REQUIRED to pass; it is not skipped or converted into an expected failure.
- A new offline regression explicitly checks the result-wrapper handling and preserves the mandatory positive assertion. **New target: 15/15** targeted and **477/477** full regression (prior verified 14/14 and 476/476). Astro 11 pages and Git CLEAN remain required.
- **Post-R1 GitHub Actions execution and independent Windows verification are PENDING**, not claimed as successful. If the positive fixture still fails, use the bounded diagnostic and the exact pinned SDK behavior to investigate further rather than weakening the acceptance requirement. No real Clerk sessions or customer identity integration are involved.

## Phase32 R2 — Workerd SDK exception type classification (2026-11-16)
- The user-provided GitHub Actions archive `logs_119100155590.zip`, latest run #7 at R1 commit `c0f6f79`, confirms actual SDK Workerd execution reached the positive synthetic fixture. It failed with **`synthetic verifier mismatch; valid fixture diagnostic: SDK_EXCEPTION`**; the valid synthetic JWT was rejected while the eight negatives were rejected. This proves the R1 result-wrapper hypothesis was **not sufficient** and does **not** identify the actual exception's class or cause.
- R2 is a **diagnostic-only, no-auth-logic-relaxation change**. The Workerd catch maps only known error classes and phrases to fixed categories, e.g. `JS_TYPE_ERROR`, `JS_REFERENCE_ERROR`, `WEBCRYPTO_RUNTIME_ERROR`, `PUBLIC_KEY_RUNTIME_ERROR`, `MISSING_CLERK_SECRET_KEY`, or `GENERIC_SDK_ERROR`; no arbitrary error text, JWT, PEM key, claims, or stack trace is returned. The valid fixture must still verify and all negative fixtures must still fail. The SDK stays pinned, and the test still forbids outbound network calls and all customer/payment authority.
- A new source contract enforces the safe diagnostic vocabulary and mandatory positive-fixture assertion: **16/16** targeted, **478/478** full regression expected (prior R1 independent Windows **15/15**, **477/477**). Astro **11 pages**, syntax and Git CLEAN still required.
- **Post-R2 local and GitHub Actions verification PENDING.** A successful R2 CI run is not assumed; the bounded category is to diagnose, not suppress, the underlying SDK failure. Do not declare Phase32 CLOSED until actual positive and negative crypto execution passes in Workerd.

## Acceptance targets — not yet independently verified
- Phase32 targeted local source contracts **16/16**; full regression **478/478** (prior R1 independently verified 477); Astro **11 pages**; JS syntax, Git diff and clean tree PASS.
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