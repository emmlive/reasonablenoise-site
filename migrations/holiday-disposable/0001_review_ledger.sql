-- RN Holiday 2C — DISPOSABLE/ISOLATED schema only.
-- Do NOT apply to existing production D1 or bind to live Pages Functions.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rn_holiday_review_orders (
  order_reference TEXT PRIMARY KEY
    CHECK(order_reference GLOB 'RNH-[0-9A-F]*' AND length(order_reference) = 20),
  checkout_session_id TEXT NOT NULL UNIQUE
    CHECK(checkout_session_id LIKE 'cs_test_%'),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 12),
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents = units * 2400),
  shipping_cents INTEGER NOT NULL CHECK(shipping_cents = 999),
  total_cents INTEGER NOT NULL CHECK(total_cents = subtotal_cents + shipping_cents),
  status TEXT NOT NULL DEFAULT 'review_only' CHECK(status = 'review_only'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rn_holiday_review_events (
  event_id TEXT PRIMARY KEY CHECK(event_id LIKE 'evt_%'),
  order_reference TEXT NOT NULL REFERENCES rn_holiday_review_orders(order_reference),
  checkout_session_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'seen_only' CHECK(status = 'seen_only'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checkout_session_id) REFERENCES rn_holiday_review_orders(checkout_session_id)
);

CREATE INDEX IF NOT EXISTS rn_holiday_review_events_order
  ON rn_holiday_review_events(order_reference);
