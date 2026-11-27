# RN Holiday 2G — Isolated Stripe TEST webhook acceptance

**Scoped engineering outcome only; no provider-originated holiday session or webhook received yet.**

## Read-only genuine Stripe evidence
Connected Reasonablenoise Groups Stripe test environment, account `acct_1JFBGfEHvJ1pMLLA`, was independently accessed via test-mode account, checkout-session, event and webhook endpoint API reads during Phase 2F.
- Stripe returned genuine `cs_test_...` test sessions, but inspected recent sessions did not carry holiday-specific checkout provenance. They are NOT holiday acceptance records.
- Enabled test-mode `checkout.session.completed` webhook endpoint points to `https://reasonablenoise.com/api/stripe-webhook`, **the live production domain** for existing sticker orders. DO NOT redirect test holiday events to it or change its configuration for this phase.
- Test-mode Stripe Tax status `pending`, `head_office` missing, defaults tax behavior and tax code null, registrations list empty. This does not prove legal or live tax registration status.

## 2G implementation: local-only Workerd acceptance
`src/lib/holiday-isolated-ingress.mjs` is NOT a Pages Function and MUST NOT be mounted on an internet-accessible route.
- Accepts only exact `http://localhost/__isolated/holiday/test-webhook`, POST, `application/json`, no query/hash or credentials in URL, bounded signature and body length.
- Requires four explicit workflow opt-ins plus `allowTaxPendingReview`. All are OFF by default. Without tax-review-only opt-in, returns HOLD without attempting Stripe reads or D1 writes. Even with that opt-in, successful reconciliation is `review_only` in disposable D1, no payment/email/fulfillment authorization.
- Internally relies on previously reviewed Stripe HMAC SHA-256 test signature, read-only independent Stripe test-mode session/line-item reconciliation, and atomic Workerd D1 review-only ledger. Responses contain decision state only, never customer personal information or secrets.
- 2G CI uses **synthetic signed webhook bodies, locally mocked Stripe GET, and actual locally emulated Workerd/Miniflare D1**. No Stripe credentials and no real event delivery are used by these tests.
- Explicit production origin and existing `/api/stripe-webhook` are rejected. Do not infer localhost host matching alone is a defense for deployment; the decisive boundary is that this is an unmounted test-only module.

## Acceptance still required before genuine provider PASS
1. Obtain owner-approved isolated HTTPS staging origin, Cloudflare Access or equivalent ingress protection, isolated disposable D1, and separate Stripe TEST webhook secret. Confirm no path to the live sticker webhook, no send providers, no live keys, no customer PII logs.
2. Confirm policy for sales tax and legal registrations; do not pretend the current pending Stripe Tax state is production ready. If a test-only proof excludes tax, record that limitation explicitly.
3. With approved staging and an appropriate test-mode checkout tax policy, create a genuine Stripe-issued holiday `cs_test_...` Session in Reasonablenoise Groups, then read it back using Stripe GET and verify items, order metadata and merchant identity; test cases must never receive customer production contacts.
4. Capture an **actual Stripe-issued signed** test-mode event delivered to isolated staging, verify signature with separate test webhook secret, independently read back payment/status/line items, then write review-only disposable D1. Redeliver/replay and check record uniqueness, refunds/expired and negative source metadata.
5. Validate production tax/shipping/returns/garment proofs/owner signoff separately. Holiday checkout stays OFF and stacked PRs remain DRAFT until explicitly approved.

**Never claim the 2G synthetic, local Workerd acceptance constitutes genuine provider-originated holiday checkout acceptance.**

**Design/Fix → Test → Release. No drifting.**
