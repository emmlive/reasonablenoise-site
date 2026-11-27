# RN Holiday Shop 2B — Read-only Stripe Checkout reconciliation

**Release status:** DRAFT. No live checkout, no production fulfillment, no customer notifications.

## Design
- Stacked on RN Holiday 2A signed test-event decision.
- `verifyRetrievedHolidayOrder` compares that signature-checked candidate with the **separately retrieved Stripe Checkout Session** and its `/line_items` collection.
- `reconcileHolidayTestCandidate` supplies **test-mode-only, opt-in** injected Stripe GET requests; it never performs network calls by default. `sk_live_` is rejected.
- Exact test catalog: 4 approved creative concepts; $24 per shirt, size S/M/L/XL/2XL, color white/cream/heather-gray, 12-unit order limit; proposed $9.99 shipping.
- Requires completed, paid, `livemode:false` Stripe Session, `holiday_shirt_test` server provenance, matching RNH reference, valid contact email and US destination, no discounts/tax, exact price/subtotal/shipping/total reconciliation, complete line item list (rejects `has_more:true`).
- Returns a **bounded, non-PII HOLD decision** with the verified variants and amount breakdown. No permission to create a durable order, email, ship or delete artwork. Webhook event values alone are not accepted as proof.

## Important limitations
- The new library is **not exposed as a Cloudflare Pages Function**. Tests inject a mock Stripe GET client with realistic response structures. No actual Stripe provider API was called; no real payment/session created.
- A correct HMAC event and retrieved session are necessary but **not sufficient** for fulfillment: a future phase must add durable, atomic D1 idempotency and a signed webhook controller with independent provider/customer provenance checks, handling refunds, duplicates, race conditions and reconciliation.
- No customer PII is emitted in the decision summary; future encrypted/limited-scope order records will need a deliberate schema and privacy policy.
- This gate assumes $24 + $9.99 shipping and no tax or discounts. Actual production tax, shipping and inventory economics remain unapproved.
- The four illustrations have **owner creative approval**, but physically printed proof, garment/stock and final production assets still require QA.

## Release prerequisites
1. Exact-commit CI of new 2B tests and inherited Phase 2A + holiday/shop + sticker + DTF regressions plus Astro build.
2. Independent local Git check and code review.
3. Design, test and verify a durable D1 ledger that rejects concurrent duplicate/replayed events.
4. Independently test actual Stripe **test-mode** retrieval and event-webhook pipeline with no production credentials, customer emails, or fulfillment.
5. Approve physical production, print fulfillment, shipping, returns, tax and original art output.
6. Obtain a separate explicit production release sign-off. **Do not merge or deploy draft PRs.**

**Design/Fix → Test → Release. No drifting.**
