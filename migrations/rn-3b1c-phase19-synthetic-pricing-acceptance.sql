-- RN-3B1C Phase 19: disposable ONLY. Do not apply to production.
-- Catalog is unapproved by default. Never infer chargeable amounts from 'from' prices.
CREATE TABLE IF NOT EXISTS dtf_test_pricing_catalog (
 catalog_version TEXT PRIMARY KEY NOT NULL,
 currency TEXT NOT NULL CHECK(currency='usd'),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
 approved_by TEXT NOT NULL DEFAULT '',
 approved_at INTEGER NOT NULL DEFAULT 0 CHECK(approved_at>=0),
 requires_manual_quote INTEGER NOT NULL DEFAULT 1 CHECK(requires_manual_quote IN (0,1)),
 CHECK(status<>'approved' OR (approved_by<>'' AND approved_at>0))
);
CREATE TABLE IF NOT EXISTS dtf_test_quote_price_signoff (
 quote_id TEXT PRIMARY KEY NOT NULL,
 catalog_version TEXT NOT NULL,
 reviewed_total_cents INTEGER NOT NULL CHECK(reviewed_total_cents BETWEEN 1 AND 100000000),
 decision TEXT NOT NULL CHECK(decision IN ('pending','approved','withdrawn')),
 signed_by TEXT NOT NULL,
 signed_at INTEGER NOT NULL CHECK(signed_at>=0),
 FOREIGN KEY(quote_id) REFERENCES dtf_test_approved_quotes(quote_id),
 FOREIGN KEY(catalog_version) REFERENCES dtf_test_pricing_catalog(catalog_version)
);
CREATE TABLE IF NOT EXISTS dtf_test_customer_acceptances (
 acceptance_id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL UNIQUE,
 quote_id TEXT NOT NULL UNIQUE,
 catalog_version TEXT NOT NULL,
 customer_subject_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 accepted_total_cents INTEGER NOT NULL CHECK(accepted_total_cents BETWEEN 1 AND 100000000),
 currency TEXT NOT NULL CHECK(currency='usd'),
 accepted_at INTEGER NOT NULL CHECK(accepted_at>0),
 decision TEXT NOT NULL CHECK(decision='customer_quote_accepted_review_only'),
 checkout_enabled INTEGER NOT NULL DEFAULT 0 CHECK(checkout_enabled=0),
 FOREIGN KEY(order_id) REFERENCES dtf_test_conversion_orders(order_id),
 FOREIGN KEY(quote_id) REFERENCES dtf_test_approved_quotes(quote_id),
 FOREIGN KEY(catalog_version) REFERENCES dtf_test_pricing_catalog(catalog_version)
);
CREATE TRIGGER IF NOT EXISTS dtf_customer_acceptance_no_update BEFORE UPDATE ON dtf_test_customer_acceptances
BEGIN SELECT RAISE(ABORT,'CUSTOMER_ACCEPTANCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS dtf_customer_acceptance_no_delete BEFORE DELETE ON dtf_test_customer_acceptances
BEGIN SELECT RAISE(ABORT,'CUSTOMER_ACCEPTANCE_IMMUTABLE'); END;
