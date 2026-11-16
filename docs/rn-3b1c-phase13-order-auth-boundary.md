# RN-3B1C Phase 13 — Synthetic authenticated-order ownership gate

Dependent draft on independently verified Phase 12 PR #33. **Engineering authored; independent verification NOT YET RUN.**

## Scope
Phase 13 introduces \`dtf_artwork_order_auth_rn3b1c\`-style boundary (actual module: \`functions/lib/dtf-artwork-order-auth-rn3b1c.js\`) between an externally provided **trusted server authenticator**, a synthetic D1-owned order authority table, and the existing Phase 12 D1 version-pin contract.

The test-only \`dtf_test_order_authority\` table records an order's owner subject, workspace, type, status and active flag. Its name deliberately prevents it from being mistaken for ReasonableNoise's live order schema. The migration explicitly says **DO NOT APPLY TO PRODUCTION**.

Both bind and read operations:
- Call a server-provided \`authenticate(request)\`; require a verified principal with server-derived subject and workspace. The callback must perform genuine session/token verification in a future separately reviewed integration. **The \`verified: true\` marker is NOT cryptographic proof by itself.**
- Query D1 for the matching active \`dtf_quote\` order in \`draft\` or \`artwork_pending\` state and match both subject and workspace.
- Ignore untrusted caller-submitted \`subjectId\`, \`workspaceId\`, \`authorize\`. Caller-provided orderId is merely a lookup target.
- Delegate exact R2 version/PNG SHA256/byte-length checks and immutable D1 pin operations to Phase 12; revalidate entitlement following the database/storage operation.
- Fail closed for absent/invalid sessions, foreign owner/workspace, inactive/paid/cancelled/non-DTF orders, synthetic DB failures, R2 overwrite and competing pins.
- Always declare checkout, deletion, and production approval false.

## Explicit limits
This is a **synthetic-auth contract**, not actual ReasonableNoise session authentication. No real session cookies, access tokens, CSRF, production order model, route adapter, schema migration or Cloudflare deployment is connected. A malicious or compromised \`authenticate\` implementation could forge a principal; Phase 13 intentionally does not supply or approve one. Database reads separated from R2 writes can race with entitlement revocation; a final entitlement recheck mitigates some but does not establish an atomic decision-time authorization fence. D1 SQL triggers do not prevent privileged schema mutations. The previously reported npm vulnerabilities remain unresolved.

No live customer upload changes, production D1/R2, Stripe, checkout activation or automatic artwork deletion.

## Independent Windows verification
\`\`\`powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase13-authenticated-order-gate-20261115
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if(!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))){throw "MINIFLARE_MISSING"}
node --test .\tests\dtf-artwork-order-auth-rn3b1c.test.mjs
if($LASTEXITCODE -ne 0){throw "PHASE13_FAILED"}
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "REGRESSION_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/feature/rn-3b1c-phase12-d1-version-binding-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "GIT_FAILED"}
git status --short
\`\`\`

Targets: **13 new disposable local D1/R2 auth tests**, **214 full tests** (201 independently verified), **11 Astro pages**, clean Git. All are unverified targets. Keep branch/PR draft, unmerged, undeployed.
