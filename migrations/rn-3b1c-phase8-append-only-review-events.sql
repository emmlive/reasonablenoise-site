-- RN-3B1C Phase 8: TEST-ONLY append-only audit migration. DO NOT APPLY LIVE.
-- Apply Phase 7 schema first; all changes thereafter are audit-triggered atomically.
CREATE TABLE IF NOT EXISTS dtf_artwork_review_events (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 claim_id TEXT NOT NULL,
 object_key TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('claimed','stale_recovered')),
 actor_id TEXT NOT NULL,
 old_state TEXT,
 new_state TEXT NOT NULL,
 occurred_at INTEGER NOT NULL,
 CHECK ((event_type='claimed' AND old_state IS NULL AND new_state='claimed')
    OR (event_type='stale_recovered' AND old_state='claimed' AND new_state='needs_review'))
);
CREATE INDEX IF NOT EXISTS idx_dtf_review_events_claim ON dtf_artwork_review_events(claim_id,event_id);
CREATE TRIGGER IF NOT EXISTS dtf_review_events_immutable_update
BEFORE UPDATE ON dtf_artwork_review_events BEGIN
 SELECT RAISE(ABORT,'AUDIT_EVENTS_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS dtf_review_events_immutable_delete
BEFORE DELETE ON dtf_artwork_review_events BEGIN
 SELECT RAISE(ABORT,'AUDIT_EVENTS_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS dtf_review_claim_guard_update
BEFORE UPDATE ON dtf_artwork_review_claims
WHEN NOT (OLD.state='claimed' AND NEW.state='needs_review'
 AND OLD.claim_id=NEW.claim_id AND OLD.object_key=NEW.object_key
 AND OLD.intent_id IS NEW.intent_id AND OLD.reason=NEW.reason
 AND OLD.claimed_at=NEW.claimed_at AND NEW.updated_at>=OLD.updated_at+3600000
 AND NEW.attempts=OLD.attempts+1 AND NEW.attempts<=3
 AND NEW.operator_id IS NOT NULL AND length(NEW.operator_id)>0)
BEGIN SELECT RAISE(ABORT,'REVIEW_TRANSITION_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS dtf_review_claim_guard_delete
BEFORE DELETE ON dtf_artwork_review_claims
BEGIN SELECT RAISE(ABORT,'REVIEW_CLAIM_DELETE_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS dtf_review_claim_audit_insert
AFTER INSERT ON dtf_artwork_review_claims BEGIN
 INSERT INTO dtf_artwork_review_events
 (claim_id,object_key,event_type,actor_id,old_state,new_state,occurred_at)
 VALUES(NEW.claim_id,NEW.object_key,'claimed',NEW.operator_id,NULL,NEW.state,NEW.claimed_at);
END;
CREATE TRIGGER IF NOT EXISTS dtf_review_claim_audit_update
AFTER UPDATE ON dtf_artwork_review_claims BEGIN
 INSERT INTO dtf_artwork_review_events
 (claim_id,object_key,event_type,actor_id,old_state,new_state,occurred_at)
 VALUES(NEW.claim_id,NEW.object_key,'stale_recovered',NEW.operator_id,OLD.state,NEW.state,NEW.updated_at);
END;
