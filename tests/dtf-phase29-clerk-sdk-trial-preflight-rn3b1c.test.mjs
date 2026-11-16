import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PHASE29_REQUIRED_PROBES,inspectClerkOfflineTrialManifest as inspect,
 phase29ClerkProbePlan as plan}
 from "../functions/lib/dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.js";
const source=readFileSync(new URL("../functions/lib/dtf-phase29-clerk-sdk-trial-preflight-rn3b1c.js",import.meta.url),"utf8");
const probe=name=>({name,result:"self-reported-pass"});
const valid=()=>({provider:"clerk",environment:"offline-local",runtime:"workerd",
 package:"@clerk/backend",version:"1.0.0",acceptsToken:"session_token",
 networkless:true,allowProviderFetch:false,
 authorizedParty:"http://localhost:8787",requestOrigin:"http://localhost:8787",
 audience:"rn_test_only",probeResults:PHASE29_REQUIRED_PROBES.map(probe)});
const noAuthority=r=>{
 assert.equal(r.status,"NO_GO");
 assert.equal(r.customerPrincipal,null);
 for(const k of ["offlineSdkExecuted","realTokenVerified","jwtKeyTrusted",
 "providerAccountAuthorized","credentialsAuthorized","packageInstallationAuthorized",
 "authRouteEnabled","localSessionAuthorized","dtfQuoteAcceptanceAuthorized",
 "dtfCheckoutEnabled","paymentAuthorized","artworkDeletionAuthorized",
 "productionApproved","deploymentAuthorized"])assert.equal(r[k],false,k);
};
test("missing manifest cannot activate Clerk",()=>noAuthority(inspect()));
test("official SDK package and fourteen unique probes are identified",()=>{
 assert.equal(plan().recommendedPackage,"@clerk/backend");
 assert.equal(PHASE29_REQUIRED_PROBES.length,14);
 assert.equal(new Set(PHASE29_REQUIRED_PROBES).size,14);
 assert.equal(Object.isFrozen(PHASE29_REQUIRED_PROBES),true);
});
test("fully self-reported manifest never verifies real Clerk token",()=>{
 const r=inspect(valid());noAuthority(r);
 assert.equal(r.reason,"INDEPENDENT_REAL_SDK_PROOF_REQUIRED");
 assert.ok(r.checks.every(c=>c.result==="CLAIM_ONLY"));
});
test("Clerk plan never approves installing SDK or provider credentials",()=>{
 const r=plan();noAuthority(r);
 assert.equal(r.checks.length,14);
 assert.ok(r.checks.every(c=>c.result==="PLANNED"));
});
test("production and nonlocal staging runtime rejected",()=>{
 for(const environment of ["production","staging","preview",undefined]){
  const r=inspect({...valid(),environment});noAuthority(r);
  assert.equal(r.reason,"INVALID_ENVIRONMENT");
 }
});
test("only workerd as requested runtime and only Clerk candidate",()=>{
 for(const change of [{runtime:"node"},{runtime:"browser"},{provider:"supabase-auth"}]){
  const r=inspect({...valid(),...change});noAuthority(r);
  assert.equal(r.reason,"INVALID_ENVIRONMENT");
 }
});
test("SDK must be @clerk/backend pinned to an exact version",()=>{
 for(const change of [{package:"@clerk/astro"},{package:"fake-sdk"},
  {version:"^1.0.0"},{version:"latest"},{version:"1.0.0-beta"},{version:""}]){
  const r=inspect({...valid(),...change});noAuthority(r);
  assert.equal(r.reason,"PACKAGE_NOT_EXACTLY_PINNED");
 }
});
test("provider fetch and non-session token modes fail closed",()=>{
 for(const change of [{allowProviderFetch:true},{networkless:false},
  {acceptsToken:"any"},{acceptsToken:"m2m_token"},{acceptsToken:"api_key"}]){
  const r=inspect({...valid(),...change});noAuthority(r);
  assert.equal(r.reason,"UNSAFE_SDK_MODE");
 }
});
test("non-loopback, wrong-origin and path origins never accepted",()=>{
 for(const change of [{authorizedParty:"https://reasonablenoise.com",requestOrigin:"https://reasonablenoise.com"},
  {authorizedParty:"http://10.0.0.1:8787",requestOrigin:"http://10.0.0.1:8787"},
  {requestOrigin:"http://127.0.0.1:8787"},
  {authorizedParty:"http://localhost:8787/path",requestOrigin:"http://localhost:8787/path"}]){
  const r=inspect({...valid(),...change});noAuthority(r);
  assert.equal(r.reason,"INVALID_LOCAL_ORIGIN");
 }
});
test("missing or malformed audience is blocked",()=>{
 for(const audience of ["","short","foo bar",null,undefined]){
  const r=inspect({...valid(),audience});noAuthority(r);
  assert.equal(r.reason,"MISSING_AUDIENCE");
 }
});
test("secret, public key, publishable key and token may not be embedded",()=>{
 for(const field of ["secretKey","jwtKey","publishableKey","token"]){
  const r=inspect({...valid(),[field]:"DO_NOT_COMMIT_KEY"});noAuthority(r);
  assert.equal(r.reason,"CREDENTIAL_MATERIAL_FORBIDDEN");
 }
});
test("missing and duplicate probe claims never count as actual tests",()=>{
 let r=inspect({...valid(),probeResults:[]});noAuthority(r);
 assert.equal(r.checks.filter(c=>c.result==="MISSING").length,14);
 const s=valid();s.probeResults.push(probe(PHASE29_REQUIRED_PROBES[0]));
 r=inspect(s);noAuthority(r);
 assert.equal(r.checks[0].result,"DUPLICATE");
});
test("failed, not-run and invalid statuses remain blockers",()=>{
 const v=valid();
 v.probeResults[0].result="fail";
 v.probeResults[1].result="not-run";
 v.probeResults[2].result="approved";
 const r=inspect(v);noAuthority(r);
 assert.deepEqual(r.checks.slice(0,3).map(x=>x.result),
  ["FAIL","NOT_RUN","INVALID_RESULT"]);
});
test("malformed manifest and unknown probe stay rejected",()=>{
 for(const x of [null,[],true,"abc",{...valid(),probeResults:"all pass"},
  {...valid(),probeResults:[null]},
  {...valid(),probeResults:[{name:"enable-dtf-checkout",result:"self-reported-pass"}]}])
  noAuthority(inspect(x));
});
test("no SDK import, live route, network, R2/D1, checkout or payment side effects",()=>{
 assert.doesNotMatch(source,/from\s+["']@clerk|import\s*\(["']@clerk|onRequestPost|fetch\s*\(|\.prepare\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
 assert.match(source,/INDEPENDENT_REAL_SDK_PROOF_REQUIRED/);
});
