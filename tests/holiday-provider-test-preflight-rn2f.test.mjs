import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyHolidayProviderTestAccount } from "../src/lib/holiday-provider-test-preflight.mjs";
const account="acct_ReasonableTest123";
const key="sk_test_isolated_preflight123";
const good={stripeTestKey:key,expectedStripeAccountId:account,
  allowProviderTestRead:true,allowIsolatedWorkflow:true};
const mock=(record={object:"account",id:account,livemode:false},opts={})=>{
  const calls=[];
  const fetcher=async(url,config)=>{
    calls.push({url,config});
    if(opts.throw)throw Error("Synthetic network error");
    if(opts.fail)return new Response("unavailable",{status:503});
    if(opts.badJson)return new Response("{",{status:200});
    return Response.json(record);
  };
  return {fetcher,calls};
};
function denied(out,reason){
  assert.equal(out.reason,reason);
  for(const field of ["paymentAuthorized","fulfillmentAuthorized",
    "emailAuthorized","deletionAuthorized"])
    assert.equal(out[field],false,field);
}
test("default OFF even with mock Stripe test key",async()=>{
  const x=mock();
  const out=await verifyHolidayProviderTestAccount({
    ...good,allowProviderTestRead:false,fetcher:x.fetcher});
  denied(out,"provider_test_gate_disabled");
  assert.equal(x.calls.length,0);
});
test("second opt-in gate also required",async()=>{
  const x=mock();
  denied(await verifyHolidayProviderTestAccount({
    ...good,allowIsolatedWorkflow:false,fetcher:x.fetcher}),
    "provider_test_gate_disabled");
  assert.equal(x.calls.length,0);
});
test("correct account identity and test livemode returns HOLD, not accepted payment",async()=>{
  const x=mock();
  const out=await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher});
  denied(out,"test_account_verified_provider_event_still_required");
  assert.equal(out.status,"hold");
  assert.equal(x.calls.length,1);
  assert.equal(x.calls[0].url,"https://api.stripe.com/v1/account");
  assert.equal(x.calls[0].config.method,"GET");
  assert.equal(x.calls[0].config.headers.authorization,"Bearer "+key);
});
test("account mismatch blocks regardless of test key",async()=>{
  const x=mock({object:"account",id:"acct_DifferentMerchant123",livemode:false});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "account_identity_or_mode_mismatch");
});
test("live-mode account blocked even with matching merchant identity",async()=>{
  const x=mock({object:"account",id:account,livemode:true});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "account_identity_or_mode_mismatch");
});
test("unexpected provider object blocked",async()=>{
  const x=mock({object:"checkout.session",id:account,livemode:false});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "account_identity_or_mode_mismatch");
});
test("live, restricted, and publishable keys rejected without provider lookup",async()=>{
  for(const key of ["sk_live_merchant12345","rk_test_restricted123",
    "pk_test_publishable123","",null]){
    const x=mock();
    denied(await verifyHolidayProviderTestAccount({
      ...good,stripeTestKey:key,fetcher:x.fetcher}),
      "missing_authorized_test_account");
    assert.equal(x.calls.length,0);
  }
});
test("invalid expected account ID rejected before provider call",async()=>{
  for(const id of ["","acct_", "cus_wrong123456",null]){
    const x=mock();
    denied(await verifyHolidayProviderTestAccount({
      ...good,expectedStripeAccountId:id,fetcher:x.fetcher}),
      "missing_authorized_test_account");
    assert.equal(x.calls.length,0);
  }
});
test("missing injected provider client fails closed",async()=>{
  denied(await verifyHolidayProviderTestAccount(good),
    "missing_authorized_test_account");
});
test("provider network failure blocks",async()=>{
  const x=mock(undefined,{throw:true});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "stripe_account_unavailable");
});
test("provider server error blocks",async()=>{
  const x=mock(undefined,{fail:true});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "stripe_account_unavailable");
});
test("malformed provider JSON blocks",async()=>{
  const x=mock(undefined,{badJson:true});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "invalid_provider_response");
});
test("real Stripe account shape may omit livemode under sk_test key; still HOLD",async()=>{
  const x=mock({object:"account",id:account});
  const r=await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher});
  denied(r,"test_account_verified_provider_event_still_required");
  assert.equal(r.status,"hold");
});
test("explicit nonboolean livemode is rejected",async()=>{
  const x=mock({object:"account",id:account,livemode:"false"});
  denied(await verifyHolidayProviderTestAccount({...good,fetcher:x.fetcher}),
    "account_identity_or_mode_mismatch");
});
test("preflight has no production route, external calls unless injected, payments or emails",()=>{
  const src=readFileSync(new URL("../src/lib/holiday-provider-test-preflight.mjs",import.meta.url),"utf8");
  const sticker=readFileSync(new URL("../functions/api/stripe-webhook.js",import.meta.url),"utf8");
  assert.doesNotMatch(src,/onRequestPost|onRequestGet|sk_live_|STRIPE_SECRET_KEY|RESEND_API_KEY|sendEmail|\.batch\(|checkout\.sessions/);
  assert.match(sticker,/order_type === "sticker_order"/);
  assert.match(src,/allowProviderTestRead=false/);
});
