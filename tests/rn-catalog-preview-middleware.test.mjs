import test from "node:test";
import assert from "node:assert/strict";
import { catalogPreviewDecision, onRequest } from "../functions/api/_middleware.js";

const preview = "https://c8747c4a.reasonablenoise-site.pages.dev";
const prod = "https://reasonablenoise.com";

test("catalog GET/PATCH alone passes Pages Preview middleware", async () => {
  for (const method of ["GET", "PATCH"]) {
    let called = 0;
    const request = new Request(preview + "/api/admin-products", { method });
    assert.equal(catalogPreviewDecision(request), "catalog-pass");
    const response = await onRequest({ request, next: () => { called++; return new Response("CATALOG_HANDLER"); } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "CATALOG_HANDLER");
    assert.equal(called, 1);
  }
});

test("every legacy API route is denied on Preview without calling handler", async () => {
  for (const route of [
    "admin-orders", "backfill-test-order", "contact", "create-checkout-session",
    "download-artwork", "order-status", "stripe-webhook", "track-event", "upload-artwork"
  ]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      let called = 0;
      const request = new Request(preview + "/api/" + route, { method });
      const response = await onRequest({ request, next: () => { called++; return new Response("UNSAFE"); } });
      assert.equal(response.status, 403, route + " " + method);
      assert.equal(called, 0, route + " " + method);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
});

test("rejects other catalog methods, near matches and unknown hosts fail closed", async () => {
  for (const [url, method] of [
    [preview + "/api/admin-products", "POST"],
    [preview + "/api/admin-products", "DELETE"],
    [preview + "/api/admin-products/extra", "GET"],
    [preview + "/api/admin-products%2fextra", "GET"],
    ["https://reasonablenoise-site.pages.dev.evil.test/api/admin-products", "GET"],
    ["http://c8747c4a.reasonablenoise-site.pages.dev/api/admin-products", "GET"],
    ["https://otherproject.pages.dev/api/admin-products", "GET"],
  ]) {
    assert.equal(catalogPreviewDecision(new Request(url, { method })), "deny", url + " " + method);
  }
});

test("forged headers do not bypass Preview isolation", async () => {
  const request = new Request(preview + "/api/stripe-webhook", {
    method: "POST", headers: {
      host: "reasonablenoise.com",
      "cf-pages-branch": "main",
      "cf-access-authenticated-user-email": "admin@example.com",
      "x-forwarded-host": "reasonablenoise.com",
    }
  });
  assert.equal(catalogPreviewDecision(request), "deny");
  let called = false;
  const response = await onRequest({ request, next: () => { called = true; return new Response("UNSAFE"); } });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("known production hosts pass through without altering existing APIs", async () => {
  for (const host of ["reasonablenoise.com", "www.reasonablenoise.com", "reasonablenoise-site.pages.dev"]) {
    const request = new Request("https://" + host + "/api/stripe-webhook", { method: "POST" });
    assert.equal(catalogPreviewDecision(request), "production-pass");
    let called = false;
    const response = await onRequest({ request, next: () => { called = true; return new Response("PROD_HANDLER"); } });
    assert.equal(await response.text(), "PROD_HANDLER");
    assert.equal(called, true);
  }
});

test("local development retains existing handlers without production secrets", () => {
  const request = new Request("http://localhost:8788/api/contact", { method: "POST" });
  assert.equal(catalogPreviewDecision(request), "local-pass");
});

test("independent catalog acceptance project canonical and hashed hosts are catalog-only", async () => {
  const hosts = [
    "reasonablenoise-catalog-isolated.pages.dev",
    "a1b2c3d4.reasonablenoise-catalog-isolated.pages.dev",
    "feature-rn-catalog.reasonablenoise-catalog-isolated.pages.dev",
  ];
  for (const host of hosts) {
    for (const method of ["GET", "PATCH"]) {
      const request = new Request(`https://${host}/api/admin-products`, { method });
      assert.equal(catalogPreviewDecision(request), "catalog-pass", host);
    }
    for (const endpoint of ["stripe-webhook", "upload-artwork", "create-checkout-session", "contact", "order-status"]) {
      let reached = false;
      const request = new Request(`https://${host}/api/${endpoint}`, { method: "POST" });
      const response = await onRequest({request, next: () => { reached = true; return new Response("UNSAFE"); }});
      assert.equal(response.status, 403, host + "/" + endpoint);
      assert.equal(reached, false);
    }
  }
});

test("catalog acceptance domain lookalikes and another Pages project stay denied", () => {
  for (const host of [
    "reasonablenoise-catalog-isolated.pages.dev.evil.test",
    "reasonablenoise-catalog-isolated.evil.pages.dev",
    "other-reasonablenoise-catalog-isolated.pages.dev",
    "otherproject.pages.dev",
  ]) {
    assert.equal(catalogPreviewDecision(new Request(`https://${host}/api/admin-products`)), "deny", host);
  }
});
