// RN-3B1C Phase 14: source-backed DTF authentication integration hold.
// This is an *audit gate*, NOT a production authentication mechanism.
// Passing source evidence never grants checkout, deletion, or production approval.
const fail=(code,missing=[])=>({
 ok:false,code,missing,productionApproved:false,
 checkoutEligible:false,deletionAuthorized:false,
 customerRouteEnabled:false
});
const required=[
 "signed_session_verifier",
 "order_authority_store",
 "owner_workspace_link",
 "session_revocation",
 "decision_time_fence",
 "csrf_browser_mutation",
 "replay_protection",
 "r2_version_recheck",
 "isolated_provider_verification"
];
// Explicit evidence is for review tracking only; no boolean can confer approval.
export function reviewDtfAuthIntegrationEvidence(evidence={}){
 if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))
  return fail("INTEGRATION_EVIDENCE_REQUIRED",required);
 const missing=required.filter(k=>evidence[k]!==true);
 return fail(missing.length?"INTEGRATION_NOT_READY":"INDEPENDENT_SECURITY_REVIEW_REQUIRED",missing);
}
// The current production routes cannot substitute an email/header/admin token,
// anonymous contact quote, or an unsigned JWT payload for customer order ownership.
export function classifyDtfIdentitySource(source){
 const banned=new Set([
  "cf-access-authenticated-user-email",
  "cf-access-jwt-payload",
  "x-admin-order-token",
  "admin-download-token",
  "contact-email",
  "stripe-checkout-metadata",
  "client-subject-id",
  "client-verified-flag"
 ]);
 if(typeof source!=="string"||banned.has(source.toLowerCase())||
  source!=="independently_verified_server_session")
  return fail("UNTRUSTED_IDENTITY_SOURCE");
 return fail("SESSION_VERIFIER_NOT_CONNECTED");
}
