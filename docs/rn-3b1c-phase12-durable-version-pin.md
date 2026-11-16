# RN-3B1C Phase 12 — Durable Artwork Version Binding (isolated)

Dependent draft on verified Phase 11 D3 PR #32. **Engineering authored, independent Windows verification pending.**

## Scope

The **disposable-only** SQL migration creates \`dtf_artwork_version_pins\`, a single immutable binding for each \`order_id\`, \`intent_id\` and \`object_key\`; \`pin_id\` is the primary key. SQL triggers reject ordinary UPDATE/DELETE. Uniqueness is enforced by D1, not by a sequential preflight query. No production migration should be applied.

\`bindVerifiedArtworkVersion\` requires the server-supplied authorized subject/order pairing, an exact private intent-ID/key mapping, trusted R2 version, PNG SHA-256 and byte size. It rechecks the object using the Phase 10/11 \`head/get/head\` readback before the D1 INSERT, and again afterwards. The INSERT uses \`ON CONFLICT DO NOTHING\` with \`meta.changes===1\` as its only success criterion; duplicates return false. The read-only \`verifyDurableArtworkPin\` reloads the D1 row and independently compares the exact private R2 version and content. No checkout or deletion authority is granted even when verification passes.

## Threat model, limitations and next gates

1. An R2 object can still be overwritten by a privileged, unconditional writer: this pin detects a changed version but cannot freeze or lock R2. There is a TOCTOU gap after the final R2 read. A pin may exist even if a concurrent R2 overwrite caused a fail-closed result after INSERT; no checkout permission follows from a row alone.
2. Object metadata and D1 are not cryptographically tamper-proof against privileged actors. SQL triggers are not privilege boundaries. Durable pinning must be connected to an actual authenticated order table with server-derived foreign-key/entitlement validation before production.
3. Native Cloudflare D1 and R2 isolation tested locally in disposable Workerd emulation, not a remote production resource. No real customer data, no live D1 migrations, R2 deletion, Stripe payment or deployment.
4. Pre-production integration still requires authenticated owner/operator validation, transactional decision-time fences, a separately verified nonproduction Cloudflare environment, paid-order retention requirements, and remediation of existing npm dependency findings.

## Windows verification

\`\`\`powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase12-d1-version-binding-20261115
$env:RN_MINIFLARE_ROOT=Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if(!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))){throw "MINIFLARE_MISSING"}
node --test .\tests\dtf-artwork-version-pin-rn3b1c.test.mjs
if($LASTEXITCODE -ne 0){throw "PHASE12_FAILED"}
node --test .\tests\*.test.mjs
if($LASTEXITCODE -ne 0){throw "REGRESSION_FAILED"}
npm run build
if($LASTEXITCODE -ne 0){throw "BUILD_FAILED"}
git diff --check origin/fix/rn-3b1c-phase11-comment-newline-r2-d3-20261115...HEAD
if($LASTEXITCODE -ne 0){throw "GIT_FAILED"}
git status --short
\`\`\`

Targets: **13 new local D1/R2 integration tests**, **201 full regression tests** (188 previously verified), **11 Astro pages**, and clean Git. These are targets, not yet verified. Do not merge, deploy, activate live DTF checkout or enable automatic artwork deletion.
