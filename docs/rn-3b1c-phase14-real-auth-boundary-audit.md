# RN-3B1C Phase 14 — Source-backed real-auth integration readiness audit

**Source inspection only; production integration NOT authorized.**

## Actual existing application evidence
Read on branch \`feature/rn-3b1c-phase13-authenticated-order-gate-20261115\`:
- \`functions/api/admin-orders.js\` authenticates administrative requests through allowlisted Cloudflare Access email headers, an email decoded from the \`cf-access-jwt-assertion\` payload, or an emergency admin token. The route source does **not** itself cryptographically verify the JWT signature. This does NOT demonstrate that edge policies are absent; it means the route alone cannot establish independently validated **customer** identity. Never use those headers, decoded claims or admin tokens to authorize customer order uploads.
- \`functions/api/contact.js\` implements current DTF quote submission, Turnstile and private R2 objects under \`dtf-quotes/.../DTF-...\`. That is an anonymous, quote-first contact workflow, **not** a customer session or a persisted D1 order ownership record.
- \`functions/api/stripe-webhook.js\` deliberately handles marked **sticker** payment sessions, not DTF customer ownership.
- \`functions/lib/dtf-artwork-order-auth-rn3b1c.js\` from Phase 13 requires caller-injected \`authenticate(request)\` and a \`verified:true\` principal, backed only by an explicitly synthetic order table; no production session verifier is supplied.

Therefore, **do not wire the Phase 13 API to production**. Customer ownership is not established by administrative email claims, a quote contact address, Stripe metadata or a client-submitted identity. The real integration requires a separately approved customer-account/session design and a canonical trusted order authority system. Phase 14 supplies a deliberately always-fail-closed readiness contract and source-based tests; **even self-asserted completion of all flags does not lift the block**.

## Independent readiness blockers
1. Cryptographically verified server-authenticated sessions and a session issuer; expiration, audience and revocation behavior.
2. Canonical server-owned order records, customer ownership and workspace mapping; no client-selected ownership.
3. Decision-time authorization tied atomically to the attempted D1 binding/use; guard against revocation and order-status changes.
4. CSRF protections for browser mutations, replay/nonce fences, and rate limiting.
5. Trusted R2 pinned-version revalidation at decision-time, not a permanent R2 immutability claim.
6. Independent nonproduction Cloudflare and provider verification under explicit separately authorized tests.
7. npm dependency vulnerabilities addressed in a separate reviewed track.

No real auth provider integration, customer route, production D1 schema migration, R2 write/delete, Stripe transaction, merge, deployment or checkout activation is part of this PR.

## Windows independent verification
\`\`\`powershell
$ErrorActionPreference="Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase14-real-auth-boundary-audit-20261115
node --test .\tests\dtf-artwork-real-auth-readiness-rn3b1c.test.mjs
if($LASTEXITCODE -ne 0){throw "PHASE14_AUDIT_FAILED"}
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if(!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))){throw "MINIFLARE_MISSING"}
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "REGRESSION_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/feature/rn-3b1c-phase13-authenticated-order-gate-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "GIT_FAILED"}
git status --short
\`\`\`

Acceptance targets: **12/12 Phase 14 tests**, **226/226 all regressions** (214 independently verified in Phase 13), **11 Astro pages**, clean Git. Not independently run. No merge/deploy.
