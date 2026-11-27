# RN Print Shop — Product Catalog & Stock Management

**DRAFT / ISOLATED / NO DEPLOY**

## Existing storefront and pricing boundaries
This is for the **ReasonableNoise print shop**, NOT restaurant food menus. Inventory has been absent from the print shop admin dashboard. The live sticker/decal `functions/api/create-checkout-session.js` uses server-owned price labels, including a fallback `Custom Sticker Order Deposit` for unknown sticker types. DTF shirts are quote-first; holiday shirts are draft checkout only. Previously paid orders must never be reinterpreted when current availability changes.

## Implemented in isolated draft
- Pure `src/lib/printshop-catalog-stock.mjs` defines eleven grounded product SKUs from existing storefront/checkout: USDOT pair, extra pair, replacement, USDOT/business-name pair, custom decals, truck lettering, fleet lettering, logo sticker batch, design cleanup, DTF custom shirts, holiday T-shirts. Initial availability is **unconfigured** for all; no claim to live stock.
- Editable proposed fields: name, description, unit price in integer cents, availability `available | out_of_stock | paused`, optional stock quantity.
- Proposed `updateProductCatalog` core requires previously cryptographically verified admin identity, exact product ID, authorized edited fields, valid data, expected revision, unique audit ID, and a caller-provided atomic `compareAndSwap` adapter. The storage adapter must update the record and append an audit event **in the same atomic transaction**; no live storage adapter is mounted. Stale edits, replay, unknown keys and failures deny.
- Proposed `checkoutAvailabilityDecision` is **not mounted into live checkout**. When explicitly enabled in a separate future gate it fails closed for unknown/unavailable/paused/zero-stock, wrong product ID, unconfigured records, or quote/draft-only product types. It never changes Stripe price or prior order data. Existing server price-label mapping is explicit; unknown `Custom Sticker Order Deposit` must be handled deliberately before gate activation.
- Existing `/admin-orders/` gains **Products & Availability**, a clearly labeled local-only preview for all eleven products. Dropdowns have no persistence, Save or backend side effects. Real stock toggles are pending verified admin API, live/isolated D1 persistence, storefront badge reads and exact server checkout enforcement.

## Required next acceptance gates
1. Implement **isolated** D1 catalog + immutable event journal with unique SKU, revision, audit ID, and transaction-safe CAS against simultaneous edit attempts. Test in real local Workerd/Miniflare, including read/write failure, rollback, replay and tenant/admin access denial.
2. Independently verify Cloudflare Access signature and roles at the **new admin API** (do not reuse legacy decode-only admin auth). Implement POST/PATCH and GET only within secure isolated staging. Avoid exposing admin token or write endpoints to public shoppers.
3. Add public read-only, cache-bounded customer availability badges, with appropriate privacy filtering, and ensure unavailable products cannot produce new checkout sessions **server-side**. Quote-only DTF needs an explicit decision for accepting inquiries while unavailable.
4. Gate production stock control behind explicit owner-approved release; regression-test sticker checkout, current paid orders, fulfillment webhook, holiday checkout-off, and DTF quote-first. Restore stock without recreating products. Avoid stock decrements or overselling until inventory reservation is designed/tested.

**Out of scope:** changing live prices, injecting stock overrides into existing checkout, new Stripe payments, publishing holiday checkout, physical apparel print approval, customer email, production deployment.

**Design/Fix → Test → Release. No drifting.**
