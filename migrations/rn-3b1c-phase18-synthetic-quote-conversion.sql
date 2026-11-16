-- RN-3B1C Phase 18: DISPOSABLE-ONLY quote approval and order-conversion model.
-- DO NOT APPLY LIVE. Not the real DTF customer/order database. Not a payment schema.
CREATE TABLE IF NOT EXISTS dtf_test_approved_quotes (
 quote_id TEXT PRIMARY KEY NOT NULL,
 quote_reference TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,
 owner_subject_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 shirt_source TEXT NOT NULL CHECK(shirt_source IN ('provided','customer_supplied')),
 print_placement TEXT NOT NULL CHECK(print_placement IN ('front','back','front_back','custom')),
 sizes_json TEXT NOT NULL,
 color TEXT NOT NULL,
 approved_total_cents INTEGER NOT NULL CHECK(approved_total_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL CHECK(currency='usd'),
 artwork_reviewed INTEGER NOT NULL CHECK(artwork_reviewed IN (0,1)),
 pricing_reviewed INTEGER NOT NULL CHECK(pricing_reviewed IN (0,1)),
 fulfillment_reviewed INTEGER NOT NULL CHECK(fulfillment_reviewed IN (0,1)),
 quote_status TEXT NOT NULL CHECK(quote_status IN ('draft','approved','rejected','cancelled')),
 approved_by TEXT NOT NULL,
 approved_at INTEGER NOT NULL CHECK(approved_at>=0),
 expires_at INTEGER NOT NULL CHECK(expires_at>=0),
 CHECK(expires_at>approved_at OR quote_status<>'approved')
);
CREATE TABLE IF NOT EXISTS dtf_test_conversion_orders (
 order_id TEXT PRIMARY KEY NOT NULL,
 quote_id TEXT NOT NULL UNIQUE,
 quote_reference TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,
 owner_subject_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
 shirt_source TEXT NOT NULL,
 print_placement TEXT NOT NULL,
 sizes_json TEXT NOT NULL,
 color TEXT NOT NULL,
 approved_total_cents INTEGER NOT NULL CHECK(approved_total_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL CHECK(currency='usd'),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 order_status TEXT NOT NULL CHECK(order_status='awaiting_customer_acceptance'),
 checkout_enabled INTEGER NOT NULL DEFAULT 0 CHECK(checkout_enabled=0),
 FOREIGN KEY(quote_id) REFERENCES dtf_test_approved_quotes(quote_id)
);
CREATE TRIGGER IF NOT EXISTS dtf_test_conversion_no_update
BEFORE UPDATE ON dtf_test_conversion_orders BEGIN
 SELECT RAISE(ABORT,'DTF_CONVERSION_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS dtf_test_conversion_no_delete
BEFORE DELETE ON dtf_test_conversion_orders BEGIN
 SELECT RAISE(ABORT,'DTF_CONVERSION_IMMUTABLE');
END;
