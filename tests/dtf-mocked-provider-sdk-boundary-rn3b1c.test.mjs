import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectMockClerkSdkRequest as clerk,inspectMockSupabaseSdkRequest as supabase}
 from "../functions/lib/dtf-mocked-provider-sdk-boundary-rn3b1c.js";
const code=readFileSync(new URL("../functions/lib/dtf-mocked-provider-sdk-boundary-rn3b1c.js",import.meta.url),"utf8");
const origin="https://test.reasonablenoise.invalid";
const req=(headers={},method="POST",url=origin+"/test-only")=>
 new Request(url,{method,headers:{origin,...headers}});
const authenticated=()=>({
 isAuthenticated:true,status:"signed-in",tokenType:"session_token",
 toAuth:()=>({userId:"clerk_subject_12345678",sessionId:"clerk_session_12345678"})
});
const clerkClient=(state=authenticated())=>({authenticateRequest:async()=>state});
const bearer="Bearer "+"synthetic_token_1234567890";
const supabaseClient=(claims={role:"authenticated",sub:"supabase_subject_12345678",
 session_id:"supabase_session_12345678"})=>({auth:{getClaims:async()=>({data:{claims},error:null})}});
const noAuthority=r=>{
 assert.equal(r.customerPrincipal,null);
 assert.equal(r.workspaceId,null);
 for(const k of ["csrfVerified","sessionAuthorized","quoteAcceptanceAuthorized",
  "checkoutEligible","paymentAuthorized","deletionAuthorized","productionApproved"])
  assert.equal(r[k],false,k);
};
test("Clerk mock SDK authenticated session produces identity evidence only",async()=>{
 const r=await clerk({request:req(),clerkClient:clerkClient()});
 assert.equal(r.ok,true);assert.equal(r.provider,"clerk");
 assert.equal(r.providerSubject,"clerk_subject_12345678");noAuthority(r);
});
test("Clerk mock receives explicit authorizedParties and session token only",async()=>{
 let captured;
 const client={authenticateRequest:async(_request,options)=>{captured=options;return authenticated();}};
 const r=await clerk({request:req(),clerkClient:client});
 assert.equal(r.ok,true);noAuthority(r);
 assert.deepEqual(captured,{authorizedParties:[origin],acceptsToken:"session_token"});
});
test("Clerk signed-out and handshake states fail closed",async()=>{
 for(const status of ["signed-out","handshake"]){
  const r=await clerk({request:req(),clerkClient:clerkClient({...authenticated(),status})});
  assert.equal(r.ok,false);noAuthority(r);
 }
});
test("Clerk non-session token cannot impersonate customer",async()=>{
 for(const tokenType of ["api_key","m2m_token","oauth_token"]){
  const r=await clerk({request:req(),clerkClient:clerkClient({...authenticated(),tokenType})});
  assert.equal(r.ok,false);
 }
});
test("Clerk incorrect auth flag, missing subject or session is denied",async()=>{
 for(const state of [{...authenticated(),isAuthenticated:false},
  {...authenticated(),toAuth:()=>({userId:"bad",sessionId:"clerk_session_12345678"})},
  {...authenticated(),toAuth:()=>({userId:"clerk_subject_12345678",sessionId:"bad"})}]){
  const r=await clerk({request:req(),clerkClient:clerkClient(state)});
  assert.equal(r.ok,false);noAuthority(r);
 }
});
test("Clerk missing SDK, rejection and malformed state fail closed",async()=>{
 const cases=[undefined,{authenticateRequest:async()=>{throw Error("offline mock");}},
  {authenticateRequest:async()=>({isAuthenticated:true,status:"signed-in",tokenType:"session_token"})}];
 for(const client of cases){
  const r=await clerk({request:req(),clerkClient:client});
  assert.equal(r.ok,false);noAuthority(r);
 }
});
test("Supabase mock getClaims with bearer returns provider evidence only",async()=>{
 const r=await supabase({request:req({authorization:bearer}),supabase:supabaseClient()});
 assert.equal(r.ok,true);assert.equal(r.provider,"supabase-auth");
 assert.equal(r.providerSubject,"supabase_subject_12345678");noAuthority(r);
});
test("Supabase mock receives the supplied bearer token without cookie fallback",async()=>{
 let captured="";
 const client={auth:{getClaims:async token=>{captured=token;return {data:{claims:{
  role:"authenticated",sub:"supabase_subject_12345678",session_id:"supabase_session_12345678"
 }},error:null};}}};
 const r=await supabase({request:req({authorization:bearer,cookie:"fake=admin"}),
  supabase:client});
 assert.equal(r.ok,true);assert.equal(captured,bearer.slice(7));noAuthority(r);
});
test("Supabase no bearer or malformed bearer never invokes SDK",async()=>{
 let calls=0;
 const client={auth:{getClaims:async()=>{calls++;return {data:{claims:{}}};}}};
 for(const authorization of ["","Basic xyz","Bearer short","Bearer x y"]){
  const r=await supabase({request:req(authorization?{authorization}:{}),supabase:client});
  assert.equal(r.ok,false);noAuthority(r);
 }
 assert.equal(calls,0);
});
test("Supabase anon/service role or invalid subject/session are denied",async()=>{
 for(const claims of [
  {role:"anon",sub:"supabase_subject_12345678",session_id:"supabase_session_12345678"},
  {role:"service_role",sub:"supabase_subject_12345678",session_id:"supabase_session_12345678"},
  {role:"authenticated",sub:"bad",session_id:"supabase_session_12345678"},
  {role:"authenticated",sub:"supabase_subject_12345678",session_id:"bad"}]){
  const r=await supabase({request:req({authorization:bearer}),supabase:supabaseClient(claims)});
  assert.equal(r.ok,false);noAuthority(r);
 }
});
test("Supabase provider errors and SDK exceptions fail closed",async()=>{
 const cases=[
  {auth:{getClaims:async()=>({data:null,error:Error("synthetic")})}},
  {auth:{getClaims:async()=>{throw Error("synthetic");}}},
  {auth:{getClaims:async()=>({data:{claims:null},error:null})}},undefined];
 for(const client of cases){
  const r=await supabase({request:req({authorization:bearer}),supabase:client});
  assert.equal(r.ok,false);noAuthority(r);
 }
});
test("cross-site Origin, fetch-site and non-POST denied before any SDK call",async()=>{
 let calls=0;
 const client={authenticateRequest:async()=>{calls++;return authenticated();}};
 const cases=[
  req({origin:"https://evil.invalid"}),
  req({"sec-fetch-site":"cross-site"}),
  req({},"GET"),
  req({},"POST","http://remote.invalid/x")];
 for(const request of cases){
  const r=await clerk({request,clerkClient:client});
  assert.equal(r.ok,false);noAuthority(r);
 }
 assert.equal(calls,0);
});
test("Supabase cross-site and unsupported origin blocked before SDK",async()=>{
 let calls=0;
 const client={auth:{getClaims:async()=>{calls++;return {data:{claims:{}},error:null};}}};
 for(const request of [
  req({authorization:bearer,origin:"https://evil.invalid"}),
  req({authorization:bearer,"sec-fetch-site":"cross-site"}),
  req({authorization:bearer},"POST","http://other.invalid/x")]){
  const r=await supabase({request,supabase:client});
  assert.equal(r.ok,false);noAuthority(r);
 }
 assert.equal(calls,0);
});
test("forged customer IDs, workspace and payment claims do not cross trust boundary",async()=>{
 const c=clerkClient({...authenticated(),toAuth:()=>({
  userId:"clerk_subject_12345678",sessionId:"clerk_session_12345678",
  workspaceId:"workspace_12345678",checkoutAuthorized:true})});
 const r1=await clerk({request:req(),clerkClient:c});
 const r2=await supabase({request:req({authorization:bearer}),supabase:supabaseClient({
  role:"authenticated",sub:"supabase_subject_12345678",
  session_id:"supabase_session_12345678",workspaceId:"workspace_12345678",
  paymentAuthorized:true})});
 for(const r of [r1,r2]){assert.equal(r.ok,true);noAuthority(r);}
});
test("mock boundary has no SDK import, network, D1, Stripe, R2 or customer route",()=>{
 assert.doesNotMatch(code,/from\s+["']@clerk|from\s+["']@supabase|onRequestPost|fetch\s*\(|\.prepare\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
 assert.match(code,/PROVIDER_IDENTITY_EVIDENCE_ONLY/);
});
