# RN-3B1C Phase 23 — Production Customer Authentication Readiness and Integration Design

**Security design only. NO live customer authentication, provider enrollment, production migration or checkout.**

## Independently verified baseline
Phase22 PR #44 closed local verification: **12/12 Workerd tests**, **339/339 regressions**, Astro **11 pages**, Git whitespace PASS and clean working tree. This is disposable Miniflare Workerd/D1 verification using a fixed synthetic principal, not a real customer login.

## Current product truth (verified from repository source)
- `functions/api/contact.js` accepts DTF quote-first inquiries, generates an unverified DTF reference and can store private uploaded artwork / send email. Name/email on contact form do **not** establish an authenticated customer principal. A DTF quote from contact is not a canonical D1 customer order.
- `functions/api/create-checkout-session.js` creates sticker-specific Stripe Checkout with `metadata[order_type]=sticker_order`. Do not route DTF orders through it or reuse its metadata and pricing.
- `functions/lib/dtf-signed-customer-session-rn3b1c.js` is a standalone Ed25519 verifier with injected keyring, issuer, audience, cookie, CSRF and local D1 revocation. It is NOT a token issuer, registration/login flow or production authorization.
- `functions/lib/dtf-atomic-session-acceptance-rn3b1c.js` performs a same-D1-write session and quote acceptance fence but uses synthetic Phase18/19/20 tables. Phase22 exercises its unchanged code inside local Workerd, NOT production Cloudflare.

## Provider selection: PENDING, NOT ASSUMED
No production customer identity provider has been selected or independently approved. Conduct a specific build-versus-buy review for an established managed IdP that supports OIDC/OAuth with verified browser sessions and a server-side trustworthy identity boundary. Evaluate security model, legal/privacy fit, MFA/recovery, supported Worker/Pages runtime, JWKS and key rotation, logout/revocation, cost, anti-abuse, SLAs, customer-support workflows, account migrations and independent security review. Do not infer an issuer from existing Cloudflare Access admin login, anonymous contact email, Stripe customer email, or synthetic Ed25519 tokens.

**Integration model proposed, subject to security review:**
1. Customer registers/signs in with chosen verified IdP. Backend independently verifies issuer signature, issuer/audience, anti-replay, nonce/state and account confirmation according to the selected protocol. Never trust headers or client JWT payload decoding.
2. Establish a production customer subject ID and a deterministic, audited, least-privilege mapping from immutable IdP identity to local account + workspace. Define multi-workspace access, membership changes, account deletion, and transfers. Email is communication only, never order-ownership proof.
3. Existing anonymous DTF contact quote remains unclaimed until a separate, explicit account verification and human-reviewed quote ownership transfer. Never automatically claim by matching submitted email, quote reference, Stripe customer ID or possessing artwork URL.
4. Issue a secure, bounded-lifetime application session with HttpOnly, Secure, SameSite, `__Host-` scoped cookie and trusted nonce-based CSRF. Define server-side revocation/epoch rotation, multi-device logout, recovery and audit; do not put signing secrets or customer IDs in UI query strings.
5. Canonical DTF quote/order rows must carry authoritative immutable customer subject/workspace, approved and versioned cents, artwork review proof and expiration. Preserve user-visible price/version. The final acceptance INSERT must atomically fence customer session epoch/revocation, workspace, canonical order/quote, approval and replay in the SAME trusted database decision.
6. Separate explicit customer quote acceptance from any payment authorization. DTF Stripe metadata, payment idempotency/webhook signature verification, shipping/tax/fulfillment and refunds are new separately approved phases. USDOT sticker checkout must remain unchanged.
7. Before any production route, independently verify Cloudflare D1 binding permissions, migration safety/rollback, production-like staging behavior, browser Origin/CSRF behavior, rate limits, logging redaction, dependency vulnerabilities, data retention, account recovery and incident response.

## Phase23 read-only readiness inventory
The new `functions/lib/dtf-auth-readiness-inventory-rn3b1c.js` exposes 14 review areas: provider selection, cryptographic issuer trust, session issuance, browser CSRF, account recovery, account-to-order binding, atomic decision, D1 schema permissions, runtime testing, pricing, acceptance UI, abuse controls, deployment safety and dependencies. A parallel test file provides 14 negative/positive inventory classification cases.

**Critical distinction:** Evidence and review metadata entered into this inventory are **untrusted claims**. An all-claimed-reviewed manifest is NOT a signed approval. The inventory never returns an integration, deployment, checkout, payment or artwork-deletion authorization. A future production release decision requires external accountable sign-off and a separately implemented enforceable runtime release gate. Phase23 does not provide that gate or an IdP implementation.

## No-go and scope fence
- No selected identity provider, registered users, credentials, authentication cookies, auth callback routes, or live customer API.
- No production Cloudflare D1 migrations, R2 changes, real email, Stripe or other external service calls.
- No production customer claim-linking, live rate card, price approval, real quote acceptance UI, payment authorization, fulfillment or artwork deletion.
- No changes to existing contact flow, USDOT sticker checkout, security rules, domain configuration or deployments.
- Synthetic source from Phases 18–22 is NOT suitable to apply live. Keep all PRs draft and unmerged.

## Independent Windows verification (read-only/offline)
$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase23-auth-readiness-design-20261116
node --test .\tests\dtf-auth-readiness-inventory-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE23_READINESS_TEST_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE23_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE23_ASTRO_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase22-workerd-d1-atomic-fence-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE23_GIT_INTEGRITY_FAILED' }
git status --short

**Targets, NOT yet independently verified:** 14/14 new Phase23 tests, 353/353 full suite (339 verified baseline), 11 static Astro pages, Git integrity PASS, clean tree. A failed test means NO_GO until corrected and independently re-run.

## Next decision
Only after confirming and independently reviewing an actual identity provider and accountable owner, implement a separately gated end-to-end staging registration/login/claim flow. Do NOT jump from passing evidence-inventory tests to DTF checkout.