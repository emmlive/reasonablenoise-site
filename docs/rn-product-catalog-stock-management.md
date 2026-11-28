# RN Print Shop — Product Catalog & Stock Management

Status: DESIGN GATE (isolated feature branch). No production activation.

## Current implementation verified (2026-11-27)

- Astro storefront: `src/pages/index.astro`, `src/pages/usdot-stickers.astro`, `src/pages/upload-design.astro`, `src/pages/dtf-shirts.astro`.
- Product names, pricing text and selectable order types are embedded in page code.
- Server checkout amount selection occurs in `functions/api/create-checkout-session.js` with a server-side string-match price map and fallback deposit.
- Existing admin orders UI: `src/pages/admin-orders.astro` and handler `functions/api/admin-orders.js`; Cloudflare Access protection is the intended browser control.
- Stripe webhook and paid-order flow must remain unmodified by catalog state changes.

## Architecture decision

1. Catalog must have one authoritative, durable, versioned source of truth. Use a dedicated Cloudflare D1 catalog binding after verifying the repo's Cloudflare deployment configuration; do **not** write catalog records into print artwork R2 storage or paid order records.
2. Stable `product_id` is immutable (e.g. `usdot-sticker-pair`, `truck-door-lettering`, `dtf-shirts`). Admin may edit display name/description/image, availability, and priced offerings. Use integer cents for fixed prices. `Starting at` prices must explicitly stay quote-only or be supported by a validated server-side pricing rule.
3. States: `available`, `out_of_stock`, `draft`, `archived`. Only `available` can create new paid checkout sessions. `draft` and `archived` cannot be publicly ordered. Manual state toggle is not quantity inventory; do not imply automatic stock deduction.
4. Admin API requires independently verified Cloudflare Access identity on **every write** plus authorized email allowlist; do not trust an unsigned decoded JWT payload or a client-supplied email. An emergency order token must not by itself grant product-edit privileges.
5. Admin updates are validated, recorded with actor + timestamp + old/new values, and use optimistic concurrency to prevent lost updates. Product image changes require a controlled upload/allowlisted image reference and safe content-type checks.
6. Customer storefront reads the same published catalog state. Show a clear `Out of stock` label and disable ordering for unavailable SKUs. Display-only checks are insufficient.
7. Checkout must resolve a stable product ID on the server, load current availability and price, reject missing/inactive products **before** creating the Stripe session, and ignore client-submitted price or status. Unknown IDs fail closed; no generic-deposit fallback may bypass an unavailable identified product.
8. A paid checkout session/order must store an immutable product name, SKU, price and catalog version snapshot. Never retroactively modify existing paid orders, fulfillment history, notifications or approved artwork.
9. Existing checkout paths remain compatible only where safely mapped to a unique SKU; ambiguous legacy selections must be explicitly resolved before payment. DTF quote requests are not Stripe checkout and should not accidentally be turned on.

## Suggested API boundaries

- `GET /api/catalog`: published public catalog, no private admin fields.
- `GET /api/admin-products`: authenticated admin listing.
- `PATCH /api/admin-products/:id` or equivalent routed endpoint: authenticated, validated edit; stale-version conflict returns 409.
- Checkout creation: authoritative SKU validation, status check and trusted cents price lookup.

## Minimal product set for migration

- USDOT Sticker Pair ($29), Extra USDOT Pair ($25), One-Side USDOT Replacement ($18), USDOT + Business Name Pair ($39).
- Truck Door Lettering (starts at $69), Custom Business Decals (starts at $35), Fleet Lettering (starts at $59/vehicle), Logo Sticker Batch (starts at $35), Design Cleanup (starts at $15).
- DTF Shirts: quote-flow catalog entry; do not assume current card checkout is ready from storefront text alone.

Migration must reconcile all existing checkout aliases and current production pricing before seeding; don't replace established production pricing without owner review.

## Test gate — required before release

1. Authorized admin can edit text, approved image and availability; unauthorized, spoofed, expired JWT and token-only writes are rejected.
2. Setting Out of Stock survives refresh and propagates to every affected storefront/order entry point.
3. A manually forged request for an Out of Stock, Draft, Archived or unknown product cannot create Stripe Checkout.
4. Client price tampering and legacy-string alias bypasses fail closed; valid SKU uses server-side cents.
5. Re-enable product without changing ID or existing orders.
6. Previously paid orders, status updates and fulfillment emails remain unchanged by product edits.
7. Concurrent stale edits reject with 409; audit records are append-only and actor-attributed.
8. DTF quote-only operations remain quote-only unless their independent acceptance gate is satisfied.
9. Disposable database migrations, unit/route tests and `npm run build` pass; exact-commit CI green.
10. Production data backup, bindings validation, read-only migration check and manual acceptance completed before rollout.

## Release controls

- Do not change production Cloudflare environment variables/bindings or Stripe configuration at design gate.
- Develop against disposable Cloudflare D1/test resources only.
- Gate with feature flag default OFF, deploy exact verified SHA, test on isolated staging, then explicitly approve production activation.
- Rollback disables catalog writes and new catalog-driven checkout while preserving historical orders.
