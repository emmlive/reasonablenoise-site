# RN Holiday 2F — Provider-originated Stripe TEST acceptance: readiness / blocker record

**Status: provider-originated acceptance BLOCKED, isolated engineering preflight can PASS. NO LIVE CHECKOUT APPROVAL.**

## Account authorization finding (27 November 2026)
Connected Stripe account discovery exposed only **TECHINADVANCE, live mode**. That is not verified to be the ReasonableNoise merchant, and it is not a test-mode account. **No merchant test key or provider-issued holiday Checkout Session/webhook was available.** We must not borrow the TECHINADVANCE live merchant or manufacture provider evidence.

## Implemented fail-closed preliminary gate
- `src/lib/holiday-provider-test-preflight.mjs` accepts an independently configured expected Stripe `acct_...` ID and explicitly injected test-mode `sk_test_...` key.
- With **both opt-in flags OFF by default**, makes no provider network call.
- If enabled in a separately authorized disposable test environment, uses a read-only GET `/v1/account`; requires matching exact merchant account ID and `livemode:false`. Rejects wrong merchant, live accounts, unavailable/malformed API replies, restricted/publishable keys, or missing test credentials.
- Even a matching test account returns only `HOLD`: the preflight is **not** proof of a provider-created Checkout Session, customer payment, webhook signature, webhook receipt, durable order or fulfillment.
- No routed Pages Function; no test keys committed, no Stripe mutations, no payments/emails, no production D1/R2. Existing USDOT checkout and custom DTF quote-first remain unchanged.

## Genuine provider acceptance evidence still needed
1. Authorize the **correct ReasonableNoise Stripe TEST-mode account** (not a live-only TECHINADVANCE account). Verify exact `acct_...` identity and mode, with connection access limited to relevant account.
2. In a separately isolated test environment, create a genuine **Stripe test Checkout Session**, get Stripe-issued `cs_test_...` ID, complete the test payment, and capture the Stripe-issued signed webhook with a disposable webhook `whsec_...` secret. Never expose these credentials or payloads with PII in logs/PRs.
3. Verify Stripe GET of the exact session and complete line-items, actual test shipping/details/prices/variants. Pair this with a genuine signed webhook and then the disposable D1 review ledger; verify duplicate webhook redelivery, async/unpaid/expired/refunded paths, negative metadata provenance, no customer email and no shipping instructions.
4. Verify Cloudflare-hosted staging binding, restart/isolate behavior and replay/rollback under the real remote staging runtime, separate from the previously tested local Miniflare D1.
5. Approve print-production proofs, shirt inventory, true shipping/tax/returns operations, durable outbox/manual fulfillment and an explicit production go-live. Existing holiday route remains default-OFF and rejects `sk_live_...` until a separately reviewed production implementation exists.

**Test evidence must not be upgraded into a provider PASS until Stripe-issued session/webhook and readback artifacts are actually observed and checked.** New preflight contracts do not require or use secret values; CI runs against mocks.

**Design/Fix → Test → Release. No drifting.**
