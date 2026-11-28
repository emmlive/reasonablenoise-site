import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/admin-catalog.astro", import.meta.url), "utf8");

test("catalog management UI is noindex and initially locked", () => {
  assert.match(source, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(source, /id="product-fields" disabled/);
  assert.match(source, /Products &amp; availability/);
  assert.match(source, /Catalog administration is disabled or not configured/);
});
test("only existing protected catalog API can read and write", () => {
  assert.match(source, /const endpoint = "\/api\/admin-products"/);
  assert.match(source, /method: "GET", credentials: "same-origin"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.doesNotMatch(source, /\/api\/create-checkout-session|\/api\/stripe-webhook|\/api\/upload-artwork/);
});
test("editing uses server version, strict cents and conflict refresh", () => {
  assert.match(source, /version: selected\.version/);
  assert.match(source, /Number\.isSafeInteger\(cents\)/);
  assert.match(source, /Math\.abs\(numericPrice \* 100 - cents\)/);
  assert.match(source, /response\.status === 409/);
  assert.match(source, /if \(conflicted\) void load\(\)/);
  assert.match(source, /body\.product\.id !== selected\.id/);
});
test("renders product fields as text nodes, not injected markup", () => {
  assert.match(source, /title\.textContent = product\.name/);
  assert.match(source, /meta\.textContent = formatPrice\(product\)/);
  assert.match(source, /notice\.textContent = message/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
});
test("explicit inventory states and missing live checkout integration notice", () => {
  for (const status of ["draft", "available", "out_of_stock", "archived"]) {
    assert.match(source, new RegExp('value="' + status + '"'));
  }
  assert.match(source, /Availability edits do not yet control the existing checkout/);
});
