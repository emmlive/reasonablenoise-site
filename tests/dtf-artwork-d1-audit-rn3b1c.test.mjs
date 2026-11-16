// RN-3B1C Phase 9: isolated local Workerd D1 audit verification. NO LIVE BINDINGS.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {planArtworkLifecycle} from "../functions/lib/dtf-artwork-lifecycle-rn3b1c.js";
import {claimArtworkReview,recoverStaleArtworkReview} from "../functions/lib/dtf-artwork-review-claims-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const read=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
const migrations=[
 read("rn-3b1c-phase7-review-claims.sql"),
 read("rn-3b1c-phase8-append-only-review-events.sql")
];
const NOW=1800000000000,uuid="12345678-1234-4234-8234-123456789abc";
const key="dtf-intents/"+uuid+"/artwork.png",intentId="intent_"+uuid.replaceAll("-","");
const operatorId="operator_12345678",second="operator_87654321";
const authorize=async id=>id===operatorId||id===second;
const worker="export default {async fetch(){return new Response('TEST_ONLY',{status:200})}}";
function statements(sql){
 const clean=sql.split(/\r?\n/).filter(line=>! /^\s*--/.test(line)).join("\n").trim();
 // These two pinned test migrations contain exactly two DDL statements each
 // plus six compound CREATE TRIGGER statements terminated by END;.
 const out=clean.match(/CREATE TABLE[\s\S]*?\n\);|CREATE INDEX[^\n]*;|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 const residue=out.reduce((s,statement)=>s.replace(statement,""),clean).trim();
 assert.equal(residue,"","UNPARSED_MIGRATION_CONTENT");
 assert.equal(out.length,10,"UNEXPECTED_DDL_STATEMENT_COUNT");
 return out;
}
async function local(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  d1Databases:{TEST_D1:"rn3b1c-phase9-disposable-audit"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1");
 const all=[...statements(migrations.join("\n"))];
 for(const stmt of all)await db.prepare(stmt.replace(/;\s*$/,"")).run();
 const row={version:1,intent_id:intentId,subject_id:"subject_12345678",
  order_id:"order_12345678",object_key:key,sha256:"a".repeat(64),byte_length:99,
  created_at:NOW-900000-86400001,expires_at:NOW-86400001,status:"issued",consumed_at:null};
 const plan=planArtworkLifecycle({rows:[row],
  objects:[{key,uploadedAt:NOW-900000-86400001,size:99}],
  protectedOrderIds:new Set(),inventoryComplete:true,now:NOW});
 assert.equal(plan.items[0].reason,"EXPIRED_UNCONSUMED_INTENT");
 const args={db,authorize,operatorId,claimId:"claim_12345678",finding:plan.items[0],plan,now:NOW};
 const events=()=>db.prepare("SELECT * FROM dtf_artwork_review_events ORDER BY event_id").all();
 const record=()=>db.prepare("SELECT * FROM dtf_artwork_review_claims WHERE claim_id=?").bind(args.claimId).first();
 return {db,mf,args,events,record};
}
const recover=f=>({db:f.db,authorize,operatorId:second,claimId:f.args.claimId,now:NOW+3600000});
test("local D1 applies all ten Phase 7/8 DDL statements and triggers",async t=>{
 const f=await local(t);
 const triggers=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all();
 assert.equal(triggers.results.length,6);
 assert.equal((await f.events()).results.length,0);
});
test("local D1 claim insert atomically creates audit event",async t=>{
 const f=await local(t);
 const r=await claimArtworkReview(f.args);assert.equal(r.ok,true,JSON.stringify(r));
 const list=(await f.events()).results;assert.equal(list.length,1);
 assert.equal(list[0].actor_id,operatorId);assert.equal(list[0].event_type,"claimed");
 assert.equal(r.deletionAuthorized,false);
});
test("local D1 20 concurrent duplicate claims produce one event",async t=>{
 const f=await local(t);
 const results=await Promise.all(Array.from({length:20},()=>claimArtworkReview(f.args)));
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.equal((await f.events()).results.length,1);
});
test("local D1 stale recovery emits exactly one attributed event",async t=>{
 const f=await local(t);assert.equal((await claimArtworkReview(f.args)).ok,true);
 const out=await Promise.all(Array.from({length:20},()=>recoverStaleArtworkReview(recover(f))));
 assert.equal(out.filter(x=>x.ok).length,1);
 const events=(await f.events()).results;assert.equal(events.length,2);
 assert.deepEqual(events.map(e=>e.event_type),["claimed","stale_recovered"]);
 assert.equal(events[1].actor_id,second);
 assert.equal((await f.record()).state,"needs_review");
});
test("local D1 audit rows cannot be updated or deleted",async t=>{
 const f=await local(t);await claimArtworkReview(f.args);
 await assert.rejects(f.db.prepare("UPDATE dtf_artwork_review_events SET actor_id='forged' WHERE event_id=1").run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_artwork_review_events WHERE event_id=1").run());
 assert.equal((await f.events()).results.length,1);
});
test("local D1 claim state cannot bypass review transitions",async t=>{
 const f=await local(t);await claimArtworkReview(f.args);
 await assert.rejects(f.db.prepare("UPDATE dtf_artwork_review_claims SET state='closed' WHERE claim_id=?").bind(f.args.claimId).run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_artwork_review_claims WHERE claim_id=?").bind(f.args.claimId).run());
 assert.equal((await f.record()).state,"claimed");
});
test("local D1 failed audit event forces insert rollback",async t=>{
 const f=await local(t);
 await f.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON dtf_artwork_review_events BEGIN SELECT RAISE(ABORT,'SIMULATED_FAILURE'); END").run();
 const result=await claimArtworkReview(f.args);assert.equal(result.ok,false);
 assert.equal(await f.record(),null);assert.equal((await f.events()).results.length,0);
});
test("local D1 failed recovery audit forces UPDATE rollback",async t=>{
 const f=await local(t);await claimArtworkReview(f.args);
 await f.db.prepare("CREATE TRIGGER fail_audit BEFORE INSERT ON dtf_artwork_review_events BEGIN SELECT RAISE(ABORT,'SIMULATED_FAILURE'); END").run();
 assert.equal((await recoverStaleArtworkReview(recover(f))).ok,false);
 assert.equal((await f.record()).state,"claimed");assert.equal((await f.events()).results.length,1);
});
test("no live endpoint, object cleanup or checkout behavior in Phase 9",()=>{
 assert.doesNotMatch(worker,/STRIPE|ARTWORK_BUCKET|ADMIN_ORDER_TOKEN|onScheduled|onRequestPost/);
 assert.match(migrations[1],/AUDIT_EVENTS_IMMUTABLE/);
});
