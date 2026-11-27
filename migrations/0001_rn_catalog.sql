-- RN catalog: initial schema only. Apply to disposable D1 first; NEVER apply blindly to production.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rn_catalog_products (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents BETWEEN 0 AND 100000000),
  price_mode TEXT NOT NULL DEFAULT 'quote_only' CHECK (price_mode IN ('fixed','starting_at','quote_only')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('available','out_of_stock','draft','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rn_catalog_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES rn_catalog_products(id),
  actor_email TEXT NOT NULL,
  previous_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  patch_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (next_version = previous_version + 1)
);
CREATE INDEX IF NOT EXISTS rn_catalog_audit_product_idx ON rn_catalog_audit(product_id, id);
CREATE TRIGGER IF NOT EXISTS rn_catalog_audit_no_update BEFORE UPDATE ON rn_catalog_audit BEGIN SELECT RAISE(ABORT, 'audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS rn_catalog_audit_no_delete BEFORE DELETE ON rn_catalog_audit BEGIN SELECT RAISE(ABORT, 'audit records are immutable'); END;

-- Seed as DRAFT, not AVAILABLE: production pricing and checkout aliases need reconciliation.
INSERT OR IGNORE INTO rn_catalog_products(id,name,description,price_cents,price_mode,status) VALUES
('usdot-sticker-pair','USDOT Sticker Pair','Standard USDOT sticker pair',2900,'fixed','draft'),
('extra-usdot-pair','Extra USDOT Pair','Extra matching sticker pair',2500,'fixed','draft'),
('one-side-usdot-replacement','One-Side USDOT Replacement','One replacement decal',1800,'fixed','draft'),
('usdot-business-name-pair','USDOT + Business Name Pair','USDOT pair with business name',3900,'fixed','draft'),
('truck-door-lettering','Truck Door Lettering','Starting price for truck door lettering',6900,'starting_at','draft'),
('custom-business-decals','Custom Business Decals','Starting price for custom decals',3500,'starting_at','draft'),
('fleet-lettering','Fleet Lettering','Starting price per vehicle',5900,'starting_at','draft'),
('logo-sticker-batch','Logo Sticker Batch','Starting price for logo sticker batches',3500,'starting_at','draft'),
('design-cleanup','Design Cleanup','Starting price for design help',1500,'starting_at','draft'),
('dtf-shirts','DTF Shirts','DTF shirt quote requests',0,'quote_only','draft');
