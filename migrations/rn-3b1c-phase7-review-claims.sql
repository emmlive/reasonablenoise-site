-- RN-3B1C Phase 7: disposable REVIEW claim state only. DO NOT APPLY to production.
-- Single-row claims are state/audit snapshots, NOT an append-only history.
CREATE TABLE IF NOT EXISTS dtf_artwork_review_claims (
 claim_id TEXT PRIMARY KEY NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 intent_id TEXT,
 operator_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('EXPIRED_UNCONSUMED_INTENT','OLD_UNREFERENCED_OBJECT')),
 state TEXT NOT NULL CHECK(state IN ('claimed','needs_review','closed')),
 claimed_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 CHECK(updated_at >= claimed_at)
);
CREATE INDEX IF NOT EXISTS idx_dtf_review_claim_state ON dtf_artwork_review_claims(state,updated_at);
