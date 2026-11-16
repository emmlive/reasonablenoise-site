# RN-3B1C Phase 10 — Write-once artwork and pinned-version contract (isolated)

Dependent draft on verified Phase 9 R1 PR #26. **Engineering authored, independent tests pending.**

## Threat model and design
Phase 3 uses random unique object keys and checks R2 bytes at upload and consume, but the R2 put API is not an atomic create-only proof: an object may be overwritten between version checks. Phase 6/7/8/9 are only manual-review and audit contracts, not deletion authorization.

This phase adds an **isolated** write-once *adapter interface* and read-only pinned-version checker:
- Requires a trusted storage adapter implementing **atomic \`putIfAbsent\`**, \`get\`, and \`head\` with a stable opaque \`version\`. Ordinary \`put\` is rejected. This is a CONTRACT, not a claimed native R2 capability.
- Checks the private UUID/key and normalized intent ID pairing and uses the existing PNG decoder/integrity hash.
- Writes once, verifies decoded stored PNG bytes and SHA-256, compares metadata and exact version before and after read.
- Rejects duplicates, different-content substitution, same-content version changes, uncertain storage return values, mismatched metadata, expired/foreign auth, and storage outages.
- All returns declare \`artworkImmutable:false\`, \`checkoutEligible:false\`, \`deletionAuthorized:false\`, and \`productionApproved:false\`. The boolean indicates that a current readback cannot prove FUTURE or privileged immutable storage.
- Does **not** add production endpoints, R2 bindings, migrations, or a delete executor. Legacy Phase 3 \`bucket.put\` path is unchanged. No live checkout.

## Remaining production requirements
1. Prove exact Cloudflare R2 conditional-create semantics and object-version identity using official API/runtime, ideally against isolated disposable local Workerd/R2 and then authorized nonproduction resources.
2. Establish server-derived authenticated subject/order association and store trusted per-order version reference durably with atomic guard against concurrent update.
3. Re-verify object version at the decision boundary, with a lock/lease or safe provider conditional operation to prevent time-of-check/use races. Two HEADs alone DO NOT close that race.
4. Define paid-order retention/legal hold and review-approved cleanup with audit/privilege isolation. Never delete live objects based on this contract.
5. Existing npm dependency vulnerabilities remain separate remediation work.

## Independent Windows verification
\`\`\`powershell
$ErrorActionPreference = "Stop"
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase10-write-once-version-contract-20261115
$env:RN_MINIFLARE_ROOT = Join-Path $env:TEMP "rn-miniflare-phase5-isolated"
if (!(Test-Path (Join-Path $env:RN_MINIFLARE_ROOT "node_modules\miniflare"))) { throw "MINIFLARE_MISSING" }
node --test .\tests\dtf-artwork-version-rn3b1c.test.mjs
if ($LASTEXITCODE -ne 0) { throw "PHASE10_FAILED" }
node --test .\tests\*.test.mjs
if ($LASTEXITCODE -ne 0) { throw "REGRESSION_FAILED" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "BUILD_FAILED" }
git diff --check origin/fix/rn-3b1c-phase9-trigger-change-count-20261115...HEAD
if ($LASTEXITCODE -ne 0) { throw "GIT_FAILED" }
git status --short
\`\`\`
Target: **14 new tests**, **174 full tests**, **11 Astro pages**, clean Git. No live integrations or changes to existing workflows.
