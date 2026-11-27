# ReasonableNoise — Varsity, Creative and Bring Your Design (BYD) storefront draft

**Status: Design draft only. NO PRODUCTION DEPLOY, NO NEW PAYMENT OR UPLOAD BACKEND.**
This branch is stacked on RN Holiday Phase 2H but is a separate design workstream from Phase 2I Stripe staging/security.

## Scope implemented
- `/shirt-designs/` — noindex draft catalog featuring original **text-only typographic concepts** Spirit, Legends, Victory, Ambition and a separate Creative section inspired by the supplied PandaUni-style mascot samples. The submitted samples are **references** only, not asserted licensed designs nor automatically transferred source assets.
- `/bring-your-design/` — noindex BYD landing page showing customer steps and a clear quote-first call-to-action.
- Existing `/dtf-shirts/` adds links to BYD and the design preview, preserving the already implemented DTF quote-first path.
- BYD CTAs deliberately use `/contact?topic=dtf`, which already selects the DTF topic and exposes the existing Turnstile-protected optional 15 MB artwork input with the existing `/api/contact` workflow. BYD does **not** reuse the USDOT-specific `/upload-design` paid sticker order pathway.

## Explicit exclusions
- No checkout implementation, cart or Stripe POST. No emails or side effects created by the new pages.
- No school/team trademarks, uploaded sample designs or third-party panda artworks are published as products.
- No print-ready claim: before catalog sale, ensure ownership/licensing, transparent print assets, garment proof and rights verification, school year/mascot accuracy, pricing, shipping and tax policy.
- Backend acceptance for genuine Stripe holiday orders and remote isolated webhook/D1 stays on the Phase 2I/2H track and remains HOLD.
- This design branch contains no new upload endpoint; it links to the currently implemented DTF Turnstile-gated quote intake. If upload protection is unavailable, customers can still describe requests without uploading artwork.

## Tests
New `tests/varsity-byd-catalog-draft.test.mjs`: 10 source contracts for page existence, all four directions, noindex/no checkout, DTF routing, existing protected upload path, rights and print proof.
No-deploy GitHub Actions runs those contracts, inherited holiday/sticker/DTF safety tests and Astro build. Review PR and independent Windows diff before any merge.

**Design/Fix → Test → Release. No drifting.**
