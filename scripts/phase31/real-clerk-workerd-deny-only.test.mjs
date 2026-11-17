// Phase31: execute the actual pinned Clerk SDK within a disposable Miniflare
// workerd runtime. Missing-secret failure only, not positive authentication.
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {join} from "node:path";
import {existsSync,readFileSync,writeFileSync,mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {generateKeyPairSync} from "node:crypto";

const root=process.env.RN_CLERK_WORKERD_ROOT;
test("actual Clerk SDK bundle runs missing-secret fail-closed probe in workerd",async()=>{
 assert.ok(root&&existsSync(join(root,"package.json")),"isolated SDK root required");
 const require=createRequire(join(root,"package.json"));
 const pkg=name=>JSON.parse(readFileSync(join(root,"node_modules",...name.split("/"),"package.json"),"utf8"));
 assert.equal(pkg("@clerk/backend").version,"3.29.0");
 assert.equal(pkg("esbuild").version,"0.28.2");
 assert.equal(pkg("miniflare").version,"4.20260730.0");
 const {build}=require("esbuild");
 const {Miniflare}=require("miniflare");
 const {publicKey}=generateKeyPairSync("rsa",{
  modulusLength:2048,
  publicKeyEncoding:{type:"spki",format:"pem"},
  privateKeyEncoding:{type:"pkcs8",format:"pem"}
 });
 const output=mkdtempSync(join(tmpdir(),"rn-phase31-workerd-"));
 const source=join(root,"phase31-entry.mjs"),bundle=join(output,"worker.mjs");
 const frontendKey="pk_test_"+Buffer.from("local-fixture.clerk.accounts.dev$").toString("base64");
 const worker=[
 'import {createClerkClient} from "@clerk/backend";',
 'const client=createClerkClient({publishableKey:__FRONTEND_KEY__,jwtKey:__PUBLIC_KEY__});',
 'export default { async fetch(request) {',
 ' if(new URL(request.url).pathname!=="/__rn_phase31_local_probe")',
 '  return new Response("not found",{status:404});',
 ' const previousFetch=globalThis.fetch; let networkAttempts=0;',
 ' globalThis.fetch=async()=>{networkAttempts++;throw Error("PROVIDER_NETWORK_FORBIDDEN");};',
 ' try {',
 '  const probe=new Request("http://localhost:8787/test-only",{method:"POST",',
 '    headers:{origin:"http://localhost:8787"}});',
 '  try {',
 '   const result=await client.authenticateRequest(probe,{',
 '    jwtKey:__PUBLIC_KEY__,authorizedParties:["http://localhost:8787"],',
 '    acceptsToken:"session_token",audience:"rn_test_only"});',
 '   return Response.json({result:"UNEXPECTED_SDK_RETURN",',
 '     authenticated:result.isAuthenticated===true,networkAttempts},{status:500});',
 '  } catch(err) {',
 '   if(!(err instanceof Error)||!err.message.includes("Missing Clerk Secret Key"))',
 '    return Response.json({result:"UNEXPECTED_SDK_ERROR",networkAttempts},{status:500});',
 '   return Response.json({result:"MISSING_KEY_DENIED",networkAttempts,',
 '    authenticated:false,customerPrincipal:null,paymentAuthorized:false,',
 '    quoteAcceptanceAuthorized:false,artworkDeletionAuthorized:false});',
 '  }',
 ' } finally { globalThis.fetch=previousFetch; }',
 '}};'
 ].join("\n").replaceAll("__PUBLIC_KEY__",JSON.stringify(publicKey))
  .replaceAll("__FRONTEND_KEY__",JSON.stringify(frontendKey));
 writeFileSync(source,worker,"utf8");
 await build({entryPoints:[source],outfile:bundle,bundle:true,
  platform:"browser",format:"esm",target:"es2022",external:["node:*"],
  mainFields:["browser","module","main"],
  conditions:["workerd","worker","browser"],logLevel:"silent"});
 const bundled=readFileSync(bundle,"utf8");
 assert.ok(bundled.length>1000,"empty SDK bundle");
 let mf;
 try{
  mf=new Miniflare({modules:true,scriptPath:bundle,
   compatibilityDate:"2026-08-06",
   compatibilityFlags:["nodejs_compat"]});
  const response=await mf.dispatchFetch("http://localhost:8787/__rn_phase31_local_probe");
  assert.equal(response.status,200,"workerd failed SDK missing-key denial probe");
  const data=await response.json();
  assert.deepEqual(data,{
   result:"MISSING_KEY_DENIED",networkAttempts:0,
   authenticated:false,customerPrincipal:null,paymentAuthorized:false,
   quoteAcceptanceAuthorized:false,artworkDeletionAuthorized:false
  });
  const outside=await mf.dispatchFetch("http://localhost:8787/not-a-customer-route");
  assert.equal(outside.status,404);
 }finally{
  if(mf)await mf.dispose();
 }
});