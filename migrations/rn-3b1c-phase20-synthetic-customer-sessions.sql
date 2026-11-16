-- RN-3B1C Phase 20: disposable local customer-session epochs ONLY.
-- DO NOT APPLY LIVE. Never use this as production authentication setup.
CREATE TABLE IF NOT EXISTS dtf_test_customer_sessions_v20 (
 session_id TEXT PRIMARY KEY NOT NULL,
 subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 session_epoch INTEGER NOT NULL CHECK(session_epoch>=1),
 csrf_sha256 TEXT NOT NULL CHECK(length(csrf_sha256)=64),
 expires_at INTEGER NOT NULL CHECK(expires_at>0),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_dtf_test_v20_owner
 ON dtf_test_customer_sessions_v20(subject_id,workspace_id);
