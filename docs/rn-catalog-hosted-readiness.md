# RN Catalog — Hosted Cloudflare Access & D1 Binding Readiness

**Status:** DOCUMENTED / HOSTED VERIFICATION NOT PERFORMED. Production remains on HOLD. No account credentials or actual production database identifiers belong in this repository.

## Boundary

PR #71's Miniflare/workerd D1 tests verify local runtime parity, **not** a hosted Cloudflare account binding or genuine Access application sign-in. A green CI run must not be reported as hosted acceptance.

Cloudflare Pages supports distinct preview and production bindings. The production admin orders application already exists and is outside this catalog gate. Do **not** replace, loosen, or share its existing policy automatically.

## Read-only inventory before any account change

1. Open the Cloudflare dashboard; identify the exact ReasonableNoise **Pages project** and preview deployment hostname. Record it outside GitHub.
2. Under **Workers & Pages → project → Settings → Bindings**, inspect preview and production. Confirm the preview binding is named exactly `RN_CATALOG_DB` and points to a **dedicated disposable D1 database**, distinct from production. Do not attach an artwork bucket or production DB as a substitute. A new or changed binding requires a redeploy before it takes effect.
3. In **Zero Trust → Access controls → Applications**, locate or provision a **preview-only** Access application. Its path must protect both methods of `/api/admin-products*`, with no bypass or service-token policy allowing user edits.
4. Confirm `RN_ACCESS_TEAM_DOMAIN` matches the team's `*.cloudflareaccess.com` domain and `RN_ACCESS_AUD` is the **preview Access application's audience**. Never copy a production application token/AUD into GitHub.
5. Confirm preview admin allowlist `RN_CATALOG_ADMIN_EMAILS` is explicit and contains only approved administrators. Leave `RN_CATALOG_ADMIN_ENABLED` unset/false during inventory. Do not upload JWTs, cookies, passwords, API tokens, real customer records, or Cloudflare credentials to CI.
6. Inspect production read-only: confirm no catalog flag was enabled and no production catalog D1 binding or migration was modified by this gate.

## Local configuration shape precheck (not hosted validation)

`node scripts/rn-catalog-hosted-preflight.mjs` reads **locally supplied** environment values: `RN_TARGET_ENVIRONMENT=preview`, `RN_CATALOG_ADMIN_ENABLED=false`, `RN_CATALOG_BINDING_NAME=RN_CATALOG_DB`, `RN_PREVIEW_D1_DATABASE_ID`, `RN_PRODUCTION_D1_DATABASE_ID`, `RN_ACCESS_TEAM_DOMAIN`, `RN_ACCESS_AUD`, `RN_CATALOG_ADMIN_EMAILS`, `RN_PREVIEW_HOST`, and `RN_ACCESS_APPLICATION_PATH=/api/admin-products*`. It prints only PASS/FAIL check names. Use non-secret values in local shell; do **not** paste environment values into chat or GitHub.

**Passing this script proves only input shape and isolation declarations.** It never authenticates to Cloudflare and cannot prove the declared IDs or paths exist. The script exits nonzero on incomplete/production-targeted input.

## Hosted acceptance — separate supervised staging gate

After explicitly confirming preview resources and the disabled feature flag:

- Access boundary: without login, GET and PATCH to the staging admin API are denied or redirected by Access. A spoofed email header or emergency orders token must never authorize a write.
- Access identity: after a **real** permitted Access login, verify signed token's issuer, audience and expiration and that an approved administrator succeeds; a non-allowlisted identity is denied. Never save or share the token.
- D1 binding: verify through staging that the bound database is the intended isolated preview D1. Inspect only draft seed counts; compare database IDs via Cloudflare dashboard without exposing them to CI output.
- Safe write: in disposable preview only, enable the catalog API temporarily, edit a disposable draft item and verify version increment, actor-attributed audit, 409 on stale edit, and rollback. Restore flag OFF and remove test artifacts when complete.
- Protection: verify the same product remains unchanged in production and that prior paid order records/Stripe webhooks were not touched.

Record **gate name, date, exact GitHub SHA, pass/fail, environment, and redacted evidence link** on PR #71. Never record raw credentials. If any step fails, leave `RN_CATALOG_ADMIN_ENABLED` OFF, halt and correct in a new commit; do not merge or deploy.

## Release boundary

Successful hosted Access/D1 acceptance would complete the Phase 2 backend infrastructure gate, **not** the finished stock-management feature. Customer storefront rendering, SKU-safe checkout stock enforcement, paid-order regressions and explicit owner release approval remain separate work.

Official references: Cloudflare Pages Functions Bindings (developers.cloudflare.com/pages/functions/bindings/) and Cloudflare Access JWT Validation (developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).


## Safe negative-access probe — available but not yet run against a hosted preview

Once the actual **isolated preview hostname** and the separate Access app are confirmed, run `scripts/rn-catalog-hosted-boundary.mjs` from a trusted machine with these environment settings:

- `RN_TARGET_ENVIRONMENT=preview`
- `RN_HOSTED_PROBE_APPROVED=read-only`
- `RN_CATALOG_ADMIN_ENABLED=false`
- `RN_PREVIEW_HOST`: actual approved isolated preview hostname (without `https://`)
- `RN_ACCESS_TEAM_DOMAIN`: the approved Access team domain (no credentials)

This performs three credential-free calls to **only** `/api/admin-products`: anonymous GET, forged-header GET, and a PATCH with the deliberately invalid `{"version":0}` body. No valid catalog mutation is sent; it never sends a real token. All requests use manual redirect handling. It blocks production hosts, internal/localhost targets, non-preview mode, missing approval, and enabled admin feature flags. It prints statuses and categorical results only, never response bodies or redirected URLs.

- `NEGATIVE_BOUNDARY_PASS` means all three requests were denied. This is **not** proof of real Access sign-in or D1 binding.
- `edge_access_redirect_observed=true` means the script observed a redirect to the configured Access team. A 401/403 without such a redirect proves denial only; Cloudflare Access configuration remains unverified.
- `BLOCKED` includes 200 (unexpected public success), 404 (missing staging route), 503 (unavailable route/binding) and network errors.
- `BLOCKED_TARGET` means no network requests were sent.

**Never** call this script using the live production hostname, add live tokens to environment variables for the probe, or relax the guard to force a PASS. Only a hosted preview account-side review can establish that the intended D1 database and Access application are actually configured.

## Exact remaining acceptance evidence

| Gate | Required observable proof | Current state |
| --- | --- | --- |
| Preview hostname | Confirmed matching Pages preview deployment and exact code SHA | UNVERIFIED |
| Preview D1 | Dedicated preview binding + database ID confirmed via dashboard, distinct from production | UNVERIFIED |
| Access policy | Preview route covers GET/PATCH; audience and team domain confirmed | UNVERIFIED |
| Access negative boundary | Cred-free denial probe against approved preview | NOT RUN |
| Access positive identity | Real authorized Access sign-in, read and safe write, unauthorized principal denied | NOT RUN |
| D1 audit | Disposable staged item version, actor audit, stale 409, rollback | NOT RUN |
| Production invariance | No order/Stripe/production binding changes | No production changes initiated in this gate |

Do not mark these rows PASS solely because local CI reports success.
