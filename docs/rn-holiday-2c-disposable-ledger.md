# RN Holiday 2C — Disposable order-review ledger and idempotency

**Status:** Draft only, NO LIVE PAYMENT or fulfillment authority.

## Implementation
- Isolated migration `migrations/holiday-disposable/0001_review_ledger.sql` with independent holiday review orders and event tables. Unique order reference, Stripe **test** session ID and event ID; strict amounts and status `review_only`/`seen_only`.
- A separate pure JS `recordHolidayReviewCandidate` accepts only a Phase 2B reconciled HOLD candidate and an **explicitly injected** D1-compatible database object, requiring `allowDisposableWrite:true`. Default is OFF.
- Canonical SHA-256 of non-PII order snapshot; exact ID + digest readback. If the same event is delivered repeatedly, no second order or event is created. A second event for an identical order can be seen without duplicating the order.
- Two SQL statements in one atomic D1-style `batch`: conditional order INSERT refuses to create a new order if that event ID was already used; event INSERT only attaches to an exactly matching order reference/session/hash. This prevents orphan orders from reused event IDs and foreign-event attachment to a different order.
- **Always HOLD, NEVER payment/fulfillment/email/artwork-deletion authorization.** No status promotion path, no customer PII in ledger or returned result.

## Actual test backend and limitations
- CI uses Node 22 `node:sqlite` with `--experimental-sqlite` to execute the exact migration and SQL in a disposable in-memory SQLite database. The adapter wraps both writes in one `BEGIN IMMEDIATE/COMMIT` transaction and rolls back on failure. The event/session unique keys, collisions, simulated parallel calls, and partial transaction failure are all verified.
- These tests demonstrate SQLite transactional semantics and D1-compatible API design; they do **NOT** prove that a deployed Cloudflare D1 database has been bound, migrated, or tested inside actual Workerd/Miniflare.
- The simulated concurrent tests share an isolated SQLite connection: actual cross-process and D1 multi-isolate delivery/race tests are still required before activation.
- No production D1 `database_id`, Cloudflare binding, live Pages Function, Stripe provider token, customer email, or R2 object is used.
- This is a safe review ledger foundation, **not** an order fulfillment subsystem.

## Release dependencies
1. CI passes 15 Phase 2C SQLite tests, 72 inherited prior-commerce tests and 13-page Astro build, plus independent Windows Git checks.
2. Disposable Miniflare/Workerd D1 transaction/replay, restart, crash and parallel actor verification.
3. Separate signed holiday webhook handler and authenticated Stripe test-mode session verification with correct provider provenance, customer/variant proof, charges/refunds and tax/shipping reconciliation.
4. Proper durable status transitions, manual review controls and notification outbox designed/tested before customer messages.
5. Owner-approved holiday artwork needs final print-ready separation/transparency/garment proof, and approved inventory, shipping/return policies and holiday cutoff dates.
6. Explicit release sign-off before merge/deploy. The current holiday checkout only supports test-mode keys, remains OFF by default, and the shop is still noindex.

Existing USDOT sticker checkout and custom DTF quote-first code remain unchanged.

**Design/Fix → Test → Release. No drifting.**
