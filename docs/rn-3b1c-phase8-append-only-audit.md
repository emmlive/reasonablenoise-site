# RN-3B1C Phase 8 — Append-only review audit (disposable SQLite only)

Dependent draft on Phase 7 PR #22. Adds an additional **review-only** SQL migration and 15 native SQLite tests. Changes recovery SQL to store the actual authorized recovery operator in the claim state before the audit trigger runs.

## Transaction model
- SQL triggers insert a \`claimed\` event in the SAME SQLite transaction as a successful claim row insertion.
- A guarded \`claimed -> needs_review\` transition appends a \`stale_recovered\` event in the SAME transaction and records the actual recovery actor.
- Failure to insert an audit event **rolls back the claim or recovery operation**; duplicates never create extra events.
- SQL triggers reject UPDATE or DELETE on the audit event table, and reject deletion or undocumented state transitions of review claims.
- These are database-trigger enforcement under ordinary SQL access, **not cryptographically immutable audit**: a database administrator capable of dropping triggers or editing the schema can alter history. Real privilege isolation, backups, tamper-evident external logs and retention remain open.

## Limits
- A pre-existing Phase 7 claim inserted **before** the Phase 8 migration won't have its original creation event. Production migration of historical data is not designed or authorized.
- A caller-controlled review plan still lacks a genuine trusted real-time R2/D1/order inventory. No real customer or payment authorization is granted.
- Only test-only SQLite is used. Local Workerd Phase 5 remains regression coverage, not proof of the Phase 8 trigger migration against genuine D1. Separate disposable D1 migration tests required.
- No R2 GET/LIST/DELETE, no Cloudflare production DB migration, no API endpoints, no Stripe, no deploy. Deletion remains OFF.
- Outstanding npm vulnerability findings remain separate security work.

## Independent Windows validation
\`\`\`powershell
$ErrorActionPreference="Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase8-append-only-audit-20261115
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "TESTS_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/feature/rn-3b1c-phase7-review-claim-ledger-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "DIFF_FAILED"}
git status --short
\`\`\`

Target: **149 tests** (134 previously verified + 15 new), 11 Astro pages, clean Git. No merge or deploy.


## R1 fixture correction after independent Windows run

Windows full suite produced **135/149 PASS and 14 FAIL**, all 14 stopping at the same Phase 8 fixture assertion (expected \`manual_review\`, got \`hold\`). The test generated \`intentId\` with \`uuid.replaceAll("-")\`, unintentionally inserting \`undefined\` in place of each hyphen; the Phase 6 lifecycle planner correctly rejected this forged intent ID. Fix only the *test fixture* with \`uuid.replaceAll("-","")\`, plus assertions for the review reason and exact normalized intent ID. **Do not relax the Phase 6 fail-closed behavior.**

Astro build was **PASS (11 pages)** and Git whitespace/status checks were clean in that run. The 15 Phase 8 audit tests must still be independently verified; the 14 downstream cases were not meaningfully exercised while their shared fixture setup failed. Re-run all 149 tests from branch \`fix/rn-3b1c-phase8-audit-fixture-intent-id-20261115\` and verify 11-page build and clean Git. No merge or deployment.
