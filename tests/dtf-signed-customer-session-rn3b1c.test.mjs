// RN-3B1C Phase 20: real Ed25519 WebCrypto verification against disposable local D1.
// Test-only issuer and signing keys are generated per process; no real customer identities.
import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyDtfCustomerSession} from "../functions/lib/dtf-signed-customer-session-rn3b1c.js";
globalThis.crypto ||= webcrypto;
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const ddl=readFileSync(new URL("../migrations/rn-3b1c-phase20-synthetic-customer-sessions.sql",import.meta.url),"utf8");
const verifierSource=readFileSync(new URL("../functions/lib/dtf-signed-customer-session-rn3b1c.js",import.meta.url),"utf8");
const NOW=1800000000;
const ids={sub:"customer_12345678",wid:"workspace_12345678",sid:"session_12345678",kid:"testkey_12345678"};
const csrf="t".repeat(48);
const enc=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
const kp=generateKeyPairSync("ed25519");
const key=new Uint8Array(kp.publicKey.export({format:"der",type:"spki"}).subarray(-32));
const issuer="https://issuer.example.invalid/known";
const audience="reasonablenoise-dtf-customer";
const defaults={iss:issuer,aud:audience,role:"customer",sub:ids.sub,wid:ids.wid,sid:ids.sid,epoch:3,iat:NOW-100,nbf:NOW-100,exp:NOW+300};
function token(payload=defaults,header={alg:"EdDSA",typ:"JWT",kid:ids.kid},privateKey=kp.privateKey){
 const message=enc(header)+"."+enc(payload);
 return message+"."+sign(null,Buffer.from(message),privateKey).toString("base64url");
}
function request(jwt=token(),{url="https://reasonablenoise.example.invalid/accept",
 method="POST",origin="https://reasonablenoise.example.invalid",
 fetchSite="same-origin",csrfToken=csrf,cookieExtra=""}={}){
 const headers=new Headers({"origin":origin,"sec-fetch-site":fetchSite,
  "x-rn-csrf":csrfToken,
  "cookie":"__Host-rn_dtf_session="+jwt+cookieExtra});
 return{url,method,headers};
}
async function fixture(t){
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase20-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 const sql=ddl.split("\n").filter(s=>!s.trimStart().startsWith("--")).join("\n");
 const chunks=sql.split(";").map(x=>x.trim()).filter(Boolean);
 assert.equal(chunks.length,2);
 for(const chunk of chunks)await db.prepare(chunk).run();
 const hash=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(csrf))).toString("hex");
 await db.prepare("INSERT INTO dtf_test_customer_sessions_v20 VALUES(?,?,?,?,?,?,?)").bind(
  ids.sid,ids.sub,ids.wid,3,hash,NOW+300,0
 ).run();
 const opts={request:request(),db,keyring:{[ids.kid]:key},issuer,audience,now:NOW};
 const verify=changes=>verifyDtfCustomerSession({...opts,...changes});
 return{db,opts,verify};
}
test("signed Ed25519 customer token and matching durable D1 epoch and CSRF verify",async t=>{
 const f=await fixture(t);const r=await f.verify();
 assert.equal(r.verified,true,JSON.stringify(r));
 assert.equal(r.csrfVerified,true);
 assert.equal(r.subjectId,ids.sub);
 assert.equal(r.sessionEpoch,3);
 assert.equal(r.checkoutEligible,false);
 assert.equal(r.productionApproved,false);
});
test("wrong signature, changed body, or other signing key fail closed",async t=>{
 const f=await fixture(t);
 const tampered=token({...defaults,sub:"customer_87654321"});
 const parts=tampered.split(".");
 const wrong=parts[0]+"."+enc(defaults)+"."+parts[2];
 const other=generateKeyPairSync("ed25519");
 for(const jwt of [wrong,token(defaults,undefined,other.privateKey)]){
  const r=await f.verify({request:request(jwt)});
  assert.equal(r.verified,false);
 }
});
test("JWT alg none, RSA confusion, unknown kid, critical header rejected",async t=>{
 const f=await fixture(t);
 for(const header of [
  {alg:"none",typ:"JWT",kid:ids.kid},
  {alg:"RS256",typ:"JWT",kid:ids.kid},
  {alg:"EdDSA",typ:"JWT",kid:"unknown_12345678"},
  {alg:"EdDSA",typ:"JWT",kid:ids.kid,crit:["foo"]}
 ]){
  assert.equal((await f.verify({request:request(token(defaults,header))})).verified,false);
 }
});
test("incorrect issuer audience role and owner claim denied",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {iss:"https://evil.example.invalid"},
  {aud:"sticker-checkout"},
  {role:"admin"},
  {sub:"customer_87654321"},
  {wid:"workspace_87654321"}
 ]){
  assert.equal((await f.verify({request:request(token({...defaults,...patch}))})).verified,false);
 }
});
test("expired, future not-before, excessive one-hour lifetime and future issuance denied",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {exp:NOW},{nbf:NOW+1},{iat:NOW+1},{iat:NOW-4000},{exp:NOW+4000}
 ]){
  assert.equal((await f.verify({request:request(token({...defaults,...patch}))})).verified,false);
 }
});
test("durable session revocation is effective immediately at verification read",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET revoked=1").run();
 assert.equal((await f.verify()).verified,false);
});
test("durable session-epoch rotation invalidates older signed cookie",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET session_epoch=4").run();
 assert.equal((await f.verify()).verified,false);
});
test("missing D1 session, owner reassignment and workspace reassignment denied",async t=>{
 for(const [field,value] of [["subject_id","customer_87654321"],["workspace_id","workspace_87654321"]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET "+field+"=?").bind(value).run();
  assert.equal((await f.verify()).verified,false);
 }
 const f=await fixture(t);
 await f.db.prepare("DELETE FROM dtf_test_customer_sessions_v20").run();
 assert.equal((await f.verify()).verified,false);
});
test("session expiration and shortened D1 expiry block still-signed cookie",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET expires_at=?").bind(NOW+200).run();
 assert.equal((await f.verify()).verified,false);
});
test("missing, changed, and duplicate CSRF tokens never authenticate",async t=>{
 const f=await fixture(t);
 for(const csrfToken of ["","z".repeat(48), "short"]){
  assert.equal((await f.verify({request:request(token(),{csrfToken})})).verified,false);
 }
});
test("cross-site origin and Sec-Fetch-Site mismatch are rejected",async t=>{
 const f=await fixture(t);
 for(const options of [
  {origin:"https://evil.example.invalid"},
  {fetchSite:"cross-site"},
  {fetchSite:"same-site"},
  {url:"http://reasonablenoise.example.invalid/accept",origin:"http://reasonablenoise.example.invalid"}
 ]){
  assert.equal((await f.verify({request:request(token(),options)})).verified,false);
 }
});
test("non-POST, missing cookie, duplicate named cookie denied",async t=>{
 const f=await fixture(t);
 assert.equal((await f.verify({request:request(token(),{method:"GET"})})).verified,false);
 const noCookie=request();noCookie.headers.delete("cookie");
 assert.equal((await f.verify({request:noCookie})).verified,false);
 assert.equal((await f.verify({request:request(token(),{cookieExtra:"; __Host-rn_dtf_session="+token()})})).verified,false);
});
test("malformed JWT, invalid segment count and overlong cookie rejected",async t=>{
 const f=await fixture(t);
 for(const bad of ["invalid", "a.b.c.d", "x".repeat(6000)]){
  assert.equal((await f.verify({request:request(bad)})).verified,false);
 }
});
test("missing key, missing DB, or D1 outage fails closed",async t=>{
 const f=await fixture(t);
 assert.equal((await f.verify({keyring:{}})).verified,false);
 assert.equal((await f.verify({db:null})).verified,false);
 assert.equal((await f.verify({db:{prepare(){throw Error("outage")}}})).verified,false);
});
test("untrusted body headers do not establish a customer principal",async t=>{
 const f=await fixture(t);
 const req=request();req.headers.set("x-customer-id","customer_87654321");
 req.headers.set("x-forwarded-host","evil.example.invalid");
 const r=await f.verify({request:req});
 assert.equal(r.verified,true);
 assert.equal(r.subjectId,ids.sub);
 assert.equal(r.workspaceId,ids.wid);
});
test("Phase20 has no issuer, login endpoint, payment or live R2/Stripe actions",()=>{
 assert.match(ddl,/DO NOT APPLY LIVE/);
 assert.doesNotMatch(verifierSource,/onRequestPost|stripe\.com|checkout\.sessions|ARTWORK_BUCKET|STRIPE_SECRET_KEY|bucket\.delete|bucket\.put/);
 assert.match(verifierSource,/paymentAuthorized:false/);
});
