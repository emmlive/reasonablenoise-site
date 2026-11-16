// RN Phase 16: quote-first UI contract, no client checkout or untrusted pricing.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {configureDtfQuote,quoteToContactUrl,parseQuotePrefill} from "../src/lib/dtf-quote-config-rn3b1c.js";
const page=readFileSync(new URL("../src/pages/dtf-shirts.astro",import.meta.url),"utf8");
const contact=readFileSync(new URL("../src/pages/contact.astro",import.meta.url),"utf8");
const api=readFileSync(new URL("../functions/api/contact.js",import.meta.url),"utf8");
const sample={quantity:12,shirtSource:"ReasonableNoise supplies shirts",placement:"Front",color:"Black",sizeBreakdown:"M:6, L:6",deadline:"Flexible",artwork:"Artwork ready to upload"};
test("normal DTF quote configuration preserves selected details without checkout eligibility",()=>{
 const r=configureDtfQuote(sample);assert.equal(r.ok,true);assert.equal(r.quantity,12);
 assert.equal(r.checkoutEligible,false);assert.equal(r.productionApproved,false);
 assert.equal(r.estimate.nonBinding,true);
});
test("existing 1, 6, 12 shirt quantity tiers are labeled starting estimates, never totals",()=>{
 for(const [q,amount] of [[1,24],[5,24],[6,20],[11,20],[12,18],[100,18]]){
  const r=configureDtfQuote({...sample,quantity:q});assert.equal(r.estimate.display,"From $"+amount+"/shirt");
 }
});
test("BYO shirts and complex placements never show a guessed price",()=>{
 for(const input of [
  {...sample,shirtSource:"Customer brings shirts"},
  {...sample,shirtSource:"Not sure yet"},
  {...sample,placement:"Front + Back"},
  {...sample,placement:"Sleeve / custom placement"}
 ])assert.equal(configureDtfQuote(input).estimate.display,"Custom quote required");
});
test("invalid, fractional, zero and unbounded quantities fail closed",()=>{
 for(const quantity of [0,-1,1.3,10001,NaN,Infinity,"2.5",""]){
  assert.equal(configureDtfQuote({...sample,quantity}).ok,false,String(quantity));
 }
});
test("unknown shirt source or placement cannot create quote transfer",()=>{
 for(const field of ["shirtSource","placement"]){
  const r=configureDtfQuote({...sample,[field]:"<script>fake</script>"});
  assert.equal(r.ok,false);assert.equal(quoteToContactUrl(r),null);
 }
});
test("quote URL transports only bounded order preferences to existing contact route",()=>{
 const r=configureDtfQuote(sample),path=quoteToContactUrl(r);
 assert.ok(path.startsWith("/contact?"));
 const u=new URL(path,"https://reasonablenoise.invalid");
 assert.equal(u.searchParams.get("topic"),"dtf");
 assert.equal(u.searchParams.get("quantity"),"12");
 assert.equal(u.searchParams.has("amount"),false);
 assert.equal(u.searchParams.has("checkout"),false);
 assert.equal(u.searchParams.has("email"),false);
});
test("quote URL round trip preserves all configured nonpayment fields",()=>{
 const r=configureDtfQuote(sample);
 const parsed=parseQuotePrefill(new URL(quoteToContactUrl(r),"https://example.invalid").searchParams);
 assert.equal(parsed.ok,true);
 for(const field of ["quantity","shirtSource","placement","color","sizeBreakdown","deadline","artwork"])
  assert.equal(parsed[field],r[field],field);
});
test("untrusted query parameters cannot force quote selection or price",()=>{
 const bad=new URLSearchParams({topic:"dtf",quantity:"-100",shirtSource:sample.shirtSource,placement:sample.placement,checkout:"true",amount:"1"});
 assert.equal(parseQuotePrefill(bad),null);
 assert.equal(parseQuotePrefill(new URLSearchParams({topic:"stickers"})),null);
});
test("untrusted free text is length bounded and never used for HTML insertion",()=>{
 const r=configureDtfQuote({...sample,color:"x".repeat(300),sizeBreakdown:"y".repeat(300),deadline:"z".repeat(300)});
 assert.equal(r.color.length,80);assert.equal(r.sizeBreakdown.length,160);assert.equal(r.deadline.length,80);
 assert.doesNotMatch(page,/innerHTML\s*=|insertAdjacentHTML/);
});
test("DTF page has mobile-responsive form, explicit no-payment CTA and bounded inputs",()=>{
 assert.match(page,/id="dtf-quote-config"/);
 assert.match(page,/max="10000"/);
 assert.match(page,/Continue to secure quote request/);
 assert.match(page,/No payment is collected/);
 assert.match(page,/md:grid-cols-2/);
});
test("existing contact form receives fields but still requires customer submission",()=>{
 assert.match(contact,/parseQuotePrefill\(params\)/);
 assert.match(contact,/fields\.dtfQuantity\.value/);
 assert.match(contact,/fields\.dtfPrintPlacement\.value/);
 assert.match(contact,/form\?\.addEventListener\("submit"/);
 assert.match(contact,/formData\.set\("message", payload\.message\)/);
});
test("DTF quote route still uses Turnstile/private R2 and not Stripe checkout",()=>{
 assert.match(api,/validateDtfArtworkChallenge/);
 assert.match(api,/dtf-quotes\//);
 assert.match(api,/RESEND_API_KEY/);
 assert.doesNotMatch(page,/checkout\.sessions|api\/create-checkout|stripe\.com/);
 assert.doesNotMatch(contact,/checkout\.sessions|api\/create-checkout/);
});
