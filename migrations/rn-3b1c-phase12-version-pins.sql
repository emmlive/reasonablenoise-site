-- RN-3B1C Phase 12: disposable-only version pins. DO NOT APPLY LIVE.
-- Immutable order-to-object binding; no automatic deletion or checkout authority.
CREATE TABLE IF NOT EXISTS dtf_artwork_version_pins (
 pin_id TEXT PRIMARY KEY NOT NULL,
 intent_id TEXT NOT NULL UNIQUE,
 subject_id TEXT NOT NULL,
 order_id TEXT NOT NULL UNIQUE,
 object_key TEXT NOT NULL UNIQUE,
 object_version TEXT NOT NULL CHECK(length(object_version) BETWEEN 8 AND 256),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 15728640),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
 CHECK(length(pin_id) BETWEEN 8 AND 128),
 CHECK(length(subject_id) BETWEEN 8 AND 128),
 CHECK(length(order_id) BETWEEN 8 AND 128)
);
CREATE TRIGGER IF NOT EXISTS dtf_version_pin_no_update
BEFORE UPDATE ON dtf_artwork_version_pins BEGIN
 SELECT RAISE(ABORT,'VERSION_PIN_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS dtf_version_pin_no_delete
BEFORE DELETE ON dtf_artwork_version_pins BEGIN
 SELECT RAISE(ABORT,'VERSION_PIN_IMMUTABLE');
END;
