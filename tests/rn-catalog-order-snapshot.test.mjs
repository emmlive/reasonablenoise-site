import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createCatalogSnapshot, verifyCatalogSnapshot } from "../functions/_catalog-order-snapshot.js";
import { onRequestPost as checkout } from "../functions/api/create-checkout-session.js";
import { onRequestPost as webhook } from "../functions/api/stripe-webhook.js";

const snapshotSecret = "rn-only-disposable-snapshot-key-with-32-characters-minimum";
const webhookSecret = "whsec_disposable_not_real";
const orderReference = "RN-20261127-1ABC2345";
const product = { id: "usdot-sticker-pair", name: "USDOT Sticker Pair", price_cents: 2900, price_mode: "fixed", status: "available", version: 7 };
const price = { label: "USDOT Sticker Pair", amountCents: 2900 };
const decision = { gate_active: true, product_id: product.id, version: product.version, price_cents: product.price_cents, price_mode: product.price_mode };

async function validMetadata() {
  return {
    source: "reasonablenoise", order_type: "sticker_order",
    order_reference: orderReference, sticker_type: "USDOT Sticker Pair",
    checkout_price_label: price.label, checkout_price_cents: "2900",
    fulfillment_method: "local_pickup",
    ...await createCatalogSnapshot(decision, price, orderReference, snapshotSecret),
  };
}
function session(metadata, extra = {}) {
  return {
    id: "cs_test_snapshot", object: "checkout.session", mode: "payment",
    client_reference_id: orderReference,
    amount_total: 2900, amount_subtotal: 2900, currency: "usd",
    payment_status: "paid", customer: null,
    customer_details: { email: "test@example.invalid" },
    metadata, ...extra,
  };
}
async function signedWebhook(event) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + raw));
  const signature = Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, "0")).join("");
  return new Request("https://reasonablenoise.test/api/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": "t=" + timestamp + ",v1=" + signature }, body: raw,
  });
}
function bucket() {
  const entries = new Map();
  const writes = [];
  return {
    writes, entries,
    async get(key) { return entries.has(key) ? { body: entries.get(key) } : null; },
    async put(key, value) { writes.push(key); entries.set(key, value); },
  };
}
async function deliver(metadata, opts = {}) {
  const b = opts.bucket || bucket();
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url) === "https://api.resend.com/emails") return Response.json({ id: "email_mock" });
    throw Error("Unexpected external URL " + url);
  };
  try {
    const event = { id: opts.eventId || "evt_test_snapshot", type: "checkout.session.completed", data: { object: session(metadata, opts.sessionOverrides) } };
    const env = {
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      RN_CATALOG_SNAPSHOT_SECRET: opts.noSecret ? undefined : snapshotSecret,
      RN_CATALOG_ORDER_SNAPSHOT_REQUIRED: opts.required === false ? "false" : "true",
      ARTWORK_BUCKET: b,
      RESEND_API_KEY: "resend_mock_not_real",
      ORDER_NOTIFY_EMAIL: "test@example.invalid",
      ORDER_FROM_EMAIL: "test@example.invalid",
    };
    const response = await webhook({ request: await signedWebhook(event), env });
    return { status: response.status, body: await response.json(), b, calls };
  } finally { globalThis.fetch = original; }
}

test("snapshot signs validated checkout-time ID, revision, price and order reference", async () => {
  const metadata = await validMetadata();
  assert.match(metadata.catalog_snapshot_mac, /^[a-f0-9]{64}$/);
  const checked = await verifyCatalogSnapshot(metadata, session(metadata), snapshotSecret, true);
  assert.equal(checked.ok, true);
  assert.equal(checked.snapshot.product_id, "usdot-sticker-pair");
  assert.equal(checked.snapshot.catalog_version, 7);
  assert.equal(checked.snapshot.catalog_price_cents, 2900);
  assert.equal(checked.snapshot.checkout_cents, 2900);
  assert.equal(checked.snapshot.order_reference, orderReference);
});

test("tampered snapshot, Stripe payment amount or reference fails closed", async () => {
  const metadata = await validMetadata();
  for (const [changed, s] of [
    [{ ...metadata, catalog_price_cents: "2000" }, session(metadata)],
    [{ ...metadata, catalog_product_version: "8" }, session(metadata)],
    [{ ...metadata, catalog_checkout_cents: "1500" }, session(metadata)],
    [metadata, session(metadata, { amount_subtotal: 3000 })],
    [metadata, session(metadata, { client_reference_id: "RN-20261127-FFFFFFFF" })],
    [metadata, session(metadata, { currency: "eur" })],
  ]) {
    assert.equal((await verifyCatalogSnapshot(changed, s, snapshotSecret, true)).ok, false);
  }
});

test("no snapshot is accepted only when enforcement is off", async () => {
  const old = { source: "reasonablenoise", order_reference: orderReference };
  assert.deepEqual(await verifyCatalogSnapshot(old, session(old), undefined, false), { ok: true, legacy: true, snapshot: null });
  assert.equal((await verifyCatalogSnapshot(old, session(old), snapshotSecret, true)).ok, false);
  assert.equal((await verifyCatalogSnapshot({ ...old, catalog_product_id: "usdot-sticker-pair" }, session(old), snapshotSecret, false)).ok, false);
});

test("webhook stores verified snapshot with paid order and preserves original after catalog revision", async () => {
  const metadata = await validMetadata();
  // A later catalog change cannot change the earlier Stripe Checkout snapshot.
  const laterCatalog = { ...product, status: "out_of_stock", price_cents: 3900, version: 8 };
  assert.equal(laterCatalog.version, 8);
  const storage = bucket();
  const outcome = await deliver(metadata, { bucket: storage });
  assert.equal(outcome.status, 200);
  const recordKey = storage.writes.find(key => key.startsWith("orders/status/"));
  assert.ok(recordKey);
  const record = JSON.parse(storage.entries.get(recordKey));
  assert.equal(record.catalog_snapshot.catalog_version, 7);
  assert.equal(record.catalog_snapshot.catalog_price_cents, 2900);
  assert.equal(record.catalog_snapshot.product_id, product.id);
  assert.equal(record.catalog_snapshot.order_reference, orderReference);
  const duplicate = await deliver(metadata, { bucket: storage });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.deepEqual(JSON.parse(storage.entries.get(recordKey)).catalog_snapshot, record.catalog_snapshot);
  assert.equal(storage.writes.filter(key => key === recordKey).length, 1);
});

test("missing or wrong snapshot prevents fulfillment writes, emails and dedup markers", async () => {
  const metadata = await validMetadata();
  for (const opts of [
    { metadata: { ...metadata, catalog_snapshot_mac: "0".repeat(64) } },
    { metadata, noSecret: true },
    { metadata: { ...metadata, catalog_product_version: "99" } },
    { metadata, sessionOverrides: { amount_subtotal: 4900 } },
  ]) {
    const outcome = await deliver(opts.metadata, opts);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.b.writes.length, 0);
    assert.deepEqual(outcome.calls, []);
  }
});

test("actual checkout embeds snapshot only when gate enabled, refuses missing signature secret before Stripe", async () => {
  const original = globalThis.fetch;
  const mockDb = { prepare(sql) { assert.match(sql, /rn_catalog_products/); return { bind(id) { assert.equal(id, product.id); return { async first() { return product; } }; } }; } };
  let called = 0;
  let stripeMetadata;
  globalThis.fetch = async (url, opts) => {
    called++;
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    stripeMetadata = new URLSearchParams(opts.body);
    return Response.json({ id: "cs_test_signed", url: "https://example.invalid/checkout" });
  };
  const request = () => new Request("https://reasonablenoise.test/api/create-checkout-session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerName: "Snapshot Customer", email: "test@example.invalid", stickerType: price.label }),
  });
  try {
    const env = { STRIPE_SECRET_KEY: "sk_mock", RN_CATALOG_CHECKOUT_GATE_ENABLED: "true", RN_CATALOG_DB: mockDb };
    let response = await checkout({ request: request(), env });
    assert.equal(response.status, 503);
    assert.equal(called, 0);
    response = await checkout({ request: request(), env: { ...env, RN_CATALOG_SNAPSHOT_SECRET: snapshotSecret } });
    assert.equal(response.status, 200);
    assert.equal(called, 1);
    assert.match(stripeMetadata.get("metadata[catalog_snapshot_mac]"), /^[a-f0-9]{64}$/);
    assert.equal(stripeMetadata.get("metadata[catalog_product_version]"), "7");
    assert.equal(stripeMetadata.get("metadata[catalog_price_cents]"), "2900");
    const meta = Object.fromEntries([...stripeMetadata.entries()]
      .filter(([k]) => k.startsWith("metadata["))
      .map(([k, v]) => [k.slice(9, -1), v]));
    const ref = stripeMetadata.get("client_reference_id");
    const checked = await verifyCatalogSnapshot(meta, session(meta, { client_reference_id: ref }), snapshotSecret, true);
    assert.equal(checked.ok, true);
  } finally { globalThis.fetch = original; }
});
