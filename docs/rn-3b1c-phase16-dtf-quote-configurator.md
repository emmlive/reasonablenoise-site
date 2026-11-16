# RN-3B1C Phase 16 — DTF quote configurator (customer-journey milestone)

**Draft/unmerged/undeployed. No paid checkout, no real customer account, no automatic deletion.**

## User-visible improvement

The existing `/dtf-shirts/` page now includes a responsive **Configure your DTF shirts** quote helper to collect quantity (1–10,000), who supplies shirts, print placement, color, size breakdown, deadline and artwork status. It uses only the existing public **from** price tiers ($24 single / $20 for 6+ / $18 for 12+); it never computes a guaranteed payable amount, tax, shipping or final order total. BYO shirts, front+back, custom placement, and uncertain shirt source always show **Custom quote required**.

Submitting the helper navigates to `/contact?topic=dtf` with *bounded nonpayment preferences*, fills the existing DTF form, and still requires an explicit user submission. The secure existing contact handler retains Turnstile gating for attached artwork, private R2 storage, admin download protection, and quote email. The sticker checkout and webhook are untouched. URL preferences are not trusted pricing or auth claims; the contact route still handles validation and final manual quotation.

## Next implementation sequence

1. Independent local tests and manual mobile browser review of Phase 16. Fix regressions in a dependent draft PR, not production.
2. Agree DTF product/size/shirt-source/placement pricing and shipping rules. Existing `from` figures are **nonbinding**, and BYO print-only pricing isn't published.
3. Design/implement canonical order table, real customer session verification and decision-time authorization; do not weaken the Phase 14 hold.
4. In a separately authorized isolated sandbox, build DTF quote acceptance/order conversion and Stripe-specific payment mode without changing sticker payment markers.
5. Verify lifecycle, privacy, notifications, retries/refunds and full staging E2E before controlled launch.

## Windows independent acceptance

```powershell
$ErrorActionPreference="Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase16-dtf-quote-configurator-20261115
node --test .\tests\dtf-quote-config-rn3b1c.test.mjs
if($LASTEXITCODE -ne 0){throw "PHASE16_FAILED"}
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if(!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))){throw "MINIFLARE_MISSING"}
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "REGRESSION_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/feature/rn-3b1c-phase15-atomic-auth-decision-design-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "GIT_FAILED"}
git status --short
```

Targets: **12/12** new tests, **251/251** total (239 previously verified), **11** Astro pages, clean Git. Not yet independently verified. Preserve draft PR, no merge/deploy, no live Cloudflare/Stripe/customer data.
