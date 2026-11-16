# RN-3B1C — Bounded PNG Integrity Gate (Phase 1)

This dependent, isolated development branch extends the **unmerged RN-3B1 preflight foundation (PR #8)**. It does not modify the existing inspection API, publish a customer report, affect sticker orders, or authorize payment.

## Completed source implementation

- `functions/lib/dtf-artwork-integrity-rn3b1c.js` verifies PNG file signature, IHDR size and supported noninterlaced layouts, chunk CRC-32, critical-chunk handling, IDAT contiguity and IEND framing.
- Decompresses the complete PNG IDAT stream using `DecompressionStream("deflate")`, bounds decoded data to 64 MiB, reconstructs all PNG filter types 0–4 and requires exact expected scanline length.
- Rejects excessive pixels, oversized compressed/decompressed files, unsupported layouts, malformed chunks, corrupt checksums and invalid stream lengths.
- Computes a SHA-256 fingerprint of the exact file bytes only after integrity checks pass.
- Returns `artworkIntentBound:false`, `checkoutEligible:false`, `productionApproved:false` on success. Failure results are manual-review-only.
- JPEG, WebP, PDF, AI, EPS, SVG and PSD are conservatively assigned to **manual review** pending a trusted full decoder or specialist handler.

### Boundaries

This validates PNG stream structure, decoded scanlines, and a checksum—not printing suitability. It does not guarantee visual composition, legibility, DPI adequacy, correct colorspace, alpha correctness, vector geometry, margins, manufacturer compatibility or physical output quality. It does not persist the file, verify ownership, bind it to a customer/session, or prevent a later client from uploading a different file.

### Remaining acceptance gates (not implemented)

1. Independent Node regression verification of all decoding edge cases and memory caps. Current code not yet runtime verified; no test pass claim.
2. Integrate PNG integrity results into the Turnstile-protected inspection API **only after** independent runtime and resource-limit testing. Keep `canAutoCheckout:false` regardless.
3. Add trusted upload-intent: server-created session/order identity, private durable object key, exact SHA-256 and size, short expiry, replay protection, owner/tenant authorization, durable consistency and idempotency checks. The browser must never be able to assert or substitute a trusted digest.
4. Full decoder or manual review for other formats, plus color/print validation, virus scanning policy and metadata stripping where relevant.
5. Explicit confirmation of production equipment, print dimensions, price table, tax/shipping, capacity and support terms before connecting RN-3B2 pricing and Stripe.
6. Synthetic Cloudflare Workers runtime, memory-limit and size-adversarial tests. Local Astro static build alone is not sufficient.

## Windows tests

```powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-artwork-integrity-20261115
node --test .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1-artwork-preflight-foundation-20261115...HEAD
git status --short
```

Expected **64 tests** (10 new, 18 preflight, 36 existing), 11 built pages; these results require independent confirmation.

No live provider use, real customer file, checkout, order creation, production or deployment is authorized.
