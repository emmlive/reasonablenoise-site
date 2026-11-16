# RN-3B1C Phase 21 — Atomic Session Revocation and DTF Quote Acceptance

**Scope: disposable local D1 only. NOT a production authorization endpoint or permission to process payment.**

## Verified baseline
Phase 20 PR #42 independently passed 16/16 signed-session checks, 4/4 identity-to-quote integration, 313/313 full regressions, Astro 11 pages, Git whitespace PASS and clean working tree.

## Source defect addressed
The earlier Phase 20 Ed25519 signed-session verifier reads D1 session revocation/epoch before calling Phase 19's accepted quote INSERT. A revocation between the preliminary verification and the mutation was not fenced by the acceptance SQL. Phase 21 introduces a new standalone conditional insertion so a stale principal cannot authorize a later write.

## What the isolated code does
- Adds functions/lib/dtf-atomic-session-acceptance-rn3b1c.js, a new review-only acceptance function. It requires a verified customer principal including session ID, session epoch, customer subject, workspace, and successful CSRF verification from an injected trusted verifier.
- Uses one D1 INSERT ... SELECT (with the existing Phase 18/19/20 synthetic tables) to check session_id, matching customer/tenant, unchanged session_epoch, revoked=0, session expiry at mutation time, order ownership, quote approval, reviewed unchanged amount and order fields, pricing catalog approval, matching user-displayed amount/version, and unique acceptance constraints.
- Earlier session verification remains necessary for JWT signature, issuer, origin and CSRF checks; the conditional D1 write closes the specifically identified verifier-read-to-acceptance-write revocation gap. D1 serializes competing mutation decisions. A revocation committed before the INSERT cannot result in an accepted record; an acceptance committed first may legitimately precede a subsequent revocation.
- Preserves one acceptance per quote/order and returns review-only success with checkoutEligible=false, paymentAuthorized=false, deletionAuthorized=false and productionApproved=false. Does not modify Phase 19 behavior or existing contact/sticker routes.

## Test coverage (authored, independently unverified)
Fourteen new local D1 tests cover valid acceptance, revocation after verifier but before SQL, session-epoch rotation after verification, owner/workspace changes, expiry at decision time, 20 concurrent attempts after revocation, 20 concurrent valid attempts producing one record, quote/pricing mutations, forged client values, session/CSRF errors, DB outages, and a deterministic barrier with 20 already-verified requests released only after a committed revocation.

## Remaining security work
- Real customer identity issuance, key management, secure cookie/CSRF lifecycle, account recovery, verified customer order linkage, production schema and permissions remain absent. The Phase 20 verifier still uses ephemeral test keys and synthetic D1.
- Authenticated customer cancellation/revision and catalog rules are not specified; final DTF chargeable tariffs are not approved.
- SQL conditional acceptance prevents the test-level TOCTOU but does not prove every production Cloudflare request/Workerd concurrency mode or cross-service R2 consistency. Independently review exact D1 semantics and platform permissions before any live integration.
- No login route, live customer acceptance UI, Stripe checkout, webhook, mail, real R2, production D1 migration, or artwork deletion changes.

## Independent Windows PowerShell verification
Run in existing ReasonableNoise working tree; install nothing and call no providers.

$ErrorActionPreference = 'Stop'
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase21-atomic-session-acceptance-20261116
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP 'rn-miniflare-phase5-isolated'
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT 'node_modules\miniflare'))) { throw 'MINIFLARE_MISSING' }
node --test .\tests\dtf-atomic-session-acceptance-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE21_ATOMIC_FENCE_FAILED' }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'PHASE21_REGRESSION_FAILED' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'PHASE21_BUILD_FAILED' }
git diff --check origin/feature/rn-3b1c-phase20-signed-customer-session-20261116...HEAD
if ($LASTEXITCODE -ne 0) { throw 'PHASE21_GIT_CHECK_FAILED' }
git status --short

## Gates
Phase21 new tests **14/14 PASS target**, full regression **327/327 PASS target** (313 independently verified baseline), Astro build **11 pages target**, Git whitespace PASS, working tree CLEAN. These are targets, not completed claims. Keep PR DRAFT/unmerged/undeployed; never execute synthetic migrations against production D1. DTF checkout and automatic artwork deletion stay disabled.