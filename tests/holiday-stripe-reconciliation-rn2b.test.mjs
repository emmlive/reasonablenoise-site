import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyHolidayStripeEvent } from "../src/lib/holiday-payment-decision.mjs";
import { reconcileHolidayTestCandidate, verifyRetrievedHolidayOrder, __holiday2b }
  from "../src/lib/holiday-stripe-reconciliation.mjs";
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const t=1795800000;
const reference="RNH-0123456789ABCDEF";
const sessionId="cs_test_holiday_123456";
const secret="whsec_holiday_test1234";
const key="sk_test_disposable_123456";
const products=[
  ["Season's Greetings Tee — M / white",2],
  ["Holiday Hoots Tee — XL / heather-gray",1],
];
const lines=()=>products.map(([description,quantity],i)=>({
  id:"li_test_"+i, object:"item", description, quantity, currency:"usd",
  amount_subtotal:quantity*2400, amount_total:quantity*2400,
  price:{type:"one_time",currency:"usd",unit_amount:2400}
}));
const session=()=>({
  id:sessionId, object:"checkout.session", mode:"payment", livemode:false,
  payment_status:"paid",status:"complete",currency:"usd",amount_subtotal:7200,
  amount_total:8199,shipping_cost:{amount_total:999},
  total_details:{amount_tax:0,amount_discount:0},
  client_reference_id:reference,
  metadata:{source:"reasonablenoise",order_type:"holiday_shirt_test",
    order_reference:reference,fulfillment_status:"manual_review_only"},
  customer_details:{email:"test-customer@example.test"},
  collected_information:{shipping_details:{address:{
    line1:"123 Test Street",city:"Mocktown",state:"IL",
    postal_code:"60544",country:"US"
  }}},
});
const event=()=>({
 id:"evt_holiday123456",type:"checkout.session.completed",livemode:false,
 data:{object:{object:"checkout.session",id:sessionId,mode:"payment",
   payment_status:"paid",currency:"usd",amount_total:8199,
   client_reference_id:reference,metadata:session().metadata}}
});
async function signedCandidate(){
 const body=JSON.stringify(event());
 const sig=createHmac("sha256",secret).update(t+"."+body).digest("hex");
 return verifyHolidayStripeEvent({rawBody:body,stripeSignature:"t="+t+",v1="+sig,
   secret,nowSeconds:t});
}
async function valid(){
 return verifyRetrievedHolidayOrder({
   candidate:await signedCandidate(),session:session(),lineItems:lines()});
}
function mockFetch(s=session(),ls=lines(),opts={}){
 const calls=[];
 const fn=async (url,init)=>{
   calls.push({url,init});
   if(opts.throw)throw Error("network disabled in fixture");
   if(opts.fail)return new Response("fail",{status:503});
   const isLines=url.endsWith("/line_items?limit=100");
   const json=isLines?{object:"list",data:ls,has_more:opts.hasMore??false}:s;
   return new Response(JSON.stringify(json),{status:200,headers:{"content-type":"application/json"}});
 };
 return {calls,fn};
}
const assertHold=(out,reason="durable_order_idempotency_and_refund_reconciliation_required")=>{
 assert.equal(out.status,"hold");
 assert.equal(out.reason,reason);
 for(const k of ["paymentAuthorized","fulfillmentAuthorized","emailAuthorized","deletionAuthorized"])
   assert.equal(out[k],false,k);
};

test("Phase 2A authentic signed paid event is only a retrieval candidate", async()=>{
 const c=await signedCandidate();
 assert.equal(c.status,"hold");
 assert.equal(c.fulfillmentAuthorized,false);
 assert.equal(c.checkoutSessionId,sessionId);
});
test("signed candidate + Stripe-retrieved session and line items reconcile only to HOLD",async()=>{
 const out=await valid();
 assertHold(out);
 assert.equal(out.units,3);assert.equal(out.subtotalCents,7200);
 assert.equal(out.totalCents,8199);assert.equal(out.shippingCents,999);
 assert.equal(out.orderReference,reference);
 assert.deepEqual(out.variants,[
  {id:"reindeer",size:"M",color:"white",quantity:2},
  {id:"owl",size:"XL",color:"heather-gray",quantity:1}]);
 assert.doesNotMatch(JSON.stringify(out),/test-customer@|123 Test Street/);
});
test("read-only Stripe lookup requests exact session and line-item resources",async()=>{
 const {fn,calls}=mockFetch();
 const result=await reconcileHolidayTestCandidate({
  candidate:await signedCandidate(),stripeTestKey:key,fetcher:fn,allowIsolatedRead:true});
 assertHold(result);
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,"https://api.stripe.com/v1/checkout/sessions/"+sessionId);
 assert.equal(calls[1].url,"https://api.stripe.com/v1/checkout/sessions/"+sessionId+"/line_items?limit=100");
 assert.ok(calls.every(c=>c.init.method==="GET"));
 assert.ok(calls.every(c=>c.init.headers.authorization==="Bearer "+key));
});
test("lookup disabled by default even with test key and injected fetch",async()=>{
 const {fn,calls}=mockFetch();
 const result=await reconcileHolidayTestCandidate({
  candidate:await signedCandidate(),stripeTestKey:key,fetcher:fn});
 assert.equal(result.reason,"retrieval_disabled");assert.equal(calls.length,0);
});
test("live or invalid Stripe key never performs retrieval",async()=>{
 for(const bad of ["sk_live_malicious123","",undefined,"pk_test_bad"]){
  const {fn,calls}=mockFetch();
  const result=await reconcileHolidayTestCandidate({
   candidate:await signedCandidate(),stripeTestKey:bad,fetcher:fn,allowIsolatedRead:true});
  assert.equal(result.reason,"retrieval_disabled");assert.equal(calls.length,0);
 }
});
test("forged unsigned object cannot act as a reconciled candidate",async()=>{
 const {fn,calls}=mockFetch();
 for(const bad of [null,{},{status:"accepted",checkoutSessionId:sessionId,orderReference:reference},
  {status:"hold",reason:"other",checkoutSessionId:sessionId,orderReference:reference}]){
  const result=await reconcileHolidayTestCandidate({
   candidate:bad,stripeTestKey:key,fetcher:fn,allowIsolatedRead:true});
  assert.equal(result.reason,"retrieval_disabled");
 }
 assert.equal(calls.length,0);
});
test("session substitutions, live mode, failed payment and mismatched references block",async()=>{
 const cases=[
  s=>s.id="cs_test_another123456",
  s=>s.livemode=true,
  s=>s.mode="subscription",
  s=>s.status="open",
  s=>s.payment_status="unpaid",
  s=>s.metadata.source="other",
  s=>s.metadata.order_type="sticker_order",
  s=>s.metadata.order_type="dtf_direct",
  s=>s.metadata.order_reference="RNH-FFFFFFFFFFFFFFFF",
  s=>s.client_reference_id="RNH-FFFFFFFFFFFFFFFF",
  s=>s.metadata.fulfillment_status="approved",
 ];
 for(const change of cases){const s=session();change(s);
  const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:s,lineItems:lines()});
  assert.equal(out.reason,"retrieved_session_mismatch");
 }
});
test("unpaid and revoked payment status never authorize emails",async()=>{
 const s=session();s.payment_status="unpaid";
 const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:s,lineItems:lines()});
 assert.equal(out.status,"blocked");assert.equal(out.emailAuthorized,false);
});
test("missing or invalid shipping address or customer email blocks",async()=>{
 for(const change of [
  s=>delete s.customer_details.email,
  s=>s.customer_details.email="bad",
  s=>s.collected_information.shipping_details.address.country="CA",
  s=>s.collected_information.shipping_details.address.line1="",
  s=>s.collected_information.shipping_details.address.postal_code="not-zip",
  s=>s.collected_information.shipping_details.address.state="",
 ]){
  const s=session();change(s);
  const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:s,lineItems:lines()});
  assert.equal(out.reason,"missing_verified_shipping_contact");
 }
});
test("item forgery, unknown designs and variants block",async()=>{
 const cases=[
  l=>l[0].description="Fake Custom DTF tee — M / white",
  l=>l[0].description="Season's Greetings Tee — 4XL / white",
  l=>l[0].description="Season's Greetings Tee — M / purple",
  l=>l[0].price.unit_amount=1,
  l=>l[0].price.currency="eur",
  l=>l[0].price.type="recurring",
  l=>l[0].quantity=0,
  l=>l[0].quantity=13,
  l=>l[0].amount_total=1,
  l=>l[0].amount_subtotal=1,
  l=>l[0].object="discount",
 ];
 for(const change of cases){const ls=lines();change(ls);
  const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:session(),lineItems:ls});
  assert.equal(out.reason,"invalid_line_items");
 }
});
test("empty and oversized line item lists, total units over 12 block",async()=>{
 for(const items of [[],Array.from({length:13},()=>lines()[0]),
   [{...lines()[0],quantity:12,amount_subtotal:28800,amount_total:28800},lines()[1]]]){
  const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:session(),lineItems:items});
  assert.equal(out.reason,"invalid_line_items");
 }
});
test("server subtotal, shipping, tax and discounts must reconcile exactly",async()=>{
 for(const change of [
  s=>s.amount_subtotal=7199,s=>s.amount_total=8200,
  s=>s.shipping_cost.amount_total=0,s=>s.total_details.amount_tax=100,
  s=>s.total_details.amount_discount=100
 ]){
  const s=session();change(s);
  const out=verifyRetrievedHolidayOrder({candidate:await signedCandidate(),session:s,lineItems:lines()});
  assert.equal(out.reason,"amount_mismatch");
 }
});
test("Stripe pagination/truncation fail closed",async()=>{
 const {fn}=mockFetch(session(),lines(),{hasMore:true});
 const out=await reconcileHolidayTestCandidate({
  candidate:await signedCandidate(),stripeTestKey:key,fetcher:fn,allowIsolatedRead:true});
 assert.equal(out.reason,"line_items_lookup_failed");
});
test("failed or malformed session and line-item retrieval fail closed",async()=>{
 for(const option of [{fail:true},{throw:true}]){
  const {fn}=mockFetch(session(),lines(),option);
  const out=await reconcileHolidayTestCandidate({
   candidate:await signedCandidate(),stripeTestKey:key,fetcher:fn,allowIsolatedRead:true});
  assert.equal(out.reason,"session_lookup_failed");
 }
 const {fn}=mockFetch({...session(),id:"cs_test_wrong123456"});
 const out=await reconcileHolidayTestCandidate({
  candidate:await signedCandidate(),stripeTestKey:key,fetcher:fn,allowIsolatedRead:true});
 assert.equal(out.reason,"session_lookup_failed");
});
test("isolation: no production holiday webhook, D1, R2, email, or live Stripe activation",()=>{
 const src=readFileSync(new URL("../src/lib/holiday-stripe-reconciliation.mjs",import.meta.url),"utf8");
 const checkout=readFileSync(new URL("../functions/api/holiday-checkout.js",import.meta.url),"utf8");
 const sticker=readFileSync(new URL("../functions/api/stripe-webhook.js",import.meta.url),"utf8");
 assert.doesNotMatch(src,/onRequestPost|sk_live_|\.prepare\s*\(|\.put\s*\(|sendEmail|resend\.com|fulfillmentAuthorized:\s*true/);
 assert.match(checkout,/RN_HOLIDAY_CHECKOUT_ENABLED/);
 assert.match(sticker,/order_type === "sticker_order"/);
 assert.equal(__holiday2b.PRICE_CENTS,2400);
 assert.equal(__holiday2b.SHIPPING_CENTS,999);
});
