# RN-3B1C Phase 7 — Durable manual-review claims and stale recovery

This dependent draft builds on Phase 6 PR #21. It adds a **disposable, review-only** D1-shaped state table, two bounded claim/recovery functions, and 12 native-SQLite contract tests. The SQL is **review-only; never apply it to production**.

## State / safety
- Claims require a trusted operator-authorization callback and a complete, successfully computed Phase 6 review plan; a unique review finding and known private key prefix are mandatory.
- SQL unique constraints allow only one claim per object key; concurrent requests get one successful insert.
- After one hour, an interrupted \`claimed\` record can transition once to \`needs_review\`; it cannot automatically retry or perform R2 cleanup.
- Attempts are capped and the single row holds claim/operator/time/status information.
- **No R2 reads/list/puts/deletes, no cron, no APIs, no production DB binding and no payment code.** All results explicitly deny deletion and checkout.

## Known limitations
- A caller-provided plan can become stale. This contract **does not validate actual live R2/D1/order state, ensure inventory completeness, or enforce protected order status**. Production integration must recompute trusted state on every operation.
- A single mutable SQL row is *not an append-only audit log*. Authentic durable audit events and admin approvals remain a separate gate.
- Review claims are not cleanup leases, cannot authorize artwork deletion, and have no recovery executor.
- SQL concurrency tests use disposable Node SQLite, not distributed remote Cloudflare D1.
- Existing npm audit findings remain open; dependency upgrades are not part of this gate.

## Windows independent verification
\`\`\`powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase7-review-claim-ledger-20261115
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Regression tests failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Astro build failed" }
git diff --check origin/feature/rn-3b1c-phase6-artwork-lifecycle-dryrun-20261115...HEAD
if ($LASTEXITCODE -ne 0) { throw "Git diff failed" }
git status --short
\`\`\`
Expected **134 tests** (122 previous + 12 new), 11 Astro pages and clean Git; no live provider changes.
