// RN Holiday 2H: locally emulated Workerd D1 and synthetic Stripe signature.
// Genuine provider readback is recorded separately; no external webhook delivery.
import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const {build}=await import(pathToFileURL(resolve(root,"node_modules","esbuild","lib","main.js")).href);
const acct="acct_1JFBGfEHvJ1pMLLA",key="sk_test_holiday2h012345";
const secret="whsec_holiday2h012345",now=1795800000;
const reference="RNH-0123456789ABCDEF",sid="cs_test_holiday2h123456";
const meta={source:"reasonablenoise",order_type:"holiday_shirt_test",
  fulfillment_status:"manual_review_only",order_reference:reference};
const testSession={object:"checkout.session",id:sid,livemode:false,mode:"payment",
  payment_status:"paid",status:"complete",currency:"usd",
  client_reference_id:reference,metadata:meta,
  amount_subtotal:2400,amount_total:3399,shipping_cost:{amount_total:999},
  total_details:{amount_tax:0,amount_discount:0},
  customer_details:{email:"synthetic@example.test"},
  collected_information:{shipping_details:{address:{
    line1:"123 Synthetic Lane",city:"Mockville",state:"IL",
    postal_code:"60544",country:"US"
  }}}
};
const mockLineItems={object:"list",has_more:false,data:[{
  object:"item",description:"Holiday Hoots Tee — M / cream",
  quantity:1,currency:"usd",amount_subtotal:2400,amount_total:2400,
  price:{type:"one_time",currency:"usd",unit_amount:2400}
}]};
const sql=readFileSync(new URL("../migrations/holiday-disposable/0001_review_ledger.sql",import.meta.url),"utf8");
const statements=sql.split(/\r?\n/).filter(s=>!/^\s*--/.test(s))
  .join("\n").split(";").map(s=>s.trim()).filter(Boolean);
assert.equal(statements.length,4);
const compiled=await build({
  entryPoints:[resolve("src/lib/holiday-provider-bound-review.mjs")],
  bundle:true,write:false,platform:"browser",format:"esm",target:"es2022",
  logLevel:"silent"
});
const worker=compiled.outputFiles[0].text+"\n"+[
  "const MOCK_HOLIDAY_SESSION="+JSON.stringify(testSession)+";",
  "const MOCK_HOLIDAY_LINES="+JSON.stringify(mockLineItems)+";",
  "export default {async fetch(request,env){",
  "let calls=[];",
  "const scenario=request.headers.get('x-test-case')||'';",
  "const fetcher=async(url,opts)=>{",
  "  calls.push(url);",
  "  if(scenario==='network_failure')throw Error('synthetic provider outage');",
  "  if(opts.method!=='GET'||opts.headers.authorization!=='Bearer sk_test_holiday2h012345')",
  "    return new Response('{}',{status:403});",
  "  if(url==='https://api.stripe.com/v1/account'){",
  "    if(scenario==='wrong_account')return Response.json({object:'account',id:'acct_WrongMerchant123'});",
  "    if(scenario==='explicit_live_account')",
  "      return Response.json({object:'account',id:'acct_1JFBGfEHvJ1pMLLA',livemode:true});",
  "    return Response.json({object:'account',id:'acct_1JFBGfEHvJ1pMLLA'});",
  "  }",
  "  if(url==='https://api.stripe.com/v1/checkout/sessions/cs_test_holiday2h123456'){",
  "    if(scenario==='unpaid')return Response.json({...MOCK_HOLIDAY_SESSION,payment_status:'unpaid'});",
  "    if(scenario==='live_session')return Response.json({...MOCK_HOLIDAY_SESSION,livemode:true});",
  "    if(scenario==='wrong_source')return Response.json({...MOCK_HOLIDAY_SESSION,metadata:{...MOCK_HOLIDAY_SESSION.metadata,source:'forged'}});",
  "    return Response.json(MOCK_HOLIDAY_SESSION);",
  "  }",
  "  if(url==='https://api.stripe.com/v1/checkout/sessions/cs_test_holiday2h123456/line_items?limit=100')",
  "    return Response.json(MOCK_HOLIDAY_LINES);",
  "  return new Response('{}',{status:404});",
  "};",
  "let input={};try{input=await request.json();}catch{}",
  "const r=await processHolidayAccountBoundReview({",
  " rawBody:input.rawBody,stripeSignature:input.stripeSignature,",
  " webhookTestSecret:'whsec_holiday2h012345',nowSeconds:1795800000,",
  " stripeTestKey:scenario==='live_key'?'sk_live_unauthorized123':'sk_test_holiday2h012345',",
  " fetcher,disposableDb:env.HOLIDAY_DISPOSABLE_D1,",
  " allowProviderAccountRead:scenario!=='disabled',",
  " allowIsolatedWorkflow:true,allowIsolatedRead:true,",
  " allowDisposableWrite:true,allowTaxPendingReview:scenario!=='tax_hold'",
  "});",
  "return Response.json({...r,syntheticProviderCalls:calls});",
  "}}"
].join("\n");
function event(variant={}){
  return {id:"evt_holiday2h123456",type:"checkout.session.completed",livemode:false,
    data:{object:{object:"checkout.session",id:sid,mode:"payment",
      payment_status:"paid",currency:"usd",amount_total:3399,
      client_reference_id:reference,metadata:meta}},...variant};
}
function signed(e=event()){
  const rawBody=JSON.stringify(e);
  const digest=createHmac("sha256",secret).update(now+"."+rawBody).digest("hex");
  return {rawBody,stripeSignature:"t="+now+",v1="+digest};
}
async function fixture(t){
  const mf=new Miniflare({modules:true,script:worker,
    compatibilityDate:"2026-08-01",
    d1Databases:{HOLIDAY_DISPOSABLE_D1:"rn-holiday-2h-disposable"}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database("HOLIDAY_DISPOSABLE_D1");
  for(const stmt of statements)await db.prepare(stmt).run();
  const count=async table=>(await db.prepare(
    "SELECT COUNT(*) AS n FROM "+table).first()).n;
  async function post({scenario="",payload=signed()}={}){
    const response=await mf.dispatchFetch("http://localhost/isolated-synthetic",{
      method:"POST",headers:{"content-type":"application/json","x-test-case":scenario},
      body:JSON.stringify(payload)
    });
    assert.equal(response.status,200);
    return response.json();
  }
  return {post,counts:async()=>[
    await count("rn_holiday_review_orders"),await count("rn_holiday_review_events")
  ]};
}
function safe(r,reason){
  assert.ok(["hold","blocked"].includes(r.status),JSON.stringify(r));
  if(reason)assert.equal(r.reason,reason);
  for(const field of ["paymentAuthorized","checkoutAuthorized",
    "taxCollectionAuthorized","fulfillmentAuthorized","emailAuthorized",
    "deletionAuthorized"])assert.equal(r[field],false,field);
  assert.doesNotMatch(JSON.stringify(r),/synthetic@example|123 Synthetic Lane|sk_test_holiday|whsec_holiday/);
}
test("real Stripe Account shape (no livemode field) -> mock signed event -> real local Workerd D1 HOLD",async t=>{
  const f=await fixture(t),r=await f.post();safe(r,"review_only_recorded_no_fulfillment");
  assert.equal(r.syntheticProviderCalls.length,3);
  assert.equal(r.syntheticProviderCalls[0],"https://api.stripe.com/v1/account");
  assert.deepEqual(await f.counts(),[1,1]);
});
test("identical event replay idempotently records one review event",async t=>{
  const f=await fixture(t);safe(await f.post());
  safe(await f.post(),"duplicate_review_event_ignored");
  assert.deepEqual(await f.counts(),[1,1]);
});
test("concurrent synthetic webhook acceptance stays review-only",async t=>{
  const f=await fixture(t);
  const results=await Promise.all(Array.from({length:10},()=>f.post()));
  results.forEach(x=>safe(x));
  assert.deepEqual(await f.counts(),[1,1]);
});
test("opt-in gate OFF prevents ALL provider calls and D1",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"disabled"});
  safe(r,"provider_bound_review_disabled");
  assert.equal(r.syntheticProviderCalls.length,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("tax-pending gate OFF prevents ALL provider calls and D1",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"tax_hold"});
  safe(r,"tax_policy_unconfirmed_no_provider_processing");
  assert.equal(r.syntheticProviderCalls.length,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("wrong merchant account rejected BEFORE any session read",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"wrong_account"});
  safe(r,"provider_account_identity_unverified");
  assert.equal(r.syntheticProviderCalls.length,1);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("explicit live merchant rejected BEFORE any session read",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"explicit_live_account"});
  safe(r,"provider_account_identity_unverified");
  assert.equal(r.syntheticProviderCalls.length,1);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("live key rejected BEFORE contacting Stripe",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"live_key"});
  safe(r,"test_credentials_or_client_missing");
  assert.equal(r.syntheticProviderCalls.length,0);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("invalid signed event blocked before session/line-items read",async t=>{
  const f=await fixture(t),p=signed();
  p.rawBody=p.rawBody.replace('"paid"','"unpaid"');
  const r=await f.post({payload:p});
  safe(r,"invalid_signature");assert.equal(r.syntheticProviderCalls.length,1);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("unpaid provider response rejected without review D1",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"unpaid"});
  safe(r,"retrieved_session_mismatch");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("provider livemode true session rejected even under mock sk_test key",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"live_session"});
  safe(r,"session_lookup_failed");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("forged holiday source in GET session rejected",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"wrong_source"});
  safe(r,"retrieved_session_mismatch");
  assert.deepEqual(await f.counts(),[0,0]);
});
test("provider network failures block and never record order",async t=>{
  const f=await fixture(t),r=await f.post({scenario:"network_failure"});
  safe(r,"provider_account_identity_unverified");
  assert.equal(r.syntheticProviderCalls.length,1);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("signed nonpayable event cannot create review order",async t=>{
  const f=await fixture(t);
  const r=await f.post({payload:signed(event({type:"checkout.session.expired"}))});
  safe(r,"non_payable_event");
  assert.equal(r.syntheticProviderCalls.length,1);
  assert.deepEqual(await f.counts(),[0,0]);
});
test("not a Pages route, no mail or Stripe mutations",()=>{
  const src=readFileSync(new URL("../src/lib/holiday-provider-bound-review.mjs",import.meta.url),"utf8");
  assert.match(src,/allowProviderAccountRead=false/);
  assert.match(src,/allowTaxPendingReview=false/);
  assert.match(src,/acct_1JFBGfEHvJ1pMLLA/);
  assert.doesNotMatch(src,/onRequestPost|onRequestGet|sk_live_|sendEmail|checkout\.sessions\.create|RESEND_API_KEY/);
});
