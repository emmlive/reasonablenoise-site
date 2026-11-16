// RN-3B1C Phase 15: disposable Workerd D1 decision fence; no live auth/R2/Stripe.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {reserveReviewOnlyDecision} from "../functions/lib/dtf-artwork-decision-fence-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const worker="export default {async fetch(){return new Response('SYNTHETIC_ONLY')}}";
const now=1800000000000;
const ids={sessionId:"session_12345678",subjectId:"subject_12345678",workspaceId:"workspace_12345678",orderId:"order_12345678",pinId:"pin_12345678",intentId:"intent_12345678123442348234123456789abc"};
const objectRef={version:"version_12345678",sha256:"a".repeat(64),byteLength:70};
const read=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
function parse(sql){
 const clean=sql.split(/\r?\n/).filter(l=>! /^\s*--/.test(l)).join("\n").trim();
 const parts=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(parts.reduce((text,p)=>text.replace(p,""),clean).trim(),"");
 return parts;
}
async function fixture(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  d1Databases:{TEST_D1:"rn3b1c-phase15-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 const p12=parse(read("rn-3b1c-phase12-version-pins.sql"));
 const p15=parse(read("rn-3b1c-phase15-synthetic-decision-fence.sql"));
 assert.equal(p12.length,3);
 assert.equal(p15.length,5);
 for(const part of [...p12,...p15])await db.prepare(part.replace(/;\s*$/,"")).run();
 const {sessionId,subjectId,workspaceId,orderId,pinId,intentId}=ids;
 await db.prepare("INSERT INTO dtf_test_session_epochs VALUES(?,?,?,?,?,?)").bind(sessionId,subjectId,workspaceId,1,now+90000,0).run();
 await db.prepare("INSERT INTO dtf_test_order_epochs VALUES(?,?,?,?,?,?,?)").bind(orderId,subjectId,workspaceId,1,"dtf_quote","draft",1).run();
 await db.prepare("INSERT INTO dtf_artwork_version_pins VALUES(?,?,?,?,?,?,?,?,?)")
 .bind(pinId,intentId,subjectId,orderId,"dtf-intents/12345678-1234-4234-8234-123456789abc/artwork.png",objectRef.version,objectRef.sha256,objectRef.byteLength,now-100).run();
 const principal={verified:true,sessionId,subjectId,workspaceId,sessionEpoch:1};
 const request={token:"synthetic_good"};
 const resolveVerifiedSession=async req=>req?.token==="synthetic_good"?principal:null;
 const verifyPinnedObject=async()=>({ok:true,...objectRef});
 const args={db,resolveVerifiedSession,verifyPinnedObject,request,orderId,pinId,decisionId:"decision_12345678",replayId:"replay_12345678",expectedOrderEpoch:1,objectRef,now};
 const decisions=async()=> (await db.prepare("SELECT * FROM dtf_test_auth_decisions").all()).results;
 return {db,args,decisions};
}
test("disposable Phase 15 D1 tables and append-only review decision triggers apply",async t=>{
 const f=await fixture(t);
 const r=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='dtf_test_auth_decisions'").all();
 assert.equal(r.results.length,2);
 assert.equal((await f.decisions()).length,0);
});
test("verified synthetic session and matching pinned order reserve review only",async t=>{
 const f=await fixture(t);
 const r=await reserveReviewOnlyDecision(f.args);
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.reviewReserved,true);
 assert.equal(r.checkoutEligible,false);
 assert.equal(r.deletionAuthorized,false);
 assert.equal((await f.decisions()).length,1);
});
test("same replay ID or pin cannot create another decision",async t=>{
 const f=await fixture(t);
 assert.equal((await reserveReviewOnlyDecision(f.args)).ok,true);
 const repeat=await reserveReviewOnlyDecision({...f.args,decisionId:"decision_87654321"});
 const alternate=await reserveReviewOnlyDecision({...f.args,decisionId:"decision_99999999",replayId:"replay_99999999"});
 assert.equal(repeat.ok,false);
 assert.equal(alternate.ok,false);
 assert.equal((await f.decisions()).length,1);
});
test("20 concurrent review attempts yield only one recorded decision",async t=>{
 const f=await fixture(t);
 const out=await Promise.all(Array.from({length:20},(_,i)=>reserveReviewOnlyDecision({...f.args,decisionId:"decision_12345678_"+i,replayId:"replay_12345678_"+i})));
 assert.equal(out.filter(r=>r.ok).length,1,JSON.stringify(out.map(r=>r.code)));
 assert.equal((await f.decisions()).length,1);
});
test("revoked session is denied by same decision-time SQL statement",async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE dtf_test_session_epochs SET revoked=1").run();
 const r=await reserveReviewOnlyDecision(f.args);
 assert.equal(r.code,"DECISION_REPLAY_OR_REVOKED");
 assert.equal((await f.decisions()).length,0);
});
test("expired session or changed session epoch rejects stale principal",async t=>{
 for(const [field,value] of [["expires_at",now],["session_epoch",2]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_session_epochs SET "+field+"=?").bind(value).run();
  assert.equal((await reserveReviewOnlyDecision(f.args)).ok,false);
  assert.equal((await f.decisions()).length,0);
 }
});
test("order reassignment, deactivation and order epoch change invalidate decision",async t=>{
 for(const [field,value] of [["owner_subject_id","subject_87654321"],["workspace_id","workspace_87654321"],["order_epoch",2],["active",0],["order_status","cancelled"],["order_status","paid"],["order_type","sticker"]]){
  const f=await fixture(t);
  await f.db.prepare("UPDATE dtf_test_order_epochs SET "+field+"=?").bind(value).run();
  assert.equal((await reserveReviewOnlyDecision(f.args)).ok,false,field);
  assert.equal((await f.decisions()).length,0);
 }
});
test("mismatched pinned digest, byte length or R2 version is denied",async t=>{
 for(const change of [{sha256:"b".repeat(64)},{byteLength:71},{version:"version_87654321"}]){
  const f=await fixture(t);
  const ref={...objectRef,...change};
  const r=await reserveReviewOnlyDecision({...f.args,objectRef:ref,verifyPinnedObject:async()=>({ok:true,...ref})});
  assert.equal(r.ok,false);
  assert.equal((await f.decisions()).length,0);
 }
});
test("foreign subject or forged request fields cannot override trusted principal",async t=>{
 const f=await fixture(t);
 const req={...f.args.request,subjectId:"subject_87654321",workspaceId:"workspace_87654321",verified:true};
 const r=await reserveReviewOnlyDecision({...f.args,request:req,resolveVerifiedSession:async()=>({verified:true,...ids,subjectId:"subject_87654321",sessionEpoch:1})});
 assert.equal(r.ok,false);
 assert.equal((await f.decisions()).length,0);
});
test("unverified session, verifier outage or R2 verification failure cannot insert",async t=>{
 const f=await fixture(t);
 const scenarios=[
  {resolveVerifiedSession:async()=>null},
  {resolveVerifiedSession:async()=>{throw Error("session unavailable");}},
  {verifyPinnedObject:async()=>({ok:false})},
  {verifyPinnedObject:async()=>{throw Error("R2 unavailable");}}
 ];
 for(const overrides of scenarios){
  assert.equal((await reserveReviewOnlyDecision({...f.args,...overrides})).ok,false);
 }
 assert.equal((await f.decisions()).length,0);
});
test("D1 write error fails closed rather than returning review authority",async t=>{
 const f=await fixture(t);
 const broken={prepare(sql){if(sql.startsWith("INSERT INTO dtf_test_auth_decisions"))throw Error("DB_OFFLINE");return f.db.prepare(sql);}};
 const r=await reserveReviewOnlyDecision({...f.args,db:broken});
 assert.equal(r.code,"DECISION_WRITE_FAILED");
 assert.equal(r.checkoutEligible,false);
 assert.equal((await f.decisions()).length,0);
});
test("decisions cannot be updated/deleted by ordinary SQL",async t=>{
 const f=await fixture(t);
 assert.equal((await reserveReviewOnlyDecision(f.args)).ok,true);
 await assert.rejects(f.db.prepare("UPDATE dtf_test_auth_decisions SET result='review_only'").run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_test_auth_decisions").run());
 assert.equal((await f.decisions()).length,1);
});
test("Phase 15 does not activate customer endpoint, payments or artwork deletion",()=>{
 const source=readFileSync(new URL("../functions/lib/dtf-artwork-decision-fence-rn3b1c.js",import.meta.url),"utf8");
 const schema=read("rn-3b1c-phase15-synthetic-decision-fence.sql");
 assert.match(schema,/DO NOT APPLY LIVE/);
 assert.match(source,/checkoutEligible:false/);
 assert.doesNotMatch(source,/onRequestPost|onScheduled|checkout\.sessions|bucket\.put|bucket\.delete|fetch\s*\(/);
});
