# RN Catalog — Independent Cloudflare Pages Acceptance Project

**Status (owner-reported screenshots): isolated Pages project created and deployed; Access and hosted D1 acceptance remain unverified.**
**Decision:** Prefer a distinct acceptance Pages project rather than introducing a first Wrangler config into the existing live `reasonablenoise-site` project. The production project remains entirely dashboard-managed with no catalog D1 binding.

## Why a separate project

Cloudflare Pages Wrangler documentation: a deployed Wrangler config becomes the project's source of truth; preview bindings and variables are not automatically inherited. The downloaded private production config may contain credential values and should **never** be committed or copied to a different project. A second Pages project avoids this configuration-governance migration entirely. Its own project-level Production is an **acceptance-only environment**; it must have no custom domain, payment credential, live R2 bucket, or email provider credentials.

Existing isolated acceptance project: `reasonablenoise-catalog-isolated`, at `reasonablenoise-catalog-isolated.pages.dev`. Do not create another Pages project or alter the original live `reasonablenoise-site` project.

## Existing deployment and remaining owner-controlled acceptance checks

1. Confirm `reasonablenoise-site` production remains on `main`, its `ARTWORK_BUCKET` is intact, and `RN_CATALOG_DB` absent in fresh config export.
2. **Already completed per owner screenshots:** a separate Pages project named `reasonablenoise-catalog-isolated` exists and serves the feature branch with `npm run build` and output `dist`. This isolated project's *own* production branch is not the live `reasonablenoise-site` production branch. Re-verify these settings read-only before further acceptance. Do not add custom domains or import provider secrets.
3. **Outstanding / HOLD:** prove separate Cloudflare Access protection of the canonical `reasonablenoise-catalog-isolated.pages.dev` host **and** required deployment subdomains. Earlier self-hosted Access creation failed because the email Include policy was empty and Cloudflare rejected the `pages.dev` wildcard as outside the zone. The existing `*.reasonablenoise-site.pages.dev` Access app does not cover this project. Cloudflare Pages `Restrict previews` alone protects preview deployment URLs, not the canonical host. Use a Cloudflare-supported method for the canonical host; restrict by approved email and no bypass. Never assume that a 503 JSON response is evidence of edge Access enforcement.
4. **Outstanding / HOLD:** after Access proof, bind `RN_CATALOG_DB` to the dedicated D1 `reasonablenoise-catalog-preview` (database created, migration not run) on this isolated project alone. Leave `RN_CATALOG_ADMIN_ENABLED=false` while proving the boundary. Never configure `ARTWORK_BUCKET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, or production admin tokens here.
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

**Current status: independent Pages site deployed and visually inspected. Access edge enforcement unverified. Isolated D1 created but no approved binding/migration evidence. No catalog admin activation. Existing live Production HOLD.**
