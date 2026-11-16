# RN-3B1C Phase 5 — local disposable Workerd D1 / R2 probes

Dependent **draft** into Phase 4 PR #16 branch. The eight tests run Cloudflare's local Miniflare Workerd emulator with ephemeral TEST_D1 and TEST_R2 bindings. There is no production account binding, remote D1 identifier, customer storage or Stripe request.

- Applies the actual Phase 3 D1 SQL migration locally.
- Uses Phase 3 durable adapter for PNG SHA-256 validation, R2 readback, private artwork binding, and one-time consumption.
- A test-only local Worker (embedded string, NOT a published endpoint) submits conditional SQL updates and R2 lookups to the same Miniflare bindings to test concurrent SQL replay fencing.
- Tests foreign owner, expiration, corruption, deletion, CHECK and UNIQUE constraints.
- **Important:** the test Worker CAS endpoint does not itself validate the artwork bytes. It tests D1 atomicity separately from the host adapter's full validation. Never deploy this test handler. No claim of authenticated end-to-end production authorization.
- Miniflare is local emulation rather than remote Cloudflare D1/R2. Object overwrite race protection, orphan sweep, authenticated end-to-end ownership and Stripe idempotency remain separate gates.

## Windows independent verification
Run only against disposable local emulator. Install without saving dependency/lockfile changes:
\`\`\`powershell
cd C:\Users\emmli\Documents\ReasonableNoise\reasonablenoise-site
git fetch origin
git switch --track origin/feature/rn-3b1c-phase5-local-workerd-20261115
npm install --no-save --package-lock=false miniflare@4
node --test .\tests\dtf-artwork-miniflare-rn3b1c.test.mjs .\tests\dtf-artwork-sqlite-rn3b1c.test.mjs .\tests\dtf-artwork-durable-rn3b1c.test.mjs .\tests\dtf-artwork-intent-rn3b1c.test.mjs .\tests\dtf-artwork-integrity-rn3b1c.test.mjs .\tests\dtf-artwork-preflight-rn3b1.test.mjs .\tests\dtf-quote-artwork.test.mjs .\tests\stripe-webhook-isolation.test.mjs .\tests\turnstile-admin-cleanup.test.mjs
npm run build
git diff --check origin/feature/rn-3b1c-phase4-disposable-sqlite-20261115...HEAD
git status --short
\`\`\`

Expected 110 tests (102 previously verified plus 8 local integration tests), 11 built pages. Do not use wrangler deploy, D1 remote, production R2, migrations apply or Stripe. No production changes.
