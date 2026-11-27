"""Disposable SQLite verification for the RN D1 schema. No external services."""
from pathlib import Path
import sqlite3
import unittest

SQL = Path(__file__).resolve().parents[1].joinpath("migrations/0001_rn_catalog.sql").read_text(encoding="utf-8")

class CatalogMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SQL)

    def tearDown(self):
        self.db.close()

    def test_seed_draft_only_and_idempotent(self):
        rows = self.db.execute("SELECT id, status FROM rn_catalog_products").fetchall()
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(status == "draft" for _, status in rows))
        self.db.executescript(SQL)
        self.assertEqual(self.db.execute("SELECT count(*) FROM rn_catalog_products").fetchone()[0], 10)

    def test_invalid_price_and_status_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE rn_catalog_products SET price_cents=-1 WHERE id='usdot-sticker-pair'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE rn_catalog_products SET status='unexpected' WHERE id='usdot-sticker-pair'")

    def test_version_conflict_and_atomic_audit(self):
        args = ("Available", "admin@example.com", "usdot-sticker-pair", 1)
        with self.db:
            self.db.execute("UPDATE rn_catalog_products SET name=?, updated_by=?, version=version+1 WHERE id=? AND version=?", args)
            self.db.execute(
                "INSERT INTO rn_catalog_audit(product_id,actor_email,previous_version,next_version,patch_json) "
                "SELECT id,?,1,version,'{}' FROM rn_catalog_products WHERE id=? AND version=2 AND updated_by=? AND changes()=1",
                ("admin@example.com","usdot-sticker-pair","admin@example.com")
            )
        self.assertEqual(self.db.execute("SELECT count(*) FROM rn_catalog_audit").fetchone()[0], 1)
        with self.db:
            result = self.db.execute("UPDATE rn_catalog_products SET name=?,updated_by=?,version=version+1 WHERE id=? AND version=?", args)
            self.assertEqual(result.rowcount, 0)
            self.db.execute(
                "INSERT INTO rn_catalog_audit(product_id,actor_email,previous_version,next_version,patch_json) "
                "SELECT id,?,1,version,'{}' FROM rn_catalog_products WHERE id=? AND version=2 AND updated_by=? AND changes()=1",
                ("admin@example.com","usdot-sticker-pair","admin@example.com")
            )
        self.assertEqual(self.db.execute("SELECT count(*) FROM rn_catalog_audit").fetchone()[0], 1)

    def test_audit_immutable(self):
        with self.db:
            self.db.execute("INSERT INTO rn_catalog_audit(product_id,actor_email,previous_version,next_version,patch_json) VALUES ('usdot-sticker-pair','admin@example.com',1,2,'{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM rn_catalog_audit")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE rn_catalog_audit SET actor_email='other'")

if __name__ == "__main__":
    unittest.main()
