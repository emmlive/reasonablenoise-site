# RN Catalog — Preview D1 Controlled Activation Runbook

**Status: DESIGN REVIEW / NO DEPLOYMENT APPROVED.** Production's `RN_CATALOG_DB` was removed from the dashboard; fresh config export showed production `ARTWORK_BUCKET` only. A local preview candidate has passed exact-prefix/diff inspection and 25/25 CI tests. Those checks do **not** establish hosted runtime readiness.

## Why direct deployment is still HOLD

Cloudflare Pages [configuration docs](https://developers.cloudflare.com/pages/functions/wrangler-configuration/) state:

- A Wrangler config used for a Pages deployment becomes the project's **source of truth**, potentially replacing dashboard-managed configuration.
- Only `production` and `preview` named environments exist; a preview configuration change applies to **all Preview deployments**, not only a branch.
- `vars`, `d1_databases`, and `r2_buckets` are **non-inheritable keys**. If an environment overrides non-inheritable configuration, that environment must explicitly define all required non-inheritable resources. Do not assume preview inherits production's artwork bucket or production variables.
- New configuration needs a new deployment to take effect.

The original project **does not track a Wrangler config**, so casually adding the candidate to the branch changes the project's configuration governance. A one-line preview D1 addition is not sufficient proof of functional parity.

## Deployment-independent readiness gates

1. **Immutable baseline**: keep a private, local, newly downloaded dashboard-exported `wrangler.toml`. Review output dir, compatibility settings, production and preview `vars` names (not values), `d1_databases`, `r2_buckets`, other non-inheritable resources and settings. Never copy values, tokens, JWTs, or private configuration to GitHub or chat.
2. **Production integrity**: production remains without `RN_CATALOG_DB`; production `ARTWORK_BUCKET` still targets `reasonablenoise-artwork`; production checkout/orders and Access policies unchanged.
3. **Preview impact**: inventory preview routes that write to R2, payments, webhooks, orders, or send emails. Determine whether they need preview-only resources or must remain disabled; do **not** bind Preview to the live artwork bucket just for parity. Preview deployment configuration may alter **all previews**, so evaluate across existing preview URLs.
4. **Feature gate**: `RN_CATALOG_ADMIN_ENABLED` stays false or unset, regardless of D1 presence. Dedicated isolated D1 UUID is `19347f3f-5fb0-4e43-9d1c-a488eef5a1b7`; never use a production/other-project database.
5. **Access security**: preview Cloudflare Access app remains enabled; JWT verification needs preview-specific `RN_ACCESS_TEAM_DOMAIN`, `RN_ACCESS_AUD`, and a restricted `RN_CATALOG_ADMIN_EMAILS`. Never use the production order-admin Access AUD as a shortcut.
6. **Review rollback**: store the private pre-change config and production deployment ID securely, document current route behavior, and rehearse restore procedure **before** any config-bearing preview deployment. Removing a committed Wrangler file in a later deployment does not automatically restore dashboard settings.
7. **Non-deploy validation**: validate the complete config with the installed Wrangler's supported configuration parser/validator; run repository CI; inspect the exact candidate and effective preview configuration. No `wrangler pages deploy` or checkout/Stripe smoke requests at this gate.

## Conditional activation (requires separate approval)

Once all gates are PASS, use a reviewed Preview deployment procedure on the intended non-`main` branch only, without promoting to Production. Immediately re-download Pages config and verify the exact production and preview resource sets; observe actual Preview /api/admin-products disabled response behind Cloudflare Access; independently inspect production /api and existing checkout. **Stop and rollback** on any unexpected production change, Preview R2 access to live data, Access bypass, or route regression.

Only after Preview binding is proven correct and Production rechecked may the isolated catalog migration be separately approved. Catalog admin write activation requires subsequent JWT and audit acceptance. Production catalog release remains a separate decision.

## Explicit STOP / GO

- **STOP now:** Local file integrity and CI alone are not sufficient, particularly because non-inheritable Preview bindings/vars and config-governance migration remain unreviewed.
- **GO for read-only inspection:** Inspect the private config's table names, variable names/counts and Preview resource requirements without publishing values.
- **NO GO for activation:** Config deployment, database migration, feature activation, or Production promotion.

## Read-only source dependency audit — 2026-11-27

Actual source inspection at PR #71's candidate branch found **10 Pages Functions**. Their static `context.env` and `env` references are inventoried by `scripts/rn-catalog-preview-dependency-audit.mjs`. Explicit names are not secret values; do not copy real values into this repository.

| API route | Dependency categories observed | Current Preview D1-only candidate |
| --- | --- | --- |
| `/api/admin-products` | RN_CATALOG_DB, feature switch, Access team/AUD, approved email allowlist | D1 present locally; auth vars absent; admin stays disabled |
| `/api/admin-orders`, `/api/backfill-test-order`, `/api/download-artwork`, `/api/order-status` | ARTWORK_BUCKET, admin tokens/access email, optional email/site URL | NOT parity; leave operations disabled |
| `/api/contact` | ARTWORK_BUCKET, Resend, Turnstile, notification and site settings | NOT parity |
| `/api/create-checkout-session` | Stripe secret, site URL and checkout amounts | NOT parity; never add production Stripe secret to Preview |
| `/api/stripe-webhook` | Stripe secret/webhook, R2, Resend and order settings | NOT parity; never add live payment/webhook secrets |
| `/api/track-event`, `/api/upload-artwork` | ARTWORK_BUCKET | NOT parity; never attach live R2 to Preview |

**Conclusion: PREVIEW_COMPATIBILITY_NOT_ESTABLISHED.** This is a conditional preview **catalog-only** candidate, not full Pages preview environment compatibility. Existing preview routes might already be disabled, but that fact was not demonstrated by code audit or browser smoke. Static analysis also cannot find dynamic environment key reads: hosted behavior needs independent testing.

Safe path forward: build a separate catalog-only Preview deployment/route isolation plan that does not activate legacy functions, or prepare a complete Preview configuration with isolated bindings and placeholder/disabled payment/contact dependencies. Review total Preview impact and Cloudflare source-of-truth/rollback implications **before deployment**. Do not try to make the compatibility checker green by placing live Stripe, Resend, or production R2 credentials into Preview.

A new set of dependency-contract tests should run in CI. Until Preview is demonstrably safe for unrelated routes and Access config is present, **no activation, migrations, writes, or production changes**.
