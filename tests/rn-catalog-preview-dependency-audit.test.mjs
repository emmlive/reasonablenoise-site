import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { inventoryPagesFunctions, assessPreviewCompatibility, forbiddenPreviewLiveBindings } from "../scripts/rn-catalog-preview-dependency-audit.mjs";

const inventory = inventoryPagesFunctions(path.resolve("functions/api"));
const routes = inventory.map(x => x.route);

test("all eleven existing API routes audited, including catalog, checkout and webhook", () => {
  assert.equal(inventory.length, 11);
  for (const route of ["/api/admin-products", "/api/catalog", "/api/create-checkout-session", "/api/stripe-webhook", "/api/upload-artwork", "/api/contact"]) {
    assert.ok(routes.includes(route), route);
  }
});
test("preview catalog API remains disabled in isolated Pages acceptance", () => {
  const route = inventory.find(x => x.route === "/api/catalog");
  assert.ok(route);
  assert.ok(route.references.includes("RN_PUBLIC_CATALOG_ENABLED"));
  assert.ok(route.references.includes("RN_CATALOG_DB"));
});
test("Preview-only D1 candidate is NOT falsely certified for entire application", () => {
  const result = assessPreviewCompatibility(inventory, ["RN_CATALOG_DB"]);
  assert.equal(result.catalog_db_bound_in_candidate, true);
  assert.equal(result.audit_result, "PREVIEW_COMPATIBILITY_NOT_ESTABLISHED");
  assert.equal(result.deployment_approved, false);
  for (const route of ["/api/create-checkout-session", "/api/stripe-webhook", "/api/upload-artwork"]) {
    assert.ok(result.routes_with_unprovided_references.some(x => x.route === route), route);
  }
});
test("adding live payment, artwork, or email secrets blocks Preview config", () => {
  for (const secret of forbiddenPreviewLiveBindings) {
    assert.equal(assessPreviewCompatibility(inventory, ["RN_CATALOG_DB", secret]).audit_result, "BLOCKED_LIVE_RESOURCES");
  }
});
test("catalog endpoint requires restricted admin vars beyond a D1 binding", () => {
  const result = assessPreviewCompatibility(inventory, ["RN_CATALOG_DB"]);
  const admin = result.routes_with_unprovided_references.find(x => x.route === "/api/admin-products");
  for (const value of ["RN_CATALOG_ADMIN_ENABLED", "RN_CATALOG_ADMIN_EMAILS", "RN_ACCESS_TEAM_DOMAIN", "RN_ACCESS_AUD"]) {
    assert.ok(admin.missing.includes(value), value);
  }
});
