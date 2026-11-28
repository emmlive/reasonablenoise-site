import test from "node:test";
import assert from "node:assert/strict";
import { classifyPaidCatalogFulfillment } from "../functions/_catalog-fulfillment-review.js";
import { onRequestPost as webhook } from "../functions/api/stripe-webhook.js";
import { onRequestPost as updateOrderStatus } from "../functions/api/order-status.js";
import { webcrypto } from "node:crypto";

const snapshot = Object.freeze({ product_id: "usdot-sticker-pair", catalog_version: 3, catalog_price_cents: 2900, price_mode: "fixed" });
const row = Object.freeze({ id: "usdot-sticker-pair", status: "available", version: 3, price_cents: 2900, price_mode: "fixed" });
const envFor = (r, fault = false) => ({
  RN_CATALOG_FULFILLMENT_REVIEW_ENABLED: "true",
  RN_CATALOG_DB: { prepare(sql) {
    assert.match(sql, /rn_catalog_products/);
    return { bind(id) {
      assert.equal(id, snapshot.product_id);
      return { async first() { if (fault) throw Error("D1 unavailable"); return r; } };
    } };
  } },
});
test("review classification stays inert while disabled or snapshot absent", async () => {
  assert.deepEqual(await classifyPaidCatalogFulfillment({}, snapshot), { required: false, checked: false, reason: "not_enabled" });
  assert.deepEqual(await classifyPaidCatalogFulfillment(envFor(row), null), { required: false, checked: false, reason: "not_enabled" });
});
test("unchanged available catalog record needs no review", async () => {
  const decision = await classifyPaidCatalogFulfillment(envFor(row), snapshot);
  assert.equal(decision.required, false);
  assert.equal(decision.checked, true);
  assert.equal(decision.reason, "catalog_still_available");
});
test("every unavailable state is flagged, while purchase stays valid", async () => {
  for (const status of ["out_of_stock", "draft", "archived"]) {
    const result = await classifyPaidCatalogFulfillment(envFor({ ...row, status }), snapshot);
    assert.equal(result.required, true);
    assert.equal(result.reason, "availability_changed");
    assert.equal(result.observed_status, status);
  }
});
test("catalog revision or price edit after checkout requires review", async () => {
  for (const modified of [
    { version: 4 },
    { price_cents: 3900 },
    { price_mode: "starting_at" },
  ]) {
    const decision = await classifyPaidCatalogFulfillment(envFor({ ...row, ...modified }), snapshot);
    assert.equal(decision.required, true);
    assert.equal(decision.reason, "catalog_revision_changed");
  }
});
test("unknown records, invalid status, missing D1 and D1 failure require review", async () => {
  for (const e of [
    envFor(null),
    envFor({ ...row, status: "unknown" }),
    envFor({ ...row, version: 0 }),
    envFor(row, true),
    { RN_CATALOG_FULFILLMENT_REVIEW_ENABLED: "true" },
  ]) {
    assert.equal((await classifyPaidCatalogFulfillment(e, snapshot)).required, true);
  }
});

// These tests directly exercise the existing order-status route with a flagged
// order and ensure no email or storage write happens before signed approval.
function bucket() {
  const saved = { order_reference: "RN-20261127-ABCDEF12", status: "order_received",
    fulfillment: { inventory_review_required: true, inventory_review_reason: "availability_changed" },
    timeline: [], catalog_snapshot: { ...snapshot } };
  const writes = [];
  return { saved, writes, async get() { return { json: async () => structuredClone(saved) }; },
    async put(_key, value) { writes.push(JSON.parse(value)); } };
}
function request(status, overrides = {}, jwt = "") {
  return new Request("https://test.invalid/api/order-status", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-admin-order-token": "mock-admin",
      ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}),
    },
    body: JSON.stringify({ orderReference: "RN-20261127-ABCDEF12", status, ...overrides }),
  });
}
test("no token-only ready, shipped, or completed transition for a review-required order", async () => {
  for (const status of ["ready_for_pickup", "shipped", "completed"]) {
    const b = bucket();
    const response = await updateOrderStatus({
      request: request(status),
      env: { ARTWORK_BUCKET: b, ADMIN_ORDER_TOKEN: "mock-admin" },
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "INVENTORY_REVIEW_REQUIRED");
    assert.equal(b.writes.length, 0);
  }
});
test("forged or missing reviewer JWT cannot approve stock review", async () => {
  for (const jwt of ["", "x.y.z"]) {
    const b = bucket();
    const response = await updateOrderStatus({
      request: request("shipped", { inventory_review_resolution: "approved", inventory_review_note: "Actual stock checked and cleared." }, jwt),
      env: {
        ARTWORK_BUCKET: b, ADMIN_ORDER_TOKEN: "mock-admin",
        RN_ACCESS_TEAM_DOMAIN: "mock-review.cloudflareaccess.com",
        RN_ACCESS_AUD: "disposable-aud", RN_CATALOG_ADMIN_EMAILS: "admin@example.invalid",
      },
    });
    assert.equal(response.status, 403);
    assert.equal(b.writes.length, 0);
  }
});
