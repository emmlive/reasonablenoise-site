# RN-3B1C Phase 19 — DTF Final Pricing Review Gate and Customer Quote Acceptance

**Disposable-only architecture and tests. Production integration NOT authorized.**

## Source-backed baseline
Phase 18 PR #40 independently passed 278/278 tests, 11 Astro pages and Git clean. Existing DTF prices $24 single, $20 each at 6+ and $18 each at 12+ are **advertised starting amounts only**. Current DTF contact request generates an anonymous email quote reference, not a customer-authenticated order. The existing Stripe checkout is sticker-specific.

## Final pricing rules remain UNAPPROVED
The provided source contains no approved final rate card. Do not infer payment amounts from starting prices. Before activating payment, define and separately approve versioned prices and business rules for:
- Shirt blanks by size, style, color; customer-supplied shirts and print-only handling
- Single-side, front/back, sleeve and custom placement; print size; artwork and setup charges
- Quantity tiers, minimums, mix of sizes, large sizes and rush charges
- Pickup/shipping/handling, tax, discounts, refunds, cancellations and re-quote policy
- USD currency, deterministic integer-cent rounding, effective and retirement dates, expiration and reviewer identity

Phase 19 stores only synthetic catalog version status and a manually reviewed quote total in cents. It is **not** a chargeable rate-calculation engine or approval of any real price.

## Isolated implementation
- Disposable-only SQL tables dtf_test_pricing_catalog, dtf_test_quote_price_signoff, dtf_test_customer_acceptances and immutable ordinary-SQL update/delete guards. Never apply to production.
- A synthetic injected customer verifier contract requires verified identity, customer role, CSRF proof, subject and workspace. It is NOT a cryptographic session verifier.
- A single conditional D1 INSERT SELECT checks that converted order and reviewed quote snapshot still agree on quantity, source, placement, sizes, color, USD cents and owner/workspace. It requires approved unexpired quote, complete artwork/pricing/fulfillment reviews, approved pricing catalog, separate per-quote signed total and matching user-visible price/version.
- Explicit customer consent true is required for the isolated contract; call-site booleans are not standalone production consent or session proofs.
- Replay and duplicate acceptances cannot create second records for the same order or quote.
- Every success remains customer_quote_accepted_review_only, checkout_enabled=0, checkoutEligible=false, paymentAuthorized=false, deletionAuthorized=false and productionApproved=false.

## Security and launch blockers
Real customer auth and canonical DTF order ownership, browser CSRF/origin enforcement, real approval UI and price catalog, quote revisions and session revocation, payment-specific Stripe flow, independent provider and staging verification are NOT implemented. D1 does not make an R2 transaction atomic. Phase 14 production readiness hold remains fail-closed. No production routes, R2, Stripe, contact email or sticker checkout changed.

## Independent Windows acceptance
PowerShell:
$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase19-catalog-and-acceptance-20261116
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\dtf-customer-quote-acceptance-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE19_FAILED' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase18-quote-approval-order-conversion-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'GIT_DIFF_FAILED' }
git status --short

Targets: **15/15** new Phase19 tests, **293/293** full regression (278 previous verified), Astro **11 pages**, Git diff PASS and clean working tree. Phase19 tests NOT independently executed. Keep PR DRAFT/unmerged/undeployed; no live data, provider requests, DTF checkout, or automatic artwork deletion.