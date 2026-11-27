// RN Holiday 2G: local Workerd ingress -> synthetic signed Stripe webhook,
// mock provider GET, disposable REAL Workerd D1. Not provider-originated.
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,
  "node_modules","miniflare","dist","src","index.js")).href);
const {build}=await import(pathToFileURL(resolve(root,
  "node_modules","esbuild","lib","main.js")).href);
const secret="whsec_isolated2g012345",key="sk_test_isolated2g012345";
const timestamp=1795800000,reference="RNH-FEDCBA9876543210";
const sid="cs_test_holiday2g123456",eventId="evt_holiday2g123456";
const meta={source:"reasonablenoise",order_type:"holiday_shirt_test",
  fulfillment_status:"manual_review_only",order_reference:reference};
const session={object:"checkout.session",id:sid,livemode:false,mode:"payment",
  payment_status:"paid",status:"complete",currency:"usd",
  amount_subtotal:2400,amount_total:3399,
  total_details:{amount_tax:0,amount_discount:0},
  shipping_cost:{amount_total:999},client_reference_id:reference,metadata:meta,
  customer_details:{email:"isolation@example.test"},
  collected_information:{shipping_details:{address:{
    line1:"123 Synthetic Lane",city:"Mockville",state:"IL",
    postal_code:"60544",country:"US"
  }}}
};
const lines={object:"list",has_more:false,data:[{
  object:"item",description:"Holiday Hoots Tee — M / cream",quantity:1,
  currency:"usd",amount_subtotal:2400,amount_total:2400,
  price:{type:"one_time",currency:"usd",unit_amount:2400}
}]};
const migration=readFileSync(new URL("../migrations/holiday-disposable/0001_review_ledger.sql",import.meta.url),"utf8");
const statements=migration.split(/\r?\n/).filter(x=>!/^\s*--/.test(x))
  .join("\n").split(";").map(x=>x.trim()).filter(Boolean);
assert.equal(statements.length,4);
const bundle=await build({entryPoints:[resolve("src/lib/holiday-isolated-ingress.mjs")],
  bundle:true,write:false,platform:"browser",format:"esm",target:"es2022",
  logLevel:"silent"});
const worker=bundle.outputFiles[0].text+"\n"+[
  "const SESSION="+JSON.stringify(session)+";",
  "const LINES="+JSON.stringify(lines)+";",
  "export default {async fetch(request,env){",
  "  const meta=await request.headers.get('x-isolated-test-case');",
  "  let reads=0;",
  "  const fetcher=async(url,init)=>{",
  "    reads++;",
  "    if(init.method!=='GET'||init.headers.authorization!=='Bearer sk_test_isolated2g012345')",
  "      return new Response('{}',{status:403});",
  "    if(url==='https://api.stripe.com/v1/checkout/sessions/cs_test_holiday2g123456')",
  "      return Response.json(meta==='unpaid'?{...SESSION,payment_status:'unpaid'}:SESSION);",
  "    if(url==='https://api.stripe.com/v1/checkout/sessions/cs_test_holiday2g123456/line_items?limit=100')",
  "      return Response.json(LINES);",
  "    return new Response('{}',{status:404});",
  "  };",
  "  const result=await inspectIsolatedHolidayWebhook({request,",
  "    webhookTestSecret:'whsec_isolated2g012345',",
  "    stripeTestKey:'sk_test_isolated2g012345',",
  "    nowSeconds:1795800000,fetcher,disposableDb:env.HOLIDAY_DISPOSABLE_D1,",
  "    allowLocalIngress:meta!=='disabled',",
  "    allowIsolatedRead:true,allowDisposableWrite:true,allowIsolatedWorkflow:true,",
  "    allowTaxPendingReview:meta!=='tax_hold'",
  "  });",
  "  return Response.json({...result,syntheticStripeReads:reads},{status:200});",
  "}}"
].join("\n");
function event(overrides={}){
  const e={id:eventId,type:"checkout.session.completed",livemode:false,
    data:{object:{object:"checkout.session",id:sid,mode:"payment",
      payment_status:"paid",currency:"usd",amount_total:3399,
      client_reference_id:reference,metadata:meta}}};
  return {...e,...overrides};
}
function payload(e=event()){
  const body=JSON.stringify(e);
  const mac=createHmac("sha256",secret).update(timestamp+"."+body).digest("hex");
  return {body,signature:"t="+timestamp+",v1="+mac};
}
async function fixture(t){
  const mf=new Miniflare({modules:true,script:worker,
    compatibilityDate:"2026-08-01",
    d1Databases:{HOLIDAY_DISPOSABLE_D1:"rn-holiday-2g-disposable"}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database("HOLIDAY_DISPOSABLE_D1");
  for(const stmt of statements)await db.prepare(stmt).run();
  const count=async table=>(await db.prepare(
    "SELECT COUNT(*) as n FROM "+table).first()).n;
  const counts=async()=>[
    await count("rn_holiday_review_orders"),await count("rn_holiday_review_events")
  ];
  async function request({url="http://localhost/__isolated/holiday/test-webhook",
    method="POST",body,signature,contentType="application/json",scenario}={}){
    const signed=payload();
    const response=await mf.dispatchFetch(url,{
      method,headers:{
        "content-type":contentType,
        "stripe-signature":signature??signed.signature,
        ...(scenario?{"x-isolated-test-case":scenario}:{})
      },...(method!=="GET"?{body:body??signed.body}:{})
    });
    assert.equal(response.status,200);
    return response.json();
  }
  return {db,counts,request};
}
function safe(out){
  assert.ok(["hold","blocked"].includes(out.status),JSON.stringify(out));
  for(const key of ["paymentAuthorized","fulfillmentAuthorized",
    "emailAuthorized","deletionAuthorized"])
    assert.equal(out[key],false,key);
  assert.doesNotMatch(JSON.stringify(out),
    /isolation@example|123 Synthetic Lane|whsec_isolated|sk_test_isolated/);
}
test("local signed synthetic event -> mock readback -> disposable real Workerd D1",async t=>{
  const f=await fixture(t);
  const r=await f.request();safe(r);
  assert.equal(r.status,"hold");
  assert.equal(r.reason,"review_only_recorded_no_fulfillment");
  assert.equal(r.syntheticStripeReads,2);
  assert.deepEqual(await f.counts(),[1,1]);
});
test("same signed event replay adds no second record",async t=>{
  const f=await fixture(t);
  await f.request();
  const r=await f.request();safe(r);
  assert.equal(r.reason,"duplicate_review_event_ignored");
  assert.deepEqual(await f.counts(),[1,1]);
});
test("15 concurrent synthetic webhook requests remain idempotent",async t=>{
  const f=await fixture(t);
  const res=await Promise.all(Array.from({length:15},()=>f.request()));
  res.forEach(safe);
  assert.deepEqual(await f.counts(),[1,1]);
});
test("default tax HOLD does not call Stripe or D1",async t=>{
  const f=await fixture(t);
  const r=await f.request({scenario:"tax_hold"});safe(r);
  assert.equal(r.reason,"tax_policy_unconfirmed_no_provider_processing");
  assert.equal(r.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("disabled local ingress calls no provider",async t=>{
  const f=await fixture(t);
  const r=await f.request({scenario:"disabled"});safe(r);
  assert.equal(r.reason,"isolated_ingress_disabled");
  assert.equal(r.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("live production domain cannot enter this adapter",async t=>{
  const f=await fixture(t);
  const r=await f.request({url:"https://reasonablenoise.com/__isolated/holiday/test-webhook"});
  safe(r);assert.equal(r.reason,"outside_disposable_local_origin");
  assert.equal(r.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("existing production stripe-webhook path never accepted",async t=>{
  const f=await fixture(t);
  const r=await f.request({url:"http://localhost/api/stripe-webhook"});
  safe(r);assert.equal(r.reason,"outside_disposable_local_origin");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("URL query string forbidden",async t=>{
  const f=await fixture(t);
  const r=await f.request({url:"http://localhost/__isolated/holiday/test-webhook?token=anything"});
  safe(r);assert.equal(r.reason,"outside_disposable_local_origin");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("GET is forbidden",async t=>{
  const f=await fixture(t);
  const r=await f.request({method:"GET"});
  safe(r);assert.equal(r.reason,"method_not_allowed");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("non-JSON content type rejected",async t=>{
  const f=await fixture(t);
  const r=await f.request({contentType:"text/plain"});safe(r);
  assert.equal(r.reason,"invalid_content_type");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("invalid Stripe signature stops before provider lookup",async t=>{
  const f=await fixture(t);
  const r=await f.request({signature:"t=1795800000,v1="+("0".repeat(64))});
  safe(r);assert.equal(r.reason,"invalid_signature");
  assert.equal(r.syntheticStripeReads,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("oversized raw body denied before Stripe GET",async t=>{
  const f=await fixture(t);
  const r=await f.request({body:"x".repeat(128001)});
  safe(r);assert.equal(r.reason,"oversized_body");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("unpaid provider readback never produces review ledger",async t=>{
  const f=await fixture(t);
  const r=await f.request({scenario:"unpaid"});
  safe(r);assert.equal(r.reason,"retrieved_session_mismatch");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("live-mode signed event forbidden even with valid synthetic signature",async t=>{
  const f=await fixture(t);
  const p=payload(event({livemode:true}));
  const r=await f.request({body:p.body,signature:p.signature});
  safe(r);assert.equal(r.reason,"out_of_scope");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("nonpayable signed expired event requires no provider read",async t=>{
  const f=await fixture(t);
  const p=payload(event({type:"checkout.session.expired"}));
  const r=await f.request({body:p.body,signature:p.signature});
  safe(r);assert.equal(r.reason,"non_payable_event");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("2G adapter is not a Pages webhook route or production deployment",()=>{
  const src=readFileSync(new URL("../src/lib/holiday-isolated-ingress.mjs",import.meta.url),"utf8");
  assert.match(src,/const ORIGIN="http:\/\/localhost"/);
  assert.match(src,/allowLocalIngress=false/);
  assert.match(src,/allowTaxPendingReview=false/);
  assert.doesNotMatch(src,/onRequestPost|onRequestGet|sk_live_|RESEND_API_KEY|sendEmail/);
  assert.doesNotMatch(worker,/onRequestPost|onRequestGet|sk_live_|RESEND_API_KEY|sendEmail/);
});
