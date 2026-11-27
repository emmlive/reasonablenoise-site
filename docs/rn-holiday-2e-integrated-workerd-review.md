# RN Holiday 2E — Synthetic signed-event → Stripe lookup → disposable D1 integration

**Status: test-only. Production checkout and outbound communication remain disabled.**

## Design/Fix
- Compose the already-tested Phase 2A cryptographic signature check, 2B independent Stripe session and line-item reconciliation, and 2C/2D atomic D1 review ledger.
- Implement as `src/lib/holiday-integrated-review.mjs` (**no Pages Function route**), with three independent explicit opt-in flags defaulting to false. Only `whsec_...` / `sk_test_...` shaped test credentials are considered.
- Fail closed at each stage and **never** return payment, fulfillment, email or deletion authority. Output contains only outcome and reason.
- Real Workerd invokes the bundled original source through a test-only, localhost-only endpoint. It injects fixed, synthetic Stripe session/line item responses: no connection to Stripe or any external provider, and no real customer PII.
- Actual D1 migration and `batch()` are used, reusing Phase 2D’s verified SQL, but with a new disposable D1 binding exclusive to the test harness. Replayed events remain idempotent; concurrent dispatches remain review-only.
- Existing ReasonableNoise USDOT webhook, product checkout, customer emails, DTF quote-first pathway, website package lock and production environment remain **untouched**.

## Test scope
14 isolated integration tests in `tests/holiday-integrated-workerd-rn2e.test.mjs` cover: one complete synthetic signed checkout to review-only ledger, replay, 20 concurrent signed webhooks, separate signed events for same checkout session, forged HMAC payload, expired/nonpayable and live-mode event rejection, disabled flags, malformed Stripe metadata and order reference, shipping rejection, product/variant/price/quantity/total forgeries, simulated provider failure/truncated lines, and localhost-only route checks. Inherited Workerd/D1, SQLite and Stripe/DTF suites run in the same no-deploy CI.

## Boundaries still unverified
- No **provider-originated** Stripe test-mode webhook or actual Stripe Checkout Session was created; all events and Stripe GET responses are synthetic.
- No account-backed Cloudflare D1 staging or production database, distributed consistency, live-key support, emails, customer order production or fulfillment actions.
- The D1 review ledger is intentionally not a shipping order or payment accounting source. Refund/cancellation lifecycle, durable customer data/notifications/outbox and reconciliation require separate design and acceptance.
- Approved seasonal artwork still needs final print-file/garment QA, confirmed stock, shipping and tax/return policy and explicit production release authorization.
- CI PASS does not by itself permit merging stacked draft PRs #55–#60, deployment, or switching on checkout.

**Design/Fix → Test → Release. No drifting.**
