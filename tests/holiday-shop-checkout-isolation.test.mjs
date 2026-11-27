import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost, __holidayTest } from "../functions/api/holiday-checkout.js";

const source = readFileSync(new URL("../functions/api/holiday-checkout.js", import.meta.url), "utf8");
const site = readFileSync(new URL("../src/pages/holiday-shirts.astro", import.meta.url), "utf8");
const sticker = readFileSync(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");
const dtf = readFileSync(new URL("../src/pages/dtf-shirts.astro", import.meta.url), "utf8");
const env = { RN_HOLIDAY_CHECKOUT_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_mock12345", SITE_URL: "https://reasonablenoise.com" };
const good = { items: [{ id: "reindeer", size: "M", color: "white", quantity: 2 }] };

function request(body = good, origin = "https://reasonablenoise.com") {
  return new Request("https://reasonablenoise.com/api/holiday-checkout", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function context(body = good, overrides = {}, origin) {
  return { request: request(body, origin), env: { ...env, ...overrides } };
}

test("holiday payments disabled by default even with Stripe test key", async () => {
  const response = await onRequestPost(context(good, { RN_HOLIDAY_CHECKOUT_ENABLED: "" }));
  assert.equal(response.status, 503);
});

test("live Stripe key rejected even if operator enables holiday gate", async () => {
  const response = await onRequestPost(context(good, { STRIPE_SECRET_KEY: "sk_live_not_allowed" }));
  assert.equal(response.status, 503);
});

test("foreign request origin rejected", async () => {
  assert.equal((await onRequestPost(context(good, {}, "https://attacker.example"))).status, 403);
});

test("bad product, forged price, unsupported size/color and quantity are rejected", () => {
  const invalid = [
    [{ id: "other", size: "M", color: "white", quantity: 1 }],
    [{ id: "reindeer", size: "XXXL", color: "white", quantity: 1 }],
    [{ id: "reindeer", size: "M", color: "black", quantity: 1 }],
    [{ id: "reindeer", size: "M", color: "white", quantity: 0 }],
    [{ id: "reindeer", size: "M", color: "white", quantity: 1.5 }],
    [{ id: "reindeer", size: "M", color: "white", quantity: 13 }],
    Array.from({ length: 13 }, () => ({ id: "reindeer", size: "M", color: "white", quantity: 1 })),
  ];
  for (const cart of invalid) assert.equal(__holidayTest.validateCart(cart), null);
});

test("fake price in browser cart never changes server unit amount", async () => {
  const original = globalThis.fetch;
  let posted;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
      posted = new URLSearchParams(init.body);
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test_fake" }), { status: 200 });
    };
    const response = await onRequestPost(context({ items: [{ ...good.items[0], price: 1, order_type: "sticker_order" }] }));
    assert.equal(response.status, 200);
    assert.equal(posted.get("line_items[0][price_data][unit_amount]"), "2400");
    assert.equal(posted.get("line_items[0][quantity]"), "2");
    assert.equal(posted.get("metadata[order_type]"), "holiday_shirt_test");
    assert.equal(posted.get("metadata[fulfillment_status]"), "manual_review_only");
    assert.equal(posted.get("shipping_address_collection[allowed_countries][0]"), "US");
    assert.equal(posted.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "999");
    assert.match(posted.get("success_url"), /holiday-order-return/);
    assert.doesNotMatch(posted.get("success_url"), /order-success/);
  } finally { globalThis.fetch = original; }
});

test("no Stripe API call occurs on invalid cart", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => { throw Error("must not call Stripe"); };
    assert.equal((await onRequestPost(context({ items: [{ id: "reindeer", size: "M", color: "white", quantity: 999 }] }))).status, 400);
  } finally { globalThis.fetch = original; }
});

test("holiday products are separate from DTF quote-first and sticker fulfillment", () => {
  assert.equal(Object.keys(__holidayTest.PRODUCTS).length, 4);
  assert.equal(__holidayTest.UNIT_CENTS, 2400);
  assert.match(site, /data-add/);
  assert.match(site, /holiday-checkout/);
  assert.match(site, /concept mockups|illustrative concepts/i);
  assert.match(dtf, /Request DTF Order Quote/);
  assert.match(sticker, /order_type === "sticker_order"/);
  assert.doesNotMatch(source, /metadata\[order_type\].*sticker_order/);
  assert.doesNotMatch(source, /sk_live_/);
});
