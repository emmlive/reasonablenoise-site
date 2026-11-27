# RN Holiday Phase 2F — Stripe Tax read-only readiness gate

**Status:** TAX HOLD. No production tax changes, tax registrations, remote checkout or email.

## Stripe evidence (Reasonablenoise Groups, account acct_1JFBGfEHvJ1pMLLA, TEST environment)
Observed from authenticated read-only Stripe API:
- `GET /v1/tax/settings`: `object=tax.settings`, `livemode=false`, `status=pending`.
- Missing field: `head_office`, as reported in `status_details.pending.missing_fields`.
- `defaults.provider=stripe`, `defaults.tax_behavior=null`, `defaults.tax_code=null`.
- `GET /v1/tax/registrations`: empty `data:[]`, `has_more:false`.
- **Do not extrapolate the test-mode registry to live tax registrations.** No live Stripe Tax settings or registrations were accessed during this tax review.

These findings are not evidence that the business is *not legally registered*; they show only no test-mode Stripe registrations recorded. A tax authority registration must not be invented or inferred from a shipping/head-office address.

## Scope
- `src/lib/holiday-tax-readiness.mjs` is pure read-only evidence inspection and advisory HOLD/BLOCKED decision logic; it has no Pages route.
- The network-taking wrapper requires explicitly injected `sk_test_...` and `allowIsolatedRead:true` (default false) and GETs only the two fixed Stripe tax endpoints; it has no mutation API.
- Fail closed on a live account, partial pagination, unavailable/malformed provider replies, missing head office, pending settings, absent registration evidence or unknown owner policy.
- Even hypothetical active settings, populated tax registrations and owner confirmations return **HOLD** until tax calculation, correct product code/price tax behavior and explicit signoff.
- No email, actual Stripe payment, checkout creation, D1/R2 mutation, key changes, Stripe Tax mutation, or live website changes.
- Existing sticker checkout and DTF quote-first workflow unchanged; test-only holiday Checkout remains OFF.

## Remaining required decisions, **not assumed**
1. Confirm ReasonableNoise's actual registered head-office address (do not assume a location from prior discussions).
2. Confirm whether and where the business is already legally registered to collect sales tax. Only then consider Stripe registration setup.
3. Decide whether holiday-shirt selling prices include tax or have tax added separately, appropriate tax code for apparel, and where shipping is taxable.
4. After explicitly approved changes, verify Stripe Tax status active and tax result in an authorized sandbox. Tax collection only applies where registration is configured; objects require `automatic_tax` enabled to use the feature.
5. Perform real Stripe **test-mode** holiday order acceptance only in a separate isolated, provider-authorized staging flow; never send a holiday test webhook into the existing production-domain sticker endpoint.
6. Independent Windows Git verification, completed CI and owner release authorization before any merge/deploy.

## Gate
New mocked tax evidence tests + inherited 127 tests + website build in isolated GitHub Actions; **passing these tests cannot authorize production tax collection or payment**.

**Design/Fix → Test → Release. No drifting.**
