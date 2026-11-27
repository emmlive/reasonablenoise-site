# RN Holiday Phase 2H — Provider TEST identity and isolated acceptance evidence

**Status:** Genuine ReasonableNoise Stripe test API/session/line-item READBACK PASS for a prior **sticker** order. Genuine provider-originated **holiday** payment and signed webhook acceptance remain BLOCKED/PENDING. All holiday PRs remain draft and holiday checkout remains OFF.

## Genuine provider-side evidence: read-only
- Connected Stripe account: Reasonablenoise Groups, `acct_1JFBGfEHvJ1pMLLA`, authorized **test** environment.
- `GET /v1/account` authenticated successfully and returned matching `id` and `object:account`. **The actual Stripe Account object omits the `livemode` field**. The earlier 2F mocked preflight had incorrectly required `livemode:false` on account; the 2H patch accepts omission only with `sk_test_` credentials, still rejecting explicit non-false values and requiring `livemode:false` on independently fetched Checkout Sessions.
- Stripe `GET /v1/checkout/sessions` returned existing provider-issued `cs_test_...` sessions, including completed-paid and expired-unpaid records.
- Independent `GET /v1/checkout/sessions/{id}` and `GET /v1/checkout/sessions/{id}/line_items` succeeded for a completed provider-issued test session. **It had legacy USDOT/sticker metadata, not holiday-sh shirt provenance, and is NOT eligible as a holiday order.** PII was deliberately excluded from this evidence record; the Stripe response may contain contact details and must not be logged.
- Stripe test-mode webhook endpoints included enabled `checkout.session.completed` delivery to **`https://reasonablenoise.com/api/stripe-webhook` (PRODUCTION DOMAIN)**. No webhook destinations, events, or secrets were modified. No test holiday event delivered.

## Actual tax blocker
Authenticated test-mode `GET /v1/tax/settings` reported `pending`, missing `head_office`, default tax code/behavior null. `GET /v1/tax/registrations` yielded zero test-mode registrations. This does NOT establish live tax registration or government's registration records; do not infer legal status.

## Phase 2H isolated implementation
- `src/lib/holiday-provider-bound-review.mjs` pins **exact Reasonablenoise Groups merchant ID** and requires an explicit `sk_test_...` credential and a separately supplied `whsec_...` test webhook signing secret.
- It first reads Stripe Account identity (GET) and rejects a different merchant or explicit live mode; then runs existing signed-event HMAC (2A), independent test-mode session and line-item GET validation (2B), atomic review-only disposable Workerd D1 ledger (2C). Disallows payment, checkout, tax collection, email, fulfillment and deletion authority on every result.
- All opt-in flags default OFF; `allowTaxPendingReview` allows **only local review evidence** under unresolved tax policy. No mounted Pages route or externally reachable acceptance endpoint; no production Cloudflare staging bindings.
- Local CI tests use **synthetic event signature, fake GET account/session/line-items responses, and real locally emulated Workerd D1**. They never perform a real provider POST or webhook delivery.
- Tests also verify the actual Stripe Account schema compatibility: missing `livemode` on the account is acceptable only with `sk_test_` keys, whereas retrieved Checkout Sessions must explicitly be `livemode:false`. We do not claim real response signatures as part of this CI.

## Strict gates still OPEN before genuine provider acceptance
1. Isolated, owner-approved HTTPS staging receiver + disposable remote Cloudflare D1 and no send providers, protected from unwanted traffic, with separate test webhook signing secret and unique Stripe TEST webhook destination. **Never use the existing production-domain sticker webhook** for holiday test deliveries.
2. Owner tax policy decision, business head office, existing legal registrations, and explicit decision how to handle pending tax in a **test-only** holiday payment scenario. No tax registrations created or guessed.
3. Genuine Stripe-issued holiday test Checkout Session with matching reference/metadata, expected `$24` per unit + `$9.99` shipping and independently verified complete line items. An actual payment must complete using test-mode methods. No real customer contact or shipping fulfillment.
4. Actual Stripe-originated signed `checkout.session.completed` (or allowed async payment success) delivered to isolated staging and verified against a separate `whsec_` secret. Independently GET read-back and durable remote D1 dedupe/replay acceptance. Confirm no email, refund/charge/production flows and no privileged entitlement.
5. Physical print proofs, inventory/fulfillment/shipping/tax/returns, independent owner review and explicit production release decision.

**Safety:** Site dependencies, live sticker checkout, DTF quote-first, tax settings, webhook destination, Stripe products and real payment state unchanged. No production deploy.

**Design/Fix → Test → Release. No drifting.**
