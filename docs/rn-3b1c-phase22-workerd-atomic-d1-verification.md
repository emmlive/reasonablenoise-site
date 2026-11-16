# RN-3B1C Phase 22 — Cloudflare Workerd + D1 Atomic Acceptance Verification

**Only local disposable Miniflare Workerd/D1. Not production Cloudflare, not a public endpoint.**

## Prior independent baseline
Phase21 PR #43 passed 14/14 targeted, 327/327 regressions, 11 Astro pages and Git clean. Phase21's one-statement conditional D1 INSERT ties session revocation/epoch to reviewed quote acceptance, but those tests mainly called the function from the Node test host.

## Phase22 harness
- New file tests/dtf-atomic-workerd-d1-rn3b1c.test.mjs loads the **exact** Phase21 source and evaluates it as a module within an isolated Workerd instance created by Miniflare. This is not a copied SQL query or host-only function call.
- The worker binds disposable TEST_D1. Seed tables come from the existing Phase18/19/20 synthetic migrations, in local Workerd D1 only, with fake test IDs and manual quote approval. The Phase18 setup conversion runs in host via the **same** Workerd D1 binding before simulated Worker fetch requests.
- Test-only worker routes are assembled solely inside the test harness. A fixed **synthetic** verified principal stands in for a preceding Phase20 signature and CSRF verification, which are covered by separate existing tests. It is NOT a real login or public customer API.
- Worker receives simultaneous fetch requests to the same D1 binding; test asserts unique acceptance and no success after committed revocation. Other tests cover rotation, cancellation, price changes, catalog mismatch, forged client price/owner, replay and missing consent.
- This tests runtime compatibility and competition of **Workerd fetch handlers**, as distinct from Phase21 Node-host tests. It does not prove every distributed Cloudflare D1 production concurrency mode, linearization of all races, or revocation during an already in-flight commit. A commit-before-acceptance ordering is the explicit verified contract.

## Critical outstanding requirements
- No real customer authentication issuer, signup/login, managed signing keys, production cookie/CSRF lifecycle or live canonical DTF customer-order mapping.
- No approved final DTF pricing, checkout authorization, payment webhook or production D1 migration.
- Need additional independently reviewed Cloudflare D1 runtime/platform behavior, authorization/identity and service permissions, verified browser acceptance UI, staging integration and dependency vulnerability cleanup before any deployment.
- Never apply any synthetic migration to production; no calls to live Cloudflare D1/R2, Stripe, Turnstile, Resend or customer endpoints.

## Independent Windows verification
Use the existing isolated Miniflare dependency and never pass real credentials:

$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase22-workerd-d1-atomic-fence-20261116
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\dtf-atomic-workerd-d1-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE22_WORKER_FAILED' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE22_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE22_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase21-atomic-session-acceptance-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE22_GIT_CHECK_FAILED' }
git status --short

## Acceptance targets (not yet independently verified)
12/12 new Phase22 Workerd/D1 tests, 339/339 full regression (327 verified baseline), Astro 11 pages, Git whitespace PASS and clean working tree. Any test failure is NO_GO until corrected and separately rerun.

PR and branch must stay DRAFT, unmerged and undeployed. Existing sticker checkout is untouched; DTF direct checkout and automatic artwork deletion remain disabled.