// RN-3B1C Phase30: official @clerk/backend isolated SDK NO-SESSION smoke.
// This is intentionally deny-only; never trust a test fixture as customer identity.
import {createRequire} from "node:module";
import {join} from "node:path";
import {generateKeyPairSync} from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {existsSync} from "node:fs";

const root=process.env.RN_CLERK_OFFLINE_ROOT;
const safety=()=>({
  customerPrincipal:null,localSessionAuthorized:false,
  dtfQuoteAcceptanceAuthorized:false,dtfCheckoutEnabled:false,
  paymentAuthorized:false,artworkDeletionAuthorized:false,
  productionApproved:false,deploymentAuthorized:false
});
test("real pinned official Clerk SDK executes denied unauthenticated request without network",async()=>{
  assert.ok(root&&existsSync(join(root,"package.json")),"isolated package root is required");
  const require=createRequire(join(root,"package.json"));
  const pkg=require("@clerk/backend/package.json");
  assert.equal(pkg.version,"3.29.0");
  const sdk=require("@clerk/backend");
  assert.equal(typeof sdk.createClerkClient,"function");
  const {publicKey}=generateKeyPairSync("rsa",{
    modulusLength:2048,
    publicKeyEncoding:{type:"spki",format:"pem"},
    privateKeyEncoding:{type:"pkcs8",format:"pem"}
  });
  // Clerk-style test frontend publishable key, never a provider account credential.
  const publishableKey="pk_test_"+Buffer.from("local-fixture.clerk.accounts.dev$").toString("base64");
  const client=sdk.createClerkClient({publishableKey,jwtKey:publicKey});
  assert.equal(typeof client.authenticateRequest,"function");
  const priorFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error("NETWORK_FORBIDDEN");};
  try{
    const request=new Request("http://localhost:8787/test-only",{
      method:"POST",headers:{origin:"http://localhost:8787"}
    });
    const result=await client.authenticateRequest(request,{
      jwtKey:publicKey,authorizedParties:["http://localhost:8787"],
      acceptsToken:"session_token",audience:"rn_test_only",
    });
    assert.equal(result.isAuthenticated,false);
    assert.equal(calls,0,"SDK attempted provider network access");
    for(const [key,value] of Object.entries(safety())){
      assert.equal(value,key==="customerPrincipal"?null:false);
    }
  }finally{globalThis.fetch=priorFetch;}
});
