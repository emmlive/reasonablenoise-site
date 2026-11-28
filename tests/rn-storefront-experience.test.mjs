import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet, onRequestPost } from "../functions/api/catalog.js";
import { printShopItems } from "../src/data/printShopCatalog.js";
import { checkoutCatalogIds } from "../functions/_catalog-checkout-gate.js";

const home = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const shop = readFileSync(new URL("../src/pages/shop.astro", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0001_rn_catalog.sql", import.meta.url), "utf8");
const row = {
  id: "usdot-sticker-pair", name: "USDOT Sticker Pair",
  description: "Sample order", image_url: "/assets/rn-logo.png",
  price_cents: 2900, price_mode: "fixed", status: "available",
};
function db(rows = [row], error = false) {
  return {
    prepare(sql) {
      assert.match(sql, /status IN \('available','out_of_stock'\)/);
      assert.doesNotMatch(sql, /SELECT \*/i);
      return { async all() { if (error) throw Error("D1 offline"); return { results: rows }; } };
    },
  };
}
async function data(env) {
  const response = await onRequestGet({ env });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("public catalog is disabled unless explicitly enabled and D1 is attached", async () => {
  assert.equal((await data({})).status, 503);
  assert.equal((await data({ RN_PUBLIC_CATALOG_ENABLED: "false", RN_CATALOG_DB: db() })).status, 503);
  assert.equal((await data({ RN_PUBLIC_CATALOG_ENABLED: "true" })).status, 503);
});

test("public catalog exposes only approved fields, safe image path and no audit/admin data", async () => {
  const response = await data({
    RN_PUBLIC_CATALOG_ENABLED: "true", RN_CATALOG_DB: db([{ ...row, updated_by: "sensitive-admin@example.test", version: 99 }]),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.products, [row]);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("read-only endpoint refuses mutations", async () => {
  assert.equal((await onRequestPost()).status, 405);
});

test("missing/invalid data and D1 faults do not claim live availability", async () => {
  const bad = [
    { ...row, status: "draft" },
    { ...row, status: "archived" },
    { ...row, status: "invalid" },
    { ...row, price_cents: -1 },
    { ...row, image_url: "https://external.invalid/tracker.png" },
    { ...row, image_url: "/assets/logo.svg" },
  ];
  for (const product of bad) {
    const response = await data({ RN_PUBLIC_CATALOG_ENABLED: "true", RN_CATALOG_DB: db([product]) });
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  }
  assert.equal((await data({ RN_PUBLIC_CATALOG_ENABLED: "true", RN_CATALOG_DB: db([row], true) })).status, 503);
});

test("visible available and out-of-stock records can be published without any stock counts", async () => {
  const result = await data({ RN_PUBLIC_CATALOG_ENABLED: "true", RN_CATALOG_DB: db([row, { ...row, id: "extra-usdot-pair", status: "out_of_stock" }]) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.products.map(x => x.status), ["available", "out_of_stock"]);
  assert.ok(result.body.products.every(x => !("stock_count" in x)));
});

test("display price guide matches authoritative catalog seeds, not customer-supplied prices", () => {
  const rows = [...migration.matchAll(/\('([^']+)','[^']+','[^']*',(\d+),'(fixed|starting_at|quote_only)','draft'\)/g)]
    .map(m => ({ id: m[1], amount: Number(m[2]), mode: m[3] }));
  assert.equal(rows.length, printShopItems.length);
  const seeded = new Map(rows.map(x => [x.id, x]));
  for (const product of printShopItems) {
    const match = seeded.get(product.id);
    assert.ok(match, "unseeded displayed product " + product.id);
    assert.equal(product.pricing, match.mode);
    const expectedPrice = match.mode === "quote_only" ? "Quote first" :
      (match.mode === "starting_at" ? "From $" : "$") + (match.amount / 100);
    assert.equal(product.price, expectedPrice);
    if (match.mode !== "quote_only") {
      assert.ok(Object.values(checkoutCatalogIds).includes(product.id), "missing checkout mapping " + product.id);
    }
  }
});

test("light homepage retains SEO, existing quote and ordering flows", () => {
  assert.match(home, /bg-\[#F9FAF8\]/);
  assert.match(home, /href="\/shop"/);
  assert.match(home, /href="\/upload-design"/);
  assert.match(home, /href="\/contact\?topic=dtf"/);
  assert.match(home, /<QuickQuote \/>/);
  assert.match(home, /<BrandAssurance theme="light" \/>/);
  assert.match(home, /<SiteAnalytics \/>/);
  assert.match(home, /<WhatsAppChat \/>/);
  assert.match(home, /"@type": "FAQPage"/);
});

test("shop starts unconfirmed, updates only from public catalog and hides unpublished products", () => {
  assert.match(shop, /Availability unconfirmed/);
  assert.match(shop, /catalogEndpoint = "\/api\/catalog"/);
  assert.match(shop, /const published = new Map/);
  assert.match(shop, /card\.dataset\.unpublished = "true"/);
  assert.match(shop, /status\.textContent = live\.status === "available"/);
  assert.match(shop, /Out of stock/);
  assert.match(shop, /action\.href = "\/contact"/);
  assert.match(shop, /price\.textContent = live\.price_mode/);
  assert.match(shop, /card\.style\.display = show \? "" : "none"/);
  assert.match(shop, /data-shop-filter/);
  assert.match(shop, /aria-pressed/);
  assert.match(shop, /Live product availability is not confirmed/);
  assert.doesNotMatch(shop, /https?:\/\/api\.stripe\.com/);
});

test("apparel card uses full-width desktop feature without breaking category filtering or honest quotes", () => {
  assert.match(shop, /item\.id === "dtf-shirts" \? "lg:col-span-3 lg:flex-row"/);
  assert.match(shop, /item\.id === "dtf-shirts" \? "lg:h-auto lg:min-h-56 lg:w-1\/3 lg:shrink-0"/);
  assert.match(shop, /item\.id === "dtf-shirts" \? "lg:p-8"/);
  assert.match(shop, /card\.dataset\.shopCategory === activeFilter/);
  assert.match(shop, /item\.cta/);
  const apparel = printShopItems.filter(x => x.category === "Apparel");
  assert.equal(apparel.length, 1);
  assert.equal(apparel[0].id, "dtf-shirts");
  assert.equal(apparel[0].pricing, "quote_only");
  assert.equal(apparel[0].href, "/contact?topic=dtf");
});
