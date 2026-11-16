// RN-3B1C Phase22: disposable Workerd fetch + D1 runtime tests, no live API.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {convertApprovedQuoteForReview} from "../functions/lib/dtf-quote-conversion-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const ddl=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
const phase21=readFileSync(new URL("../functions/lib/dtf-atomic-session-acceptance-rn3b1c.js",import.meta.url),"utf8");
const MS=1800000000000,SEC=MS/1000;
const ids={owner:"customer_12345678",workspace:"workspace_12345678",reviewer:"reviewer_12345678",
 session:"session_12345678",quote:"quote_12345678",order:"dtf_order_12345678",
 catalog:"catalog_12345678",reference:"DTF-20261116-1234ABCD"};
function parts(sql,expected){
 const clean=sql.split(/\r?\n/).filter(x=>!/^\s*--/.test(x)).join("\n").trim();
 const found=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(found.length,expected);
 assert.equal(found.reduce((s,item)=>s.replace(item,""),clean).trim(),"");
 return found.map(item=>item.replace(/;\s*$/,""));
}
const workerCode=phase21.replace(
 "export async function acceptDtfQuoteWithAtomicSessionFence",
 "async function acceptDtfQuoteWithAtomicSessionFence"
)+[
 'const principal={verified:true,csrfVerified:true,role:"customer",',
 'subjectId:"customer_12345678",workspaceId:"workspace_12345678",',
 'sessionId:"session_12345678",sessionEpoch:2};',
 'export default {async fetch(request,env){',
 ' const url=new URL(request.url);',
 ' if(request.method!=="POST"||url.hostname!=="localhost")return new Response("LOCAL_ONLY",{status:404});',
 ' if(url.pathname==="/revoke"||url.pathname==="/rotate"){',
 '  const sql=url.pathname==="/revoke"?',
 '   "UPDATE dtf_test_customer_sessions_v20 SET revoked=1 WHERE session_id=?":',
 '   "UPDATE dtf_test_customer_sessions_v20 SET session_epoch=3 WHERE session_id=?";',
 '  const result=await env.TEST_D1.prepare(sql).bind(principal.sessionId).run();',
 '  return Response.json({ok:result.success===true,changes:result.meta?.changes||0});',
 ' }',
 ' if(url.pathname==="/accept"){',
 '  const body=await request.json();',
 '  const result=await acceptDtfQuoteWithAtomicSessionFence({',
 '   db:env.TEST_D1,verifyCustomerSession:async()=>principal,request,',
 '   acceptanceId:body.acceptanceId,orderId:"dtf_order_12345678",',
 '   displayedCatalogVersion:body.catalogVersion||"catalog_12345678",',
 '   displayedTotalCents:body.displayedTotalCents??21600,',
 '   explicitConsent:body.explicitConsent??true,now:1800000000000,',
 '   amountCents:body.amountCents,customerId:body.customerId,checkout:body.checkout',
 '  });',
 '  return Response.json(result);',
 ' }',
 ' return new Response("LOCAL_ONLY",{status:404});',
 '}}'
].join("\n");
async function fixture(t){
 const mf=new Miniflare({modules:true,script:workerCode,
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase22-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 for(const query of [
  ...parts(ddl("rn-3b1c-phase18-synthetic-quote-conversion.sql"),4),
  ...parts(ddl("rn-3b1c-phase19-synthetic-pricing-acceptance.sql"),5)
 ])await db.prepare(query).run();
 const v20=ddl("rn-3b1c-phase20-synthetic-customer-sessions.sql")
  .split(/\r?\n/).filter(x=>!x.trimStart().startsWith("--")).join("\n");
 for(const q of v20.split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(q).run();
 await db.prepare("INSERT INTO dtf_test_customer_sessions_v20 VALUES(?,?,?,?,?,?,?)").bind(
  ids.session,ids.owner,ids.workspace,2,"a".repeat(64),SEC+90,0).run();
 await db.prepare("INSERT INTO dtf_test_approved_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  ids.quote,ids.reference,ids.workspace,ids.owner,12,"provided","front",
  '{"M":4,"L":8}',"Navy",21600,"usd",1,1,1,"approved",ids.reviewer,MS-10000,MS+90000
 ).run();
 const conversion=await convertApprovedQuoteForReview({
  db,authorizeOperator:async()=>({verified:true,role:"dtf_quote_reviewer",
   subjectId:ids.reviewer,workspaceId:ids.workspace}),
  quoteId:ids.quote,orderId:ids.order,now:MS-1000
 });
 assert.equal(conversion.ok,true,JSON.stringify(conversion));
 await db.prepare("INSERT INTO dtf_test_pricing_catalog VALUES(?,?,?,?,?,?)").bind(
  ids.catalog,"usd","approved",ids.reviewer,MS-5000,1).run();
 await db.prepare("INSERT INTO dtf_test_quote_price_signoff VALUES(?,?,?,?,?,?)").bind(
  ids.quote,ids.catalog,21600,"approved",ids.reviewer,MS-2000).run();
 async function send(path,body={}){
  const res=await mf.dispatchFetch("http://localhost"+path,{method:"POST",
   headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal(res.status,200);
  return res.json();
 }
 const accept=(id="accept_12345678",extra={})=>send("/accept",{acceptanceId:id,...extra});
 const rows=async()=>(await db.prepare("SELECT * FROM dtf_test_customer_acceptances").all()).results;
 return{mf,db,send,accept,rows};
}
test("real Workerd fetch executes Phase21 source and creates review-only D1 row",async t=>{
 const f=await fixture(t);
 const r=await f.accept();
 assert.equal(r.ok,true,JSON.stringify(r));
 const [row]=await f.rows();
 assert.equal(row.checkout_enabled,0);
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(r.paymentAuthorized,false);
});
test("Workerd revocation commits before acceptance and blocks stale principal",async t=>{
 const f=await fixture(t);
 const revoke=await f.send("/revoke");
 assert.equal(revoke.ok,true);
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("Workerd epoch rotation prevents acceptance",async t=>{
 const f=await fixture(t);
 assert.equal((await f.send("/rotate")).ok,true);
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("20 Workerd requests submitted after revocation yield zero accepted",async t=>{
 const f=await fixture(t);
 assert.equal((await f.send("/revoke")).ok,true);
 const results=await Promise.all(Array.from({length:20},(_,i)=>
  f.accept("accept_12345678_"+i)));
 assert.equal(results.filter(r=>r.ok).length,0);
 assert.equal((await f.rows()).length,0);
});
test("20 concurrent Workerd requests create precisely one acceptance",async t=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:20},(_,i)=>
  f.accept("accept_12345678_"+i)));
 assert.equal(results.filter(r=>r.ok).length,1);
 assert.equal((await f.rows()).length,1);
});
test("Worker repeat and alternate acceptance ID cannot replay order",async t=>{
 const f=await fixture(t);
 assert.equal((await f.accept()).ok,true);
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.accept("accept_87654321")).ok,false);
 assert.equal((await f.rows()).length,1);
});
test("Workerd cancellation blocks acceptance at write boundary",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_approved_quotes SET quote_status='cancelled'").run();
 assert.equal((await f.accept()).ok,false);
});
test("Workerd amount change or wrong visible catalog version blocks acceptance",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_approved_quotes SET approved_total_cents=25000").run();
 assert.equal((await f.accept()).ok,false);
 assert.equal((await f.accept("accept_87654321",{catalogVersion:"catalog_87654321"})).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("Workerd forged customer/price/checkout fields cannot override D1 snapshot",async t=>{
 const f=await fixture(t);
 const result=await f.accept("accept_12345678",{
  amountCents:1,customerId:"customer_87654321",checkout:true
 });
 assert.equal(result.ok,true);
 const [row]=await f.rows();
 assert.equal(row.accepted_total_cents,21600);
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(row.checkout_enabled,0);
});
test("Workerd explicit consent missing means no acceptance",async t=>{
 const f=await fixture(t);
 assert.equal((await f.accept("accept_12345678",{explicitConsent:false})).ok,false);
 assert.equal((await f.rows()).length,0);
});
test("Workerd test handler rejects non-POST and nonlocal origin",async t=>{
 const f=await fixture(t);
 for(const [url,method] of [["http://localhost/accept","GET"],
  ["http://outside.example.invalid/accept","POST"]]){
  const r=await f.mf.dispatchFetch(url,{method});
  assert.equal(r.status,404);
 }
});
test("Phase22 has no live provider, R2, customer issuer, email or checkout",()=>{
 assert.match(workerCode,/s\.revoked=0 AND s\.expires_at>/);
 assert.match(workerCode,/checkoutEligible:false/);
 assert.doesNotMatch(workerCode,/STRIPE_SECRET_KEY|RESEND_API_KEY|ARTWORK_BUCKET|api\.stripe\.com|api\.resend\.com/);
 assert.doesNotMatch(phase21,/onRequestPost|fetch\s*\(/);
});
