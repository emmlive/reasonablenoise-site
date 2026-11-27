# RN Print Library — Isolated Artwork Upload & Proof Review Gate

**STATUS: DRAFT / NO DEPLOY / UNMOUNTED.** No customer upload or admin endpoint, Cloudflare deployment, R2 production write, print-ready artwork, payment or email is enabled.

## Implemented boundaries
- `src/lib/print-library-upload-approval-isolated.mjs`: standalone **unmounted** module.
- PNG-only preliminary preflight: magic signature, critical IHDR format/dimensions, per-chunk CRC32, chunk size and count, IDAT and terminal IEND checks, reject animated PNG, 15 MB limit. This is **not** full image decompression or antivirus, ICC/output color validation, transparency, printer proof or print-ready certification. Other formats intentionally blocked pending dedicated validators.
- Compute SHA-256 from uploaded bytes. Reject mismatches against an expected checksum before storage; require safe artwork slug and immutable `vN` version.
- Private staging only under `print-library/proof-pending/{designId}/{version}/{sha256}.png`, with conditional R2 `put` using `onlyIf: {etagDoesNotMatch: '*'}`. No overwrite/deletion. Audit ledger `createPending` must be supplied by a trusted isolated host and reject existing version or duplicate audit ID.
- A failed ledger write after conditional R2 put may create an **orphan staging object**. This is explicitly fail-closed to the user, never deletes or promotes anything, and must be reconciled/audited before the feature is productionized.
- Separate `recordPhysicalProofReview` accepts two **different previously verified admin identities**, an existing pending version, specific physical proof and rights evidence references, review ID, and append-only `ledger.appendReview`. Allowed decisions: `approved_for_next_gate` and `rejected`. This **never promotes files to print-ready**. Identity is accepted as a trusted capability only from a future independently authenticated caller; no API route is mounted.
- In CI, tests use synthetic valid zlib-compressed PNG bytes (real PNG chunk CRCs), in-memory mock R2 with immutable put and mock unique-ledger semantics. They are not real Cloudflare remote persistence, production artwork or physical proofs.

## Required next acceptance gates
1. Independently verify Cloudflare Access signature with pinned JWKS and exact audience/issuer at the **backend** boundary; do not reuse existing admin-orders' legacy unverified claim fallback or admin token for print approval.
2. Build a **real isolated** staging R2 and database binding (no live site), transactional uniqueness, append-only audit trails and recovery for orphan staging objects. Test concurrent immutable writes and replay under the actual Workerd runtime.
3. Add full file decompression/scanline reconstruction, image content checks and malware scanning before accepting any real uploaded artwork. PNG structural integrity and SHA-256 alone cannot establish safe printability.
4. Have separate authorized human staff verify customer rights, transparency, print dimensions, colors and a real physical proof. Record evidence with immutable identity/time, then create a production-ready artifact with independent security gate, signed association to approved order, and no automatic promotion from concept to print-ready.
5. Implement authorization-protected admin-only attachment download and audit it; deny unpaid/reversed and mismatched versions. Real browser QA, print shop signoff, and explicit owner release required.

The existing six SVG vectors remain concept previews. BYD DTF remains quote-first. No Stripe Phase 2I, tax, sticker API, or live order behaviors changed.

**Design/Fix → Test → Release. No drifting.**
