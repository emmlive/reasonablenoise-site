# ReasonableNoise Admin Print Artwork Library — Readiness Phase

**Draft only; no production deployment or downloadable print files.**

## Why this design
The current admin system at `/admin-orders/` handles paid sticker/decal order status records, backed by private Cloudflare R2 `ARTWORK_BUCKET`. The user wants each approved shirt artwork accessible inside this admin workflow when orders arrive, including ready-to-print files with the correct version.

Six current varsity/creative SVGs are editorial **concept** artwork only; none has verified garment output, transparent print separation, legal-rights approval, or physical production proof. They must not be incorrectly exposed as ready to print.

## Implemented in this phase
- Added **Print Artwork Library** panel in existing admin orders UI with six independently identified preview assets (Spirit, Legends, Victory, Ambition, Forest Club, Sunset Pals), status **Concept — not printable**, and intentionally disabled download controls.
- Added pure `src/lib/print-artwork-catalog.mjs` metadata classification, a rigid `validApprovedPrintArtwork` evidence validator for *future* production record reads, and statuses Concept / Proof pending / Print ready. Validator requires design-specific R2 key under `print-library/approved/{id}/{version}/{file}`, SHA256, rights and physical-proof confirmations, dated approver, actual file MIME/extension, pixel and printed-inch dimensions, and version.
- No new public backend, admin API, R2 read/write, download, customer payment, or email. Existing USDOT sticker admin status and secure file flow unchanged; storefront review PRs remain stacked/draft.

## Next security/production implementation gates
1. Define **actual** signed-in admin identity and permission scope for the print library. A client-controlled identity header or unverified JWT claims must not authorize direct R2 file downloads. Protect both dashboard and API using validated Cloudflare Access JWT/zero-trust policy; apply least privilege and no emergency token in query strings.
2. Implement R2 approved production objects in a distinct `print-library/approved/` prefix; separate private original artwork, public concept previews, proof-pending work, and approved artwork. Add upload preflight file validation, content hashing, malware/type examination and manual approval with immutable versions and audit record.
3. Verify sample ownership/licensing, source asset rights, transparent background when needed, printer-approved color mode and size, DTF-compatible separations, test print and garment placement. Recorded approval must be deliberate and cannot be inferred from a website preview.
4. Only then add an authorized admin-only download endpoint with strict exact-version routing, server-side checksum/content checks, no path traversal, no inline browser execution and audited order-to-artwork association.
5. Tie approved design version to the customer's paid/approved order after independent provider acceptance, allow print operator to retrieve that version only, log the print action, and deny print for unapproved/reversed/unpaid orders.
6. Real browser test against deployed **isolated** staging under Cloudflare Access. Check both authorized and unauthorized direct API access, BYD quote handoff, mobile UI, and correct blocked concept downloads.

**Explicit out of scope:** Phase 2I Stripe holiday checkout/webhook staging, tax settings, live deployment, manual print approval of these six SVG designs.

**Design/Fix → Test → Release. No drifting.**
