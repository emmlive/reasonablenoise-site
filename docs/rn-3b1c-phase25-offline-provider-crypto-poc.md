# RN-3B1C Phase 25 — Isolated Identity Provider Cryptographic PoC

**IMPORTANT: Offline provider-shaped crypto fixtures only. No real Clerk or Supabase tenant, live provider SDK, account, network request, issuer/keys, login route or production integration.**

## Starting evidence
Phase24 PR #46 passed independent Windows verification: 14/14 targeted tests, 367/367 full suite, Astro 11 pages and Git clean. Clerk and Supabase Auth were shortlisted for isolated evaluation, Auth0 retained as a fallback. **No provider approved or selected.**

## Official documentation checked (Nov 16, 2026)
- Clerk authenticateRequest describes server-side request authentication, networkless verification when configured with trusted jwtKey, and strongly recommends authorizedParties to prevent cross-origin cookie misuse. Real SDK behavior requires separate isolated testing. https://clerk.com/docs/reference/backend/authenticate-request
- Supabase JWT documentation describes its per-project JWKS with asymmetric keys; getClaims can validate supported asymmetric JWTs and otherwise call the Auth server for symmetric keys. Supabase's JWT signing-key docs describe RSA and P-256 and key rotation. Real issuer + JWKS lifecycle needs separate staging proof. https://supabase.com/docs/guides/auth/jwts ; https://supabase.com/docs/guides/auth/signing-keys ; https://supabase.com/docs/reference/javascript/auth-getclaims
- Supabase SSR / session docs distinguish cookie/PKCE-based auth from per-request bearer auth, requiring an appropriate package and secure callback/session flow. https://supabase.com/docs/guides/auth/choosing-a-server-package ; https://supabase.com/docs/guides/auth/server-side/advanced-guide

## Phase25 implementation
New `functions/lib/dtf-offline-idp-crypto-poc-rn3b1c.js` is a deliberately bounded, **test-only** provider-shaped JWT cryptographic boundary. It uses WebCrypto and ephemeral pinned JWKs. It verifies a synthetic Clerk-shaped **RS256 RSA-2048** JWT including exact issuer/audience, sid, authorized-party origin (azp), strict header and expiration, and a synthetic Supabase-shaped **ES256 P-256** JWT including exact issuer/audience, authenticated role, session_id, strict header and expiration. Every verification is offline with no network, real provider SDK, secret, key service or D1 access.

**Do not mistake synthetic token shape for full provider-specific protocol validation.** Actual Clerk session formats, azp use, authorizedParties semantics, nonce/session status and tenant settings must be confirmed with official SDK running in disposable staging. Actual Supabase session tokens may vary by project/algorithm/configuration, and key distribution / real getClaims logic has not been exercised. This PoC is NOT a claim that either service integrates end-to-end.

Successful cryptographic verification yields provider name, signed subject and session reference as **untrusted for local DTF authorization** until a separate verified mapping/revocation/CSRF boundary is implemented. It deliberately returns `customerPrincipal=null`, `sessionAuthorized=false`, `quoteAcceptanceAuthorized=false`, `checkoutEligible=false`, `paymentAuthorized=false`, `deletionAuthorized=false`, `productionApproved=false` and cannot be passed to Phase21 as a verified local customer principal.

## Tests
`tests/dtf-offline-idp-crypto-poc-rn3b1c.test.mjs` generates disposable RSA and EC keypairs via Node WebCrypto (no crypto provider calls) and checks 15 cases: valid provider-shaped signatures, payload tampering, issuer/audience confusion, unknown keys, algorithm confusion, JOSE jku/crit/jwk injection, expired/future/overlong claims, Clerk authorized party/session mismatches, Supabase role/session mismatches, unsafe origin, provider mismatch, leaked private signing JWK, forged customer workspace and payment claims, and no server route/provider side effects. These are test cases authored, not independently verified yet.

## Pinned nonproduction next gates
1. Approve a specific **nonproduction** Clerk and/or Supabase project PoC, using only synthetic identities and separate expiring credentials. No production tenant or user data.
2. Verify provider-specific token types, login/callback, browser PKCE/state/nonce (as applicable), CSRF, cookie flags, session refresh, logout, key rotation, recovery and anti-abuse using official SDK paths and actual local Cloudflare Pages/Workers runtime.
3. Map a server-verified provider account to a separate canonical, immutable local customer subject and workspace through an auditable D1 entitlement; never use email/phone/anonymous quote reference as proof.
4. Prove provider revocation/identity rotation feeds a durable local epoch and the Phase21 decision-time same-D1-statement fence. Test 20-way acceptance/revocation races using trusted nonproduction credentials.
5. Obtain external independent review, approved final DTF price catalog and explicit separate release authorization before any production route, D1 migration or checkout.

## Independent Windows verification
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase25-idp-offline-crypto-poc-20261116
node --test .\tests\dtf-offline-idp-crypto-poc-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE25_OFFLINE_CRYPTO_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE25_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE25_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase24-idp-evaluation-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE25_GIT_FAILED' }
git status --short

## Acceptance targets (not yet independently verified)
15/15 Phase25 new tests, **382/382** full suite (367 independently verified Phase24 baseline), Astro **11 pages**, Git integrity PASS, clean working tree. Any failure is a NO-GO and must be corrected and rerun.

## Hard safety fence
PR remains draft/unmerged/undeployed; no real Clerk/Supabase/Cloudflare account, provider API calls or signup flow; no R2/D1 production queries, Stripe, email, payment authorization, modifications to production USDOT sticker checkout, DTF direct checkout or automatic artwork deletion.