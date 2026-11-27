# RN Holiday 2A — Signed Payment Event Decision Boundary

**Status:** Isolated review-only control. NO HOLIDAY FULFILLMENT and NO LIVE CHECKOUT APPROVAL.

## Scope
- Signed Stripe test-event HMAC-SHA256 verification offline with timestamp tolerance ±300s. Uses **raw payload bytes** as string; does not trust JSON or query parameters before signature checking.
- Rejects non-test events, unknown event types, wrong source, `sticker_order`/custom DTF substitutions, bad order reference, unpaid sessions, wrong currency, or malformed checkout IDs.
- Only recognizes `holiday_shirt_test` paid test Checkout Sessions bearing a strict `RNH-` reference matching `client_reference_id`.
- **Returns HOLD even when the signature and payment marker verify.** A webhook event by itself is not durable fulfillment authorization. A later phase must retrieve the Checkout Session and actual line items from Stripe, independently validate customer provenance and amounts/variants, and commit an idempotent order record before emails or shipping actions.
- Signed failed, expired, and refunded event types also remain HOLD, not accepted as new orders.
- Provides NO Pages Function route and NO hooks into the live sticker webhook, Stripe API, R2, D1, Resend, or customer notification.

## Owner-approved art
The four holiday illustrations are creatively approved as designs. This does not yet confirm color-calibrated print-ready files, garment dimensions/stock, licensing verification, or physical proof sign-off. Preserve reindeer, polar bear, owl, and gingerbread designs faithfully. Do not claim merchandise ready to ship until vendor stock and fulfillment are verified.

## Test evidence
Isolated CI `rn-holiday-2a-payment-decision.yml` runs 15 new HMAC/event tests, existing 7 holiday shop tests, 35 sticker/DTF commerce regressions, and Astro static build. GitHub CI and independent Windows tests must be recorded before PASS.

## Unresolved before launch
1. Separate test-only Stripe webhook route with verified signature and **actual** Stripe session/line item retrieval, plus provenance controls and price/quantity matching.
2. Durable D1 order ledger and replay protection based on event/session IDs, duplicate/parallel delivery, partial failures, refunds, and reconciliation.
3. Manual fulfillment and notification after verified durable state, never after redirect success alone.
4. Final shirt inventory, print proof, customer returns/tax/shipping cutoff approval.
5. Browser acceptance and end-to-end test-mode Stripe/Cloudflare replay tests.
6. Explicit owner release signoff to remove seasonal `noindex` and activate any real payment (separate code gate; no `sk_live_` support exists).

**Design/Fix → Test → Release. No drifting.**
