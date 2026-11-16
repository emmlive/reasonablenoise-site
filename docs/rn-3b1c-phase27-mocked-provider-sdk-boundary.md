# RN-3B1C Phase27 — Mocked Official SDK Integration Boundary

**Offline mock-only integration. NOT a real Clerk or Supabase staging test. NO provider accounts/credentials.**

## Baseline
Phase26 PR #48 independently passed 15/15 new, 397/397 full regression, 11-page Astro build, syntax, Git diff and clean tree. That verified a planning/preflight gate, not any provider's production behavior.

## Current official API shape (checked Nov 16, 2026)
- Clerk documents `clerkClient.authenticateRequest(request,{authorizedParties:[origin],acceptsToken:'session_token'})`, returning a RequestState with `isAuthenticated`, `status`, `tokenType`, and `toAuth()` for `userId`/`sessionId`. Docs recommend explicit `authorizedParties` and note networkless JWT verification may not query live revocation. https://clerk.com/docs/reference/backend/authenticate-request
- Supabase documents `supabase.auth.getClaims(jwt)` to verify an access token against project JWKS where asymmetric keys are configured. This check alone must not be mistaken for a live session-revocation check or local DTF authorization; project configuration/SDK compatibility and local mapping are unverified. https://supabase.com/docs/reference/javascript/auth-getclaims

## Implemented on isolated branch
`functions/lib/dtf-mocked-provider-sdk-boundary-rn3b1c.js` exposes two non-routed adapter functions that accept **injected** objects mimicking the documented SDK API surface. It makes no network calls and imports neither provider SDK. The adapter validates POST same-origin inputs first. Clerk adapter requires `isAuthenticated===true`, `status='signed-in'`, `tokenType='session_token'`, and bounded `toAuth().userId/sessionId`. Supabase adapter requires a syntactically bounded explicit Bearer credential, a mock `getClaims(token)` response without error, role `'authenticated'`, and bounded `sub/session_id`. The adapter does NOT actually validate token cryptography; that is presumed solely from mock input and must be independently verified using official SDKs in a separately authorized environment.

**All allowed outcomes return only provider identity EVIDENCE.** Even a mock authenticated state returns `customerPrincipal=null`, `workspaceId=null`, `csrfVerified=false`, `sessionAuthorized=false`, `quoteAcceptanceAuthorized=false`, `checkoutEligible=false`, `paymentAuthorized=false`, `deletionAuthorized=false`, `productionApproved=false`. There is no registration, cookie issuance, signed local session, D1 access, canonical quote ownership, route, checkout or production approval.

`tests/dtf-mocked-provider-sdk-boundary-rn3b1c.test.mjs` authors 15 tests: successful synthetic Clerk/Supabase SDK responses; strict Clerk options and token type; missing identity/session; exceptions; bearer-only Supabase calls; malformed bearer rejects before mock invocation; service/anon roles denied; cross-origin/cross-site/method checks; caller-forged workspace and payment flags; no live integrations.

## Threat model and remaining blockers
- **Mock limitations:** mock objects can lie and can be fabricated by any caller. This source MUST NOT be mounted into public customer request routes as if a real SDK had verified them.
- No real Clerk `authenticateRequest` or Supabase `getClaims` code executed. No account, browser login, logout, token refresh, actual provider revocation, PKCE, nonce/state, real CSRF, worker bundling, hosted IdP, or D1 session lookup has been tested.
- In a later, separately approved trial: pin official SDK versions, create disposable test providers/accounts, verify real cryptographic issuer/audience/key trust and binding, compare actual runtime output to this mock contract, and test active revocation, origin policy, login/recovery/callback, account-to-quote ownership, and D1 write-time fencing.
- Supabase bearer-token tests do NOT imply browser session cookies are supported; browser cookie/PKCE authentication would need separate design and tests.
- Clerk `authorizedParties` is a server-to-SDK option and not a replacement for application CSRF protection; real-session owner and local D1 authorization remain unproven.
- No automatic claim of existing anonymous DTF contact quote via email, quote reference, Stripe customer, or artwork link. Preserve sticker checkout and quote-first DTF flow.

## Independent Windows verification
$ErrorActionPreference='Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase27-mocked-sdk-boundary-20261116
node --check .\tests\dtf-mocked-provider-sdk-boundary-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE27_SYNTAX_FAILED' }
node --test .\tests\dtf-mocked-provider-sdk-boundary-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE27_TARGETED_FAILED' }
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE27_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE27_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase26-provider-staging-preflight-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE27_GIT_FAILED' }
git status --short

**Targets (NOT yet independently run):** 15/15 new tests, **412/412** full regressions (397 independently verified baseline), 11 Astro pages, syntax/Git checks PASS and clean tree. Any failure remains a NO-GO pending correction.

## Hard NO-GO
Do NOT provision a provider tenant, access any production or staging customer identity, install provider SDK, configure real keys, enable auth routes, apply Cloudflare D1 migrations, call Cloudflare R2/Stripe/Resend/Turnstile, modify sticker checkout, activate DTF checkout, automatically delete artwork, merge or deploy this PR.