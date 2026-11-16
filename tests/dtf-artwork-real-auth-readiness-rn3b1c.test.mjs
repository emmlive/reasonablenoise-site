// RN-3B1C Phase 14: real source-boundary audit, no live requests.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewDtfAuthIntegrationEvidence,classifyDtfIdentitySource} from "../functions/lib/dtf-artwork-real-auth-readiness-rn3b1c.js";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const admin=read("functions/api/admin-orders.js");
const contact=read("functions/api/contact.js");
const stripe=read("functions/api/stripe-webhook.js");
const phase13=read("functions/lib/dtf-artwork-order-auth-rn3b1c.js");
const gate=read("functions/lib/dtf-artwork-real-auth-readiness-rn3b1c.js");
const flags=[
 "signed_session_verifier","order_authority_store","owner_workspace_link",
 "session_revocation","decision_time_fence","csrf_browser_mutation",
 "replay_protection","r2_version_recheck","isolated_provider_verification"
];
test("existing admin endpoint uses Access email claims and admin token, not customer auth",()=>{
 assert.match(admin,/cf-access-authenticated-user-email/i);
 assert.match(admin,/cf-access-jwt-assertion/i);
 assert.match(admin,/function decodeAccessJwtEmail/);
 assert.match(admin,/ADMIN_ORDER_TOKEN/);
 assert.match(admin,/function isAuthorized/);
});
test("existing admin endpoint decodes Access JWT payload without local signature verification",()=>{
 assert.match(admin,/JSON\.parse\(atob\(padded\)\)/);
 assert.doesNotMatch(admin,/crypto\.subtle\.verify|jwtVerify\s*\(|verifyJwtSignature\s*\(/);
});
test("real DTF contact is quote-first and creates R2 quote reference, not a customer session",()=>{
 assert.match(contact,/makeDtfQuoteReference/);
 assert.match(contact,/dtf-quotes\//);
 assert.match(contact,/CONTACT_NOTIFY_EMAIL|ORDER_NOTIFY_EMAIL/);
 assert.doesNotMatch(contact,/dtf_test_order_authority|dtf_artwork_version_pins/);
});
test("Stripe webhook is sticker-only and not authority for DTF order ownership",()=>{
 assert.match(stripe,/isReasonableNoiseStickerSession/);
 assert.match(stripe,/metadata\?\.order_type === "sticker_order"/);
 assert.doesNotMatch(stripe,/dtf_test_order_authority|dtf_artwork_version_pins/);
});
test("Phase 13 verified:true flag is a synthetic authenticator interface, not crypto proof",()=>{
 assert.match(phase13,/principal\?\.verified!==true/);
 assert.match(phase13,/authenticate\(request\)/);
 assert.doesNotMatch(phase13,/crypto\.subtle\.verify|jwtVerify|validateSessionCookie/);
});
test("unknown and missing evidence cannot authorize integration",()=>{
 for(const input of [undefined,null,[],{},false,"yes"]){
  const result=reviewDtfAuthIntegrationEvidence(input);
  assert.equal(result.ok,false);
  assert.equal(result.productionApproved,false);
  assert.equal(result.checkoutEligible,false);
 }
});
test("every missing authentication, revocation and request-fence proof is identified",()=>{
 const result=reviewDtfAuthIntegrationEvidence({});
 assert.deepEqual(result.missing,flags);
});
test("each claimed individual proof remains blocked until independent review",()=>{
 for(const key of flags){
  const result=reviewDtfAuthIntegrationEvidence({[key]:true});
  assert.equal(result.ok,false);
  assert.ok(result.missing.length>0);
 }
});
test("even all self-asserted evidence cannot enable production checkout",()=>{
 const evidence=Object.fromEntries(flags.map(k=>[k,true]));
 const result=reviewDtfAuthIntegrationEvidence(evidence);
 assert.equal(result.code,"INDEPENDENT_SECURITY_REVIEW_REQUIRED");
 assert.equal(result.ok,false);
 assert.equal(result.checkoutEligible,false);
 assert.equal(result.productionApproved,false);
});
test("admin headers, decoded JWT, contact email, and client claims cannot become customer principal",()=>{
 for(const source of [
  "cf-access-authenticated-user-email","cf-access-jwt-payload","x-admin-order-token",
  "admin-download-token","contact-email","stripe-checkout-metadata",
  "client-subject-id","client-verified-flag"
 ]){
  assert.equal(classifyDtfIdentitySource(source).code,"UNTRUSTED_IDENTITY_SOURCE");
 }
});
test("even requested trusted-session mode fails before a real verifier is wired",()=>{
 const result=classifyDtfIdentitySource("independently_verified_server_session");
 assert.equal(result.code,"SESSION_VERIFIER_NOT_CONNECTED");
 assert.equal(result.customerRouteEnabled,false);
});
test("no customer request handler, Stripe call, R2 deletion or live migrations created",()=>{
 assert.doesNotMatch(gate,/onRequestPost|onScheduled|fetch\s*\(|bucket\.put|bucket\.delete|checkout\.sessions|env\.STRIPE|D1Database/);
 assert.match(gate,/productionApproved:false/);
 assert.match(gate,/customerRouteEnabled:false/);
});
