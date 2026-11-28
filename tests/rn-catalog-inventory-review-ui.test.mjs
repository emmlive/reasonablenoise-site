import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../src/pages/admin-orders.astro", import.meta.url), "utf8");
const update = readFileSync(new URL("../src/pages/admin-order-update.astro", import.meta.url), "utf8");
const summary = readFileSync(new URL("../functions/api/admin-orders.js", import.meta.url), "utf8");
const statusApi = readFileSync(new URL("../functions/api/order-status.js", import.meta.url), "utf8");

test("admin orders list includes persistent manual inventory review status", () => {
  assert.match(summary, /inventory_review_required: fulfillment\.inventory_review_required === true/);
  assert.match(summary, /inventory_review_reason: fulfillment\.inventory_review_reason/);
  assert.match(admin, /Inventory review required/);
  assert.match(admin, /order\.inventory_review_required/);
});

test("order update page starts review controls hidden until flagged order loaded", () => {
  assert.match(update, /id="inventory-review-panel" class="[^"]*hidden/);
  assert.match(update, /inventoryReviewPanel\.classList\.toggle\("hidden", !requiresReview\)/);
  assert.match(update, /inventoryReviewApprove\.checked = false/);
  assert.match(update, /inventoryReviewNote\.value = ""/);
  assert.match(update, /fulfillment\.inventory_review_required === true/);
});

test("review approval requires explicit checkbox and sends typed explanation only on approval", () => {
  assert.match(update, /inventoryReviewApprove\.checked/);
  assert.match(update, /reviewExplanation\.length < 12/);
  assert.match(update, /inventory_review_resolution: "approved"/);
  assert.match(update, /inventory_review_note: reviewExplanation/);
  assert.match(update, /signed Cloudflare Access administrator session/i);
});

test("server requires verified JWT and explanation before completing a flagged order", () => {
  assert.match(statusApi, /verifyCatalogAdminAccess\(request, env\)/);
  assert.match(statusApi, /inventoryReviewNote\.length < 12/);
  assert.match(statusApi, /INVENTORY_REVIEW_REQUIRED/);
  assert.match(statusApi, /inventory_review_resolved_by = inventoryReviewer/);
  assert.match(statusApi, /"inventory_review_approved"/);
});
