# RN-3B1 — DTF artwork preflight foundation

## Scope

A new, isolated read-only API at `POST /api/dtf-artwork-preflight` accepts multipart `artwork`, `widthInches`, `heightInches` and `cf-turnstile-response`.

- Security: `DTF_TURNSTILE_SECRET` must be set; Turnstile action must be **`dtf_preflight`**, and Siteverify hostname must match `reasonablenoise.com` or `www.reasonablenoise.com`. Tokens from the existing `dtf_artwork` action must not be reused. Do not send Turnstile secrets to the client.
- Files: max 15 MB; PNG/JPEG/WebP headers are inspected; PDF/SVG/AI/EPS/PSD receive specialist-review status, never automatic approval. The inspection is intentionally metadata-only, not full pixel decoding or quality certification.
- Print size: 0.5–120 inches per dimension accepted for preliminary metadata analysis only. This does **not** certify usable printer width, film capacity or commercial availability.
- Resolution: effective pixels-per-inch uses the smaller of width ratio and height ratio. Below 150 PPI is a low-resolution warning, 150–299 is below the 300 PPI target; 300+ is `technical_pass`, **not** `print_ready`.
- Reports return `technical_pass`, `review_recommended` or `cannot_print`, with stable codes, without exposing token, secret or private storage paths. Every result explicitly has `canAutoCheckout: false` and `productionApproved: false`.
- The endpoint performs **no** R2 writes, email sends, Stripe requests, webhook calls, or admin/production-order changes.
- It does **not** alter existing `/api/contact`, `/api/upload-artwork`, `/api/create-checkout-session`, or `/api/stripe-webhook`.

## Crucial boundaries / next gates

This is a **foundation**, not completed e-commerce or a print-quality oracle:

1. **RN-3B1B:** Introduce a separately verified `dtf_preflight` Turnstile widget and UI, with one-time challenges and a human-readable inspection report. Keep `dtf_artwork` token handling separate for the existing quote form. Review Cloudflare WAF rate limiting for the new endpoint before activation.
2. **RN-3B1C:** Full server-side image decode, content validation, correct ICC/color/alpha handling, page/artboard handling for PDF/AI, appropriate quality threshold rules and binding the inspected bytes to a private uploaded artwork record (hash, size, dimensions, authorized owner, expiration, no tampering). No trust in client-provided “PASS”.
3. **RN-3B2:** Owner-approved material cost/printer width and gang-sheet pricing table, server-calculated total, validated shipping/pickup.
4. **RN-3B3:** Only after independent verification, add a separate DTF Stripe Checkout path and order-type-specific webhook guards, persistent order intent/paid verification and idempotency.
5. **RN-3B4:** Only verified paid orders with approved artwork and commissioned equipment may enter the actual production queue.

## Local verification

```powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1-artwork-preflight-foundation-20261115
node --test .\tests\dtf-artwork-preflight-rn3b1.test.mjs
node --test .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/main...HEAD
git status --short
```

Expected 18 newly added synthetic tests and existing DTF/sticker regressions green. **Not independently run in the user's Windows runtime yet.** No live provider tests are authorized here. Do not merge/deploy this API until runtime test and WAF review.
