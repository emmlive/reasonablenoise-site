# RN-3B1C Phase 4 — Disposable SQLite migration and CAS verification

This draft-only milestone extends Phase 3 PR #15. It adds **13 offline tests** that run the *actual* Phase 3 migration and conditional SQL through Node's native SQLite engine, with an in-memory-only database and synthetic private-object adapter.

## Explicit scope
- In-memory SQLite \`DatabaseSync(":memory:")\`. Never opens a production database file or makes a network connection.
- Tests real SQL schema creation and CHECK/UNIQUE constraints, indexed expiry, atomic affected-row compare-and-swap replay fence, rollback, expiration, R2 tampering, insertion error cleanup and orphan deletion failure.
- Synthetic R2 interface: **not real Cloudflare R2**. SQLite engine: **not Cloudflare D1**; this is SQL semantics verification, not actual Workers/D1 distributed-connection consistency.
- No Stripe, customer endpoints, webhooks, Cloudflare binding or deployment change.
- The Phase 3 adapter's dependency-injected authentication and D1-shaped API still need real endpoint/session integration and Cloudflare runtime tests. Cross-worker concurrency and R2 immutability remain unverified.
- Real orphan sweeper and reconciliation are not implemented; the deletion-failure test intentionally demonstrates an unauthorizing leftover private object.

## Windows verification

Node 22 with native experimental SQLite is required. The \`--experimental-sqlite\` flag enables the SQLite module on older compatible Node 22 releases.

\`\`\`powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase4-disposable-sqlite-20261115
node --experimental-sqlite --test .\tests\dtf-artwork-sqlite-rn3b1c.test.mjs .\tests\dtf-artwork-durable-rn3b1c.test.mjs .\tests\dtf-artwork-intent-rn3b1c.test.mjs .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1c-phase3-durable-binding-20261115...HEAD
git status --short
\`\`\`

Target **102/102 tests** (89 previous + 13 new), 11 Astro pages and clean Git state. A Node experimental SQLite warning is expected; it is not itself a failing test.

Next safety gates: disposable genuine D1/Workers tests with least privilege; R2 object lifecycle and immutability; orphan sweeper; authenticated real customer/order binding; separately reviewed checkout idempotency. Nothing is production-approved.
