// Phase19 disposable D1 price signoff and customer acceptance, no providers.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {convertApprovedQuoteForReview} from "../functions/lib/dtf-quote-conversion-rn3b1c.js";
import {acceptReviewedDtfQuote} from "../functions/lib/dtf-customer-quote-acceptance-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const read=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
const sql19=read("rn-3b1c-phase19-synthetic-pricing-acceptance.sql");
const src19=readFileSync(new URL("../functions/lib/dtf-customer-quote-acceptance-rn3b1c.js",import.meta.url),"utf8");
const NOW=1800000000000;
const ids={quote:"quote_12345678",reference:"DTF-20261116-1234ABCD",owner:"customer_12345678",workspace:"workspace_12345678",reviewer:"reviewer_12345678",order:"dtf_order_12345678",catalog:"catalog_12345678"};
function parts(sql,expected){
 const clean=sql.split(/\r?\n/).filter(line=>!/^\s*--/.test(line)).join("\n").trim();
 const found=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(found.length,expected);
 assert.equal(found.reduce((text,part)=>text.replace(part,""),clean).trim(),"");
 return found;
}
async function fixture(t,{catalogStatus="approved",signoff="approved"}={}){
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",
  compatibilityDate:"2026-08-01",d1Databases:{TEST_D1:"rn-phase19-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 for(const query of [
  ...parts(read("rn-3b1c-phase18-synthetic-quote-conversion.sql"),4),
  ...parts(sql19,5)
 ])await db.prepare(query.replace(/;\s*$/,"")).run();
 await db.prepare("INSERT INTO dtf_test_approved_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  ids.quote,ids.reference,ids.workspace,ids.owner,12,"provided","front",'{"M":4,"L":8}',
  "Navy",21600,"usd",1,1,1,"approved",ids.reviewer,NOW-10000,NOW+90000
 ).run();
 const c=await convertApprovedQuoteForReview({db,authorizeOperator:async()=>({
  verified:true,role:"dtf_quote_reviewer",subjectId:ids.reviewer,workspaceId:ids.workspace
 }),orderId:ids.order,quoteId:ids.quote,now:NOW-1000});
 assert.equal(c.ok,true,JSON.stringify(c));
 await db.prepare("INSERT INTO dtf_test_pricing_catalog VALUES(?,?,?,?,?,?)").bind(
  ids.catalog,"usd",catalogStatus,catalogStatus==="approved"?ids.reviewer:"",
  catalogStatus==="approved"?NOW-5000:0,1
 ).run();
 await db.prepare("INSERT INTO dtf_test_quote_price_signoff VALUES(?,?,?,?,?,?)").bind(
  ids.quote,ids.catalog,21600,signoff,ids.reviewer,NOW-2000
 ).run();
 const trusted={verified:true,csrfVerified:true,role:"customer",subjectId:ids.owner,workspaceId:ids.workspace};
 const args={db,verifyCustomerSession:async()=>trusted,request:{kind:"synthetic"},
  acceptanceId:"accept_12345678",orderId:ids.order,displayedCatalogVersion:ids.catalog,
  displayedTotalCents:21600,explicitConsent:true,now:NOW};
 const rows=async()=>(await db.prepare("SELECT * FROM dtf_test_customer_acceptances").all()).results;
 return{db,args,rows};
}
test("Phase19 disposable D1 pricing and immutable customer acceptance schema applies",async t=>{
 const f=await fixture(t);
 const r=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='dtf_test_customer_acceptances'").all();
 assert.equal(r.results.length,2);
 assert.equal((await f.rows()).length,0);
});
test("explicit verified synthetic customer accepts matching approved quote review-only",async t=>{
 const f=await fixture(t);
 const result=await acceptReviewedDtfQuote(f.args);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.checkoutEligible,false);
 const [row]=await f.rows();
 assert.equal(row.accepted_total_cents,21600);
 assert.equal(row.catalog_version,ids.catalog);
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(row.checkout_enabled,0);
});
test("no explicit consent cannot create acceptance",async t=>{
 const f=await fixture(t);
 for(const explicitConsent of [false,null,undefined,"true",1]){
  assert.equal((await acceptReviewedDtfQuote({...f.args,explicitConsent})).ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("draft and retired pricing catalogs block acceptance",async t=>{
 for(const status of ["draft","retired"]){
  const f=await fixture(t,{catalogStatus:status});
  assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false,status);
  assert.equal((await f.rows()).length,0);
 }
});
test("missing pricing signoff or withdrawal blocks acceptance",async t=>{
 for(const decision of ["pending","withdrawn"]){
  const f=await fixture(t,{signoff:decision});
  assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false,decision);
 }
});
test("displayed amount, currency or catalog version mismatch is rejected",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {displayedTotalCents:100},
  {displayedCatalogVersion:"catalog_87654321"}
 ]){
  assert.equal((await acceptReviewedDtfQuote({...f.args,...patch})).ok,false);
 }
 await f.db.prepare("UPDATE dtf_test_pricing_catalog SET currency='usd'").run();
 assert.equal((await f.rows()).length,0);
});
test("catalog approval must precede customer acceptance",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_pricing_catalog SET approved_at=?").bind(NOW+10).run();
 assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false);
});
test("quote expires or approval withdrawn after conversion: customer cannot accept",async t=>{
 for(const [field,value] of [["expires_at",NOW],["quote_status","cancelled"],["pricing_reviewed",0]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_approved_quotes SET "+field+"=?").bind(value).run();
  assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false,field);
  assert.equal((await f.rows()).length,0);
 }
});
test("revised quote amount, size or placement after conversion blocks stale acceptance",async t=>{
 for(const [field,value] of [["approved_total_cents",25000],["sizes_json",'{"L":12}'],["print_placement","back"]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_approved_quotes SET "+field+"=?").bind(value).run();
  assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false,field);
 }
});
test("foreign owner, workspace, missing CSRF or unverified session blocks acceptance",async t=>{
 const f=await fixture(t);
 for(const patch of [
  {subjectId:"customer_87654321"},{workspaceId:"workspace_87654321"},
  {csrfVerified:false},{verified:false},{role:"reviewer"}
 ]){
  const result=await acceptReviewedDtfQuote({...f.args,
   verifyCustomerSession:async()=>({verified:true,csrfVerified:true,role:"customer",
    subjectId:ids.owner,workspaceId:ids.workspace,...patch})});
  assert.equal(result.ok,false);
 }
 assert.equal((await f.rows()).length,0);
});
test("duplicate acceptance and another ID cannot accept the same order twice",async t=>{
 const f=await fixture(t);
 assert.equal((await acceptReviewedDtfQuote(f.args)).ok,true);
 assert.equal((await acceptReviewedDtfQuote(f.args)).ok,false);
 assert.equal((await acceptReviewedDtfQuote({...f.args,acceptanceId:"accept_87654321"})).ok,false);
 assert.equal((await f.rows()).length,1);
});
test("20 concurrent acceptance attempts persist exactly once",async t=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:20},(_,i)=>acceptReviewedDtfQuote({
  ...f.args,acceptanceId:"accept_12345678_"+i
 })));
 assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
 assert.equal((await f.rows()).length,1);
});
test("forged client price, owner and checkout claim do not change acceptance record",async t=>{
 const f=await fixture(t);
 const result=await acceptReviewedDtfQuote({...f.args,amountCents:1,
  customerId:"customer_87654321",workspaceId:"workspace_87654321",checkout:true});
 assert.equal(result.ok,true);
 const [row]=await f.rows();
 assert.equal(row.accepted_total_cents,21600);
 assert.equal(row.customer_subject_id,ids.owner);
 assert.equal(row.checkout_enabled,0);
});
test("session or D1 outage fails closed; immutable acceptance cannot update/delete",async t=>{
 const f=await fixture(t);
 assert.equal((await acceptReviewedDtfQuote({...f.args,
  verifyCustomerSession:async()=>{throw Error("down")}})).ok,false);
 assert.equal((await acceptReviewedDtfQuote({...f.args,db:{prepare(){throw Error("down")}}})).ok,false);
 assert.equal((await f.rows()).length,0);
 assert.equal((await acceptReviewedDtfQuote(f.args)).ok,true);
 await assert.rejects(f.db.prepare("UPDATE dtf_test_customer_acceptances SET checkout_enabled=0").run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_test_customer_acceptances").run());
 assert.equal((await f.rows()).length,1);
});
test("Phase19 still contains no customer endpoint, payment, real session or R2 mutator",()=>{
 assert.match(sql19,/Do not apply to production/i);
 assert.match(sql19,/CHECK\(checkout_enabled=0\)/);
 assert.match(src19,/paymentAuthorized:false/);
 assert.doesNotMatch(src19,/onRequestPost|checkout\.sessions|STRIPE_SECRET_KEY|ARTWORK_BUCKET|fetch\s*\(|bucket\.put|bucket\.delete/);
});
