// RN-3B1C Phase 18: disposable D1 quote conversion tests, no external service.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {convertApprovedQuoteForReview} from "../functions/lib/dtf-quote-conversion-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const migration=readFileSync(new URL("../migrations/rn-3b1c-phase18-synthetic-quote-conversion.sql",import.meta.url),"utf8");
const source=readFileSync(new URL("../functions/lib/dtf-quote-conversion-rn3b1c.js",import.meta.url),"utf8");
const NOW=1800000000000;
const ids={quoteId:"quote_12345678",quoteRef:"DTF-20261116-1234ABCD",owner:"customer_12345678",workspace:"workspace_12345678",reviewer:"reviewer_12345678"};
function statements(){
 const clean=migration.split(/\r?\n/).filter(l=>! /^\s*--/.test(l)).join("\n").trim();
 const all=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(all.length,4);
 assert.equal(all.reduce((str,statement)=>str.replace(statement,""),clean).trim(),"");
 return all;
}
async function fixture(t,extra={}){
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase18-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 for(const sql of statements())await db.prepare(sql.replace(/;\s*$/,"")).run();
 const {quoteId,quoteRef,owner,workspace,reviewer}=ids;
 await db.prepare("INSERT INTO dtf_test_approved_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  quoteId,quoteRef,workspace,owner,12,"provided","front",'{"M":4,"L":8}',
  "Navy",21600,"usd",1,1,1,"approved",reviewer,NOW-10000,NOW+90000
 ).run();
 const principal={verified:true,role:"dtf_quote_reviewer",subjectId:reviewer,workspaceId:workspace};
 const args={
  db,authorizeOperator:async()=>principal,request:{identity:"local-synthetic"},
  quoteId,orderId:"dtf_order_12345678",now:NOW,...extra
 };
 const rows=async()=> (await db.prepare("SELECT * FROM dtf_test_conversion_orders").all()).results;
 return{db,args,rows};
}
test("Phase 18 disposable schema applies with two immutable conversion triggers",async t=>{
 const f=await fixture(t);
 const r=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='dtf_test_conversion_orders'").all();
 assert.equal(r.results.length,2);
 assert.equal((await f.rows()).length,0);
});
test("approved reviewed quote converts to awaiting-customer-acceptance only",async t=>{
 const f=await fixture(t);
 const result=await convertApprovedQuoteForReview(f.args);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.checkoutEligible,false);
 assert.equal(result.paymentAuthorized,false);
 const [row]=await f.rows();
 assert.equal(row.approved_total_cents,21600);
 assert.equal(row.quantity,12);
 assert.equal(row.order_status,"awaiting_customer_acceptance");
 assert.equal(row.checkout_enabled,0);
});
test("replay conversion and alternate order ID cannot duplicate quote",async t=>{
 const f=await fixture(t);
 assert.equal((await convertApprovedQuoteForReview(f.args)).ok,true);
 assert.equal((await convertApprovedQuoteForReview(f.args)).ok,false);
 assert.equal((await convertApprovedQuoteForReview({...f.args,orderId:"dtf_order_99999999"})).ok,false);
 assert.equal((await f.rows()).length,1);
});
test("20 concurrent conversion attempts commit exactly one immutable order",async t=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:20},(_,i)=>convertApprovedQuoteForReview({
  ...f.args,orderId:"dtf_order_"+String(i).padStart(8,"0")
 })));
 assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
 assert.equal((await f.rows()).length,1);
});
test("unapproved, cancelled, rejected and draft quotes cannot convert",async t=>{
 for(const status of ["draft","cancelled","rejected"]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_approved_quotes SET quote_status=?").bind(status).run();
  assert.equal((await convertApprovedQuoteForReview(f.args)).ok,false,status);
  assert.equal((await f.rows()).length,0);
 }
});
test("incomplete artwork pricing or fulfillment review fails closed",async t=>{
 for(const field of ["artwork_reviewed","pricing_reviewed","fulfillment_reviewed"]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_approved_quotes SET "+field+"=0").run();
  assert.equal((await convertApprovedQuoteForReview(f.args)).ok,false,field);
  assert.equal((await f.rows()).length,0);
 }
});
test("expired, future-approved and invalid timestamps cannot convert",async t=>{
 for(const [col,value] of [["expires_at",NOW],["approved_at",NOW+1]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_approved_quotes SET "+col+"=?").bind(value).run();
  assert.equal((await convertApprovedQuoteForReview(f.args)).ok,false,col);
 }
});
test("foreign workspace or different reviewer cannot convert",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {workspaceId:"workspace_87654321"},
  {subjectId:"reviewer_87654321"}
 ]){
  const r=await convertApprovedQuoteForReview({...f.args,
   authorizeOperator:async()=>({verified:true,role:"dtf_quote_reviewer",subjectId:ids.reviewer,workspaceId:ids.workspace,...patch})});
  assert.equal(r.ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("forged client prices status and customer identity are ignored",async t=>{
 const f=await fixture(t);
 const result=await convertApprovedQuoteForReview({...f.args,
  amountCents:1,subjectId:"customer_87654321",workspaceId:"workspace_87654321",quoteStatus:"paid"
 });
 assert.equal(result.ok,true);
 const [row]=await f.rows();
 assert.equal(row.owner_subject_id,ids.owner);
 assert.equal(row.approved_total_cents,21600);
 assert.equal(row.order_status,"awaiting_customer_acceptance");
});
test("invalid or unavailable reviewer never creates a record",async t=>{
 const f=await fixture(t);
 const scenarios=[
  async()=>null,
  async()=>({verified:true,role:"customer",subjectId:ids.reviewer,workspaceId:ids.workspace}),
  async()=>({verified:false,role:"dtf_quote_reviewer",subjectId:ids.reviewer,workspaceId:ids.workspace}),
  async()=>{throw Error("offline")}
 ];
 for(const authorizeOperator of scenarios){
  assert.equal((await convertApprovedQuoteForReview({...f.args,authorizeOperator})).ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("database rejection fails closed, not converted",async t=>{
 const f=await fixture(t);
 const broken={prepare(){throw Error("db unavailable");}};
 const result=await convertApprovedQuoteForReview({...f.args,db:broken});
 assert.equal(result.code,"CONVERSION_WRITE_FAILED");
 assert.equal(result.converted,false);
 assert.equal((await f.rows()).length,0);
});
test("normal SQL may not update or delete converted order",async t=>{
 const f=await fixture(t);
 assert.equal((await convertApprovedQuoteForReview(f.args)).ok,true);
 await assert.rejects(f.db.prepare("UPDATE dtf_test_conversion_orders SET checkout_enabled=0").run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_test_conversion_orders").run());
 assert.equal((await f.rows()).length,1);
});
test("invalid input, absent trusted components and zero time fail closed",async t=>{
 const f=await fixture(t);
 for(const arg of [
  {...f.args,orderId:"bad"},
  {...f.args,now:0},
  {...f.args,authorizeOperator:null},
  {...f.args,db:null}
 ]){
  const result=await convertApprovedQuoteForReview(arg);
  assert.equal(result.ok,false);
  assert.equal(result.checkoutEligible,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("no customer route, checkout, R2 mutation or payment provider integration",()=>{
 assert.match(migration,/DO NOT APPLY LIVE/);
 assert.match(source,/checkoutEligible:false/);
 assert.doesNotMatch(source,/fetch\s*\(|onRequestPost|checkout\.sessions|ARTWORK_BUCKET|STRIPE_SECRET_KEY|bucket\.put|bucket\.delete/);
 assert.match(migration,/CHECK\(checkout_enabled=0\)/);
});
