# RN Holiday 2D — Actual disposable Workerd D1 verification

**Development/test milestone only. NO live Cloudflare D1, Stripe session, checkout, email or deployment.**

## Gate
- Execute the existing Phase 2C JavaScript ledger source inside an actual Miniflare 4/Workerd fetch handler (source-preserving transformation strips ES module export keywords only).
- Use the **exact Phase 2C SQL migration** against a real disposable Miniflare D1 binding `HOLIDAY_DISPOSABLE_D1`, not a mocked `batch` or an in-memory Node `sqlite` adapter.
- Verify: schema and status checks; order/event uniqueness; repeat webhook delivery; concurrent independent Workerd fetches; a different valid event for the same order; reused event ID; wrong checkout session and wrong amount/variants; an intentionally failing second batched SQL statement that must roll back the first; disposal/reopening of Miniflare with the same disposable D1 persistence path.
- Control root isolated under runner temp using pinned `miniflare@4.20260730.0`. The website's `package.json` and lockfile remain unchanged.
- Execute inherited Phase 2C (15 actual isolated Node SQLite contracts), Phase 2B/2A and sticker/DTF commerce regressions (72), Astro 13-page build, no-deploy/no-live key guard.

## Evidence distinctions
This is the **actual locally emulated Cloudflare D1 runtime**, not a remote Cloudflare account database, real production binding, live Stripe order, customer notification, physical shirt stock, or multi-region distributed consistency test.
Workerd concurrency tests operate against one disposable local D1 instance; separate Cloudflare staging runtime/restart/network failure proof remains necessary for a full payment launch.
All Phase 2C order rows remain `review_only`, events remain `seen_only`, and all results deny payment, fulfillment, customer email and artwork deletion authority.

## Production release remains HOLD
PR #59 stacked on #58/#57/#56/#55 must remain draft and undeployed until durable provider test-mode end-to-end verified order lifecycle, actual Stripe webhook route, fulfillment/refund/outbox, product proof, garment inventory, shipping/cutoff/tax/return policy and owner sign-off are complete.

**Design/Fix → Test → Release. No drifting.**
