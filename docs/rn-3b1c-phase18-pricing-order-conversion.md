# RN-3B1C Phase 18 — DTF pricing review and quote-to-order conversion foundation

**Source-gated, disposable-only Phase 18. No production schema or checkout activation.**

## Verified baseline and actual production facts

Phase 17 D1 PR #39 independently passed desktop and mobile Chrome 42 assertions, 264/264 source/local D1 regressions, Astro 11 pages and clean Git. Chrome quote submission was intercepted and was NOT an actual customer order, email or R2 provider verification.

Existing /dtf-shirts/ uses indicative **From $24 / $20 per shirt at 6+ / $18 per shirt at 12+** only. There are no approved final DTF pricing rules, and BYO shirts, front+back, custom size, shipping, tax, setup/print fees and artwork services require manual pricing. Phase 16 configurator does not create a durable customer order.

Live /api/contact produces a DTF-... reference and sends a message, possibly storing private DTF artwork in R2; it does not create a verified authenticated customer order in D1. The existing /api/create-checkout-session is **sticker checkout**; it MUST NOT be reused with DTF client-provided amounts or sticker metadata.

## Proposed production pricing review — NOT IMPLEMENTED

Before real DTF prices can be charged, a trusted owner/reviewer must define the canonical product catalog, supported apparel sizes/materials/color variations, shirt-supplied versus customer-supplied treatment, front/back/sleeve print costs, artwork prep charges, quantity tiers, shipping versus pickup, tax treatment, discounts, cancellation/refund and re-quote policy. Current advertising figures are only starting estimates, not chargeable final prices. Define pricing version, rounding, currency and calculation ownership in the server; never trust URL price or a client-submitted total.

Separately specify customer quote acceptance, identity, expiration, status transitions, editable order policy and durable audit. An approved quote can create an **awaiting_customer_acceptance** order, but conversion is never itself consent to pay. Payment must be a future independent design/authorization phase using a distinct DTF Stripe metadata contract and separate webhook/fraud controls.

## Isolated implementation

- migrations/rn-3b1c-phase18-synthetic-quote-conversion.sql: **DO NOT APPLY LIVE**. Two disposable tables: dtf_test_approved_quotes and dtf_test_conversion_orders, with immutable converted-order triggers. Quote captures quantity, apparel source, placement, size breakdown JSON, reviewed USD total in cents, owner/workspace, reviewer, expiry and three explicit review flags (artwork, pricing, fulfillment).
- functions/lib/dtf-quote-conversion-rn3b1c.js: parameterized **single INSERT ... SELECT** copies only server-owned approved quote values, verifies synthetic reviewer identity and same workspace, matching reviewer, approved status, unexpired time and all review flags, enforcing unique quote conversion. Caller-provided amounts, subject, workspace or status are ignored.
- Conversion success returns `awaiting_customer_acceptance`, `checkoutEligible:false`, `paymentAuthorized:false`, `deletionAuthorized:false`, and `productionApproved:false`. Synthetic reviewer injection is NOT a real authentication proof, D1/R2 are NOT cross-transactional, and normal D1 triggers are NOT privileged-user tamper protection.
- Tests cover concurrent attempts, duplicate conversion, incomplete approvals, expiry, foreign workspace/reviewer, ignored forged amount, synthetic verifier errors and SQL immutability.

No customer UI, /api/contact, sticker checkout, webhook, production Cloudflare D1/R2, Resend, Turnstile, Stripe, background scheduled job, automated artwork cleanup, or deployment changes.

## Windows independent verification

```powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase18-quote-approval-order-conversion-20261116

$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))) { throw "MINIFLARE_MISSING" }

node --test .\tests\dtf-quote-conversion-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw "PHASE18_FAILED" }

node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "REGRESSION_FAILED" }

npm run build
if ($LASTEXITCODE -ne 0) { throw "BUILD_FAILED" }

git diff --check origin/fix/rn-3b1c-phase17-contact-path-browser-d1-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw "GIT_DIFF_FAILED" }
git status --short
```

Targets **14/14** Phase 18 tests, **278/278** total (264 verified baseline), Astro **11 pages**, and clean Git. **Tests authored but not independently run yet.** Avoid merges/deploys, live customer data, provider requests, DTF payment activation, and automatic artwork deletion. Security readiness hold from Phase 14 stays in place.
