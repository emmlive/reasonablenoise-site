// RN-3B1C Phase32: official Clerk verifyToken() executing in disposable
// Workerd with synthetic local RS256 fixtures. NO Clerk-issued tokens or authority.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {join} from "node:path";
import {existsSync,readFileSync,writeFileSync,mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {generateKeyPairSync,sign} from "node:crypto";

const root=process.env.RN_CLERK_WORKERD_ROOT;
const now=Math.floor(Date.now()/1000);
const fixtureIssuer="https://local-fixture.clerk.accounts.dev";
const fixtureAudience="rn_phase32_synthetic";
const fixtureOrigin="http://localhost:8787";
const b64=value=>Buffer.from(JSON.stringify(value)).toString("base64url");

test("actual Clerk SDK verifyToken checks synthetic RS256 fixtures in Workerd without granting identity",async()=>{
 assert.ok(root&&existsSync(join(root,"package.json")),"isolated SDK root required");
 const require=createRequire(join(root,"package.json"));
 const pkg=name=>JSON.parse(readFileSync(join(root,"node_modules",...name.split("/"),"package.json"),"utf8"));
 assert.equal(pkg("@clerk/backend").version,"3.29.0");
 assert.equal(pkg("miniflare").version,"4.20260730.0");
 assert.equal(pkg("esbuild").version,"0.28.2");
 const {build}=require("esbuild");
 const {Miniflare}=require("miniflare");
 const makeKeys=()=>generateKeyPairSync("rsa",{
  modulusLength:2048,
  publicKeyEncoding:{type:"spki",format:"pem"},
  privateKeyEncoding:{type:"pkcs8",format:"pem"}
 });
 const keys=makeKeys(),foreignKeys=makeKeys();
 const claims={
  iss:fixtureIssuer,sub:"user_phase32_synthetic_only",sid:"sess_phase32_synthetic_only",
  aud:fixtureAudience,azp:fixtureOrigin,
  iat:now-10,nbf:now-10,exp:now+180
 };
 const issue=(payload,privateKey=keys.privateKey)=>{
  const signingInput=b64({alg:"RS256",typ:"JWT"})+"."+b64(payload);
  return signingInput+"."+sign("RSA-SHA256",Buffer.from(signingInput),privateKey).toString("base64url");
 };
 const valid=issue(claims);
 const signature=valid.split(".")[2];
 const tampered=valid.split(".").slice(0,2).join(".")+"."+
  (signature.startsWith("A")?"B":"A")+signature.slice(1);
 const cases=[
  ["valid",valid,true],
  ["tampered-signature",tampered,false],
  ["foreign-signing-key",issue(claims,foreignKeys.privateKey),false],
  ["expired",issue({...claims,iat:now-400,nbf:now-400,exp:now-90}),false],
  ["future-nbf",issue({...claims,iat:now+120,nbf:now+120,exp:now+240}),false],
  ["wrong-audience",issue({...claims,aud:"wrong_synthetic_aud"}),false],
  ["wrong-authorized-party",issue({...claims,azp:"https://foreign.invalid"}),false],
  ["wrong-issuer",issue({...claims,iss:"https://foreign.invalid"}),false],
  ["no-token","",false]
 ];
 const out=mkdtempSync(join(tmpdir(),"rn-phase32-clerk-"));
 const entry=join(root,"phase32-entry.mjs"),bundle=join(out,"worker.mjs");
 const worker=[
  'import {verifyToken} from "@clerk/backend";',
  'const cases=__FIXTURES__;',
  'export default {async fetch(request){',
  ' if(new URL(request.url).pathname!=="/__rn_phase32_synthetic_jwt_probe")',
  '  return new Response("not found",{status:404});',
  ' const originalFetch=globalThis.fetch;let networkAttempts=0;',
  ' globalThis.fetch=async()=>{networkAttempts++;throw Error("EXTERNAL_NETWORK_FORBIDDEN");};',
  ' try{const verdicts=[];let validFixtureDiagnostic="NOT_RUN";',
  ' for(const [name,token] of cases){',
  '  let verified=false,diagnostic="NOT_EVALUATED";',
  '  try{if(token){',
  '   const result=await verifyToken(token,{jwtKey:__PUBLIC_KEY__,',
  '    issuer:__ISSUER__,audience:__AUDIENCE__,',
  '    authorizedParties:[__ORIGIN__],clockSkewInMs:0});',
  '   const isWrapped=result!==null&&typeof result==="object"&&',
  '     (Object.hasOwn(result,"data")||Object.hasOwn(result,"errors"));',
  '   const hasErrors=isWrapped&&Array.isArray(result.errors)&&result.errors.length>0;',
  '   const claims=isWrapped?result.data:result;',
  '   verified=!hasErrors&&claims?.sub==="user_phase32_synthetic_only"&&',
  '     claims?.sid==="sess_phase32_synthetic_only";',
  '   diagnostic=verified?"CLAIMS_VERIFIED":hasErrors?"SDK_RETURNED_ERRORS":',
  '     claims==null?"NO_CLAIMS":"CLAIMS_MISMATCH";',
  '  }else{diagnostic="EMPTY_TOKEN";}',
  '  }catch(error){diagnostic=error instanceof Error?',
  '    (error.name==="TokenVerificationError"?"TOKEN_VERIFICATION_EXCEPTION":',
  '     "SDK_EXCEPTION"):"UNKNOWN_EXCEPTION";}',
  '  verdicts.push({name,verified});',
  '  if(name==="valid"&&!verified)validFixtureDiagnostic=diagnostic;',
  ' }',
  ' return Response.json({scope:"SYNTHETIC_CRYPTO_ONLY",',
  '  verdicts,validFixtureDiagnostic,networkAttempts,customerPrincipal:null,',
  '  localSessionAuthorized:false,dtfCheckoutEnabled:false,',
  '  paymentAuthorized:false,artworkDeletionAuthorized:false,',
  '  productionApproved:false});',
  ' }finally{globalThis.fetch=originalFetch;}',
  '}};'
 ].join("\n")
  .replaceAll("__FIXTURES__",JSON.stringify(cases.map(([name,token])=>[name,token])))
  .replaceAll("__PUBLIC_KEY__",JSON.stringify(keys.publicKey))
  .replaceAll("__ISSUER__",JSON.stringify(fixtureIssuer))
  .replaceAll("__AUDIENCE__",JSON.stringify(fixtureAudience))
  .replaceAll("__ORIGIN__",JSON.stringify(fixtureOrigin));
 writeFileSync(entry,worker,"utf8");
 await build({entryPoints:[entry],outfile:bundle,bundle:true,
  platform:"browser",format:"esm",target:"es2022",external:["node:*"],
  mainFields:["browser","module","main"],
  conditions:["workerd","worker","browser"],logLevel:"silent"});
 assert.ok(readFileSync(bundle,"utf8").length>1000);
 let mf;
 try{
  mf=new Miniflare({modules:true,modulesRoot:out,scriptPath:bundle,
   compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"]});
  const response=await mf.dispatchFetch("http://localhost:8787/__rn_phase32_synthetic_jwt_probe");
  assert.equal(response.status,200,"Workerd synthetic crypto probe must run");
  const data=await response.json();
  assert.equal(data.scope,"SYNTHETIC_CRYPTO_ONLY");
  assert.deepEqual(data.verdicts,cases.map(([name,,expected])=>({name,verified:expected})),
   `synthetic verifier mismatch; valid fixture diagnostic: ${data.validFixtureDiagnostic}`);
  assert.equal(data.validFixtureDiagnostic,"CLAIMS_VERIFIED");
  assert.equal(data.networkAttempts,0);
  for(const name of ["customerPrincipal","localSessionAuthorized","dtfCheckoutEnabled",
   "paymentAuthorized","artworkDeletionAuthorized","productionApproved"]){
   assert.equal(data[name],name==="customerPrincipal"?null:false,name);
  }
  const wrong=await mf.dispatchFetch("http://localhost:8787/not-an-auth-route");
  assert.equal(wrong.status,404);
 }finally{if(mf)await mf.dispose();}
});