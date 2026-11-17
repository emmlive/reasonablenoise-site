# RN-3B1C Phase30 — Actual Clerk SDK deny-only isolated CI experiment

## Verified baseline
Phase29 PR #51 independently verified: 15/15 targeted; 442/442 full; 11 static pages; JS syntax/Git clean. Phase29 did not install or execute an actual SDK.

## Goal and hard limit
Execute the **official** pinned `@clerk/backend@3.29.0` through real Node `createClerkClient` and `authenticateRequest` using an entirely synthetic, non-authenticated local Request and locally generated RSA public PEM. **Observed blocker (CI runs #1–#3):** official SDK installed, but `authenticateRequest()` threw `Missing Clerk Secret Key` before an unauthenticated RequestState existed. The bounded R1 repair asserts that **exact configuration failure** with `assert.rejects` and requires zero network calls. This tests the SDK's missing-credential fail-closed path, **NOT** a normal unauthenticated session denial, genuine Clerk session, accepted JWT, callback, login, or revocation. No real Clerk tenant or provider-issued token is involved.

## Implementation
- `.github/workflows/rn-phase30-clerk-offline-sdk.yml`: scoped push CI job on this feature branch, read-only repo permission, Node 22, installs exact SDK version into a disposable `$RUNNER_TEMP` directory outside the site's npm package tree using `--ignore-scripts --no-audit --no-fund --save-exact`; runs one isolated SDK-only smoke; checks site package files unchanged. No production secrets or account access.
- `scripts/phase30/real-clerk-sdk-deny-smoke.test.mjs`: loads actual SDK from disposable package root via createRequire, checks package version, creates client with local-only synthetic publishable key and generated public JWT PEM, calls actual `authenticateRequest` for a localhost POST without token, forces any fetch to throw, and verifies an exact `Missing Clerk Secret Key` exception with zero network requests. This is a prerequisite-configuration rejection, not successful session verification. The synthetic frontend string is not a real Clerk credential.
- `tests/dtf-phase30-offline-sdk-ci-contract-rn3b1c.test.mjs`: eight offline source contracts that can run without installing SDK. They require exact version pinning and isolated install, actual SDK call, explicit missing-secret rejection assertion, no network, no secrets and no production authority.

## Limitations
Real SDK invocation and deny result are contingent on CI actually running successfully; pushing the workflow does NOT prove completion. Its outcome must be checked from the GitHub Actions job and pinned commit. In R1, expected SDK rejection is **Missing Clerk Secret Key**, not an unauthenticated response. A successful R1 CI job proves only that this pinned SDK fails closed without a mandatory key; it does **NOT** validate legitimate Clerk session rejection or authentication. Workerd compatibility remains **UNVERIFIED**: this CI runs Node 22, not a Cloudflare Worker runtime. Never read `isAuthenticated` from a mocked adapter or treat it as a local ReasonableNoise principal.

## Independent Windows verification
$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase30-clerk-sdk-offline-ci-20261116
node --check .\tests\dtf-phase30-offline-sdk-ci-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE30_SYNTAX_FAILED' }
node --test .\tests\dtf-phase30-offline-sdk-ci-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE30_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE30_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE30_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase29-clerk-sdk-trial-preflight-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE30_GIT_FAILED' }
git status --short

**Targets:** eight new tests, 450/450 regressions (442 verified baseline), Astro 11 static pages, Git clean. Separately inspect the **new post-R1 GitHub Actions run** for actual `@clerk/backend@3.29.0` installation and expected missing-secret fail-closed assertion PASS. If that run passes, mark *configuration-rejection subgate* PASS; keep *actual authenticated/unauthenticated session semantics* BLOCKED until separately authorized provider credentials and official runtime test. Node CI is an additional independent gate, never inferred from source contracts.

## NO-GO constraints
No Clerk tenant, credentials, live provider endpoints, real JWTs, user registration, auth route activation, Cloudflare D1/R2 writes, Stripe, Resend, USDOT checkout modifications, DTF checkout, payment permission, automatic artwork deletion, merge or deploy. Keep PR DRAFT.