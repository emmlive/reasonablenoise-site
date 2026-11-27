# ReasonableNoise Print Library — Verified Access and Versioned Private File Retrieval

**Phase: security-core, TEST ONLY — no public route, upload workflow or production deployment.**

## Scope
Pure module `src/lib/print-library-secure-core.mjs` has two independently testable entry points:
1. `verifyAdminAccessAssertion`: validate an RS256 signed `cf-access-jwt-assertion` cryptographically using **caller-supplied, trusted, pinned Cloudflare Access public JWKS**. Exact issuer and audience; non-expired exp, bounded iat/nbf; matching admin email allowlist and verified signature are mandatory. Never authorize an asserted email header, unsigned JWT, wrong KID, wrong merchant, or order admin fallback token.
2. `readApprovedPrintFile`: given a **previously verified** identity, a **trusted server-owned approval record** passing full rights/physical-proof/SHA-256/version/print-dimensions checks, exact design/version, order linkage, and a private R2 `get` interface, read only the approved `print-library/approved/<design>/<version>/...` file; enforce a capped byte count and SHA-256 full-content checksum before returning raw bytes. Does not authorize printing; caller must separately enforce fulfilled/unpaid/refund order state and log successful download.

## Important safety boundaries
- No `functions/api` route is mounted. The existing /admin-orders dashboard and its legacy admin API authorization are not reused for this new print feature. The legacy API currently decodes JWT claims or accepts an admin token; that is NOT an acceptable security boundary for private production artwork without cryptographic validation.
- This phase has no UI button enabled, no R2 writes, no real approved artwork stored, and no actual provider API calls.
- The test generates a real RSA keypair on the CI runner, signs synthetic JWTs, checks forged/expired/incorrect claims and KID, and uses a mock R2 bucket with synthetic art bytes to test deterministic file-integrity checks.
- No app secrets or JWKS can be guessed or committed. A later staging deployment must use verified Cloudflare Access team/aud configuration and trusted key rotation handling. Independent backend security review is required.
- A later approval ledger needs transactional, append-only audit, human-verified physical proof, trusted rights checks, immutable version IDs, role-based access and order binding. For actual HTTP download, deny unapproved/unpaid/reversed orders, attach `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, private/no-store, and audit each retrieval.
- A later upload service needs safe file-type checks and file integrity proof, isolated staging/private R2, antivirus/scanning controls and no public write path.
- Nothing here fixes or modifies the existing production sticker download/API authentication behavior, and no assertion of safe public exposure is made.

**Release posture:** PR DRAFT, NO DEPLOY, no new HTTP endpoints, print-ready 0. Phase 2I Stripe staging and artwork/physical proofs remain separate gates.

**Design/Fix → Test → Release. No drifting.**
