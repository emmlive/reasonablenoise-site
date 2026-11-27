import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

const migration = readFileSync(new URL("../migrations/0001_rn_catalog.sql", import.meta.url), "utf8")
  .replace(/^\\s*--.*$/gm, "");
const adminSource = readFileSync(new URL("../functions/api/admin-products.js", import.meta.url), "utf8");
const worker = adminSource + `
export default {
  async fetch(request, env) {
    const context = { request, env };
    if (request.method === "GET") return onRequestGet(context);
    if (request.method === "PATCH") return onRequestPatch(context);
    return new Response("Method not allowed", { status: 405 });
  }
};`;

async function disposable() {
  const mf = new Miniflare({
    modules: true,
    script: worker,
    compatibilityDate: "2026-08-06",
    d1Databases: { RN_CATALOG_DB: "rn-catalog-disposable-test" },
    bindings: {
      RN_CATALOG_ADMIN_ENABLED: "true",
      RN_CATALOG_ADMIN_EMAILS: "admin@example.com",
      RN_ACCESS_TEAM_DOMAIN: "rn-disposable.cloudflareaccess.com",
      RN_ACCESS_AUD: "rn-disposable-test",
      ADMIN_ORDER_TOKEN: "not-valid-for-catalog",
    },
  });
  try {
    const db = await mf.getD1Database("RN_CATALOG_DB");
    await db.exec(migration);
    return { mf, db };
  } catch (e) {
    await mf.dispose();
    throw e;
  }
}

test("isolated workerd D1 migration seeds 10 draft products and is idempotent", async () => {
  const { mf, db } = await disposable();
  try {
    const first = await db.prepare("SELECT COUNT(*) AS n FROM rn_catalog_products WHERE status = 'draft'").first();
    assert.equal(first.n, 10);
    await db.exec(migration);
    const after = await db.prepare("SELECT COUNT(*) AS n FROM rn_catalog_products").first();
    assert.equal(after.n, 10);
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM rn_catalog_audit").first();
    assert.equal(audit.n, 0);
  } finally { await mf.dispose(); }
});

test("actual D1 batch: update + audit, stale optimistic revision creates no audit", async () => {
  const { mf, db } = await disposable();
  try {
    async function update(version, name) {
      return db.batch([
        db.prepare("UPDATE rn_catalog_products SET name=?, version=version+1, updated_by=? WHERE id=? AND version=?")
          .bind(name, "admin@example.com", "usdot-sticker-pair", version),
        db.prepare("INSERT INTO rn_catalog_audit(product_id,actor_email,previous_version,next_version,patch_json) SELECT id,?,?,version,? FROM rn_catalog_products WHERE id=? AND version=? AND updated_by=? AND changes()=1")
          .bind("admin@example.com", version, JSON.stringify({name}), "usdot-sticker-pair", version+1, "admin@example.com"),
      ]);
    }
    const success = await update(1, "Updated USDOT");
    assert.equal(success[0].meta.changes, 1);
    assert.equal(success[1].meta.changes, 1);
    const stale = await update(1, "Stale title");
    assert.equal(stale[0].meta.changes, 0);
    assert.equal(stale[1].meta.changes, 0);
    const row = await db.prepare("SELECT name,version FROM rn_catalog_products WHERE id=?").bind("usdot-sticker-pair").first();
    assert.deepEqual({ name:row.name, version:row.version }, { name:"Updated USDOT", version:2 });
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM rn_catalog_audit").first();
    assert.equal(audit.n, 1);
    await assert.rejects(db.prepare("DELETE FROM rn_catalog_audit").run());
    await assert.rejects(db.prepare("UPDATE rn_catalog_audit SET actor_email='hijack'").run());
  } finally { await mf.dispose(); }
});

test("real workerd HTTP handler denies missing credentials, forged headers, and emergency order token", async () => {
  const { mf } = await disposable();
  try {
    const url = "https://local-test.invalid/api/admin-products?id=usdot-sticker-pair&token=not-valid-for-catalog";
    const req = new Request(url, { method:"PATCH", headers: {
      "cf-access-authenticated-user-email":"admin@example.com",
      "x-admin-order-token":"not-valid-for-catalog",
      "content-type":"application/json",
    }, body: JSON.stringify({ version:1, name:"Bad edit" }) });
    const result = await mf.dispatchFetch(req);
    assert.equal(result.status, 401);
    assert.equal((await mf.dispatchFetch(new Request(url))).status, 401);
  } finally { await mf.dispose(); }
});

test("real D1 batch rolls back when audit insert is forbidden", async () => {
  const { mf, db } = await disposable();
  try {
    await assert.rejects(db.batch([
      db.prepare("UPDATE rn_catalog_products SET status='available', version=version+1 WHERE id='dtf-shirts'"),
      db.prepare("INSERT INTO rn_catalog_audit(product_id,actor_email,previous_version,next_version,patch_json) VALUES ('missing-product','admin@example.com',1,2,'{}')"),
    ]));
    const row = await db.prepare("SELECT status, version FROM rn_catalog_products WHERE id='dtf-shirts'").first();
    assert.equal(row.status, "draft");
    assert.equal(row.version, 1);
  } finally { await mf.dispose(); }
});
