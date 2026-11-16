import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PHASE28_TRIAL_ORDER,PHASE28_TRIAL_CONTROLS,
 evaluatePhase28TrialRequest as evaluate,getPhase28TrialRecommendation as recommend}
 from "../functions/lib/dtf-phase28-staging-trial-decision-rn3b1c.js";
const source=readFileSync(new URL("../functions/lib/dtf-phase28-staging-trial-decision-rn3b1c.js",import.meta.url),"utf8");
const evidence=control=>({control,state:"claimed-pass",evidenceRef:"review/phase28-demo-1234",
 reviewerRef:"reviewer/external-audit-1234"});
const request=provider=>({provider,environment:"disposable-staging",
 attestations:PHASE28_TRIAL_CONTROLS.map(evidence)});
const noPower=result=>{
 assert.equal(result.status,"NO_GO");
 assert.equal(result.providerSelected,null);
 assert.equal(result.customerPrincipal,null);
 for(const key of ["stagingProvisioningAuthorized","credentialCreationAuthorized",
 "realSdkAuthorized","customerLoginEnabled","productionAuthAuthorized",
 "dtfOrderOwnershipGranted","quoteAcceptanceAuthorized","dtfCheckoutEnabled",
 "paymentAuthorized","artworkDeletionAuthorized","deployAuthorized"])
  assert.equal(result[key],false,key);
};
test("Phase28 is NO_GO on absent input",()=>noPower(evaluate()));
test("only two trial candidates and unique 14 controls",()=>{
 assert.deepEqual(PHASE28_TRIAL_ORDER,["clerk","supabase-auth"]);
 assert.equal(PHASE28_TRIAL_CONTROLS.length,14);
 assert.equal(new Set(PHASE28_TRIAL_CONTROLS).size,14);
 assert.equal(Object.isFrozen(PHASE28_TRIAL_CONTROLS),true);
});
test("Clerk recommendation is not a production or staging selection",()=>{
 const r=recommend();noPower(r);
 assert.equal(r.preferredTrialCandidate,"clerk");
 assert.equal(r.checks[0].status,"FIRST_TRIAL_CANDIDATE_ONLY");
});
test("Supabase fallback is not a selection",()=>{
 const r=recommend();noPower(r);
 assert.equal(r.fallbackTrialCandidate,"supabase-auth");
 assert.equal(r.checks[1].status,"SECOND_TRIAL_CANDIDATE_ONLY");
});
test("perfect Clerk checklist never provisions a real provider",()=>{
 const r=evaluate(request("clerk"));noPower(r);
 assert.ok(r.checks.every(x=>x.status==="CLAIM_ONLY"));
});
test("perfect Supabase checklist never creates real credentials",()=>{
 const r=evaluate(request("supabase-auth"));noPower(r);
 assert.ok(r.checks.every(x=>x.status==="CLAIM_ONLY"));
});
test("forged approval flags and real user claims do not grant authority",()=>{
 const r=evaluate({...request("clerk"),productionApproved:true,
  realSdkAuthorized:true,providerSelected:"clerk",customerPrincipal:"someone"});
 noPower(r);
});
test("missing environment cannot be interpreted as staging",()=>{
 for(const environment of [undefined,"production","preview","staging",""]){
  const r=evaluate({...request("clerk"),environment});noPower(r);
  assert.equal(r.reason,"ISOLATION_UNPROVEN");
 }
});
test("unknown provider and admin-access provider rejected",()=>{
 for(const provider of ["auth0","admin-access","custom",""]){
  const r=evaluate(request(provider));noPower(r);
  assert.equal(r.reason,"INVALID_TRIAL_CANDIDATE");
 }
});
test("missing all and partial controls stay visible",()=>{
 const r=evaluate({...request("clerk"),attestations:[evidence(PHASE28_TRIAL_CONTROLS[0])]});
 noPower(r);assert.equal(r.checks.filter(x=>x.status==="MISSING").length,13);
});
test("duplicate control does not overwrite evidence",()=>{
 const r=request("clerk");r.attestations.push(evidence(PHASE28_TRIAL_CONTROLS[0]));
 const response=evaluate(r);noPower(response);
 assert.equal(response.checks[0].status,"DUPLICATE");
});
test("unrun and failed controls remain explicit blockers",()=>{
 const r=request("clerk");r.attestations[0].state="failed";r.attestations[1].state="not-run";
 const response=evaluate(r);noPower(response);
 assert.equal(response.checks[0].status,"FAILED");
 assert.equal(response.checks[1].status,"NOT_RUN");
});
test("missing reviewer, invalid reference and unknown status are not evidence",()=>{
 const r=request("supabase-auth");
 r.attestations[0].evidenceRef="";
 r.attestations[1].reviewerRef="!";
 r.attestations[2].state="approved";
 const result=evaluate(r);noPower(result);
 assert.deepEqual(result.checks.slice(0,3).map(x=>x.status),
  ["INVALID_EVIDENCE","INVALID_EVIDENCE","INVALID_STATE"]);
});
test("malformed controls and request inputs fail closed",()=>{
 for(const input of [null,[],4,"clerk",{provider:"clerk",environment:"disposable-staging"},
  {...request("clerk"),attestations:[null]},
  {...request("clerk"),attestations:[{control:"activate-checkout"}]}]){
  noPower(evaluate(input));
 }
});
test("no SDK, live provider, D1, R2, Stripe, routes or network side effects",()=>{
 assert.doesNotMatch(source,/onRequestPost|fetch\s*\(|\.prepare\s*\(|createClerkClient|createServerClient|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
 assert.match(source,/SEPARATE_PROVIDER_APPROVAL_REQUIRED/);
});
