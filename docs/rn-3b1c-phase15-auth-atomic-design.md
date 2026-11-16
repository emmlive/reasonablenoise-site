# RN-3B1C Phase 15 — Production authentication architecture and atomic decision-time design

**Architecture and disposable SQL experiment only. DO NOT DEPLOY.**

## Source-backed current state

Phase 14 (independent 226/226 PASS) established the repository does **not** contain an approved customer session verifier or a canonical customer-owned DTF order authority table. Cloudflare Access admin identity, unsigned decoded admin JWT payload, and emergency admin token are **not** customer identity. Current DTF workflow is anonymous quote-first with R2 uploads. The sticker Stripe webhook cannot authorize DTF artwork.

## Proposed production architecture — NOT IMPLEMENTED

1. **Session issuer/verification:** select and independently validate a dedicated customer-account provider. Worker-side server verifies issuer, signature, audience, expiration, nonce/session ID, key rotation and revocation. Do not treat a `verified:true` flag, email, client-supplied subject, or Cloudflare Access admin claims as proof. Cookies require Secure, HttpOnly, SameSite and explicit CSRF defenses for all browser mutation endpoints. Set conservative TTL and reauthentication.
2. **Canonical order authority:** design a real customer/workspace/order model and migrations separately. Ownership, workspace, DTF type, current status, order epoch and account entitlements must come from server-controlled records. A DTF quote ID is not yet an order ID and must not silently gain ownership or payment rights.
3. **Decision-time fence:** a single D1 conditional statement must atomically verify session epoch/unrevoked/unexpired, order owner/workspace/status/epoch, exact stored pin digest/version/length and one-time replay fences. Revocation and ownership changes increment epochs. Ordinary preflight SELECT followed by INSERT is inadequate.
4. **R2 boundary:** independently verify actual pinned PNG bytes and version immediately before any D1 decision; note that D1 and R2 cannot share a transaction. A privileged writer may overwrite R2 before or after SQL. Protect R2 credentials and enforce least privilege. A new separately authorized step must reverify R2 and the current decision state at the point of *any future* business action.
5. **Audit/observability:** an append-only decision ledger with synthetic-session/order epoch inputs, distinct replay ID and unique pin ID; bounded nonsecret reason codes. Distinguish audit from authorization: its existence never grants checkout, delete, shipment, printing or production approval.
6. **Before future activation:** provider-backed nonproduction integration tests, CSRF and session-expiry tests, replay and concurrency verification, protected endpoint rate limiting, abuse handling, customer data privacy review, independent auth architecture/security review, reviewed production migration/rollback, and dependency vulnerability remediation.

## Phase 15 isolated engineering

`migrations/rn-3b1c-phase15-synthetic-decision-fence.sql` creates **disposable-only** `dtf_test_session_epochs`, `dtf_test_order_epochs` and `dtf_test_auth_decisions` with one-time replay/pin uniqueness and ordinary SQL UPDATE/DELETE rejection on decision rows.

`reserveReviewOnlyDecision` uses injected `resolveVerifiedSession` and `verifyPinnedObject` **synthetic trusted callback interfaces**. It enforces a single parameterized `INSERT … SELECT` across session/order/pin records. The requested reservation is **review only**. No customer authentication implementation, website UI changes, live route, real D1 schema migration, Cloudflare provider or Stripe calls exist.

**Limits:** A forged or poorly implemented injected resolver can still forge synthetic identity. D1 fencing does not turn a historical decision into irrevocable authorization; a subsequent revocation can happen at any time. The R2 readback callback is not an atomic part of D1, and its test double cannot prove production integrity. SQL triggers are not tamper-proof against privileged schema mutation. The Phase 14 fail-closed production readiness hold remains in place.

## Windows independent acceptance

```powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase15-atomic-auth-decision-design-20261115
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))) { throw "Isolated Miniflare missing" }
node --test .\tests\dtf-artwork-decision-fence-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Phase 15 failed" }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Regression failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
git diff --check origin/feature/rn-3b1c-phase14-real-auth-boundary-audit-20261115...HEAD
if ($LASTEXITCODE -ne 0) { throw "Git integrity failed" }
git status --short
```

Target: **13/13 Phase 15**, **239/239 regressions** (226 verified baseline), **11 Astro pages**, clean Git. These are **NOT YET VERIFIED**. No merge/deployment/production SQL or provider access is authorized; DTF remains quote-first with direct checkout and automatic artwork deletion disabled.
