# RN-3B1C Phase28 — Nonproduction Identity Provider Trial Decision

**Plan-only. Trial sequence recommendation is not vendor selection or authorization to create tenants, credentials, SDK installations, live accounts, routes, D1 migrations, or deploy.**

## Verified baseline
Phase27 PR #49 locally verified on Windows: 15/15 new tests, 412/412 full regression, 11-page Astro build, JS syntax, Git diff and clean working tree. Its injected Clerk/Supabase mocks did NOT run the actual vendor SDKs.

## Decision record — candidate trial order only
1. **Clerk first** as the *preferred isolated browser-session trial candidate*, not as the selected production IdP. Official Clerk `authenticateRequest()` supports session token verification with explicit `authorizedParties`, `audience`, and `jwtKey` options. It must be proven on the Cloudflare Pages Functions/Workers environment using a separately authorized disposable instance before any trust is placed in a real Clerk `RequestState`. Reference: https://clerk.com/docs/reference/backend/authenticate-request
2. **Supabase Auth second** as an independent alternate evaluation, not as a fallback production authorization. Its official docs distinguish cookie `@supabase/ssr` from stateless Bearer `@supabase/server`. The project must decide which model fits Astro static + Pages Functions and verify exact runtime compatibility, refresh/cookie protection and backend request auth. References: https://supabase.com/docs/guides/auth/choosing-a-server-package and https://supabase.com/docs/reference/server
3. **No real provider selected**. This is an order for a future independently approved disposable test only, not a procurement, price or enterprise commitment.

## Phase28 implementation
`functions/lib/dtf-phase28-staging-trial-decision-rn3b1c.js` is read-only. It states 14 required independent controls: written authorization, dedicated synthetic tenant, least privilege, isolated secret store, synthetic identities, redirect/origin policy, exact SDK pin and Worker build, issuer/audience/signature/JWKS, token expiry/revocation, CSRF/cookies, recovery/logout, separate local D1 ownership testing, rollback and independent review. `evaluatePhase28TrialRequest()` reports missing, duplicate, failed, unrun, invalid and self-claimed evidence distinctly. Even a perfect self-attested result is `NO_GO` and every provider/account/login/customer-order/Stripe/R2/deploy permission stays false.

`tests/dtf-phase28-staging-trial-decision-rn3b1c.test.mjs` covers 15 fail-closed test cases for trial priority, rejected unknown provider, no accidental approval on self-attest or spoofed flags, partial evidence, environment mismatch, malformed records and no live integration side effects. **Tests authored, not yet independently run.**

## Required future real-provider test plan, NOT executed
First authorize one disposable nonproduction Clerk instance with an explicit technical review of service terms/cost, operational ownership, safe test credentials, disposal plan and named reviewers. In a **different isolated branch** pin official SDK versions and test actual provider-issued sessions and token verification on the real isolated runtime, then reject revoked/expired/mismatched sessions, wrong authorized party, invalid Origin/CSRF, unsafe callback/recovery state and unauthorized quote ownership. Repeat with Supabase if Clerk does not meet requirements. Do not use accounts or tokens from existing Supabase projects or any production service.

Crucial boundary: no external provider subject is a ReasonableNoise local customer. A separate canonical D1 customer/tenant mapping, session epoch, verified CSRF, same-statement Phase21 acceptance fence and manual anonymous quote claim must be designed and independently verified before local DTF order ownership is possible. Current Phase20 local Ed25519 cookie and Phase21 D1 acceptance must not be bypassed by any outside token or checked form input.

## Windows independent verification
$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase28-staging-trial-decision-20261116
node --check .\tests\dtf-phase28-staging-trial-decision-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE28_SYNTAX_FAILED' }
node --test .\tests\dtf-phase28-staging-trial-decision-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE28_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE28_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE28_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase27-mocked-sdk-boundary-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE28_GIT_FAILED' }
git status --short

## Expected acceptance target (not verified yet)
15/15 Phase28 tests, **427/427** full regressions (Phase27 verified 412), Astro **11 pages**, syntax/Git integrity PASS and clean working tree.

## Hard NO-GO
PR is draft, unmerged and undeployed. No provider selected, no tenant/accounts provisioned, no SDK installed, no credentials, no provider calls, no customer auth routes, no real D1/R2 mutation, no Stripe/Resend integration, no USDOT sticker checkout changes, no DTF direct checkout, no automatic artwork deletion.