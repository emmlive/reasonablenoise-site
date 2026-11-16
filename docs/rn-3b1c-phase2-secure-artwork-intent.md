# RN-3B1C Phase 2 — Secure Artwork Intent (isolated contract)

Dependent on Phase 1 PR #12, **not main**. This adds a pure server-only transactional intent state machine and synthetic tests. No route, production database, R2 bucket, Stripe service, or customer session is connected.

## Trust contract
- Caller authenticates the account and verifies that `subjectId` may act on `orderId`; neither may be read from browser claims.
- Issue takes the exact original PNG bytes, independently validates full PNG raster integrity and computes SHA-256. The private object key is generated server-side. The private object must be durably written, read back and validated before any future production integration can consider the intent usable.
- The `store.atomic(fn)` adapter must provide durable cross-request **serializable** transactions, unique insertion, committed update, and rollback on error. The in-memory adapter in tests is **not** production storage.
- Consumption takes the trusted private-object read and compares the actual bytes, object key, owner/order, length, fingerprint, expiry and one-use state in an atomic transaction.
- The issued and consumed API results both have `checkoutEligible:false` and `productionApproved:false`. Consumed means only that this isolated predicate passed; it is **not** payment authorization.
- Fifteen-minute lifetime; one successful consumption maximum.

## Unmet integration gates
1. Select and independently verify a durable transactional backend with uniqueness/concurrency and recovery tests (Cloudflare D1 or another supported database).
2. Introduce authenticated order/session issuance; create private object with an atomic/durable linkage strategy and fail-closed compensation for storage/transaction failures.
3. Ensure trusted object read, SHA-256, and expiry are checked at payment authorization; no client-controlled object key or alternate bytes.
4. Specify retry semantics: a consumed intent cannot be reused after a failed downstream checkout; new intent required unless a separate durable checkout idempotency model is proven.
5. Runtime adversarial/concurrent tests, object ownership and deletion/expiry cleanup, genuine Cloudflare Worker checks, and independent review.
6. Resolve full print-suitability review, pricing, taxes/shipping and merchant readiness before RN-3B3 Stripe work.

## Local verification
```powershell
node --test .\tests\dtf-artwork-intent-rn3b1c.test.mjs .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1c-artwork-integrity-20261115...HEAD
git status --short
```

No merge, deploy, payment, production order, provider call or customer upload is authorized.
