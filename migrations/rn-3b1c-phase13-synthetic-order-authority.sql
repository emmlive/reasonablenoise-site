-- RN-3B1C Phase 13: SYNTHETIC order ownership fixture only.
-- DO NOT APPLY TO PRODUCTION. NOT the live order schema.
CREATE TABLE IF NOT EXISTS dtf_test_order_authority (
 order_id TEXT PRIMARY KEY NOT NULL,
 owner_subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 order_type TEXT NOT NULL CHECK(order_type IN ('dtf_quote','sticker')),
 order_status TEXT NOT NULL CHECK(order_status IN ('draft','artwork_pending','cancelled','paid')),
 is_active INTEGER NOT NULL CHECK(is_active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_dtf_test_order_authority_owner
 ON dtf_test_order_authority(owner_subject_id,workspace_id);
