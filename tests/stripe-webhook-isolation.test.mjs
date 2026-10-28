import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { onRequestPost } from "../functions/api/stripe-webhook.js";

const WEBHOOK_SECRET = "whsec_local_test_only";
const ORDER_REFERENCE = "RN-20261028-ABC12345";

function ownSession(overrides = {}) {
  const base = {
    id: "cs_test_reasonablenoise_example",
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    client_reference_id: ORDER_REFERENCE,
    amount_total: 2900,
    amount_subtotal: 2900,
    currency: "usd",
    customer: null,
    customer_details: { name: "Test Buyer", email: "buyer@example.test" },
    metadata: {
      source: "reasonablenoise",
      order_type: "sticker_order",
      order_reference: ORDER_REFERENCE,
      sticker_type: "USDOT Sticker Pair",
      checkout_price_cents: "2900",
      fulfillment_method: "local_pickup",
      email: "buyer@example.test",
      customer_name: "Test Buyer",
    },
  };

  return {
    ...base,
    ...overrides,
    metadata: overrides.metadata === undefined ? base.metadata : overrides.metadata,
  };
}

function eventOf(type, object, id = "evt_test_reasonablenoise_01") {
  return { id, type, data: { object } };
}

async function signedRequest(event) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await webcrypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${raw}`)
  );
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return new Request("https://reasonablenoise.test/api/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${hex}` },
    body: raw,
  });
}

function fakeBucket() {
  const objects = new Map();
  const writes = [];
  return {
    writes,
    async get(key) {
      return objects.has(key) ? { body: objects.get(key) } : null;
    },
    async put(key, value) {
      writes.push(key);
      objects.set(key, value);
    },
  };
}

async function deliver(event, opts = {}) {
  const calls = [];
  const bucket = opts.bucket ?? fakeBucket();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const address = String(url);
    calls.push(address);
    if (address.startsWith("https://api.stripe.com/v1/customers/")) {
      if (opts.customerLookupFails) {
        return new Response(JSON.stringify({ error: "test failure" }), { status: 500 });
      }
      return new Response(JSON.stringify({
        object: "customer",
        metadata: opts.customerMetadata ?? {},
      }), { status: 200 });
    }
    if (address === "https://api.resend.com/emails") {
      return new Response(JSON.stringify({ id: "test_email_id" }), { status: 200 });
    }
    throw new Error("Unexpected external request: " + address);
  };

  try {
    const request = await signedRequest(event);
    const env = {
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_SECRET_KEY: opts.noStripeKey ? "" : "sk_test_not_real",
      RESEND_API_KEY: "re_test_not_real",
      ORDER_NOTIFY_EMAIL: "orders@example.test",
      ORDER_FROM_EMAIL: "ReasonableNoise <orders@example.test>",
      SITE_URL: "https://reasonablenoise.test",
      ARTWORK_BUCKET: bucket,
    };
    const response = await onRequestPost({ request, env });
    return { status: response.status, result: await response.json(), calls, bucket };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertNoSideEffects(outcome) {
  assert.equal(outcome.calls.filter((url) => url.includes("resend.com")).length, 0);
  assert.deepEqual(outcome.bucket.writes, []);
}

test("ignores non-checkout events, including payment intents, charges and invoices", async () => {
  for (const type of [
    "payment_intent.succeeded",
    "charge.succeeded",
    "invoice.paid",
    "invoice.payment_succeeded",
    "checkout.session.async_payment_succeeded",
  ]) {
    const result = await deliver(eventOf(type, ownSession()));
    assert.equal(result.status, 200);
    assert.equal(result.result.ignored, type);
    assertNoSideEffects(result);
    assert.deepEqual(result.calls, []);
  }
});

test("ignores a completed session marked virtumotive", async () => {
  const session = ownSession({
    metadata: { ...ownSession().metadata, source: "virtumotive" },
  });
  const outcome = await deliver(eventOf("checkout.session.completed", session));
  assert.equal(outcome.result.ignored, "excluded_source");
  assertNoSideEffects(outcome);
});

test("ignores sessions without our server-owned source and order-type markers", async () => {
  const metadata = { ...ownSession().metadata };
  delete metadata.source;
  const missingSource = await deliver(eventOf("checkout.session.completed", ownSession({ metadata })));
  assert.equal(missingSource.result.ignored, "unrecognized_checkout");
  assertNoSideEffects(missingSource);

  const wrongType = await deliver(eventOf("checkout.session.completed", ownSession({
    metadata: { ...ownSession().metadata, order_type: "unrelated_order" },
  })));
  assert.equal(wrongType.result.ignored, "unrecognized_checkout");
  assertNoSideEffects(wrongType);
});

test("ignores malformed reference and mismatched client reference", async () => {
  const result = await deliver(eventOf("checkout.session.completed", ownSession({
    client_reference_id: "another_order",
  })));
  assert.equal(result.result.ignored, "unrecognized_checkout");
  assertNoSideEffects(result);
});

test("ignores incomplete payments even with our markers", async () => {
  const result = await deliver(eventOf("checkout.session.completed", ownSession({
    payment_status: "unpaid",
  })));
  assert.equal(result.result.ignored, "unpaid_checkout");
  assertNoSideEffects(result);
});

test("ignores paid sessions belonging to virtumotive customers", async () => {
  const session = ownSession({ customer: "cus_testforeign" });
  const outcome = await deliver(eventOf("checkout.session.completed", session), {
    customerMetadata: { source: "virtumotive" },
  });
  assert.equal(outcome.status, 200);
  assert.equal(outcome.result.ignored, "excluded_customer_source");
  assert.equal(outcome.calls.filter((url) => url.includes("api.stripe.com")).length, 1);
  assertNoSideEffects(outcome);
});

test("also rejects expanded virtumotive customer metadata", async () => {
  const session = ownSession({
    customer: { object: "customer", id: "cus_testforeign", metadata: { source: "virtumotive" } },
  });
  const outcome = await deliver(eventOf("checkout.session.completed", session));
  assert.equal(outcome.result.ignored, "excluded_customer_source");
  assert.deepEqual(outcome.calls, []);
  assertNoSideEffects(outcome);
});

test("fails closed when customer provenance cannot be checked", async () => {
  const session = ownSession({ customer: "cus_testtemporary" });
  const outcome = await deliver(eventOf("checkout.session.completed", session), {
    customerLookupFails: true,
  });
  assert.equal(outcome.status, 503);
  assertNoSideEffects(outcome);
});

test("processes one paid ReasonableNoise session and never emails twice on duplicate delivery", async () => {
  const bucket = fakeBucket();
  const event = eventOf("checkout.session.completed", ownSession());
  const first = await deliver(event, { bucket });
  assert.equal(first.status, 200);
  assert.equal(first.result.success, true);
  assert.equal(first.result.duplicate, false);
  assert.equal(first.calls.filter((url) => url === "https://api.resend.com/emails").length, 2);
  assert.ok(bucket.writes.some((key) => key.startsWith("orders/status/")));
  assert.ok(bucket.writes.some((key) => key.startsWith("system/stripe-events/")));

  const writesBefore = bucket.writes.length;
  const second = await deliver(event, { bucket });
  assert.equal(second.result.duplicate, true);
  assert.equal(second.result.skipped_emails, true);
  assert.equal(second.calls.filter((url) => url === "https://api.resend.com/emails").length, 0);
  assert.equal(bucket.writes.length, writesBefore);
});
