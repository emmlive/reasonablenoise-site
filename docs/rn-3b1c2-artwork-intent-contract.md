# RN-3B1C Phase 2A — Server-owned artwork intent contract

This branch is based on the unmerged RN-3B1C PNG integrity PR #12, which in turn depends on RN-3B1 preflight PR #8. It is an **offline interface experiment** and is not integrated with the customer route, R2 or Stripe.

## Implemented contract

`functions/lib/dtf-artwork-intent-rn3b1c2.js` exports:

- `prepareArtworkIntent({ context, bytes, store, clock, idFactory })`: re-verifies actual PNG bytes using the full PNG integrity function, calculates exact-byte SHA-256, and asks the injected repository to create a unique pending record with an opaque intent ID, trusted owner/order references, file length, and at most 15 minutes of lifetime.
- `consumeArtworkIntent({ context, intentId, bytes, store, clock, idFactory })`: verifies identity, order, current time, exact byte count and SHA-256 against the persisted record, then calls `consumeIfUnchanged(record)`. This adapter operation **must be an atomic conditional state transition**, not read + unconditional update.

All successful and failed results explicitly remain `checkoutEligible:false` and `productionApproved:false`. Successful responses also set `artworkIntentBound:false` because no authenticated, durable file storage has been implemented. A synthetic single-use validation does not permit a payment.

## Trust boundary — important

The `trustedServerIdentity:true` flag is only a **test adapter precondition**. **Never accept it from request JSON, query parameters, or any browser-provided value.** A future endpoint must derive the identity and order entitlement exclusively from verified server-side authentication/session state, validate CSRF and Turnstile as appropriate, and implement atomic database-backed durable storage. The repository contract relies on the injected adapter honoring its create/compare-and-consume semantics; the current tests use an isolated in-memory fake.

This module cannot claim production-safe ownership enforcement until an independently reviewed authenticated adapter exists.

## Remaining gates before making an actual paid DTF order

1. Authenticated server identity & least-privilege storage adapter with unique intent constraints, conditional consume, expiry, audit and idempotent retry handling.
2. Private R2 object association with server-generated object paths, exact content hash and size, immutable or version-pinned content, and rollback/cleanup semantics.
3. Threat-model and race tests: duplicate identifiers, parallel consume, overlapping users, cross-order substitution, time skew, expired/revoked intent, repeat webhook, storage/db failure.
4. Full image and print-color assessment, specialist review for non-PNG formats, approved printer capacity.
5. Reconcile PRs #7/#8/#10/#11/#12 and the RN-V1 `main` release without bypassing current sticker payment safety.
6. Only after real DTF pricing is approved: signed/versioned quote totals, Stripe checkout isolation and verified paid production queue.

## Windows offline verification

```powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c2-artwork-intent-contract-20261115
node --test .\tests\dtf-artwork-intent-rn3b1c2.test.mjs .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1c-artwork-integrity-20261115...HEAD
git status --short
```

Expected **75 tests** (11 new + 64 prior) and 11 Astro pages. **Unverified until independently executed**.

No live provider calls, public endpoints, payment activation, production orders, merge or deployment.
