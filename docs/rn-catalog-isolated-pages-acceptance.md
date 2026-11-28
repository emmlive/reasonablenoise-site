# RN Catalog — Independent Cloudflare Pages Acceptance Project

**Engineering design only — no new Cloudflare project created or deployed by this PR.**
**Decision:** Prefer a distinct acceptance Pages project rather than introducing a first Wrangler config into the existing live `reasonablenoise-site` project. The production project remains entirely dashboard-managed with no catalog D1 binding.

## Why a separate project

Cloudflare Pages Wrangler documentation: a deployed Wrangler config becomes the project's source of truth; preview bindings and variables are not automatically inherited. The downloaded private production config may contain credential values and should **never** be committed or copied to a different project. A second Pages project avoids this configuration-governance migration entirely. Its own project-level Production is an **acceptance-only environment**; it must have no custom domain, payment credential, live R2 bucket, or email provider credentials.

Proposed project name: `reasonablenoise-catalog-isolated`. If unavailable, **STOP** and review a different exact hostname, update middleware and tests, and require a new Access destination before creating anything.

## Setup — requires separate owner authorization and account action

1. Confirm `reasonablenoise-site` production remains on `main`, its `ARTWORK_BUCKET` is intact, and `RN_CATALOG_DB` absent in fresh config export.
2. Create a **separate** Pages project named `reasonablenoise-catalog-isolated`, connected to `emmlive/reasonablenoise-site` with **production branch set to the isolated feature branch only**, build `npm run build`, output `dist`. Do not connect `reasonablenoise.com` or any real customer-facing custom domain. Do not import production environment variables. Be aware that this project would classify the feature branch as *its own* production environment; this is not the existing live site Production.
3. Before permitting catalog administration, create a distinct Cloudflare Access self-hosted application covering `reasonablenoise-catalog-isolated.pages.dev` **and** its required deployment subdomains. Restrict by approved administrator email, with no bypass policies. Existing Access app `*.reasonablenoise-site.pages.dev` **does not cover** this new project.
4. On the new isolated project only, configure `RN_CATALOG_DB` to the dedicated D1 `reasonablenoise-catalog-preview` (UUID already created), not to production or other projects. Leave `RN_CATALOG_ADMIN_ENABLED=false` while proving the boundary. Never configure `ARTWORK_BUCKET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, or production admin tokens in this project.
5. When Access is protected and the new project is reviewed, configure the **new Access app's** `RN_ACCESS_TEAM_DOMAIN`, `RN_ACCESS_AUD`, and `RN_CATALOG_ADMIN_EMAILS` in that project's encrypted secrets/variables. Do not reuse the old project's AUD, and do not send these values in chat/GitHub.
6. Verify hosted GET `/api/admin-products` returns 503 while flag OFF and GET `/api/upload-artwork` returns 403. Validate all other nine legacy APIs are middleware-denied, using safe GET/HEAD probes only, never live provider payloads.
7. Re-download both original and isolated Pages configuration read-only, compare effective bindings and verify original production unchanged. Document rollback (disable Access app? **No** — first disable the isolated project/deployment; never loosen Access to troubleshoot). No SQL migration at this gate.
8. Only after isolated runtime and auth checks PASS, separately authorize migration against D1 `reasonablenoise-catalog-preview`, then enable catalog read acceptance, then separately approve audited updates. Never release the new catalog admin route on the actual live site before a distinct production decision.

## Code-level boundary

`functions/api/_middleware.js` recognizes only `reasonablenoise-catalog-isolated.pages.dev` and one-label subdomains as *catalog acceptance hosts*, in addition to existing original-project Preview hosts. They are **never production pass-through**. Only GET/PATCH `/api/admin-products` is routed to its handler. Every other `/api/*` operation is blocked 403 before the handler. This middleware does not replace Access edge protection or signed JWT validation.

## STOP conditions

- Any secret value or production artwork binding copied into this new project
- Missing Access login enforcement for the new project
- External custom domain added
- Catalog flag unexpectedly true
- Any production settings in `reasonablenoise-site` modified
- Migration requested before binding and auth checks PASS

**Current status: READY FOR OWNER REVIEW ONLY.** No Cloudflare project created. No D1 migration. No catalog admin activation. Existing live Production HOLD.
