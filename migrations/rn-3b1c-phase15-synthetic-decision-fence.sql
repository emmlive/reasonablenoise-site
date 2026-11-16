-- RN-3B1C Phase 15: disposable decision-time authorization experiment.
-- DO NOT APPLY LIVE. Synthetic session/order authority, NOT production identity.
CREATE TABLE IF NOT EXISTS dtf_test_session_epochs (
 session_id TEXT PRIMARY KEY NOT NULL,
 subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 session_epoch INTEGER NOT NULL CHECK(session_epoch>=1),
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1))
);
CREATE TABLE IF NOT EXISTS dtf_test_order_epochs (
 order_id TEXT PRIMARY KEY NOT NULL,
 owner_subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 order_epoch INTEGER NOT NULL CHECK(order_epoch>=1),
 order_type TEXT NOT NULL CHECK(order_type IN ('dtf_quote','sticker')),
 order_status TEXT NOT NULL CHECK(order_status IN ('draft','artwork_pending','cancelled','paid')),
 active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS dtf_test_auth_decisions (
 decision_id TEXT PRIMARY KEY NOT NULL,
 replay_id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL,
 order_id TEXT NOT NULL,
 pin_id TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 session_epoch INTEGER NOT NULL,
 order_epoch INTEGER NOT NULL,
 decided_at INTEGER NOT NULL,
 result TEXT NOT NULL CHECK(result='review_only'),
 FOREIGN KEY(session_id) REFERENCES dtf_test_session_epochs(session_id),
 FOREIGN KEY(order_id) REFERENCES dtf_test_order_epochs(order_id),
 FOREIGN KEY(pin_id) REFERENCES dtf_artwork_version_pins(pin_id)
);
CREATE TRIGGER IF NOT EXISTS dtf_test_auth_decision_no_update BEFORE UPDATE ON dtf_test_auth_decisions
BEGIN SELECT RAISE(ABORT,'AUTH_DECISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS dtf_test_auth_decision_no_delete BEFORE DELETE ON dtf_test_auth_decisions
BEGIN SELECT RAISE(ABORT,'AUTH_DECISION_IMMUTABLE'); END;
