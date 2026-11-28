import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { onRequestPatch as patchCatalog } from "../functions/api/admin-products.js";
import { onRequestPost as startCheckout } from "../functions/api/create-checkout-session.js";
import { onRequestPost as receiveWebhook } from "../functions/api/stripe-webhook.js";
import { onRequestPost as setOrderStatus } from "../functions/api/order-status.js";

const ACCESS_DOMAIN = "catalog-integrated-disposable.cloudflareaccess.com";
const ACCESS_AUD = "rn-disposable-integrated-aud";
const ADMIN_EMAIL = "admin@example.invalid";
const WEBHOOK_KEY = "whsec_disposable_integrated_only";
const SNAPSHOT_KEY = "integrated-disposable-catalog-snapshot-key-at-least-thirty-two";
const PRODUCT_ID = "usdot-sticker-pair";

const migration = readFileSync(new URL("../migrations/0001_rn_catalog.sql", import.meta.url), "utf8")
  .replace(/^\s*--.*$/gm, "")
  .replace(/^\s*PRAGMA foreign_keys\s*=\s*ON;\s*$/gmi, "")
  .trim()
  .split(/(?<=;)\s*\n(?=(?:CREATE|INSERT)\b)/i)
  .map(statement => statement.replace(/\s*\n\s*/g, " ").trim())
  .join("\n");

async function createDatabase() {
  const mf = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('not public')}}",
    compatibilityDate: "2026-08-06",
    d1Databases: { RN_CATALOG_DB: "rn-integrated-disposable" },
  });
  try {
    const db = await mf.getD1Database("RN_CATALOG_DB");
    await db.exec(migration);
    return { mf, db };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

async function signedAccess() {
  const pair = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "integrated-disposable-key";
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://" + ACCESS_DOMAIN,
    aud: ACCESS_AUD, email: ADMIN_EMAIL, exp: Math.floor(Date.now()/1000) + 600,
  })).toString("base64url");
  const message = header + "." + claims;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(message));
  return { token: message + "." + Buffer.from(signature).toString("base64url"), jwk };
}

function catalogEnv(db) {
  return {
    RN_CATALOG_DB: db,
    RN_CATALOG_ADMIN_ENABLED: "true",
    RN_CATALOG_ADMIN_EMAILS: ADMIN_EMAIL,
    RN_ACCESS_TEAM_DOMAIN: ACCESS_DOMAIN,
    RN_ACCESS_AUD: ACCESS_AUD,
  };
}
async function updateStatus(db, token, version, status) {
  const req = new Request("https://catalog.test.invalid/api/admin-products?id=" + PRODUCT_ID, {
    method: "PATCH",
    headers: { "content-type": "application/json", "cf-access-jwt-assertion": token },
    body: JSON.stringify({ version, status }),
  });
  return patchCatalog({ request: req, env: catalogEnv(db) });
}
function mockOrderInput() {
  return new Request("https://catalog.test.invalid/api/create-checkout-session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerName: "Disposable Customer",
      email: "customer@example.invalid",
      stickerType: "USDOT Sticker Pair",
      quantity: "1",
      fulfillmentMethod: "local_pickup",
    }),
  });
}
function checkoutEnv(db) {
  return {
    RN_CATALOG_DB: db,
    RN_CATALOG_CHECKOUT_GATE_ENABLED: "true",
    RN_CATALOG_SNAPSHOT_SECRET: SNAPSHOT_KEY,
    STRIPE_SECRET_KEY: "sk_disposable_no_real_calls",
  };
}
function fakeR2() {
  const values = new Map();
  const writes = [];
  return {
    values, writes,
    async get(key) {
      return values.has(key) ? { body: values.get(key), json: async () => JSON.parse(values.get(key)) } : null;
    },
    async put(key, value) { writes.push(key); values.set(key, String(value)); },
  };
}
async function stripeSigned(event) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await webcrypto.subtle.sign("HMAC", secret,
    new TextEncoder().encode(timestamp + "." + raw));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://catalog.test.invalid/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=" + timestamp + ",v1=" + hex },
    body: raw,
  });
}

test("integrated D1 admin status -> checkout -> stock change -> paid snapshot -> fulfillment (disposable only)", async () => {
  const { mf, db } = await createDatabase();
  const { token, jwk } = await signedAccess();
  const r2 = fakeR2();
  const requests = { stripe: 0, certs: 0, emails: 0 };
  let createdSession;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address === "https://" + ACCESS_DOMAIN + "/cdn-cgi/access/certs") {
      requests.certs++;
      return Response.json({ keys: [jwk] });
    }
    if (address === "https://api.stripe.com/v1/checkout/sessions") {
      requests.stripe++;
      const params = new URLSearchParams(options.body);
      const metadata = Object.fromEntries([...params].filter(([key]) => key.startsWith("metadata["))
        .map(([key, value]) => [key.slice(9, -1), value]));
      createdSession = {
        id: "cs_test_disposable_integrated",
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: params.get("client_reference_id"),
        amount_subtotal: Number(params.get("line_items[0][price_data][unit_amount]")),
        amount_total: Number(params.get("line_items[0][price_data][unit_amount]")),
        currency: "usd",
        customer: null,
        customer_details: { email: "customer@example.invalid", name: "Disposable Customer" },
        metadata,
      };
      return Response.json({ id: createdSession.id, url: "https://checkout.example.invalid/only-test" });
    }
    if (address === "https://api.resend.com/emails") {
      requests.emails++;
      return Response.json({ id: "email_disposable" });
    }
    throw Error("Unexpected provider access: " + address);
  };
  try {
    const seeded = await db.prepare("SELECT status,version,price_cents FROM rn_catalog_products WHERE id=?").bind(PRODUCT_ID).first();
    assert.equal(seeded.status, "draft");
    assert.equal(seeded.version, 1);

    // An authenticated D1 edit promotes this precise product, with an immutable audit record.
    let response = await updateStatus(db, token, 1, "available");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).product.version, 2);
    const stale = await updateStatus(db, token, 1, "available");
    assert.equal(stale.status, 409);

    response = await startCheckout({ request: mockOrderInput(), env: checkoutEnv(db) });
    assert.equal(response.status, 200);
    assert.equal(requests.stripe, 1);
    assert.equal(createdSession.metadata.catalog_product_id, PRODUCT_ID);
    assert.equal(createdSession.metadata.catalog_product_version, "2");
    assert.equal(createdSession.metadata.catalog_price_cents, "2900");

    // Race boundary: once checkout session is created, the customer can still
    // pay it even after availability has changed. Preserve that earlier sale.
    response = await updateStatus(db, token, 2, "out_of_stock");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).product.version, 3);
    response = await startCheckout({ request: mockOrderInput(), env: checkoutEnv(db) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "PRODUCT_UNAVAILABLE");
    assert.equal(requests.stripe, 1, "no second Stripe Checkout session");

    const event = {
      id: "evt_integrated_disposable_1",
      type: "checkout.session.completed",
      data: { object: createdSession },
    };
    const webhookEnv = {
      RN_CATALOG_CHECKOUT_GATE_ENABLED: "true",
      RN_CATALOG_ORDER_SNAPSHOT_REQUIRED: "true",
      RN_CATALOG_SNAPSHOT_SECRET: SNAPSHOT_KEY,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_KEY,
      ARTWORK_BUCKET: r2,
      RESEND_API_KEY: "resend_disposable_only",
      ORDER_NOTIFY_EMAIL: "orders@example.invalid",
      ORDER_FROM_EMAIL: "orders@example.invalid",
    };
    response = await receiveWebhook({ request: await stripeSigned(event), env: webhookEnv });
    assert.equal(response.status, 200);
    const firstWebhook = await response.json();
    assert.equal(firstWebhook.duplicate, false);
    const orderKey = r2.writes.find(key => key.startsWith("orders/status/"));
    assert.ok(orderKey);
    const firstRecord = JSON.parse(r2.values.get(orderKey));
    assert.equal(firstRecord.catalog_snapshot.product_id, PRODUCT_ID);
    assert.equal(firstRecord.catalog_snapshot.catalog_version, 2);
    assert.equal(firstRecord.catalog_snapshot.checkout_cents, 2900);
    assert.equal(firstRecord.catalog_snapshot.catalog_price_cents, 2900);
    assert.equal((await db.prepare("SELECT status,version FROM rn_catalog_products WHERE id=?").bind(PRODUCT_ID).first()).status, "out_of_stock");

    const emailCount = requests.emails;
    response = await receiveWebhook({ request: await stripeSigned(event), env: webhookEnv });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicate, true);
    assert.equal(requests.emails, emailCount);
    assert.equal(r2.writes.filter(key => key === orderKey).length, 1);

    response = await setOrderStatus({
      request: new Request("https://catalog.test.invalid/api/order-status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-order-token": "disposable-admin" },
        body: JSON.stringify({
          orderReference: createdSession.client_reference_id,
          status: "completed",
          catalog_snapshot: { catalog_version: 999 },
        }),
      }),
      env: { ARTWORK_BUCKET: r2, ADMIN_ORDER_TOKEN: "disposable-admin" },
    });
    assert.equal(response.status, 200);
    const final = JSON.parse(r2.values.get(orderKey));
    assert.equal(final.status, "completed");
    assert.deepEqual(final.catalog_snapshot, firstRecord.catalog_snapshot);
    const audits = await db.prepare("SELECT previous_version,next_version FROM rn_catalog_audit WHERE product_id=? ORDER BY id").bind(PRODUCT_ID).all();
    assert.deepEqual(audits.results.map(a => [a.previous_version, a.next_version]), [[1,2],[2,3]]);
    assert.ok(requests.certs >= 2);
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
  }
});
