# RN-3B2 — DTF Transfer Pricing Foundation (Synthetic Only)

## Why this branch exists

Customers should eventually progress from **choose size → upload and inspect artwork → review exact total → secure Stripe checkout → paid production order**. The printer model, verified operating capacity, real transfer pricing, shipping obligations and tax rules have **not** been supplied, so this isolated branch creates only a server-side pricing **calculation contract**, never a real purchasable quote.

This branch starts from `main` after RN-V1. It is independent of the draft DTF transfer UI (PR #7), artwork preflight API (PR #8), and customer quality integration (PR #10). It must not be merged into the live checkout path until later gates are complete.

## Implemented engine

`functions/lib/dtf-pricing-rn3b2.js` exports `calculateDtfSyntheticPrice(request, config)`.

- **Strict synthetic-only configuration:** `mode: "synthetic_test"`, `testOnly: true`, plus explicit integer cent rates and shipping amounts. No default production prices.
- Accepts selected size in **quarter-inch increments** and quantities from 1 through 10,000. Standard cards: 3×3, 8×10, 10.5×11, 11×14 inches. Other sizes require explicit `allowCustomSizes: true` for synthetic experiments.
- Calculates per-transfer amount as a function of area using integer cents, with rounding up; optional tiered basis-point discounts and separate pickup/shipping line.
- Produces a nonbinding preview with `checkoutEligible: false`, `productionApproved: false`, and prominent `TEST ONLY` disclaimer on every success. Invalid input/configuration fails closed.
- No HTTP endpoint, Stripe call, payment link, order write, storage action, or customer-facing test-price publication.

**All numbers in automated tests are deliberately fictional and do not represent ReasonableNoise's prices.** Never publish them in customer-facing pages.

## Gates to actual DTF checkout

1. **RN-3B1C** — Complete full image decode and secure upload-intent association: check file bytes, validated printing limits, expiry, replay resistance, user consent and file-to-quote integrity. Low quality or specialist formats must go to review, not automatic checkout.
2. **Printer verification** — Record machine model, compatible transfer sizes/materials, actual output capacity, turnaround constraints, minimum print batches, and confirmed production limits.
3. **Real pricing commission** — Specify per-size cost, ink/film/material, labor, quantity tiers, sales tax, shipping rates, handling, returns/reprints, and which custom items require manual review. These must become versioned server-side prices, not client-sent cents.
4. **RN-3B2 acceptance** — Validate a production pricing table, minimum order size, max line items, shipping address eligibility, taxes and total rounding. Bind quote totals to a signed, expiring, nonreplayable quote identity.
5. **RN-3B3** — Server-create Stripe checkout sessions only from a verified, unexpired artwork intent and committed server-owned total. Keep old sticker checkout and webhook source isolation unchanged.
6. **RN-3B4** — Independently confirm paid Stripe sessions and only then create a durable production job with notifications; duplicate webhooks must be idempotent.
7. **Operational activation** — Controlled rollout, production printer-ready gate, runbook and monitoring; no unattended launch.

## Offline Windows verification

```powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b2-dtf-server-pricing-foundation-20261115
node --test .\tests\dtf-pricing-rn3b2.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/main...HEAD
git status --short
```

Expected **45 tests** (9 new + 36 existing) and 11-page Astro build. These are expected outcomes, **not** verified results yet.

**Release status: draft only. Never expose test prices to real customers, merge automatically, issue DTF Stripe sessions, accept payment or create production jobs under this milestone.**
