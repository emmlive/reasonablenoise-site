# RN-3B1C Phase 5 — local disposable Workerd D1 / R2 probes

Dependent **draft** into Phase 4 PR #16 branch. The eight tests run Cloudflare's local Miniflare Workerd emulator with ephemeral TEST_D1 and TEST_R2 bindings. There is no production account binding, remote D1 identifier, customer storage or Stripe request.

- Applies the actual Phase 3 D1 SQL migration locally.
- Uses Phase 3 durable adapter for PNG SHA-256 validation, R2 readback, private artwork binding, and one-time consumption.
- A test-only local Worker (embedded string, NOT a published endpoint) submits conditional SQL updates and R2 lookups to the same Miniflare bindings to test concurrent SQL replay fencing.
- Tests foreign owner, expiration, corruption, deletion, CHECK and UNIQUE constraints.
- **Important:** the test Worker CAS endpoint does not itself validate the artwork bytes. It tests D1 atomicity separately from the host adapter's full validation. Never deploy this test handler. No claim of authenticated end-to-end production authorization.
- Miniflare is local emulation rather than remote Cloudflare D1/R2. Object overwrite race protection, orphan sweep, authenticated end-to-end ownership and Stripe idempotency remain separate gates.

## Windows independent verification
Run only against disposable local emulator. The previous `npm install --no-save` executed inside the application directory altered transitive packages and broke the Astro build. Restore the application's locked dependencies with `npm ci` and install Miniflare under a separate temporary directory. The tests require `RN_MINIFLARE_ROOT` and load only that isolated copy.

Workerd 1.20260730.1 reports support through 2026-08-06; this revision uses compatibility date **2026-08-01**. This is an emulator compatibility correction, not proof of Cloudflare runtime correctness.

Use:
\`\`\`powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/fix/rn-3b1c-phase5-local-runtime-isolation-20261115
npm ci
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
New-Item -ItemType Directory -Force -Path $env:RN_MINIFLARE_ROOT | Out-Null
npm install --prefix $env:RN_MINIFLARE_ROOT --no-save --package-lock=false miniflare@4
node --test .\tests\dtf-artwork-miniflare-rn3b1c.test.mjs .\tests\dtf-artwork-sqlite-rn3b1c.test.mjs .\tests\dtf-artwork-durable-rn3b1c.test.mjs .\tests\dtf-artwork-intent-rn3b1c.test.mjs .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1c-phase4-disposable-sqlite-20261115...HEAD
git status --short
\`\`\`

Expected 110 tests (102 previously verified plus 8 local integration tests), 11 built pages. The earlier run was **103 PASS / 7 FAIL** due to Workerd rejecting the configured future compatibility date; Astro also failed because the local dependency tree changed. Those failures have not yet been independently re-tested. Do not mark Phase 5 passed until the entire suite and build succeed. Do not use wrangler deploy, D1 remote, production R2, migrations apply or Stripe. No production changes.

## Phase 5 R2 migration-loader correction

Independent Windows run after R1: **103/110 PASS; 7 D1 setup failures**, all reporting `SQL code did not contain a statement` from a comment-only migration segment. R1's Workerd compatibility-date blocker was resolved. The PowerShell stop-on-error guard halted execution before a fresh Astro build or Git checks; do not claim those gates passed. This R2 branch strips only full-line SQL comments in the disposable Miniflare test harness before executing the same CREATE TABLE and INDEX statements. The migration file and production code are unchanged. Independent retest remains required.

Use `git switch --track origin/fix/rn-3b1c-phase5-d1-migration-loader-20261115` instead of the previous branch when running the verification commands above. Keep Miniflare installed outside the repository via RN_MINIFLARE_ROOT.

## Phase 5 R3 — complete DDL statement execution
Independent Windows verification after R2 produced **103/110 PASS**, with all seven remaining failures at D1 schema setup: `D1_EXEC_ERROR: incomplete input` for multiline `CREATE TABLE`. Astro built 11 pages successfully, and Git checks were clean.

The local Miniflare harness now parses the known Phase 3 migration into **exactly two** semicolon-terminated statements, checks the expected `CREATE TABLE` and `CREATE INDEX` prefixes, and executes each complete statement through `db.prepare(statement).run()`. This bypasses the emulator's newline-splitting behavior in `db.exec`. The real migration and customer/checkout routes are unchanged.

**R3 remains unverified until the user runs the standalone 8-test Miniflare suite, the complete 110-test regression, Astro build and Git checks.** Use branch `fix/rn-3b1c-phase5-d1-statement-execution-20261115`, preserve the existing external `RN_MINIFLARE_ROOT`, and do not use any remote Cloudflare bindings or commands.
