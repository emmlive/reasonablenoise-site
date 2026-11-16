// RN-3B1C Phase21 disposable D1 atomic session-revocation tests.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {convertApprovedQuoteForReview} from "../functions/lib/dtf-quote-conversion-rn3b1c.js";
import {acceptDtfQuoteWithAtomicSessionFence} from "../functions/lib/dtf-atomic-session-acceptance-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const ddl=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
const source=readFileSync(new URL("../functions/lib/dtf-atomic-session-acceptance-rn3b1c.js",import.meta.url),"utf8");
function parseStatements(src,expected){
 const clean=src.split(/\r?\n/).filter(line=>!/^\s*--/.test(line)).join("\n").trim();
 const found=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(found.length,expected);
 assert.equal(found.reduce((s,q)=>s.replace(q,""),clean).trim(),"");
 return found.map(q=>q.replace(/;\s*$/,""));
}
const MS=1800000000000, SEC=MS/1000;
const ids={quote:"quote_12345678",reference:"DTF-20261116-1234ABCD",
 owner:"customer_12345678",workspace:"workspace_12345678",reviewer:"reviewer_12345678",
 order:"dtf_order_12345678",catalog:"catalog_12345678",session:"session_12345678"};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase21-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 const queries=[
  ...parseStatements(ddl("rn-3b1c-phase18-synthetic-quote-conversion.sql"),4),
  ...parseStatements(ddl("rn-3b1c-phase19-synthetic-pricing-acceptance.sql"),5)
 ];
 for(const q of queries)await db.prepare(q).run();
 const sessionSQL=ddl("rn-3b1c-phase20-synthetic-customer-sessions.sql")
  .split(/\r?\n/).filter(l=>!l.trimStart().startsWith("--")).join("\n");
 for(const q of sessionSQL.split(";").map(x=>x.trim()).filter(Boolean))await db.prepare(q).run();
 await db.prepare("INSERT INTO dtf_test_customer_sessions_v20 VALUES(?,?,?,?,?,?,?)").bind(
  ids.session,ids.owner,ids.workspace,2,"a".repeat(64),SEC+90,0).run();
 await db.prepare("INSERT INTO dtf_test_approved_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  ids.quote,ids.reference,ids.workspace,ids.owner,12,"provided","front",
  '{"M":4,"L":8}',"Navy",21600,"usd",1,1,1,"approved",ids.reviewer,MS-10000,MS+90000
 ).run();
 const c=await convertApprovedQuoteForReview({db,authorizeOperator:async()=>({
  verified:true,role:"dtf_quote_reviewer",subjectId:ids.reviewer,workspaceId:ids.workspace
 }),quoteId:ids.quote,orderId:ids.order,now:MS-1000});
 assert.equal(c.ok,true,JSON.stringify(c));
 await db.prepare("INSERT INTO dtf_test_pricing_catalog VALUES(?,?,?,?,?,?)").bind(
  ids.catalog,"usd","approved",ids.reviewer,MS-5000,1).run();
 await db.prepare("INSERT INTO dtf_test_quote_price_signoff VALUES(?,?,?,?,?,?)").bind(
  ids.quote,ids.catalog,21600,"approved",ids.reviewer,MS-2000).run();
 const principal={verified:true,csrfVerified:true,role:"customer",subjectId:ids.owner,
  workspaceId:ids.workspace,sessionId:ids.session,sessionEpoch:2};
 const args={db,verifyCustomerSession:async()=>principal,request:{synthetic:true},
  acceptanceId:"accept_12345678",orderId:ids.order,displayedCatalogVersion:ids.catalog,
  displayedTotalCents:21600,explicitConsent:true,now:MS};
 const accept=patch=>acceptDtfQuoteWithAtomicSessionFence({...args,...patch});
 const rows=async()=>(await db.prepare("SELECT * FROM dtf_test_customer_acceptances").all()).results;
 return{db,args,principal,accept,rows};
}
test("valid verified session and current D1 epoch atomically accept one review-only quote",async t=>{
 const f=await fixture(t);
 const result=await f.accept();
 assert.equal(result.ok,true,JSON.stringify(result));
 const [row]=await f.rows();
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(row.accepted_total_cents,21600);
 assert.equal(row.checkout_enabled,0);
 assert.equal(result.paymentAuthorized,false);
});
test("revocation AFTER prior verification but BEFORE INSERT fails closed",async t=>{
 const f=await fixture(t);
 const original=f.args.verifyCustomerSession;
 const r=await f.accept({verifyCustomerSession:async request=>{
  const principal=await original(request);
  await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET revoked=1").run();
  return principal;
 }});
 assert.equal(r.ok,false);
 assert.equal((await f.rows()).length,0);
});
test("epoch rotation AFTER verifier return but BEFORE INSERT blocks acceptance",async t=>{
 const f=await fixture(t);
 const r=await f.accept({verifyCustomerSession:async()=>{
  await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET session_epoch=3").run();
  return f.principal;
 }});
 assert.equal(r.ok,false);
 assert.equal((await f.rows()).length,0);
});
test("subject reassignment or workspace change after prior verify denies",async t=>{
 for(const [col,value] of [["subject_id","customer_87654321"],["workspace_id","workspace_87654321"]]){
  const f=await fixture(t);
  const r=await f.accept({verifyCustomerSession:async()=>{
   await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET "+col+"=?").bind(value).run();
   return f.principal;
  }});
  assert.equal(r.ok,false,col);
  assert.equal((await f.rows()).length,0);
 }
});
test("session expiration at exact write time and shortened expiry deny",async t=>{
 for(const expiry of [SEC,SEC-1]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET expires_at=?").bind(expiry).run();
  assert.equal((await f.accept()).ok,false);
 }
});
test("concurrent revoke versus acceptance never records acceptance after committed revoke",async t=>{
 const f=await fixture(t);
 // The verifier intentionally returns a stale previously verified principal.
 // D1 revocation is committed first; a batch of competing accepts cannot win afterward.
 await f.db.prepare("UPDATE dtf_test_customer_sessions_v20 SET revoked=1").run();
 const attempts=await Promise.all(Array.from({length:20},(_,i)=>f.accept({
  acceptanceId:"accept_12345678_"+String(i)
 })));
 assert.equal(attempts.some(x=>x.ok),false);
 assert.equal((await f.rows()).length,0);
});
test("twenty concurrent valid acceptance attempts still produce exactly one record",async t=>{
 const f=await fixture(t);
 const attempts=await Promise.all(Array.from({length:20},(_,i)=>f.accept({
  acceptanceId:"accept_12345678_"+String(i)
 })));
 assert.equal(attempts.filter(x=>x.ok).length,1);
 assert.equal((await f.rows()).length,1);
});
test("quote status or amount changed after verifier return is rejected at write",async t=>{
 for(const [col,value] of [["quote_status","cancelled"],["approved_total_cents",25000]]){
  const f=await fixture(t);
  const r=await f.accept({verifyCustomerSession:async()=>{
   await f.db.prepare("UPDATE dtf_test_approved_quotes SET "+col+"=?").bind(value).run();
   return f.principal;
  }});
  assert.equal(r.ok,false,col);
  assert.equal((await f.rows()).length,0);
 }
});
test("unverified principal, absent CSRF, missing session epoch fail before D1 write",async t=>{
 const f=await fixture(t);
 for(const patch of [{verified:false},{csrfVerified:false},{sessionEpoch:undefined},{sessionId:"bad"}]){
  assert.equal((await f.accept({verifyCustomerSession:async()=>({...f.principal,...patch})})).ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("displayed amount/version mismatch and no explicit consent reject",async t=>{
 const f=await fixture(t);
 for(const patch of [{displayedTotalCents:1},{displayedCatalogVersion:"catalog_87654321"},
  {explicitConsent:false}]){
  assert.equal((await f.accept(patch)).ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("malicious caller owner/amount/checkout values cannot override signed principal",async t=>{
 const f=await fixture(t);
 const r=await f.accept({customerId:"customer_87654321",workspaceId:"workspace_87654321",
  amountCents:1,checkout:true});
 assert.equal(r.ok,true);
 const [row]=await f.rows();
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(row.accepted_total_cents,21600);
 assert.equal(row.checkout_enabled,0);
});
test("SQL failure and verifier outage return fail-closed, no payment authority",async t=>{
 const f=await fixture(t);
 for(const patch of [{db:{prepare(){throw Error("offline")}}},
  {verifyCustomerSession:async()=>{throw Error("offline")}}]){
  const r=await f.accept(patch);
  assert.equal(r.ok,false);
  assert.equal(r.paymentAuthorized,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("Phase21 is non-routed, no Stripe, Cloudflare live R2 or email side effects",()=>{
 assert.doesNotMatch(source,/onRequestPost|checkout\.sessions|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY|fetch\s*\(|bucket\.put|bucket\.delete/);
 assert.match(source,/s\.revoked=0 AND s\.expires_at>/);
 assert.match(source,/s\.session_epoch=\?/);
 assert.match(source,/checkoutEligible:false/);
});
