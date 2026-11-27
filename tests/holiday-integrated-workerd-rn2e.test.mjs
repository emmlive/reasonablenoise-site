// RN Holiday 2E — true locally emulated Workerd D1 integration; synthetic Stripe only.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,
  "node_modules","miniflare","dist","src","index.js")).href);
const {build}=await import(pathToFileURL(resolve(root,
  "node_modules","esbuild","lib","main.js")).href);
const secret="whsec_holiday_isolated12345",stripeKey="sk_test_isolated12345",now=1795800000;
const reference="RNH-0123456789ABCDEF",sid="cs_test_holiday_123456";
const metadata={
  source:"reasonablenoise",order_type:"holiday_shirt_test",
  fulfillment_status:"manual_review_only",order_reference:reference
};
const sampleSession={
  object:"checkout.session",id:sid,livemode:false,mode:"payment",
  payment_status:"paid",status:"complete",currency:"usd",
  amount_subtotal:7200,amount_total:8199,
  total_details:{amount_tax:0,amount_discount:0},
  shipping_cost:{amount_total:999},client_reference_id:reference,
  metadata,
  customer_details:{email:"synthetic@example.test"},
  collected_information:{shipping_details:{address:{
    line1:"123 Test Street",city:"Mocktown",state:"IL",
    postal_code:"60544",country:"US"
  }}}
};
const sampleLines=[
  {object:"item",description:"Season's Greetings Tee — M / white",quantity:2,
   currency:"usd",amount_subtotal:4800,amount_total:4800,
   price:{type:"one_time",currency:"usd",unit_amount:2400}},
  {object:"item",description:"Holiday Hoots Tee — XL / heather-gray",quantity:1,
   currency:"usd",amount_subtotal:2400,amount_total:2400,
   price:{type:"one_time",currency:"usd",unit_amount:2400}}
];
const migration=readFileSync(new URL("../migrations/holiday-disposable/0001_review_ledger.sql",import.meta.url),"utf8");
function statements(){
  const cleaned=migration.split(/\r?\n/).filter(l=>!/^\s*--/.test(l)).join("\n");
  const parts=cleaned.split(";").map(x=>x.trim()).filter(Boolean);
  assert.equal(parts.length,4);
  return parts;
}
const bundled=await build({
  entryPoints:[resolve("src/lib/holiday-integrated-review.mjs")],
  bundle:true,write:false,platform:"browser",format:"esm",target:"es2022",
  logLevel:"silent"
});
assert.equal(bundled.outputFiles.length,1);
const fixtureWorker=bundled.outputFiles[0].text+"\n"+[
  "const BASE_SESSION="+JSON.stringify(sampleSession)+";",
  "const BASE_LINES="+JSON.stringify(sampleLines)+";",
  "function jsonClone(x){return JSON.parse(JSON.stringify(x));}",
  "export default {async fetch(request,env){",
  "const u=new URL(request.url);",
  "if(u.hostname!=='localhost'||request.method!=='POST'||u.pathname!=='/synthetic')",
  "return new Response('TEST_ONLY',{status:404});",
  "const body=await request.json();",
  "const sess=jsonClone(BASE_SESSION);const lines=jsonClone(BASE_LINES);",
  "switch(body.scenario){",
  " case 'unpaid':sess.payment_status='unpaid';break;",
  " case 'wrong_source':sess.metadata.source='other';break;",
  " case 'wrong_reference':sess.client_reference_id='RNH-AAAAAAAAAAAAAAAA';break;",
  " case 'bad_shipping':sess.collected_information.shipping_details.address.country='CA';break;",
  " case 'bad_amount':sess.amount_total=8100;break;",
  " case 'bad_variant':lines[0].description='Unknown Tee — M / white';break;",
  " case 'bad_price':lines[0].price.unit_amount=1;break;",
  " case 'bad_quantity':lines[0].quantity=13;break;",
  "}",
  "let reads=0;",
  "const fetcher=async(url,init)=>{",
  "  reads++;if(body.scenario==='provider_failure')throw Error('offline_provider');",
  "  if(init.method!=='GET'||!url.startsWith('https://api.stripe.com/v1/checkout/sessions/'))",
  "    return new Response('{}',{status:404});",
  "  if(init.headers.authorization!=='Bearer sk_test_isolated12345')",
  "    return new Response('{}',{status:403});",
  "  if(url.endsWith('/line_items?limit=100'))",
  "    return Response.json({object:'list',data:lines,has_more:body.scenario==='truncated'});",
  "  if(url==='https://api.stripe.com/v1/checkout/sessions/cs_test_holiday_123456')",
  "    return Response.json(sess);",
  "  return new Response('{}',{status:404});",
  "};",
  "const result=await processHolidayIsolatedReview({",
  " rawBody:body.rawBody,stripeSignature:body.stripeSignature,",
  " webhookTestSecret:'whsec_holiday_isolated12345',",
  " nowSeconds:1795800000,stripeTestKey:'sk_test_isolated12345',",
  " fetcher,disposableDb:env.HOLIDAY_DISPOSABLE_D1,",
  " allowIsolatedWorkflow:body.enabled===true,",
  " allowIsolatedRead:body.enabled===true,",
  " allowDisposableWrite:body.enabled===true",
  "});",
  "return Response.json({...result,syntheticStripeReads:reads});",
  "}}"
].join("\n");
const createEvent=(overrides={})=>({
  id:"evt_holiday123456",type:"checkout.session.completed",livemode:false,
  data:{object:{
    object:"checkout.session",id:sid,mode:"payment",
    payment_status:"paid",currency:"usd",amount_total:8199,
    client_reference_id:reference,metadata
  }},
  ...overrides
});
function signed(event=createEvent()){
  const rawBody=JSON.stringify(event);
  const digest=createHmac("sha256",secret).update(now+"."+rawBody).digest("hex");
  return {rawBody,stripeSignature:"t="+now+",v1="+digest};
}
async function fixture(t){
  const mf=new Miniflare({modules:true,script:fixtureWorker,
    compatibilityDate:"2026-08-01",
    d1Databases:{HOLIDAY_DISPOSABLE_D1:"rn-holiday-2e-disposable"}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database("HOLIDAY_DISPOSABLE_D1");
  for(const sql of statements())await db.prepare(sql).run();
  async function post(variant={}){
    const response=await mf.dispatchFetch("http://localhost/synthetic",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({...signed(),enabled:true,...variant})
    });
    assert.equal(response.status,200);
    return response.json();
  }
  const count=async(table)=>(await db.prepare(
    "SELECT COUNT(*) AS n FROM "+table).first()).n;
  const counts=async()=>[
    await count("rn_holiday_review_orders"),
    await count("rn_holiday_review_events")
  ];
  return {mf,db,post,counts};
}
function noAuthority(result){
  assert.ok(["hold","blocked"].includes(result.status),JSON.stringify(result));
  for(const field of ["paymentAuthorized","fulfillmentAuthorized",
    "emailAuthorized","deletionAuthorized"])
    assert.equal(result[field],false,field);
  assert.doesNotMatch(JSON.stringify(result),/synthetic@example|123 Test Street|sk_test_isolated/);
}
test("actual Workerd signed synthetic webhook → mock Stripe GETs → real D1 review record",async t=>{
  const f=await fixture(t);
  const result=await f.post();
  noAuthority(result);
  assert.equal(result.status,"hold");
  assert.equal(result.reason,"review_only_recorded_no_fulfillment");
  assert.equal(result.syntheticStripeReads,2);
  assert.deepEqual(await f.counts(),[1,1]);
  assert.equal((await f.db.prepare("SELECT status FROM rn_holiday_review_orders").first()).status,"review_only");
});
test("replayed webhook HMAC event retains single D1 order and event",async t=>{
  const f=await fixture(t);
  noAuthority(await f.post());
  const second=await f.post();
  noAuthority(second);
  assert.equal(second.reason,"duplicate_review_event_ignored");
  assert.deepEqual(await f.counts(),[1,1]);
});
test("20 simultaneously dispatched signed events cannot create duplicate review orders",async t=>{
  const f=await fixture(t);
  const results=await Promise.all(Array.from({length:20},()=>f.post()));
  results.forEach(noAuthority);
  assert.ok(results.every(x=>x.status==="hold"));
  assert.deepEqual(await f.counts(),[1,1]);
});
test("distinct signed event IDs for identical session create one order and two events",async t=>{
  const f=await fixture(t);
  noAuthority(await f.post());
  const second=await f.post(signed(createEvent({id:"evt_alternate123456"})));
  noAuthority(second);
  assert.equal(second.status,"hold");
  assert.deepEqual(await f.counts(),[1,2]);
});
test("invalid signature stops before Stripe retrieval and D1",async t=>{
  const f=await fixture(t);
  const input=signed();
  input.rawBody=input.rawBody.replace('"paid"','"unpaid"');
  const result=await f.post(input);noAuthority(result);
  assert.equal(result.reason,"invalid_signature");
  assert.equal(result.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("nonpayable signed event never initiates session retrieval",async t=>{
  const f=await fixture(t);
  const result=await f.post(signed(createEvent({type:"checkout.session.expired"})));
  noAuthority(result);
  assert.equal(result.reason,"non_payable_event");
  assert.equal(result.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("live-mode signed event is rejected before Stripe GET or D1",async t=>{
  const f=await fixture(t);
  const result=await f.post(signed(createEvent({livemode:true})));
  noAuthority(result);
  assert.equal(result.reason,"out_of_scope");
  assert.equal(result.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("integration requires all three explicit isolated flags",async t=>{
  const f=await fixture(t);
  const result=await f.post({enabled:false});
  noAuthority(result);
  assert.equal(result.reason,"integration_disabled");
  assert.equal(result.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("retrieved Stripe unpaid, forged source or session reference stops before D1",async t=>{
  const f=await fixture(t);
  for(const scenario of ["unpaid","wrong_source","wrong_reference"]){
    const result=await f.post({scenario});
    noAuthority(result);assert.equal(result.status,"blocked");
    assert.equal(result.reason,"retrieved_session_mismatch");
  }
  assert.deepEqual(await f.counts(),[0,0]);
});
test("retrieved shipping destination is required before D1",async t=>{
  const f=await fixture(t);
  const result=await f.post({scenario:"bad_shipping"});
  noAuthority(result);
  assert.equal(result.reason,"missing_verified_shipping_contact");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("price, variant, quantity and total forgeries fail before D1",async t=>{
  const f=await fixture(t);
  for(const scenario of ["bad_variant","bad_price","bad_quantity","bad_amount"]){
    const result=await f.post({scenario});
    noAuthority(result);
    assert.equal(result.status,"blocked",scenario);
  }
  assert.deepEqual(await f.counts(),[0,0]);
});
test("provider failure and truncated line item listing fail closed",async t=>{
  const f=await fixture(t);
  for(const scenario of ["provider_failure","truncated"]){
    const result=await f.post({scenario});
    noAuthority(result);assert.equal(result.status,"blocked");
  }
  assert.deepEqual(await f.counts(),[0,0]);
});
test("foreign origin and methods cannot access the test-only worker route",async t=>{
  const f=await fixture(t);
  for(const [url,method] of [
    ["http://example.invalid/synthetic","POST"],
    ["http://localhost/synthetic","GET"]
  ]){
    const response=await f.mf.dispatchFetch(url,{method,
      ...(method==="POST"?{body:"{}"}:{})});
    assert.equal(response.status,404);
  }
  assert.deepEqual(await f.counts(),[0,0]);
});
test("test module and worker never contain production Pages endpoint or sending functionality",()=>{
  const src=readFileSync(new URL("../src/lib/holiday-integrated-review.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/onRequestPost|onRequestGet|RESEND_API_KEY|sk_live_|sendEmail|db\.exec|fetch\(/);
  assert.doesNotMatch(fixtureWorker,/onRequestPost|RESEND_API_KEY|sk_live_|sendEmail/);
  assert.match(src,/allowIsolatedWorkflow=false/);
});
