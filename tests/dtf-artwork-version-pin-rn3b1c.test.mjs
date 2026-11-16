// RN-3B1C Phase 12: disposable local Workerd D1 + R2 version binding.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createLocalR2WriteOnceAdapter} from "../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js";
import {stageWriteOnceArtwork} from "../functions/lib/dtf-artwork-version-rn3b1c.js";
import {bindVerifiedArtworkVersion,verifyDurableArtworkPin} from "../functions/lib/dtf-artwork-version-pin-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const uuid="12345678-1234-4234-8234-123456789abc";
const key="dtf-intents/"+uuid+"/artwork.png",intentId="intent_"+uuid.replaceAll("-","");
const subjectId="subject_12345678",orderId="order_12345678",pinId="pin_12345678",now=1800000000000;
const authorize=async(s,o)=>s===subjectId&&o===orderId;
const worker="export default {async fetch(){return new Response('PHASE12_TEST_ONLY')}}";
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(arr){let c=0xffffffff;for(const b of arr){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const t=Buffer.from(type);return Buffer.concat([u32(data.length),t,data,u32(crc(Buffer.concat([t,data])))]);}
const png=(color=255)=>Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,color]))),chunk("IEND")]));
const migration=readFileSync(new URL("../migrations/rn-3b1c-phase12-version-pins.sql",import.meta.url),"utf8");
async function fixture(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  d1Databases:{TEST_D1:"rn3b1c-phase12-disposable"},
  r2Buckets:{TEST_R2:"rn3b1c-phase12-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1"),bucket=await mf.getR2Bucket("TEST_R2");
 const sql=migration.split(/\r?\n/).filter(line=>! /^\s*--/.test(line)).join("\n");
 const statements=sql.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(statements.length,3);
 assert.equal(statements.reduce((s,part)=>s.replace(part,""),sql).trim(),"");
 for(const statement of statements)await db.prepare(statement.replace(/;\s*$/,"")).run();
 const store=createLocalR2WriteOnceAdapter(bucket);
 const created=await stageWriteOnceArtwork({store,authorize,subjectId,orderId,intentId,key,bytes:png()});
 assert.equal(created.ok,true,JSON.stringify(created));
 const args={db,store,authorize,subjectId,orderId,intentId,pinId,reference:created.objectRef,now};
 const rows=()=>db.prepare("SELECT * FROM dtf_artwork_version_pins").all();
 return{db,bucket,store,args,rows,created};
}
const verify=f=>verifyDurableArtworkPin(({db,store,authorize,subjectId,orderId,intentId,pinId})=>({db,store,authorize,subjectId,orderId,intentId,pinId}))(f.args);
test("local D1 migration creates immutable version-pin schema and triggers",async t=>{
 const f=await fixture(t);
 const triggers=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='dtf_artwork_version_pins'").all();
 assert.equal(triggers.results.length,2);
 assert.equal((await f.rows()).results.length,0);
});
test("verified local R2 version binds to one durable D1 order record",async t=>{
 const f=await fixture(t);
 const result=await bindVerifiedArtworkVersion(f.args);
 assert.equal(result.ok,true,JSON.stringify(result));
 const row=(await f.rows()).results[0];
 assert.equal(row.order_id,orderId);
 assert.equal(row.object_version,f.created.objectRef.version);
 assert.equal(row.sha256,f.created.objectRef.sha256);
 assert.equal(result.checkoutEligible,false);
});
test("verified durable pin is readable only with matching server-authorized order",async t=>{
 const f=await fixture(t);
 assert.equal((await bindVerifiedArtworkVersion(f.args)).ok,true);
 const result=await verify(f);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.deletionAuthorized,false);
});
test("20 concurrent version pins for the same order succeed exactly once",async t=>{
 const f=await fixture(t);
 const out=await Promise.all(Array.from({length:20},(_,i)=>bindVerifiedArtworkVersion({...f.args,pinId:"pin_12345678_"+i})));
 assert.equal(out.filter(x=>x.ok).length,1,JSON.stringify(out.map(x=>x.code)));
 assert.equal((await f.rows()).results.length,1);
});
test("duplicate order/intent/object conflicts are rejected even with distinct pin IDs",async t=>{
 const f=await fixture(t);
 assert.equal((await bindVerifiedArtworkVersion(f.args)).ok,true);
 for(const extra of [{pinId:"pin_87654321"},{pinId:pinId}]){
  const result=await bindVerifiedArtworkVersion({...f.args,...extra});
  assert.equal(result.ok,false);
 }
 assert.equal((await f.rows()).results.length,1);
});
test("version pin rejects changed version after unconditional R2 overwrite",async t=>{
 const f=await fixture(t);
 assert.equal((await bindVerifiedArtworkVersion(f.args)).ok,true);
 await f.bucket.put(key,png(100),{httpMetadata:{contentType:"image/png"}});
 const result=await verify(f);
 assert.equal(result.code,"PINNED_OBJECT_CHANGED");
});
test("same-sized content substitution without metadata change is detected",async t=>{
 const f=await fixture(t);
 assert.equal((await bindVerifiedArtworkVersion(f.args)).ok,true);
 const pinned=f.created.objectRef;
 await f.bucket.put(key,png(100),{httpMetadata:{contentType:"image/png"},customMetadata:{rnSha256:pinned.sha256,rnByteLength:String(pinned.byteLength)}});
 assert.equal((await verify(f)).ok,false);
});
test("immutable D1 records reject UPDATE and DELETE even for direct SQL",async t=>{
 const f=await fixture(t);
 assert.equal((await bindVerifiedArtworkVersion(f.args)).ok,true);
 await assert.rejects(f.db.prepare("UPDATE dtf_artwork_version_pins SET sha256=?").bind("a".repeat(64)).run());
 await assert.rejects(f.db.prepare("DELETE FROM dtf_artwork_version_pins").run());
 assert.equal((await f.rows()).results.length,1);
});
test("unauthorized or foreign order never writes a version pin",async t=>{
 const f=await fixture(t);
 const result=await bindVerifiedArtworkVersion({...f.args,orderId:"foreign_12345678"});
 assert.equal(result.code,"UNAUTHORIZED_ORDER");
 const read=await verifyDurableArtworkPin({...f.args,subjectId:"foreign_12345678"});
 assert.equal(read.code,"UNAUTHORIZED_ORDER");
 assert.equal((await f.rows()).results.length,0);
});
test("forged reference or mismatched private key fails before DB insert",async t=>{
 const f=await fixture(t);
 for(const change of [{version:"fake_version_1234"},{sha256:"b".repeat(64)},{key:"orders/other.png"}]){
  const result=await bindVerifiedArtworkVersion({...f.args,reference:{...f.args.reference,...change}});
  assert.equal(result.ok,false);
 }
 assert.equal((await f.rows()).results.length,0);
});
test("failed D1 write rejects pin without deleting R2 artwork",async t=>{
 const f=await fixture(t);
 const db={prepare:()=>({bind:()=>({run:async()=>{throw Error("DB_DOWN");}})})};
 const result=await bindVerifiedArtworkVersion({...f.args,db});
 assert.equal(result.code,"VERSION_PIN_WRITE_FAILED");
 assert.ok(await f.bucket.head(key));
});
test("invalid arguments and unavailable database fail closed",async t=>{
 const f=await fixture(t);
 for(const changed of [{pinId:"bad!"},{now:-1},{db:null},{reference:null}]){
  const r=await bindVerifiedArtworkVersion({...f.args,...changed});
  assert.equal(r.ok,false);
  assert.equal(r.checkoutEligible,false);
 }
 assert.equal((await f.rows()).results.length,0);
});
test("Phase 12 never activates checkout, delete or production migrations",()=>{
 const src=readFileSync(new URL("../functions/lib/dtf-artwork-version-pin-rn3b1c.js",import.meta.url),"utf8");
 assert.doesNotMatch(src,/bucket\.delete|bucket\.put|checkout\.sessions|onRequestPost|onScheduled|env\.|fetch\s*\(/);
 assert.match(migration,/DO NOT APPLY LIVE/);
 assert.match(src,/checkoutEligible:false/);
});
