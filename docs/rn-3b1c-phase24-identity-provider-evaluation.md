# RN-3B1C Phase 24 — Customer Identity Provider Evaluation (NO SELECTION)

**Source-backed evaluation only. No production identity provider has been approved.**

## Verified starting point
Phase23 PR #45 independently passed 14/14 targeted and 353/353 full tests, Astro 11 pages and Git clean. Its 14 readiness gates never self-authorize deployment. The existing DTF /api/contact path is anonymous quote-first; the existing Stripe checkout is sticker-only. Phases18–22 are disposable synthetic account/quote/D1 models. No real customer account or signed issuer exists in ReasonableNoise production.

## Options researched on November 16, 2026
**Clerk — shortlisted for an isolated proof of concept, NOT selected.** Official Clerk docs describe `authenticateRequest()`, a backend verification path with optional networkless JWT key and strongly recommend specifying `authorizedParties` to prevent origin/cookie attacks. Clerk's Workers compatibility is documented by Clerk. Clerk offers built-in sign-in/sign-up UI and account support. Its current Hobby plan advertises 50,000 monthly retained users, but MRU differs from conventional MAU and production needs such as MFA or session duration may require paid features. Sources: https://clerk.com/docs/reference/backend/authenticate-request ; https://clerk.com/articles/authentication-for-serverless-and-edge-deployments-2 ; https://clerk.com/pricing .

**Supabase Auth — shortlisted as a second isolated proof of concept, NOT selected.** Official documentation describes WebCrypto/JWKS claim verification, server-side PKCE/cookie flows and newer Workers-oriented `@supabase/server` for header-based tokens. Supabase's SSR and server packages cover different request/session models and cannot be assumed interchangeable. Its pricing page currently advertises 50,000 free monthly active users and Pro from $25/month, subject to project/runtime usage and additional feature costs. Sources: https://supabase.com/docs/guides/auth/jwts ; https://supabase.com/docs/guides/auth/choosing-a-server-package ; https://supabase.com/docs/guides/auth/server-side/creating-a-client ; https://supabase.com/pricing .

**Auth0 — retained as managed OIDC fallback, Workers integration UNVERIFIED.** Auth0 publishes managed login and user management, and its current Free page advertises up to 25,000 monthly active users (terms/feature limits apply). Provider-specific Cloudflare Pages integration, issuer/JWKS validation, account recovery and revocation behavior still require actual technical evidence rather than assuming Node middleware works in Workers. Sources: https://auth0.com/pricing .

These are vendor-published capabilities and public prices, not proof of application compatibility, actual provider availability, performance or contractual acceptance. Pricing must be rechecked before procurement.

## Architecture fit criteria and weights (design assumption, not vendor scores)
| Criterion | Weight | Required independent demonstration |
|---|---:|---|
| Workers / Pages runtime | 20 | Exact Pages Functions runtime build and server-side verification, not just Node |
| Cryptographic verification | 20 | Issuer, audience, authorized origins, JWKS/key rotation, token type and nonce/state |
| Session revocation | 15 | Logout, recovery, revoked/rotated sessions and Phase21 D1 same-write gate |
| Account recovery | 10 | Verified signup, email validation, recovery and device/session management |
| D1 order ownership | 15 | Immutable provider subject mapped to local account and approved quotes, never email matching |
| CSRF/browser security | 10 | SameSite/HttpOnly/Secure cookie, Origin, CSRF, browser replay/race tests |
| Cost and portability | 10 | Real billing unit, MFA costs, migration/export and non-provider-specific order identities |

**Provisional experiment order:** Evaluate Clerk and Supabase Auth side-by-side in *completely isolated* local/staging PoCs; retain Auth0 as fallback. This ordering is a proposal, not a provider approval or authoritative ranking. Prioritize successful verified edge authentication + immutable D1 ownership over user count tiers or UI convenience.

## Important incompatibilities and security design
- Phase20's custom Ed25519 cookie contract is **not a generic IdP token verifier**. Clerk, Supabase and Auth0 have different token issuers, signing algorithms, subject formats, session lifecycles and key distribution. Do not feed a provider's JWT directly into the Phase20 verifier or mint a trusted local principal from email/client claims.
- The local Phase21 atomic D1 acceptance fence assumes a real, verified session row with matching subject/workspace/epoch. Any selected provider needs an independently reviewed bridge from verified provider identity to a local durable session authority and canonical customer/quote owner. Revocation and account changes need write-time D1 enforcement.
- Anonymous historical DTF contact quotes cannot be auto-claimed based on email, phone, quote reference, Stripe customer or possession of a private-artwork link. Design a manual or otherwise independently secure claim workflow with auditable proof.
- Cloudflare Access currently protects administrators only. Do not reuse its decoded JWT payload or administrator identity as customer authentication.
- The project has no final approved DTF rate card. Real quote acceptance and DTF Stripe payment must remain separate future steps.

## Phase24 bounded deliverables
`functions/lib/dtf-idp-evaluation-rn3b1c.js` defines a three-provider candidate inventory and seven weighted criteria. The evaluator records *proposed* score and unknown count only when all criteria are present. Even a perfect self-declared 100/100 proposal **always** returns `NO_SELECTION`, production/auth activation/payment/deletion permissions false. No provider SDK, network requests, real keys or customer sessions are used. `tests/dtf-idp-evaluation-rn3b1c.test.mjs` contains 14 isolated gate tests.

## Next independent decision gates
1. Accountable stakeholder selects PoC candidate(s) and approves budget/terms, distinct from production provider selection.
2. Independently verify a temporary *nonproduction* issuer and exact Cloudflare Workers/Pages SDK path. Do not create a production auth tenant or process customer identity without separate authorization.
3. Test signature/issuer/audience/JWKS/authorized origins, cookies/PKCE/CSRF, logout/epoch rotation, signup/recovery, tenant ownership and D1 atomic accept with disposable IDs.
4. Review pricing and portability, account export, customer support, abuse, data residency, secret access, emergency rollback and vendor failure behavior.
5. Record an externally verified signoff. This evaluation artifact itself can NEVER enable auth or checkout.

## Windows independent verification
$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase24-idp-evaluation-20261116
node --test .\tests\dtf-idp-evaluation-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE24_IDP_TEST_FAILED' }
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE24_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE24_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase23-auth-readiness-design-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE24_GIT_FAILED' }
git status --short

Targets: new Phase24 **14/14**, full suite **367/367** (353 previously verified), Astro **11 pages**, Git integrity PASS and clean working tree. These are targets; independent Phase24 tests have NOT been run yet. PR remains draft, unmerged and undeployed; no production auth, Stripe, Cloudflare D1/R2, Resend, checkout or automated artwork deletion.