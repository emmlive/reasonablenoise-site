// Phase20 contract integration: signed customer session → existing Phase19 quote acceptance.
// Everything stays in disposable local D1. No live auth, issuer, email or checkout.
import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,generateKeyPairSync,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {convertApprovedQuoteForReview} from "../functions/lib/dtf-quote-conversion-rn3b1c.js";
import {acceptReviewedDtfQuote} from "../functions/lib/dtf-customer-quote-acceptance-rn3b1c.js";
import {verifyDtfCustomerSession} from "../functions/lib/dtf-signed-customer-session-rn3b1c.js";
globalThis.crypto ||= webcrypto;
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const ddl=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
function statements(sql,n){
 const clean=sql.split(/\r?\n/).filter(l=>!/^\s*--/.test(l)).join("\n").trim();
 const found=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(found.length,n);
 assert.equal(found.reduce((str,part)=>str.replace(part,""),clean).trim(),"");
 return found;
}
const S=1800000000, MS=S*1000;
const ids={customer:"customer_12345678",workspace:"workspace_12345678",reviewer:"reviewer_12345678",
 quote:"quote_12345678",order:"dtf_order_12345678",catalog:"catalog_12345678",session:"session_12345678",kid:"testkey_12345678"};
const csrf="a".repeat(48);
const kp=generateKeyPairSync("ed25519");
const pub=new Uint8Array(kp.publicKey.export({type:"spki",format:"der"}).subarray(-32));
const issuer="https://issuer.invalid/phase20",audience="rn-dtf-customer";
const enc=v=>Buffer.from(JSON.stringify(v)).toString("base64url");
const claims={iss:issuer,aud:audience,role:"customer",sub:ids.customer,wid:ids.workspace,
 sid:ids.session,epoch:2,iat:S-30,nbf:S-30,exp:S+90};
function token(p=claims){
 const msg=enc({alg:"EdDSA",typ:"JWT",kid:ids.kid})+"."+enc(p);
 return msg+"."+sign(null,Buffer.from(msg),kp.privateKey).toString("base64url");
}
function request(tkn=token()){
 return {url:"https://reasonablenoise.example.invalid/dtf/accept",method:"POST",
  headers:new Headers({"origin":"https://reasonablenoise.example.invalid",
   "sec-fetch-site":"same-origin","x-rn-csrf":csrf,
   "cookie":"__Host-rn_dtf_session="+tkn})};
}
async function fixture(t){
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase20-auth-accept-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 const migrations=[
  ...statements(ddl("rn-3b1c-phase18-synthetic-quote-conversion.sql"),4),
  ...statements(ddl("rn-3b1c-phase19-synthetic-pricing-acceptance.sql"),5)
 ];
 for(const q of migrations)await db.prepare(q.replace(/;\s*$/,"")).run();
 const sql20=ddl("rn-3b1c-phase20-synthetic-customer-sessions.sql").split("\n").filter(l=>!l.trimStart().startsWith("--")).join("\n");
 for(const q of sql20.split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 const sha=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(csrf))).toString("hex");
 await db.prepare("INSERT INTO dtf_test_customer_sessions_v20 VALUES(?,?,?,?,?,?,?)").bind(
  ids.session,ids.customer,ids.workspace,2,sha,S+90,0).run();
 await db.prepare("INSERT INTO dtf_test_approved_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  ids.quote,"DTF-20261116-1234ABCD",ids.workspace,ids.customer,12,"provided","front",
  '{"M":4,"L":8}',"Navy",21600,"usd",1,1,1,"approved",ids.reviewer,MS-10000,MS+90000
 ).run();
 const converted=await convertApprovedQuoteForReview({
  db,authorizeOperator:async()=>({verified:true,role:"dtf_quote_reviewer",subjectId:ids.reviewer,workspaceId:ids.workspace}),
  quoteId:ids.quote,orderId:ids.order,now:MS-1000
 });
 assert.equal(converted.ok,true);
 await db.prepare("INSERT INTO dtf_test_pricing_catalog VALUES(?,?,?,?,?,?)").bind(
  ids.catalog,"usd","approved",ids.reviewer,MS-5000,1).run();
 await db.prepare("INSERT INTO dtf_test_quote_price_signoff VALUES(?,?,?,?,?,?)").bind(
  ids.quote,ids.catalog,21600,"approved",ids.reviewer,MS-2000).run();
 const args={db,request:request(),acceptanceId:"accept_12345678",orderId:ids.order,
  displayedCatalogVersion:ids.catalog,displayedTotalCents:21600,explicitConsent:true,now:MS,
  verifyCustomerSession:req=>verifyDtfCustomerSession({
   db,request:req,keyring:{[ids.kid]:pub},issuer,audience,now:S
  })
 };
 const accept=changes=>acceptReviewedDtfQuote({...args,...changes});
 const rows=async()=>(await db.prepare("SELECT * FROM dtf_test_customer_acceptances").all()).results;
 return{db,args,accept,rows};
}
test("valid cryptographic customer session + CSRF grants only review-only Phase19 quote acceptance",async t=>{
 const f=await fixture(t);
 const result=await f.accept();
 assert.equal(result.accepted,true,JSON.stringify(result));
 assert.equal(result.paymentAuthorized,false);
 const [row]=await f.rows();
 assert.equal(row.customer_subject_id,ids.customer);
 assert.equal(row.checkout_enabled,0);
});
test("revoking real signed customer session blocks downstream quote acceptance",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET revoked=1").run();
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("rotating session epoch blocks existing signed customer token at quote boundary",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET session_epoch=3").run();
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("signed session owner mismatch blocks quote acceptance even with exact price",async t=>{
 const f=await fixture(t);
 const other=token({...claims,sub:"customer_87654321"});
 assert.equal((await f.accept({request:request(other)})).ok,false);
 assert.equal((await f.rows()).length,0);
});
