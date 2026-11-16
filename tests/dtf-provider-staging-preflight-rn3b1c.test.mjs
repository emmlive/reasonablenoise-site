import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PHASE26_PROVIDERS,PHASE26_GATES,
 inspectProviderStagingPreflight as inspect,planProviderStagingTasks as plan}
 from "../functions/lib/dtf-provider-staging-preflight-rn3b1c.js";
const code=readFileSync(new URL("../functions/lib/dtf-provider-staging-preflight-rn3b1c.js",import.meta.url),"utf8");
const entry=gate=>({gate,result:"claimed-pass",reference:"review/staging-proof-1234",
 reviewerRef:"reviewer/security-1234"});
const complete=provider=>({provider,evidence:PHASE26_GATES.map(entry)});
const noPower=r=>{
 assert.equal(r.status,"NO_GO");
 for(const key of ["stagingApproved","providerSelected","credentialsAuthorized",
  "accountCreationAuthorized","loginEnabled","customerRouteEnabled",
  "dtfCheckoutEnabled","stripeAuthorized","r2MutationAuthorized",
  "artworkDeletionAuthorized","deploymentAuthorized","productionApproved"])
  assert.equal(r[key],false,key);
};
test("absent preflight is NO_GO",()=>noPower(inspect()));
test("only two shortlisted staging providers allowed",()=>{
 assert.deepEqual(PHASE26_PROVIDERS,["clerk","supabase-auth"]);
 for(const name of ["auth0","admin-access","made-up",""]){
  const r=inspect(complete(name));
  noPower(r);assert.equal(r.reason,"UNAPPROVED_PROVIDER");
 }
});
test("sixteen unique staging gates are required",()=>{
 assert.equal(PHASE26_GATES.length,16);
 assert.equal(new Set(PHASE26_GATES).size,16);
 assert.equal(Object.isFrozen(PHASE26_GATES),true);
});
test("missing all proof remains NO_GO with sixteen missing gates",()=>{
 const r=inspect({provider:"clerk",evidence:[]});
 noPower(r);assert.equal(r.details.filter(x=>x.state==="MISSING").length,16);
});
test("one claimed gate leaves fifteen missing",()=>{
 const r=inspect({provider:"supabase-auth",evidence:[entry(PHASE26_GATES[0])]});
 noPower(r);assert.equal(r.details.filter(x=>x.state==="MISSING").length,15);
});
test("perfect claimed pass for Clerk never creates credentials or login",()=>{
 const r=inspect(complete("clerk"));
 noPower(r);assert.ok(r.details.every(x=>x.state==="CLAIMED_NOT_VERIFIED"));
});
test("perfect claimed pass for Supabase never creates customers or checkout",()=>{
 const r=inspect(complete("supabase-auth"));
 noPower(r);assert.ok(r.details.every(x=>x.state==="CLAIMED_NOT_VERIFIED"));
});
test("forged signed-off and provider approved flags are ignored",()=>{
 const r=inspect({...complete("clerk"),stagingApproved:true,
  approvedBy:"administrator",credentialsAuthorized:true,productionApproved:true});
 noPower(r);
});
test("duplicate gate reports duplicate rather than overriding",()=>{
 const p=complete("clerk");p.evidence.push(entry(PHASE26_GATES[0]));
 const r=inspect(p);noPower(r);
 assert.equal(r.details[0].state,"DUPLICATE");
});
test("failed and not tested claims remain distinct",()=>{
 const p=complete("supabase-auth");
 p.evidence[0].result="failed";
 p.evidence[1].result="not-tested";
 const r=inspect(p);noPower(r);
 assert.equal(r.details[0].state,"FAILED");
 assert.equal(r.details[1].state,"UNTESTED");
});
test("invalid review metadata cannot masquerade as proof",()=>{
 const p=complete("clerk");p.evidence[0].reference="";
 p.evidence[1].reviewerRef="!";
 const r=inspect(p);noPower(r);
 assert.equal(r.details[0].state,"INVALID_REFERENCE");
 assert.equal(r.details[1].state,"INVALID_REFERENCE");
});
test("unknown gate or malformed item is rejected",()=>{
 for(const item of [{gate:"dtf-checkout",result:"claimed-pass"},
  null,2,{gate:PHASE26_GATES[0],result:"claimed-pass"}]){
  const r=inspect({provider:"clerk",evidence:[item]});
  noPower(r);
 }
});
test("invalid top-level shapes fail closed",()=>{
 for(const value of [null,[],12,"clerk",{provider:"clerk",evidence:"pass"}]){
  noPower(inspect(value));
 }
});
test("plan for each provider is not an execution grant",()=>{
 for(const provider of PHASE26_PROVIDERS){
  const r=plan(provider);noPower(r);
  assert.equal(r.details.length,16);
  assert.ok(r.details.every(x=>x.state==="PLANNED"));
 }
});
test("source has no SDK, network, R2, D1, billing or customer route",()=>{
 assert.doesNotMatch(code,/onRequestPost|fetch\s*\(|\.prepare\s*\(|createClerkClient|createClient\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
 assert.match(code,/INDEPENDENT_STAGING_AUTHORIZATION_REQUIRED/);
});
