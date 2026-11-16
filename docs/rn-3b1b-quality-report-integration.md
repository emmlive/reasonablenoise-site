# RN-3B1B — DTF artwork quality report integration

## Scope and dependency

This integration branch is based on the **unmerged RN-3A transfer UI branch (PR #7)**. It copies the independently tested RN-3B1 inspection foundation from **PR #8** in order to run a reviewable end-to-end UI-to-API synthetic contract. Neither existing PR is merged or changed by this work.

## Customer journey (still quote-first)

1. Select transfer dimensions and quantity.
2. Choose a file, see the local preview for PNG/JPG/WebP.
3. Complete a *separate* Cloudflare Turnstile challenge with action `dtf_preflight` and click **Inspect my artwork**.
4. Read preliminary status: header/resolution checks passed, review recommended, or cannot verify. Error conditions fall back to manual quote.
5. Submit the existing DTF quote separately through `/api/contact` using its own Turnstile action `dtf_artwork`.

The preflight request carries selected file + dimensions only. It does not store artwork, create an order, quote a price, or authorize checkout. The existing DTF quote endpoint separately controls private R2 storage, challenge verification, email, and failure cleanup.

A technical pass means **headers and estimated resolution only**; it does not guarantee readable pixels, transparency, ICC/color, suitable art, valid PDF/artboard or production dimensions. Every backend report has `canAutoCheckout: false` and `productionApproved: false`.

## Guards before customer launch

- Independently verify the **combined branch** tests and build. Do not merge PR #7, #8, or this integration PR automatically; coordinate future conflict resolution with `main` (RN-V1 has since merged).
- Review Cloudflare Turnstile availability/sitekey and action-specific Siteverify behavior on the production domain. Test only with synthetic/staging tokens; no production provider calls in this gate.
- Establish WAF rate limiting and payload limits before enabling a public inspection endpoint.
- Confirm uploaded artwork content using a *full decoder and trusted object association* (RN-3B1C) before using any quality result for checkout.
- Verify printing capacity, material costs, gang-sheet sizes and prices before enabling payment/production (RN-3B2 onward).
- Local `astro dev` does not necessarily run Cloudflare Pages Functions; a page mock/production-equivalent preview is needed for live API interaction verification.

## Local independent check (Windows)

```powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1b-dtf-quality-report-20261115

node --test .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-transfers-rn3a.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3a-dtf-transfers-quote-first-20261114...HEAD
git status --short
```

Expected: **65 tests** (18 preflight + 11 DTF transfer UI + 36 pre-existing), **12 Astro pages** and clean git; these results are **not yet verified** on Windows. Do not submit a live quote, payment or customer artwork during this check.
