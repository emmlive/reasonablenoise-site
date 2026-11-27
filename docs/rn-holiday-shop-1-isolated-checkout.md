# RN Holiday Shop 1 — Isolated seasonal shop with test-mode checkout

**Status:** draft only. **No production launch, merge, live payment, customer email, or deployed endpoint is authorized by this change.**

## What is implemented

- New static `/holiday-shirts/` shop on Astro with four products: Season's Greetings Tee, Holiday Cheer Tee, Holiday Hoots Tee, Ginger Snap Tee.
- Each shirt is shown as a **temporary original illustrative shirt mockup**. These are not the four uploaded print-ready customer images. Production product photos and artwork must be approved and added before launch.
- All four $24.00 test catalog entries allow sizes S/M/L/XL/2XL and colors white, cream, heather gray. Color/size inventory and actual garment specifications remain unverified.
- Local browser cart with quantity limits, subtotal, removal and a checkout button.
- Separate `POST /api/holiday-checkout` that rejects invalid items, unknown colors/sizes, cross-origin requests, too many items, and forged client prices. It uses Stripe's **test** secret key only and rejects live keys even if manually configured.
- `RN_HOLIDAY_CHECKOUT_ENABLED` must equal `true` for test checkout to run; absent/false defaults to HTTP 503.
- Server controls the test catalog price: $24 per shirt; standard US test shipping $9.99. Tax and final costs are shown at Stripe when configured. These are proposed values, not confirmed inventory/fulfillment rates.
- Stripe Checkout session metadata deliberately tagged `order_type=holiday_shirt_test` and `fulfillment_status=manual_review_only`, with a separate `/holiday-order-return/` page that explicitly never interprets a URL as proof of payment.
- Existing sticker `/api/create-checkout-session`, `/api/stripe-webhook`, admin orders, DTF quote contact, production R2 storage, and USDOT Checkout **UNMODIFIED**.
- A read-only Actions workflow runs focused contracts + existing Stripe and DTF tests + Astro build. No secrets or deploy.

## Test configuration (only isolated, never production)

Set a disposable preview `SITE_URL` to its **exact HTTPS origin**, a restricted Stripe `sk_test_...` key and `RN_HOLIDAY_CHECKOUT_ENABLED=true`. There is **no live-key support** in the holiday endpoint. The client makes a same-origin request; all product descriptions and prices are server-controlled.

## Essential blockers before selling

1. Obtain licensed, print-ready original four T-shirt graphic files with transparent true alpha (the sample images appear on checkerboard backgrounds), verify print quality and rights, approve colors and placement. Replace the placeholder product previews with real garment mockups matching the final art.
2. Verify blank shirt SKUs, size/color availability, production method, capacity and actual $24 retail economics. Confirm shipping charges, tax, customer service/return/cancellation/holiday delivery policy and holiday cutoff.
3. Design/Fix/Test a **separate, signed Stripe holiday webhook** and an auditable durable fulfilled/unfulfilled order record with dedupe, payment/customer provenance, order line items, size/color, shipping address, inventory and email notices; preserve sticker-only webhook routing. The current sticker webhook deliberately does **not** fulfill `holiday_shirt_test` sessions.
4. Test success, cancellation, failed payment, replay, duplicate webhook, fraudulent metadata, refund handling, fulfillment update, shipping and customer notification in a disposable environment, then obtain written release approval.
5. Only after that, introduce a distinct live mode behind additional release gates; **do not just replace the test Stripe key** in the current endpoint.
6. Confirm final seasonal product page can be indexed and linked from home once legal/shipping/art/checkout are operational. Current page is `noindex`, hidden from normal navigation, and not production-linked.

## Independent Windows verification

```powershell
git fetch origin
git checkout feature/rn-holiday-shop-checkout-isolated-20261127
git pull --ff-only
node --check .\functions\api\holiday-checkout.js
node --test .\tests\holiday-shop-checkout-isolation.test.mjs
node --test .\tests\stripe-webhook-isolation.test.mjs .\tests\dtf-quote-artwork.test.mjs
npm ci
npm run build
git diff --check origin/main...HEAD
git status --short
```

CI must be green and final Git output clean before even calling this **isolated test-mode milestone** PASS. This phase does **not** authorize a live checkout or claim order fulfillment.
