# RN-3B1C Phase31 — Real Clerk SDK in isolated Workerd (deny-only)

## Scope
**Phase31 tests actual bundled `@clerk/backend` in the local Cloudflare `workerd` engine via Miniflare.** Like Phase30, this is a negative missing-secret test, NOT a positive Clerk session or provider-account integration. No real credentials, network calls to Clerk, accounts, customer routes, D1/R2/Stripe/Resend calls, deployment, checkout or artwork deletion.

## Baseline
Phase30 R1 PR #52 independently verified Windows **8/8**, complete suite **450/450**, Astro **11 pages**, Git diff and clean tree. GitHub Actions #6 PASS on `f2009f9`, proving official SDK missing-secret rejection inside Node22—not a signed session.

## Implemented
- `.github/workflows/rn-phase31-clerk-workerd-offline.yml`: branch-scoped, read-only Actions job on Ubuntu 24.04 + Node22; install exact versions in disposable runner temp, keeping website dependencies untouched: `@clerk/backend@3.29.0`, `miniflare@4.20260730.0`, `esbuild@0.28.2`.
- `scripts/phase31/real-clerk-workerd-deny-only.test.mjs`: builds real official Clerk SDK through esbuild for ESM Worker with `nodejs_compat`. A **real Miniflare Workerd process** handles an isolated local-only probe, invokes `client.authenticateRequest` with a locally generated public RSA key and synthetic frontend string but **no Clerk secret**. Accept only the exact missing-secret exception and `networkAttempts===0`; otherwise fail. Any unrelated HTTP path must return 404. SDK is bundled from disposable npm root, not production.
- `tests/dtf-phase31-clerk-workerd-ci-contract-rn3b1c.test.mjs`: **12** static offline invariants for versions, dependency isolation, real Workerd invocation, denial, no secrets/routes/payment and untouched site packages.

## R1 CI failure and exact bounded repair (2026-11-16)
- User-supplied GitHub Actions run #3 log showed `MiniflareCoreError [ERR_RUNTIME_FAILURE]`: requested compatibility date **2026-11-01**, but the installed/pinned Workerd server binary supported only through **2026-08-06**. The Workerd process failed to start, so no SDK runtime result was observed.
- R1 changes the isolated smoke test's **single** `compatibilityDate` setting to **2026-08-06**, leaving pinned package versions, `nodejs_compat`, Clerk code, route boundaries, and production behavior unchanged.
- The offline contract suite now contains **11** tests, adding an explicit regression fence against a later unsupported November date. Expected full test count is now **461** (460 verified before R1), not 460.
- This removes the **known date mismatch** only. The new GitHub Actions Workerd run must still prove it starts and executes the actual Clerk SDK test. Neither the source change nor offline contracts alone establishes runtime compatibility.

## R2 CI diagnostic and narrowly scoped module-root repair (2026-11-16)
- Uploaded GitHub Actions run #6 log `logs_119090632171.zip` confirms the R1 compatibility date was no longer the immediate failure. The actual SDK bundle step completed, but **Workerd failed during startup** with `can't use ".." to break out of starting directory`, `MiniflareCoreError [ERR_RUNTIME_FAILURE]`. The SDK authentication probe did **not** execute.
- Isolated bundle path was `bundle=join(output,"worker.mjs")` in a temporary directory outside the repository, while Miniflare used `modules:true,scriptPath:bundle` without an explicit module root. Upstream Miniflare documentation records this same path-resolution error when module paths escape their starting directory. Reference: https://github.com/cloudflare/workers-sdk/pull/4954
- R2 changes only Miniflare initialization to `modules:true,modulesRoot:output,scriptPath:bundle`. The module root is exactly the temporary directory containing `worker.mjs`. No Clerk SDK, version, bundler, authentication behavior, credentials, provider calls, production routes or deployment configuration is changed.
- The local source-contract suite now has **12** tests (prior independently verified **11**); expected full suite count is **462** (prior **461**). The old module assertion was adjusted, and a new regression asserts the bundle and module root are identical.
- **R2 is not yet runtime-verified.** A successful new Phase31 Actions run must show that Workerd started, performed the real SDK missing-key rejection, made zero network requests, and returned 404 for unrelated paths. If a new error appears, diagnose it separately. Do not treat this path fix as evidence of actual Clerk login or provider-issued session verification.

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

**Targets (not independently verified):** 12/12 targeted, **462/462** full (Phase31 R1 independently verified 461), Astro **11 pages**, Git CLEAN, plus separate GitHub Actions **Workerd actual SDK deny-only run PASS**. Do not close Phase31 Workerd milestone before that actual runtime proof is observed.

## Security holds
PR draft, unmerged, undeployed. Production authentication disabled. DTF remains quote-first; direct payment/checkout and automatic R2 artwork deletion disabled. Existing USDOT sticker checkout unchanged.

## External documentation
- Cloudflare Miniflare module workers: https://developers.cloudflare.com/workers/testing/miniflare/core/modules/
- Miniflare package runtime: https://www.npmjs.com/package/miniflare
- Clerk backend SDK package: https://www.npmjs.com/package/@clerk/backend
- Cloudflare Workers bundling: https://developers.cloudflare.com/workers/wrangler/bundling/