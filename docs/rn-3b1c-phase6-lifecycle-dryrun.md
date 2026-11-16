# RN-3B1C Phase 6 — Artwork Lifecycle Reconciliation (dry-run only)

Dependent draft on Phase 5 R3 PR #20. Adds an **offline, pure** reconciliation planner and 12 synthetic tests; does not introduce a cleanup API, R2 list/delete or D1 mutation.

## Threats addressed by the planner
- A consumed intent may correspond to an order that must retain artwork. **Never** delete consumed artwork based on checkout intent expiry.
- An issued intent that expired more than 24 hours ago is marked for **manual review only** when no protected order is listed, a complete inventory is attested, and record/file metadata agree.
- An R2 object without a D1 record may be an in-flight write, so young orphans are held; old unreferenced objects receive manual review only.
- Duplicated keys, inconsistent state, missing files, unknown prefixes, oversized metadata, future timestamps, and incomplete snapshots fail closed.
- All results return `deletionAuthorized:false`; no method can erase artwork.

## Explicit gaps for safe production cleanup
1. Real authenticated owner/order lifecycle and durable protected-order registry.
2. Account-scoped, paginated, *complete* object inventory, cross-check with D1, and visibility guarantees.
3. Atomic cleanup claim/lease, fresh database check, object identity/version condition, audit trail and retry ledger before deletion.
4. R2 overwrite protection for private intent key and retention/legal hold policies for paid orders.
5. Safe rollback and diagnostics for partial cleanup, including crash between object deletion and D1 record transition.
6. Disposable Workerd/D1/R2 lifecycle integration tests and a separate authorization for any production cleanup.

## Local verification (PowerShell)
```powershell
git fetch origin
git switch --track origin/feature/rn-3b1c-phase6-artwork-lifecycle-dryrun-20261115
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
node --test .\tests\*.test.mjs
npm run build
git diff --check origin/fix/rn-3b1c-phase5-d1-statement-execution-20261115...HEAD
git status --short
```

Target 122 tests (110 previously verified + 12 new) and 11 Astro pages. No production mutations, checkout authorization or customer data are touched. Dependency audit findings from Phase 5 remain open.
