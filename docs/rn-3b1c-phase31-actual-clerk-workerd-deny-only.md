# RN-3B1C Phase31 — Real Clerk SDK in isolated Workerd (deny-only)

## Scope
**Phase31 tests actual bundled `@clerk/backend` in the local Cloudflare `workerd` engine via Miniflare.** Like Phase30, this is a negative missing-secret test, NOT a positive Clerk session or provider-account integration. No real credentials, network calls to Clerk, accounts, customer routes, D1/R2/Stripe/Resend calls, deployment, checkout or artwork deletion.

## Baseline
Phase30 R1 PR #52 independently verified Windows **8/8**, complete suite **450/450**, Astro **11 pages**, Git diff and clean tree. GitHub Actions #6 PASS on `f2009f9`, proving official SDK missing-secret rejection inside Node22—not a signed session.

## Implemented
- `.github/workflows/rn-phase31-clerk-workerd-offline.yml`: branch-scoped, read-only Actions job on Ubuntu 24.04 + Node22; install exact versions in disposable runner temp, keeping website dependencies untouched: `@clerk/backend@3.29.0`, `miniflare@4.20260730.0`, `esbuild@0.28.2`.
- `scripts/phase31/real-clerk-workerd-deny-only.test.mjs`: builds real official Clerk SDK through esbuild for ESM Worker with `nodejs_compat`. A **real Miniflare Workerd process** handles an isolated local-only probe, invokes `client.authenticateRequest` with a locally generated public RSA key and synthetic frontend string but **no Clerk secret**. Accept only the exact missing-secret exception and `networkAttempts===0`; otherwise fail. Any unrelated HTTP path must return 404. SDK is bundled from disposable npm root, not production.
- `tests/dtf-phase31-clerk-workerd-ci-contract-rn3b1c.test.mjs`: **10** static offline invariants for versions, dependency isolation, real Workerd invocation, denial, no secrets/routes/payment and untouched site packages.

## Nonproofs and blockers
- A PASS would prove the SDK can be bundled and the missing-key failure path executed inside local Workerd. It does NOT prove valid signed JWT acceptance, accurate Clerk session classification, live revocation, callback security, browser CSRF, production Cloudflare Pages compatibility, D1 customer ownership, or live session authorization.
- If esbuild, package export, workerd compatibility, missing-key behavior or a package install fails, mark **NO_GO**; inspect exact logs before bounded code edits. Do not fake a PASS by replacing SDK with a mock, preemptively returning a denial, substituting Node tests, or skipping the Workerd assertion.
- No production website or custom domain activation. No real Clerk account/project and no secrets required. A real positive authentication trial remains separately gated.

## Independent Windows PowerShell run
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase31-clerk-workerd-compat-20261116
node --check .\tests\dtf-phase31-clerk-workerd-ci-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE31_SYNTAX_FAILED' }
node --test .\tests\dtf-phase31-clerk-workerd-ci-contract-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE31_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE31_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE31_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase30-clerk-sdk-offline-ci-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE31_GIT_FAILED' }
git status --short

**Targets (not independently verified):** 10/10 targeted, **460/460** full (Phase30 baseline 450), Astro **11 pages**, Git CLEAN, plus separate GitHub Actions **Workerd actual SDK deny-only run PASS**. Do not close Phase31 Workerd milestone before that actual runtime proof is observed.

## Security holds
PR draft, unmerged, undeployed. Production authentication disabled. DTF remains quote-first; direct payment/checkout and automatic R2 artwork deletion disabled. Existing USDOT sticker checkout unchanged.

## External documentation
- Cloudflare Miniflare module workers: https://developers.cloudflare.com/workers/testing/miniflare/core/modules/
- Miniflare package runtime: https://www.npmjs.com/package/miniflare
- Clerk backend SDK package: https://www.npmjs.com/package/@clerk/backend
- Cloudflare Workers bundling: https://developers.cloudflare.com/workers/wrangler/bundling/