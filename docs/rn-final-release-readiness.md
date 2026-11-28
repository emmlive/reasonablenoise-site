# RN Print Shop — Final Release Readiness Decision

**Decision: HOLD production.** This document is a release gate and evidence ledger, not an activation command. Do not treat CI or screenshots as hosted Access/D1 acceptance.

## Frozen scope
- Preserve original production Pages project `reasonablenoise-site` on `main`, the existing Stripe checkout/webhook, R2 artwork, email, and order-status workflows.
- Develop only in Draft PR #71 on `feature/rn-product-catalog-stock-management-20261127`, deployed to independent `reasonablenoise-catalog-isolated.pages.dev` for visual acceptance.
- Keep new production/isolated flags OFF unless separately authorized: `RN_CATALOG_ADMIN_ENABLED`, `RN_PUBLIC_CATALOG_ENABLED`, `RN_CATALOG_CHECKOUT_GATE_ENABLED`, `RN_CATALOG_ORDER_SNAPSHOT_REQUIRED`, `RN_CATALOG_FULFILLMENT_REVIEW_ENABLED`.
- Do not import live Stripe, Resend, R2 artwork, webhook, or emergency admin credentials into the isolated Pages project.
- Gang Sheet visual builder is not implemented. The recovered DTF transfer page supports quote-first artwork/size requests only; isolated preview blocks submissions.
- Catalog products start `draft`. Do not promote them to Available without deliberate pricing, proof and fulfillment review.

## Evidence already obtained
| Check | Evidence | Judgment |
|---|---|---|
| Catalog security, paid snapshot, inventory review, isolated D1 lifecycle | CI on feature branch: 109/109 at commit `eea7b0ed` before this readiness patch | Engineering PASS, not a hosted runtime pass |
| Astro print shop | 14-page build | Engineering PASS |
| Shop desktop, DTF hero, form and corrected contrast | Owner-supplied screenshots of isolated site | Desktop visual PASS for pictured sections, not mobile or submission |
| Initial independent Pages deployment | Owner dashboard and browser screenshots | Isolated website exists |
| Host-specific Access coverage | Earlier Access UI rejected wildcard `pages.dev` and empty Allow policy; no completed authenticated OTP evidence | BLOCKED / unverified |
| Dedicated D1 `reasonablenoise-catalog-preview` | Created, migration not applied; original live project binding removed | Hosted binding/migration acceptance NOT DONE |
| Real Stripe payment, webhook, R2 fulfillment with new catalog flags | Providers intentionally excluded from isolated project; only mock-provider CI | NOT TESTED |
| Live production release | No merge/rollout authorization | HOLD |

## Final consolidated acceptance — strict order

### 1. Immutable production boundary (read only)
- Review original Pages project `reasonablenoise-site`: production branch `main`; original `ARTWORK_BUCKET` still bound; no `RN_CATALOG_DB`; payment and email bindings unchanged. Record names/states only, never secret values.
- Review independent Pages project: hostname `reasonablenoise-catalog-isolated.pages.dev`, source branch pinned to feature branch, no custom domain or live provider credentials. Do not change public production.
- Verify the exact feature commit and CI checks before any acceptance, after each correction.

### 2. Authenticated edge Access boundary (HOLD until verified)
- Apply approved Cloudflare Pages/Zero Trust Access protection for **both the canonical isolated hostname and any deployment preview hostname actually used**. `Restrict previews` alone does not protect the canonical `pages.dev` address.
- Use an Allow policy containing the actual approved administrator email(s), no Everyone or Bypass.
- Demonstrate from a fresh signed-out browser that the canonical site/admin path cannot be reached without the expected Access challenge, and a non-allowlisted identity cannot enter.
- Demonstrate successful approved OTP sign-in and inspect new app's team domain/audience privately. Never expose JWT, AUD, mailbox, or secrets in PR comments.
- Verify a forged email header and emergency token cannot authorize `/api/admin-products`. Do not enable catalog admin merely to bypass a missing Access challenge.
- **Stop** if the canonical project is public and the acceptance requirement is full edge coverage. Public static marketing pages do not prove the admin route is authenticated.

### 3. Isolated D1 binding and migration (only after step 2)
- Bind only `RN_CATALOG_DB` to `reasonablenoise-catalog-preview` on **the isolated Pages project**, not `reasonablenoise-site`; verify binding ID out of band.
- Confirm `RN_CATALOG_ADMIN_ENABLED=false` and forbidden providers remain absent.
- With a separate explicit migration approval, apply `migrations/0001_rn_catalog.sql` to the isolated D1 **only**, verify ten `draft` products, immutable audit triggers, and repeatability. No live D1 migration.
- Exercise authenticated GET and controlled optimistic-version PATCH against disposable records only after edge/identity proof and explicit write authorization; test stale version 409, audit actor, and rollback.

### 4. Release behavior review
- Present Shop price guides as unconfirmed unless `RN_PUBLIC_CATALOG_ENABLED=true` and real D1 reads are verified. Verify no draft/archived product is exposed.
- Review all catalog-to-checkout product IDs and price modes. The new checkout gate and webhook snapshot MUST be activated only with a synchronized secret/flag deployment plan and approved handling for already-open legacy Checkout Sessions. Enabling snapshot-required too early can interrupt legitimate legacy payments.
- Confirm paid-session lifecycle: new out-of-stock checkouts blocked, previously issued sessions honored, inventory changes trigger documented manager review, and marked orders cannot be fulfilled without signed Access admin approval.
- Do not call mock Stripe/Resend/R2 tests a real production payment smoke test.

### 5. Final release authorization
- Owner confirms scope, approved version, QA evidence, rollback actions, and explicit **GO**. Then merge/deploy exact reviewed commit via ordinary protected pipeline.
- Release in bounded stages; keep all new catalog flags OFF immediately after deploy while verifying legacy customer orders work as before.
- Separate feature-activation authorization for catalog admin, public read-only data, and server-side checkout/webhook flags. Never enable several coupled flags as an unreviewed bulk toggle.
- On any failure: stop feature activation, disable new flags, restore exact last-known-good deployment if necessary. Do not disable Access controls or copy production secrets into preview.

## Gate result
`RN_FINAL_RELEASE_READY=NO`

**Primary blockers:** hosted Access evidence, isolated D1 binding/migration evidence, and approved activation/legacy Checkout Session compatibility plan. This document authorizes no actual production configuration change.
