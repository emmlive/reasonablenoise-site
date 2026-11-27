import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateHolidayTaxReadiness,inspectHolidayTaxReadiness} from "../src/lib/holiday-tax-readiness.mjs";
const pending={object:"tax.settings",livemode:false,status:"pending",
  defaults:{provider:"stripe",tax_behavior:null,tax_code:null},
  head_office:null,status_details:{pending:{missing_fields:["head_office"]}}};
const active={object:"tax.settings",livemode:false,status:"active",
  head_office:{address:{country:"US"}},
  defaults:{provider:"stripe",tax_behavior:"exclusive",tax_code:"txcd_test"}};
const none={object:"list",data:[],has_more:false};
const registered={object:"list",data:[
  {id:"taxreg_test123456",object:"tax.registration",status:"active",
   country:"US",country_options:{us:{state:"IL"}}}
],has_more:false};
const confirmations={
  taxPolicyConfirmed:true,headOfficeConfirmed:true,businessRegistrationConfirmed:true,
  productTaxCodeConfirmed:true,priceTaxBehaviorConfirmed:true
};
const key="sk_test_isolated_tax12345";
function assertNoAuthority(result,reason){
  assert.ok(["blocked","hold"].includes(result.status));
  if(reason)assert.equal(result.reason,reason);
  for(const k of ["paymentAuthorized","checkoutAuthorized","taxCollectionAuthorized",
    "fulfillmentAuthorized","emailAuthorized","deletionAuthorized"])
    assert.equal(result[k],false,k);
}
function provider(settings=pending,registrations=none){
  const calls=[];
  return {calls,fetcher:async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith("/tax/settings"))return Response.json(settings);
    if(url.includes("/tax/registrations?limit=100"))
      return Response.json(registrations);
    throw Error("Unexpected network URL");
  }};
}
test("actual observed test settings pending for head_office yield HOLD",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({settings:pending,registrations:none}),
    "head_office_and_tax_settings_pending");
});
test("active settings with zero registrations still HOLD",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({settings:active,registrations:none}),
    "no_tax_registrations_recorded");
});
test("registrations alone never imply owner has confirmed legal tax registration",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({
    settings:active,registrations:registered
  }),"business_tax_policy_and_registrations_unconfirmed");
});
test("missing product tax code or price tax behavior remains HOLD",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({
    settings:{...active,defaults:{tax_code:null,tax_behavior:null}},
    registrations:registered,...confirmations
  }),"product_tax_code_and_price_behavior_unconfirmed");
});
test("even all assumed confirmations yield HOLD pending tax calculation and signoff",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({
    settings:active,registrations:registered,...confirmations
  }),"tax_read_only_preflight_complete_test_calculation_and_owner_signoff_required");
});
test("live mode rejected without depending on tax status",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({
    settings:active,registrations:registered,...confirmations,
    accountLivemode:true
  }),"live_mode_forbidden");
});
test("unknown or missing settings rejected",()=>{
  for(const settings of [null,{}, {object:"customer"}, {...active,livemode:true},
    {...active,status:"unknown"}]){
    assertNoAuthority(evaluateHolidayTaxReadiness({settings,registrations:none}),
      "tax_evidence_missing_or_untrusted");
  }
});
test("registration pagination must be complete before evaluation",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({
    settings:active,registrations:{object:"list",data:registered.data,has_more:true}
  }),"tax_evidence_missing_or_untrusted");
});
test("missing registration listing is blocked",()=>{
  assertNoAuthority(evaluateHolidayTaxReadiness({settings:active}),
    "tax_evidence_missing_or_untrusted");
});
test("default-off network gate makes no calls",async()=>{
  const p=provider();
  assertNoAuthority(await inspectHolidayTaxReadiness({stripeTestKey:key,
    fetcher:p.fetcher}),"tax_read_disabled");
  assert.equal(p.calls.length,0);
});
test("only syntactically valid test key may reach provider",async()=>{
  for(const k of ["","sk_live_dangerous123","pk_test_123456789","rk_test_123456789"]){
    const p=provider();
    assertNoAuthority(await inspectHolidayTaxReadiness({
      stripeTestKey:k,fetcher:p.fetcher,allowIsolatedRead:true
    }),"test_account_or_client_missing");
    assert.equal(p.calls.length,0);
  }
});
test("read-only GET to two fixed provider endpoints with no mutation",async()=>{
  const p=provider();
  const result=await inspectHolidayTaxReadiness({
    stripeTestKey:key,fetcher:p.fetcher,allowIsolatedRead:true});
  assertNoAuthority(result,"head_office_and_tax_settings_pending");
  assert.deepEqual(p.calls.map(c=>c.url),[
    "https://api.stripe.com/v1/tax/settings",
    "https://api.stripe.com/v1/tax/registrations?limit=100"
  ]);
  assert.ok(p.calls.every(c=>c.init.method==="GET"));
});
test("failed Tax settings call blocks before registration lookup",async()=>{
  let count=0;
  const out=await inspectHolidayTaxReadiness({
    stripeTestKey:key,allowIsolatedRead:true,
    fetcher:async()=>{count++;return new Response("fail",{status:503});}
  });
  assertNoAuthority(out,"tax_settings_unavailable");
  assert.equal(count,1);
});
test("failed registrations call blocks after tax settings",async()=>{
  let count=0;
  const out=await inspectHolidayTaxReadiness({
    stripeTestKey:key,allowIsolatedRead:true,
    fetcher:async()=>{
      count++;
      return count===1?Response.json(pending):new Response("fail",{status:503});
    }
  });
  assertNoAuthority(out,"tax_registrations_unavailable");
  assert.equal(count,2);
});
test("provider exception and invalid JSON block safely",async()=>{
  for(const fetcher of [
    async()=>{throw Error("network failed");},
    async()=>new Response("{",{status:200})
  ]){
    const out=await inspectHolidayTaxReadiness({
      stripeTestKey:key,fetcher,allowIsolatedRead:true});
    assertNoAuthority(out,"tax_settings_unavailable");
  }
});
test("source has no routing, Checkout, write, email or D1 authority",()=>{
  const src=readFileSync(new URL("../src/lib/holiday-tax-readiness.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/onRequestPost|onRequestGet|checkout\.sessions|sendEmail|\.batch\(|method:"POST"|sk_live_|RESEND_API_KEY/);
  assert.match(src,/allowIsolatedRead=false/);
});
