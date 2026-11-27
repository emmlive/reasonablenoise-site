import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyHolidayStripeEvent } from "../src/lib/holiday-payment-decision.mjs";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const now = 1795800000;
const secret = "whsec_holiday_test1234";
const reference = "RNH-0123456789ABCDEF";
const checkoutId = "cs_test_holiday_123456";
const event = () => ({
  id: "evt_holiday_123456",
  type: "checkout.session.completed",
  livemode: false,
  data: { object: {
    id: checkoutId, object: "checkout.session", mode: "payment",
    payment_status: "paid", amount_total: 5799, currency: "usd",
    client_reference_id: reference,
    metadata: {
      source: "reasonablenoise", order_type: "holiday_shirt_test",
      fulfillment_status: "manual_review_only", order_reference: reference,
    },
  } },
});
function signed(value, opts={}) {
  const rawBody = typeof value === "string" ? value : JSON.stringify(value);
  const timestamp = opts.timestamp ?? now;
  const signature = createHmac("sha256", opts.secret ?? secret)
    .update(String(timestamp) + "." + rawBody).digest("hex");
  return { rawBody, stripeSignature: "t=" + timestamp + ",v1=" + signature,
    secret, nowSeconds: now };
}
async function decide(value=event(), options={}) {
  return verifyHolidayStripeEvent(signed(value, options));
}
test("genuine offline HMAC positive remains a hold, never fulfillment", async()=>{
  const result = await decide();
  assert.equal(result.status, "hold");
  assert.equal(result.reason, "retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe");
  assert.equal(result.eventId, "evt_holiday_123456");
  assert.equal(result.orderReference, reference);
  for (const k of ["paymentAuthorized","fulfillmentAuthorized","emailAuthorized","deletionAuthorized"])
    assert.equal(result[k],false,k);
});
test("tampered body cannot pass with original HMAC", async()=>{
  const valid = signed(event());
  const changed = valid.rawBody.replace('"paid"','"unpaid"');
  assert.equal((await verifyHolidayStripeEvent({...valid,rawBody:changed})).reason,"invalid_signature");
});
test("incorrect signing secret and signature are blocked", async()=>{
  assert.equal((await decide(event(),{secret:"whsec_otherkey123456"})).reason,"invalid_signature");
  const v=signed(event());
  assert.equal((await verifyHolidayStripeEvent({...v,stripeSignature:"t="+now+",v1="+"0".repeat(64)})).reason,"invalid_signature");
});
test("stale and future Stripe timestamp blocked", async()=>{
  for(const offset of [-301,301]){
    assert.equal((await decide(event(),{timestamp:now+offset})).reason,"invalid_signature");
  }
});
test("duplicate or multiple signature tokens never create authorization", async()=>{
  const v=signed(event());
  const result=await verifyHolidayStripeEvent({...v,stripeSignature:"v1="+"0".repeat(64)+","+v.stripeSignature});
  assert.equal(result.status,"hold");
  assert.equal(result.fulfillmentAuthorized,false);
});
test("malformed and missing event identifiers fail closed", async()=>{
  for(const id of ["","abc","evt_"]){
    const e=event();e.id=id;assert.equal((await decide(e)).status,"blocked");
  }
});
test("live events rejected even with valid synthetic signature", async()=>{
  const e=event();e.livemode=true;
  assert.equal((await decide(e)).reason,"out_of_scope");
});
test("foreign order types and sources cannot become holiday orders", async()=>{
  for(const [field,value] of [["source","virtumotive"],["order_type","sticker_order"],["order_type","dtf_direct"],["fulfillment_status","approved"]]){
    const e=event();e.data.object.metadata[field]=value;
    assert.equal((await decide(e)).reason,"invalid_holiday_session",field);
  }
});
test("unpaid and incorrectly referenced sessions are blocked", async()=>{
  const cases=[
    e=>e.data.object.payment_status="unpaid",
    e=>e.data.object.client_reference_id="RNH-AAAAAAAAAAAAAAAA",
    e=>e.data.object.metadata.order_reference="RN-20261127-AAAA1111",
    e=>e.data.object.id="cs_live_not_allowed",
    e=>e.data.object.mode="subscription",
    e=>e.data.object.amount_total=0,
    e=>e.data.object.currency="eur",
  ];
  for(const change of cases){const e=event();change(e);assert.equal((await decide(e)).reason,"invalid_holiday_session");}
});
test("other checkout, async failures and refunds never authorize fulfillment", async()=>{
  for(const type of ["charge.refunded","checkout.session.expired","checkout.session.async_payment_failed"]){
    const e=event();e.type=type;
    const result=await decide(e);
    assert.equal(result.status,"hold");
    assert.equal(result.reason,"non_payable_event");
    assert.equal(result.fulfillmentAuthorized,undefined);
  }
});
test("unknown events cannot become order records", async()=>{
  const e=event();e.type="invoice.paid";
  assert.equal((await decide(e)).reason,"out_of_scope");
});
test("async payment succeeded still requires retrieval and durable replay fence", async()=>{
  const e=event();e.type="checkout.session.async_payment_succeeded";
  assert.equal((await decide(e)).reason,"retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe");
});
test("malformed signed JSON fails closed", async()=>{
  assert.equal((await verifyHolidayStripeEvent(signed("{oops"))).reason,"invalid_json");
});
test("oversized body and absent credentials rejected without crypto execution", async()=>{
  assert.equal((await verifyHolidayStripeEvent(signed("x".repeat(128001)))).reason,"invalid_input");
  assert.equal((await verifyHolidayStripeEvent({...signed(event()),secret:""})).reason,"invalid_input");
});
test("No production routes, Stripe API, D1, R2, email or checkout activation",()=>{
  const source=readFileSync(new URL("../src/lib/holiday-payment-decision.mjs",import.meta.url),"utf8");
  const sticker=readFileSync(new URL("../functions/api/stripe-webhook.js",import.meta.url),"utf8");
  const checkout=readFileSync(new URL("../functions/api/holiday-checkout.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/onRequestPost|fetch\s*\(|\.prepare\s*\(|\.put\s*\(|sendEmail|resend\.com|stripe\.com\/v1/);
  assert.match(sticker,/order_type === "sticker_order"/);
  assert.match(checkout,/RN_HOLIDAY_CHECKOUT_ENABLED/);
  assert.match(checkout,/holiday_shirt_test/);
  assert.doesNotMatch(source,/paymentAuthorized:\s*true|fulfillmentAuthorized:\s*true/);
});
