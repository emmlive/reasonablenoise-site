-- RN-3B1C Phase 3 only: review-only migration, DO NOT APPLY to production.
-- D1 SQLite: ownership is enforced in the server adapter, never via browser claims.
CREATE TABLE IF NOT EXISTS dtf_artwork_intents (
 intent_id TEXT PRIMARY KEY NOT NULL,
 version INTEGER NOT NULL CHECK(version=1),
 subject_id TEXT NOT NULL,
 order_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 15728640),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','consumed')),
 consumed_at INTEGER,
 CHECK(expires_at > created_at),
 CHECK((status='issued' AND consumed_at IS NULL) OR (status='consumed' AND consumed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_dtf_intents_expiry ON dtf_artwork_intents(expires_at,status);
