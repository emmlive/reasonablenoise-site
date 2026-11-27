import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {verifyAdminAccessAssertion,readApprovedPrintFile} from "../src/lib/print-library-secure-core.mjs";

const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),alg:"RS256",use:"sig",kid:"test-key-1"};
const config={jwks:[jwk],issuer:"https://test-team.cloudflareaccess.com",audience:"app-audience-123",
  allowedEmails:["printing@example.test"],nowSeconds:1800000000};
const claim={iss:config.issuer,aud:config.audience,sub:"user-abc",email:"printing@example.test",
  iat:1799999950,nbf:1799999950,exp:1800000500};
function base64url(v){return Buffer.from(typeof v==="string"?v:JSON.stringify(v)).toString("base64url");}
function jwt(payload=claim,header={alg:"RS256",typ:"JWT",kid:"test-key-1"},key=privateKey){
  const input=base64url(header)+"."+base64url(payload);
  return input+"."+sign("RSA-SHA256",Buffer.from(input),key).toString("base64url");
}
function request(token=jwt(),extra={}){
 return new Request("https://isolated.example.test/admin",{headers:{
  ...(token?{"cf-access-jwt-assertion":token}:{}),...extra}});
}
const untrusted={ok:true,reason:"verified_access_assertion"};
const bytes=new TextEncoder().encode("SYNTHETIC PRINT ART — NOT A REAL CUSTOMER FILE");
const hash=createHash("sha256").update(bytes).digest("hex");
const record={id:"spirit",version:"v1",status:"print_ready",printReady:true,
  rightsConfirmed:true,proofApproved:true,approverId:"admin-001",
  approvedAt:"2026-11-27T22:00:00Z",sha256:hash,proofId:"proof_123456",
  widthPx:3600,heightPx:4200,printWidthInches:12,printHeightInches:14,
  mimeType:"image/png",printFileR2Key:"print-library/approved/spirit/v1/asset_123456.png"};
function bucket(blob=bytes){const calls=[];return {calls,get:async k=>{
 calls.push(k);return blob===null?null:{size:blob.byteLength,arrayBuffer:async()=>blob.buffer.slice(blob.byteOffset,blob.byteOffset+blob.byteLength)}
 }};}
const params=(override={})=>({
 authorizedIdentity:untrusted,approvalRecord:record,expectedDesignId:"spirit",
 expectedVersion:"v1",boundOrderReference:"RN-TEST-PRINT001",approvedOrderReference:"RN-TEST-PRINT001",
 bucket:bucket(),...override});
test("real RS256 signed Access assertion with pinned JWK identity passes",async()=>{
 const r=await verifyAdminAccessAssertion({...config,request:request()});
 assert.equal(r.ok,true);assert.equal(r.email,"printing@example.test");
 assert.equal(r.downloadAuthorized,false);assert.equal(r.printAuthorized,false);
});
test("unsigned or absent assertion rejected, even with asserted email header",async()=>{
 for(const token of [null,"not.jwt.value"]){
 const r=await verifyAdminAccessAssertion({...config,request:request(token,{
 "cf-access-authenticated-user-email":"printing@example.test"})});
 assert.equal(r.ok,false);
 }
});
test("fabricated unsigned JWT (alg none) rejected",async()=>{
 const token=base64url({alg:"none",typ:"JWT",kid:"test-key-1"})+"."+base64url(claim)+".unsigned";
 assert.equal((await verifyAdminAccessAssertion({...config,request:request(token)})).ok,false);
});
test("claims tamper rejected by cryptographic signature",async()=>{
 const parts=jwt().split(".");
 parts[1]=base64url({...claim,email:"another@example.test"});
 assert.equal((await verifyAdminAccessAssertion({...config,request:request(parts.join("."))})).ok,false);
});
test("forged admin email header alone never authorized",async()=>{
 const r=await verifyAdminAccessAssertion({...config,request:request(null,{
 "cf-access-authenticated-user-email":"printing@example.test","x-admin-order-token":"emergency"})});
 assert.equal(r.ok,false);
});
test("wrong issuer, audience and email rejected",async()=>{
 for(const change of [{iss:"https://wrong.cloudflareaccess.com"},{aud:"other"},
  {email:"outsider@example.test"},{sub:""}]){
 const r=await verifyAdminAccessAssertion({...config,request:request(jwt({...claim,...change}))});
 assert.equal(r.ok,false);
 }
});
test("expired, premature, absurd JWT TTL rejected",async()=>{
 for(const changes of [{exp:1799999999},{nbf:1800000500},
  {iat:1800000500},{iat:1700000000}]){
 const r=await verifyAdminAccessAssertion({...config,request:request(jwt({...claim,...changes}))});
 assert.equal(r.ok,false);
 }
});
test("unknown key ID or conflicting keys rejected",async()=>{
 const unknown=jwt(claim,{alg:"RS256",typ:"JWT",kid:"bad-key"});
 assert.equal((await verifyAdminAccessAssertion({...config,request:request(unknown)})).ok,false);
 assert.equal((await verifyAdminAccessAssertion({...config,jwks:[jwk,jwk],request:request()})).ok,false);
});
test("RS256 only, malformed alg and wrong key type rejected",async()=>{
 for(const header of [{alg:"HS256",typ:"JWT",kid:"test-key-1"},
  {alg:"RS256",typ:"unknown",kid:"test-key-1"}]){
 assert.equal((await verifyAdminAccessAssertion({...config,request:request(jwt(claim,header))})).ok,false);
 }
});
test("malformed token, oversized token and invalid configuration fail closed",async()=>{
 assert.equal((await verifyAdminAccessAssertion({...config,request:request("xxx")})).ok,false);
 assert.equal((await verifyAdminAccessAssertion({...config,request:request("A".repeat(8200))})).ok,false);
 assert.equal((await verifyAdminAccessAssertion({...config,jwks:[],request:request()})).ok,false);
});
test("exact approved private artwork version, SHA-256 and bound order read only",async()=>{
 const opts=params();const r=await readApprovedPrintFile(opts);
 assert.equal(r.ok,true);assert.equal(r.downloadAuthorized,true);
 assert.equal(r.printAuthorized,false);
 assert.equal(r.sha256,hash);assert.deepEqual(Array.from(r.bytes),Array.from(bytes));
 assert.deepEqual(opts.bucket.calls,[record.printFileR2Key]);
});
test("concept, proof-pending and missing rights rejected before R2",async()=>{
 for(const change of [{status:"concept"},{status:"proof_pending"},
   {proofApproved:false},{rightsConfirmed:false}]){
 const opts=params({approvalRecord:{...record,...change}});
 const r=await readApprovedPrintFile(opts);
 assert.equal(r.ok,false);assert.equal(opts.bucket.calls.length,0);
 }
});
test("unverified identity rejected before R2",async()=>{
 for(const who of [null,{ok:false},{}]){
 const opts=params({authorizedIdentity:who});
 assert.equal((await readApprovedPrintFile(opts)).ok,false);
 assert.equal(opts.bucket.calls.length,0);
 }
});
test("different order, design or version blocked before R2",async()=>{
 for(const override of [{boundOrderReference:"RN-OTHER-00001"},
   {expectedDesignId:"legends"},{expectedVersion:"v2"},
   {approvedOrderReference:""},{boundOrderReference:"../../orders"}]){
 const opts=params(override);
 assert.equal((await readApprovedPrintFile(opts)).ok,false);
 assert.equal(opts.bucket.calls.length,0);
 }
});
test("storage missing, mismatched hash and oversized files rejected",async()=>{
 const missing=params({bucket:bucket(null)});
 assert.equal((await readApprovedPrintFile(missing)).ok,false);
 const wrong=params({bucket:bucket(new TextEncoder().encode("tampered"))});
 const r=await readApprovedPrintFile(wrong);assert.equal(r.reason,"checksum_mismatch");
 const large=params({maxBytes:3});assert.equal((await readApprovedPrintFile(large)).ok,false);
});
test("read errors fail closed and no storage key accepted from request URL",async()=>{
 const opts=params({bucket:{get:async()=>{throw Error("private failure");}}});
 assert.equal((await readApprovedPrintFile(opts)).ok,false);
 const p=params({approvalRecord:{...record,printFileR2Key:"orders/2026/11/customer.png"}});
 assert.equal((await readApprovedPrintFile(p)).ok,false);
});
test("secure core remains UNMOUNTED with no network, payments or public endpoints",()=>{
 const s=readFileSync(new URL("../src/lib/print-library-secure-core.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(s,/onRequestPost|onRequestGet|fetch\(|\.put\(|\.delete\(|sk_live_|STRIPE_SECRET_KEY/);
 assert.match(s,/crypto\.subtle\.verify/);
 assert.match(s,/crypto\.subtle\.digest/);
});
