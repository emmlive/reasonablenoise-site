# RN-3B1C Phase 9 — Local Workerd D1 audit trigger verification

Dependent on Phase 8 R1 PR #24. **Draft / unverified.** This adds one test-only integration suite (9 cases) and no production changes.

## Scope
- Runs the unchanged Phase 7 and Phase 8 SQL migrations in isolated Miniflare 4 / Workerd D1 (compatibility date 2026-08-01).
- Test-only migration parser checks eight pinned DDL statements: one claim table, two indexes, one audit-event table, and six triggers. The parser rejects unmatched content and does not apply SQL remotely.
- Calls the same Phase 7/8 claim and recovery module through local D1 bindings; validates concurrent idempotency, actor attribution, immutability guards, illegal state transitions, and atomic rollback when simulated audit insertion fails.
- Does NOT demonstrate that privileged DB operators cannot drop triggers or rewrite tables. No independent tamper-evident archive.
- No R2, Stripe, production D1, deployed routes, webhooks, external calls or customer data. Artwork deletion remains OFF.

## Windows verification
\`\`\`powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase9-local-d1-audit-20261115
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))) {throw "MINIFLARE_MISSING"}
node --test .\tests\dtf-artwork-d1-audit-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) {throw "PHASE9_FAILED"}
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) {throw "REGRESSION_FAILED"}
npm run build
if ($LASTEXITCODE -ne 0) {throw "BUILD_FAILED"}
git diff --check origin/fix/rn-3b1c-phase8-audit-fixture-intent-id-20261115...HEAD
if ($LASTEXITCODE -ne 0) {throw "GIT_FAILED"}
git status --short
\`\`\`
Expected: **9 new local D1 tests**, **158 total tests**, **11 Astro pages**, clean Git. These results are targets, not verified outcomes. Phase 8 audit integrity was previously verified against native disposable SQLite, not production D1. Dependency audit vulnerabilities remain open.
