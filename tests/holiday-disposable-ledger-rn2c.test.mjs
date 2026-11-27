import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { recordHolidayReviewCandidate,__holiday2c } from "../src/lib/holiday-review-ledger.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const schema=readFileSync(new URL("../migrations/holiday-disposable/0001_review_ledger.sql",import.meta.url),"utf8");
function createDb({faultAfter=-1}={}){
 const raw=new DatabaseSync(":memory:");
 raw.exec(schema);
 let failAt=faultAfter;
 const adapter={
  prepare(sql) {
    return { bind(...args){
      return {sql,args,async first(){return raw.prepare(sql).get(...args)??null;}};
    }};
  },
  async batch(statements){
    raw.exec("BEGIN IMMEDIATE");
    try{
      const result=[];
      for(let i=0;i<statements.length;i++){
        if(i===failAt)throw new Error("synthetic_crash");
        const out=raw.prepare(statements[i].sql).run(...statements[i].args);
        result.push({success:true,meta:{changes:Number(out.changes)}});
      }
      raw.exec("COMMIT");
      return result;
    }catch(e){raw.exec("ROLLBACK");throw e;}
  }
 };
 return {raw,adapter,close:()=>raw.close(),setFault:v=>{failAt=v;}};
}
const reference="RNH-0123456789ABCDEF";
const session="cs_test_holiday_123456";
function candidate(changes={}){
 return {
  status:"hold",reason:"durable_order_idempotency_and_refund_reconciliation_required",
  paymentAuthorized:false,fulfillmentAuthorized:false,emailAuthorized:false,
  deletionAuthorized:false,eventId:"evt_holiday123456",
  orderReference:reference,checkoutSessionId:session,
  units:3,subtotalCents:7200,shippingCents:999,totalCents:8199,
  variants:[
    {id:"reindeer",size:"M",color:"white",quantity:2},
    {id:"owl",size:"XL",color:"heather-gray",quantity:1}
  ],...changes
 };
}
const count=(raw,table)=>raw.prepare("SELECT COUNT(*) n FROM "+table).get().n;
const orders="rn_holiday_review_orders",events="rn_holiday_review_events";
function testHeld(out){
 assert.equal(out.status,"hold");
 for(const key of ["paymentAuthorized","fulfillmentAuthorized","emailAuthorized","deletionAuthorized"])
  assert.equal(out[key],false,key);
}

test("schema creates two isolated review-only tables with unique references",()=>{
 const d=createDb();try{
  assert.equal(count(d.raw,orders),0);
  assert.equal(count(d.raw,events),0);
  assert.match(schema,/checkout_session_id TEXT NOT NULL UNIQUE/);
  assert.match(schema,/order_reference TEXT PRIMARY KEY/);
  assert.match(schema,/event_id TEXT PRIMARY KEY/);
  assert.match(schema,/CHECK\(status = 'review_only'\)/);
  assert.match(schema,/CHECK\(status = 'seen_only'\)/);
 }finally{d.close();}
});
test("default gate fails closed and never touches disposable DB",async()=>{
 const d=createDb();try{
  const out=await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter});
  assert.equal(out.reason,"ledger_disabled");
  assert.equal(count(d.raw,orders),0);assert.equal(count(d.raw,events),0);
 }finally{d.close();}
});
test("reconciled 2B candidate creates only a review order and event, never fulfillment",async()=>{
 const d=createDb();try{
  const out=await recordHolidayReviewCandidate({
    candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  testHeld(out);
  assert.equal(out.reason,"review_only_recorded_no_fulfillment");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
  assert.equal(d.raw.prepare("SELECT status FROM "+orders).get().status,"review_only");
  assert.equal(d.raw.prepare("SELECT status FROM "+events).get().status,"seen_only");
 }finally{d.close();}
});
test("identical webhook replay does not create a second order or event",async()=>{
 const d=createDb();try{
  const run=()=>recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  testHeld(await run());
  const second=await run();
  testHeld(second);
  assert.equal(second.reason,"duplicate_review_event_ignored");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("same order new legitimate event records event but not duplicate order",async()=>{
 const d=createDb();try{
  await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  const out=await recordHolidayReviewCandidate({
    candidate:candidate({eventId:"evt_other123456"}),disposableDb:d.adapter,allowDisposableWrite:true});
  testHeld(out);
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),2);
 }finally{d.close();}
});
test("reused event ID with new order cannot create orphan or claim a different order",async()=>{
 const d=createDb();try{
  await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  const out=await recordHolidayReviewCandidate({candidate:candidate({
    orderReference:"RNH-AAAAAAAAAAAAAAAA",checkoutSessionId:"cs_test_other123456"
  }),disposableDb:d.adapter,allowDisposableWrite:true});
  assert.equal(out.reason,"identity_collision_or_unconfirmed_write");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("same reference with different session cannot create an event or modify order",async()=>{
 const d=createDb();try{
  await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  const out=await recordHolidayReviewCandidate({
    candidate:candidate({eventId:"evt_other123456",checkoutSessionId:"cs_test_other123456"}),
    disposableDb:d.adapter,allowDisposableWrite:true
  });
  assert.equal(out.reason,"identity_collision_or_unconfirmed_write");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("same session with different reference cannot create an event",async()=>{
 const d=createDb();try{
  await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  const out=await recordHolidayReviewCandidate({
    candidate:candidate({eventId:"evt_other123456",orderReference:"RNH-AAAAAAAAAAAAAAAA"}),
    disposableDb:d.adapter,allowDisposableWrite:true
  });
  assert.equal(out.reason,"identity_collision_or_unconfirmed_write");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("amount or variant mutation after first record is blocked without mutation",async()=>{
 const d=createDb();try{
  await recordHolidayReviewCandidate({candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  const modified=candidate({eventId:"evt_other123456",variants:[
    {id:"bear",size:"M",color:"cream",quantity:2},
    {id:"owl",size:"XL",color:"heather-gray",quantity:1}
  ]});
  const out=await recordHolidayReviewCandidate({
    candidate:modified,disposableDb:d.adapter,allowDisposableWrite:true
  });
  assert.equal(out.reason,"identity_collision_or_unconfirmed_write");
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("forced failure after order INSERT rolls back order and event atomically",async()=>{
 const d=createDb({faultAfter:1});try{
  const out=await recordHolidayReviewCandidate({
    candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  assert.equal(out.reason,"atomic_write_failed");
  assert.equal(count(d.raw,orders),0);assert.equal(count(d.raw,events),0);
  d.setFault(-1);
  const retry=await recordHolidayReviewCandidate({
    candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true});
  testHeld(retry);
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("parallel duplicate event submissions cannot exceed one order or event",async()=>{
 const d=createDb();try{
  const calls=Array.from({length:20},()=>recordHolidayReviewCandidate({
    candidate:candidate(),disposableDb:d.adapter,allowDisposableWrite:true}));
  const results=await Promise.all(calls);
  assert.ok(results.every(r=>r.status==="hold"));
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),1);
 }finally{d.close();}
});
test("different events for one order under parallel submissions do not duplicate order",async()=>{
 const d=createDb();try{
  const calls=Array.from({length:12},(_,i)=>recordHolidayReviewCandidate({
    candidate:candidate({eventId:"evt_parallel"+String(i).padStart(6,"0")}),
    disposableDb:d.adapter,allowDisposableWrite:true
  }));
  const results=await Promise.all(calls);
  assert.ok(results.every(r=>r.status==="hold"));
  assert.equal(count(d.raw,orders),1);assert.equal(count(d.raw,events),12);
 }finally{d.close();}
});
test("invalid input fails before database write",async()=>{
 const d=createDb();try{
  for(const changed of [
    {status:"accepted"},{reason:"payment_approved"},
    {fulfillmentAuthorized:true},{paymentAuthorized:true},
    {orderReference:"RN-20261127-1234ABCD"},
    {eventId:"evt_"},{checkoutSessionId:"cs_live_bad"},
    {units:1},{totalCents:1},{shippingCents:0},
    {variants:[{id:"dtf_direct",size:"M",color:"white",quantity:3}]}
  ]){
    const out=await recordHolidayReviewCandidate({
      candidate:candidate(changed),disposableDb:d.adapter,allowDisposableWrite:true});
    assert.equal(out.reason,"invalid_review_candidate",JSON.stringify(changed));
  }
  assert.equal(count(d.raw,orders),0);assert.equal(count(d.raw,events),0);
 }finally{d.close();}
});
test("schema denies a direct privileged status mutation",()=>{
 const d=createDb();try{
  assert.throws(()=>d.raw.prepare("INSERT INTO "+orders+" (order_reference,checkout_session_id,payload_sha256,units,subtotal_cents,shipping_cents,total_cents,status) VALUES (?,?,?,?,?,?,?,?)")
    .run(reference,session,"0".repeat(64),1,2400,999,3399,"fulfilled"));
  assert.equal(count(d.raw,orders),0);
 }finally{d.close();}
});
test("no live route, provider credential, D1 binding, customer PII or send code introduced",()=>{
 const src=readFileSync(new URL("../src/lib/holiday-review-ledger.mjs",import.meta.url),"utf8");
 const sticker=readFileSync(new URL("../functions/api/stripe-webhook.js",import.meta.url),"utf8");
 const checkout=readFileSync(new URL("../functions/api/holiday-checkout.js",import.meta.url),"utf8");
 assert.doesNotMatch(src,/onRequestPost|sk_live_|STRIPE_SECRET_KEY|\.send\(|resend\.com|fetch\s*\(|db\.exec|deleteArtwork/);
 assert.match(sticker,/order_type === "sticker_order"/);
 assert.match(checkout,/RN_HOLIDAY_CHECKOUT_ENABLED/);
 assert.ok(!schema.includes("CREATE TRIGGER"));
 assert.ok(!schema.includes("DROP TABLE"));
 assert.equal(__holiday2c.normalize(candidate()).snapshot.units,3);
});
