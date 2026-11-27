# RN Apparel — Artwork and BYD Refinement

**Status: DRAFT, no deploy, no commerce activation.** This is a design/UX workstream stacked on PR #65; Stripe Phase 2I remains separate.

## New original SVG previews
Six self-contained, scalable SVG assets in `public/shirt-concepts/`:
- `spirit.svg`: collegiate starburst.
- `legends.svg`: abstract flame / rising-form emblem.
- `victory.svg`: original star shield.
- `ambition.svg`: original upward mountain motif.
- `forest-club.svg`: geometric panda face with layered evergreen scenery.
- `sunset-pals.svg`: same original visual vocabulary, alternate warm color treatment and naming.

These are **new editorial concept mockups**, not user-submitted sample artwork, copyrighted varsity marks, existing school mascots, or print-production-ready files. SVG preview text states concept/proof limits. The original uploaded images remain references only; no external image, brand, sample logo or unlicensed mascot is embedded into committed previews. Avoid claiming transparency, 300 DPI, CMYK/DTF compatibility or actual licensed school rights from SVG alone. The previews deliberately use graphical background art; a printer must prepare final transparent, correctly separated artwork and physical samples before sale.

## BYD refinement
The `/bring-your-design/` draft page retains the protected `/contact?topic=dtf` quote-and-upload route. New in-browser brief composer:
- Quantity 1–500, source, garment color, print placement.
- Explicit ownership or license acknowledgment required before the customer prepares a brief.
- User-click only note preparation, safe `textContent` output, optional clipboard copy with a manual fallback.
- Does not send, store, upload or charge. The customer must paste notes into the existing DTF quote request manually. When the contact form's Turnstile is unavailable, its artwork upload stays disabled, but text quote requests remain possible.

## Engineering and release gates
- 15 new artwork/UX contracts and 10 existing draft contracts; inherited holiday checkout, USDOT webhook and DTF upload/quote safety suites.
- No holiday or Stripe backend changes; all seasonal payment flags OFF, no backend routes, new API endpoints, changes to Cloudflare, tax setup, email or D1/R2 production bindings.
- Before final customer-facing release: verify artwork rights, color/garment proof, file format transparency and print dimensions, real pricing and shipping, tax collection policy, actual BYD submission UX in a browser with live Turnstile, accessibility, and production owner signoff.
- Genuine Stripe test-mode holiday checkout and signed isolated webhook remain separate pending Phase 2I work.

**Design/Fix → Test → Release. No drifting.**
