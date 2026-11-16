# RN-3B1C Phase 11 — Disposable local Cloudflare R2 conditional writes

Dependent draft on Phase 10 PR #27. Adds an **isolated local R2 adapter** and **10 Miniflare/Workerd tests**. No production R2 bindings, routes, D1 migration, customer data or Stripe calls.

## Official API capability
Cloudflare documents Workers R2 \`put(key,value,{onlyIf: Headers})\`, with \`If-None-Match: *\` as the create-if-absent precondition. Failed put preconditions return \`null\`. R2 objects carry a per-upload \`version\` and \`size\`. The S3 conditional-write documentation says write conditions evaluate atomically at commit, and concurrent creates for the same existing key cannot both succeed while the original remains stored.

Sources:
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/r2/api/s3/conditional-operations/
- https://developers.cloudflare.com/r2/reference/consistency/

## Contract and limitations
The test-only adapter maps native R2 \`put/head/get\` to the Phase 10 \`putIfAbsent/head/get\` interface, using \`onlyIf:new Headers({"If-None-Match":"*"})\`. The adapter writes a SHA256 string and byte-length to **untrusted object custom metadata**, checks the decoded PNG against those values, and insists on matching upload \`version\` both before and after the body read. This cannot establish tamper-proof metadata, perpetual immutability or safe delete authorization.

The tests intentionally demonstrate that an **unconditional R2 put can overwrite a write-once object**. Therefore, real enforcement also requires all writers to use conditional puts, private key ACL/authorization, durable D1 version pinning and a safe decision-time CAS/lease. This code is never wired to the existing Phase 3 upload path.

## Windows verification
\`\`\`powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase11-local-r2-conditional-create-20261115
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if(!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))){throw "MINIFLARE_MISSING"}
node --test .\tests\dtf-artwork-r2-conditional-rn3b1c.test.mjs
if($LASTEXITCODE -ne 0){throw "PHASE11_FAILED"}
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "REGRESSION_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/feature/rn-3b1c-phase10-write-once-version-contract-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "GIT_FAILED"}
git status --short
\`\`\`
Expected: **10 new local R2 tests**, **184 full regression tests** (174 previously verified), **11 Astro pages**, clean Git. These are verification targets, not confirmed results.

No merge, deployment or payment activation authorized. npm dependency vulnerabilities remain open.
