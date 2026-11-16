// Phase25: disposable RSA and ECDSA WebCrypto fixtures, never real provider tokens.
import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {verifyOfflineIdpFixture as verify} from "../functions/lib/dtf-offline-idp-crypto-poc-rn3b1c.js";
const source=readFileSync(new URL("../functions/lib/dtf-offline-idp-crypto-poc-rn3b1c.js",import.meta.url),"utf8");
const subtle=webcrypto.subtle,NOW=1800000000,origin="https://reasonablenoise.example.invalid";
const base64=value=>Buffer.from(value).toString("base64url");
const json=value=>base64(JSON.stringify(value));
let fixtureCache;
async function setup(){
 if(fixtureCache)return fixtureCache;
 const configs={
  clerk:{algorithm:{name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
   publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},
   alg:"RS256",issuer:"https://clerk.example.invalid",audience:"rn-test-clerk",
   claims:{azp:origin,sid:"clerk_session_12345678"}},
  "supabase-auth":{algorithm:{name:"ECDSA",namedCurve:"P-256"},
   alg:"ES256",issuer:"https://project.example.invalid/auth/v1",audience:"authenticated",
   claims:{role:"authenticated",session_id:"supabase_session_12345678"}}
 };
 const out={};
 for(const [provider,config] of Object.entries(configs)){
  const pair=await subtle.generateKey(config.algorithm,true,["sign","verify"]);
  const jwk=await subtle.exportKey("jwk",pair.publicKey);
  Object.assign(jwk,{kid:"test_key_12345678",alg:config.alg,use:"sig"});
  out[provider]={...config,pair,jwk,provider};
 }
 fixtureCache=out;return out;
}
async function signed(f,overrides={},headOverrides={}){
 const head={typ:"JWT",alg:f.alg,kid:f.jwk.kid,...headOverrides};
 const claims={iss:f.issuer,aud:f.audience,sub:"subject_12345678",
  iat:NOW-20,nbf:NOW-20,exp:NOW+80,...f.claims,...overrides};
 const signingInput=json(head)+"."+json(claims);
 const algo=f.alg==="RS256"?
  {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}:
  {name:"ECDSA",hash:"SHA-256"};
 const signature=await subtle.sign(algo,f.pair.privateKey,new TextEncoder().encode(signingInput));
 return signingInput+"."+base64(signature);
}
const args=(f,token)=>({provider:f.provider,token,keyring:{[f.jwk.kid]:f.jwk},
 issuer:f.issuer,audience:f.audience,authorizedParty:origin,now:NOW});
const noAuthority=r=>{
 assert.equal(r.customerPrincipal,null);
 for(const flag of ["sessionAuthorized","quoteAcceptanceAuthorized","checkoutEligible",
  "paymentAuthorized","deletionAuthorized","productionApproved"])
  assert.equal(r[flag],false,flag);
};
test("Clerk-shaped RSA2048 RS256 signature verifies locally but grants no account authority",async()=>{
 const f=(await setup()).clerk,r=await verify(args(f,await signed(f)));
 assert.equal(r.verified,true,JSON.stringify(r));
 assert.equal(r.providerSubject,"subject_12345678");
 noAuthority(r);
});
test("Supabase-shaped P-256 ES256 signature verifies locally but grants no order authority",async()=>{
 const f=(await setup())["supabase-auth"],r=await verify(args(f,await signed(f)));
 assert.equal(r.verified,true,JSON.stringify(r));
 noAuthority(r);
});
test("altered payload invalidates RSA and ECDSA signatures",async()=>{
 for(const f of Object.values(await setup())){
  const token=await signed(f);
  const bits=token.split(".");
  bits[1]=json({sub:"attacker_12345678"});
  const r=await verify(args(f,bits.join(".")));
  assert.equal(r.verified,false);
  noAuthority(r);
 }
});
test("wrong issuer and wrong audience reject cryptographically signed claims",async()=>{
 for(const f of Object.values(await setup())){
  for(const patch of [{iss:"https://evil.example.invalid"},{aud:"other-audience"}]){
   const r=await verify(args(f,await signed(f,patch)));
   assert.equal(r.verified,false);
  }
 }
});
test("unknown key ID and unpinned signing key reject",async()=>{
 const f=(await setup()).clerk;
 assert.equal((await verify(args(f,await signed(f,{}, {kid:"other_key_12345678"})))).verified,false);
 assert.equal((await verify({...args(f,await signed(f)),keyring:{}})).verified,false);
});
test("none and algorithm confusion rejected despite signature material",async()=>{
 const f=(await setup()).clerk;
 for(const alg of ["none","HS256","ES256"]){
  assert.equal((await verify(args(f,await signed(f,{}, {alg})))).verified,false);
 }
});
test("dangerous JOSE key reference and crit headers are denied",async()=>{
 const f=(await setup()).clerk;
 for(const p of [{jku:"https://evil.example.invalid"},{crit:["exp"]},
  {jwk:{kty:"RSA",n:"foo",e:"AQAB"}}]){
  assert.equal((await verify(args(f,await signed(f,{},p)))).verified,false);
 }
});
test("expired, not-yet-valid, future-issued and excessive lifetime tokens denied",async()=>{
 for(const f of Object.values(await setup())){
  for(const patch of [{exp:NOW},{nbf:NOW+1},{iat:NOW+1},
   {iat:NOW-10000,exp:NOW+1}]){
   assert.equal((await verify(args(f,await signed(f,patch)))).verified,false);
  }
 }
});
test("Clerk authorized party and session ID required",async()=>{
 const f=(await setup()).clerk;
 for(const patch of [{azp:"https://other.example.invalid"},{sid:"bad"}]){
  const r=await verify(args(f,await signed(f,patch)));
  assert.equal(r.verified,false);
 }
});
test("Supabase authenticated role and session ID required",async()=>{
 const f=(await setup())["supabase-auth"];
 for(const patch of [{role:"service_role"},{role:"anon"},{session_id:"bad"}]){
  const r=await verify(args(f,await signed(f,patch)));
  assert.equal(r.verified,false);
 }
});
test("missing authorizedParty, unsafe external origin and missing audience fail closed",async()=>{
 const f=(await setup()).clerk,token=await signed(f);
 for(const patch of [{authorizedParty:""},{authorizedParty:"http://remote.example.invalid"},
  {authorizedParty:"https://reasonablenoise.example.invalid/evil"},{audience:""}]){
  assert.equal((await verify({...args(f,token),...patch})).verified,false);
 }
});
test("provider mismatch and unknown provider never accept a signed token",async()=>{
 const fs=await setup(),clerk=fs.clerk;
 const token=await signed(clerk);
 assert.equal((await verify({...args(clerk,token),provider:"supabase-auth"})).verified,false);
 assert.equal((await verify({...args(clerk,token),provider:"auth0"})).verified,false);
});
test("private signing JWK, missing key and bad shapes are rejected",async()=>{
 const f=(await setup()).clerk,token=await signed(f);
 const secret=await subtle.exportKey("jwk",f.pair.privateKey);
 assert.equal((await verify({...args(f,token),keyring:{
  [f.jwk.kid]:{...secret,kid:f.jwk.kid,alg:f.alg,use:"sig"}
 }})).verified,false);
 for(const bad of [null,"", "a.b", "a.b.c.d", {}]){
  assert.equal((await verify({...args(f,token),token:bad})).verified,false);
 }
});
test("verified provider subject cannot substitute for signed local DTF principal",async()=>{
 const f=(await setup()).clerk,r=await verify(args(f,await signed(f,{
  workspaceId:"workspace_12345678",customerId:"customer_12345678",
  checkoutAuthorized:true,csrfVerified:true
 })));
 assert.equal(r.verified,true);
 noAuthority(r);
 assert.equal(r.workspaceId,undefined);
 assert.equal(r.csrfVerified,undefined);
});
test("source contains no live endpoint, D1, Stripe, R2 or provider fetch",()=>{
 assert.doesNotMatch(source,/onRequestPost|fetch\s*\(|\.prepare\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
 assert.match(source,/OFFLINE_PROVIDER_SHAPED_CRYPTO_ONLY/);
});
