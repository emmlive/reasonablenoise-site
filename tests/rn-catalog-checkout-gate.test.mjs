import test from "node:test";
import assert from "node:assert/strict";
import { authorizeCatalogCheckout, checkoutCatalogIds } from "../functions/_catalog-checkout-gate.js";
import { onRequestPost } from "../functions/api/create-checkout-session.js";

const pricing = { label: "USDOT Sticker Pair", amountCents: 2900 };
const record = { id: "usdot-sticker-pair", status: "available", price_cents: 2900, price_mode: "fixed", version: 1 };
const db = (row = record, throws = false) => ({
  prepare(sql) {
    assert.match(sql, /WHERE id = \?/);
    return { bind(id) { assert.equal(id, "usdot-sticker-pair"); return {
      async first() { if (throws) throw Error("offline"); return row; },
    }; } };
  }
});

test("gate is opt-in and leaves legacy checkout untouched while disabled", async () => {
  assert.deepEqual(await authorizeCatalogCheckout({}, pricing), { allowed: true, gate_active: false });
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "false" }, pricing)).allowed, true);
});

test("enabled gate allows only available, known, matching fixed price", async () => {
  const result = await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db() }, pricing);
  assert.deepEqual(result, { allowed: true, gate_active: true, product_id: "usdot-sticker-pair", version: 1 });
  assert.equal(Object.keys(checkoutCatalogIds).length, 9);
});

test("unavailable, draft, archived, and absent products block before payment", async () => {
  for (const row of [
    { ...record, status: "out_of_stock" },
    { ...record, status: "draft" },
    { ...record, status: "archived" },
    null,
  ]) {
    const result = await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db(row) }, pricing);
    assert.equal(result.allowed, false);
    assert.equal(result.status, 409);
  }
});

test("unknown server product and missing/failed D1 fail closed", async () => {
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true" }, pricing)).status, 503);
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db(record, true) }, pricing)).status, 503);
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db() }, { label: "Custom Sticker Order Deposit", amountCents: 2500 })).code, "CATALOG_PRODUCT_UNKNOWN");
});

test("fixed price mismatches, quote-only, malformed records fail closed", async () => {
  for (const row of [
    { ...record, price_cents: 1900 },
    { ...record, price_mode: "quote_only" },
    { ...record, version: 0 },
    { ...record, price_mode: "other" },
  ]) {
    const result = await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db(row) }, pricing);
    assert.equal(result.allowed, false);
  }
});

test("starting-at price is a floor, not a silent Stripe price override", async () => {
  const starting = { ...record, price_mode: "starting_at", price_cents: 2500 };
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db(starting) }, pricing)).allowed, true);
  assert.equal((await authorizeCatalogCheckout({ RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: db({ ...starting, price_cents: 3000 }) }, pricing)).code, "PRICE_REVIEW_REQUIRED");
});

function checkoutContext(env, stickerType = "USDOT Sticker Pair") {
  return {
    env,
    request: new Request("https://reasonablenoise.com/api/create-checkout-session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerName: "Test Customer", email: "test@example.invalid", stickerType, quantity: "1" }),
    }),
  };
}

test("actual checkout API never calls Stripe when catalog product is out of stock", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; throw Error("Stripe should never be called"); };
  try {
    const response = await onRequestPost(checkoutContext({
      STRIPE_SECRET_KEY: "mock-test-only",
      RN_CATALOG_CHECKOUT_GATE_ENABLED: "true",
      RN_CATALOG_DB: db({ ...record, status: "out_of_stock" }),
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "PRODUCT_UNAVAILABLE");
    assert.equal(count, 0);
  } finally { globalThis.fetch = original; }
});

test("actual checkout API retains existing Stripe pricing when gate disabled", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, args) => {
    count++;
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    const params = new URLSearchParams(args.body);
    assert.equal(params.get("line_items[0][price_data][unit_amount]"), "2900");
    return Response.json({ url: "https://example.invalid/mock-checkout", id: "cs_mock" });
  };
  try {
    const response = await onRequestPost(checkoutContext({ STRIPE_SECRET_KEY: "mock-test-only" }));
    assert.equal(response.status, 200);
    assert.equal(count, 1);
  } finally { globalThis.fetch = original; }
});
