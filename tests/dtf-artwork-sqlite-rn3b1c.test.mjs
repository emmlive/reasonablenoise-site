// RN-3B1C Phase 4: true disposable SQLite execution of Phase 3 D1-shaped SQL.
// In-memory only. No Cloudflare binding, network request, filesystem DB, or Stripe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { createDurableArtworkIntent, consumeDurableArtworkIntent } from "../functions/lib/dtf-artwork-durable-rn3b1c.js";

const migration=readFileSync(new URL("../migrations/rn-3b1c-phase3-artwork-intents.sql",import.meta.url),"utf8");
const subjectId="subject_12345678",orderId="order_12345678",NOW=1800000000000;
const authorize=async(s,o)=>s===subjectId&&o===orderId;
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(t,d=Buffer.alloc(0)){const b=Buffer.from(t);return Buffer.concat([u32(d.length),b,d,u32(crc(Buffer.concat([b,d])))]);}
function png(filter=0){return Uint8Array.from(Buffer.concat([
 Buffer.from([137,80,78,71,13,10,26,10]),
 chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),
 chunk("IDAT",deflateSync(Buffer.from([filter,0,0,0,255]))),chunk("IEND")
]));}
class SqliteD1 {
 constructor(){this.sqlite=new DatabaseSync(":memory:");this.sqlite.exec(migration);}
 prepare(sql){
  const statement=this.sqlite.prepare(sql);
  return {bind:(...args)=>({
   first:async()=>statement.get(...args)??null,
   run:async()=>{const r=statement.run(...args);return {success:true,meta:{changes:Number(r.changes)}};}
  })};
 }
 close(){this.sqlite.close();}
 row(id){return this.sqlite.prepare("SELECT * FROM dtf_artwork_intents WHERE intent_id=?").get(id);}
 count(){return this.sqlite.prepare("SELECT COUNT(*) AS n FROM dtf_artwork_intents").get().n;}
}
class MemoryPrivateR2 {
 constructor(){this.objects=new Map();this.corruptRead=false;this.failDelete=false;}
 async put(key,bytes){this.objects.set(key,Uint8Array.from(bytes));}
 async get(key){
  const b=this.objects.get(key);
  if(!b)return null;
  return {arrayBuffer:async()=>this.corruptRead?Uint8Array.from([9,9]).buffer:Uint8Array.from(b).buffer};
 }
 async delete(key){if(this.failDelete)throw Error("DELETE_UNAVAILABLE");this.objects.delete(key);}
}
async function fixture(t){
 const db=new SqliteD1(),bucket=new MemoryPrivateR2();
 t.after(()=>db.close());
 const created=await createDurableArtworkIntent({db,bucket,authorize,subjectId,orderId,bytes:png(),now:NOW});
 assert.equal(created.ok,true,JSON.stringify(created));
 return {db,bucket,created};
}
const consume=(f,params={})=>consumeDurableArtworkIntent({db:f.db,bucket:f.bucket,authorize,
 intentId:f.created.intentId,subjectId,orderId,now:NOW+1,...params});

test("SQLite migration applies in memory, expected indexes and integrity check",()=>{
 const db=new SqliteD1();
 try {
  const names=db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(x=>x.name);
  assert.ok(names.includes("idx_dtf_intents_expiry"));
  assert.equal(db.sqlite.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.equal(db.count(),0);
 } finally {db.close();}
});
test("verified R2 round-trip creates exactly one durable SQLite record",async t=>{
 const f=await fixture(t),r=f.db.row(f.created.intentId);
 assert.equal(f.db.count(),1);assert.equal(r.status,"issued");assert.equal(r.subject_id,subjectId);
 assert.equal(r.byte_length,f.bucket.objects.get(r.object_key).byteLength);
 assert.match(r.sha256,/^[a-f0-9]{64}$/);
 assert.equal(f.created.checkoutEligible,false);assert.equal(f.created.productionApproved,false);
});
test("conditional SQL consume transitions issued to consumed once",async t=>{
 const f=await fixture(t);
 assert.equal((await consume(f)).ok,true);
 assert.equal(f.db.row(f.created.intentId).status,"consumed");
 assert.equal((await consume(f)).ok,false);
});
test("30 concurrent requests against same SQLite database accept only one",async t=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:30},()=>consume(f)));
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.equal(f.db.row(f.created.intentId).status,"consumed");
});
test("real SQLite SQL affected-row CAS rejects stale duplicate",async t=>{
 const f=await fixture(t);
 const row=f.db.row(f.created.intentId);
 const sql="UPDATE dtf_artwork_intents SET status='consumed', consumed_at=? WHERE intent_id=? AND status='issued' AND expires_at>?";
 assert.equal(Number(f.db.sqlite.prepare(sql).run(NOW+1,row.intent_id,NOW+1).changes),1);
 assert.equal(Number(f.db.sqlite.prepare(sql).run(NOW+2,row.intent_id,NOW+2).changes),0);
});
test("primary key and private object key uniqueness are enforced by SQLite",async t=>{
 const f=await fixture(t),r=f.db.row(f.created.intentId);
 const statement=f.db.sqlite.prepare("INSERT INTO dtf_artwork_intents (intent_id,version,subject_id,order_id,object_key,sha256,byte_length,created_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,'issued')");
 const vals=[r.intent_id,1,r.subject_id,r.order_id,r.object_key,r.sha256,r.byte_length,r.created_at,r.expires_at];
 assert.throws(()=>statement.run(...vals));
 assert.throws(()=>statement.run("intent_ffffffffffffffffffffffffffffffff",...vals.slice(1)));
 assert.equal(f.db.count(),1);
});
test("invalid state, file size, hash size and expiry fail SQLite CHECK constraints",async t=>{
 const f=await fixture(t),r=f.db.row(f.created.intentId);
 for(const query of [
  ["UPDATE dtf_artwork_intents SET status='unknown' WHERE intent_id=?",r.intent_id],
  ["UPDATE dtf_artwork_intents SET byte_length=0 WHERE intent_id=?",r.intent_id],
  ["UPDATE dtf_artwork_intents SET sha256='bad' WHERE intent_id=?",r.intent_id],
  ["UPDATE dtf_artwork_intents SET expires_at=created_at WHERE intent_id=?",r.intent_id],
  ["UPDATE dtf_artwork_intents SET status='consumed' WHERE intent_id=?",r.intent_id],
 ])assert.throws(()=>f.db.sqlite.prepare(query[0]).run(...query.slice(1)));
 assert.equal(f.db.row(r.intent_id).status,"issued");
});
test("transaction rollback restores issued state and allows a later consume",async t=>{
 const f=await fixture(t),id=f.created.intentId;
 f.db.sqlite.exec("BEGIN");
 f.db.sqlite.prepare("UPDATE dtf_artwork_intents SET status='consumed', consumed_at=? WHERE intent_id=?").run(NOW+1,id);
 f.db.sqlite.exec("ROLLBACK");
 assert.equal(f.db.row(id).status,"issued");
 assert.equal((await consume(f)).ok,true);
});
test("backdated and expired consume do not mutate SQLite row",async t=>{
 const f=await fixture(t);
 for(const now of [NOW-1,NOW+900000,NOW+900001]){
  assert.equal((await consume(f,{now})).ok,false);
  assert.equal(f.db.row(f.created.intentId).status,"issued");
 }
});
test("foreign subject/order cannot consume real SQLite record",async t=>{
 const f=await fixture(t);
 for(const over of [{subjectId:"foreign_12345678"},{orderId:"foreign_12345678"}]){
  assert.equal((await consume(f,over)).code,"UNAUTHORIZED_ORDER");
 }
 assert.equal(f.db.row(f.created.intentId).status,"issued");
});
test("private R2 content substitution fails without changing SQLite state",async t=>{
 const f=await fixture(t);f.bucket.corruptRead=true;
 assert.equal((await consume(f)).code,"STORED_ARTWORK_MISMATCH");
 assert.equal(f.db.row(f.created.intentId).status,"issued");
});
test("SQLite insert rejection triggers R2 orphan cleanup without any record",async t=>{
 const db=new SqliteD1(),bucket=new MemoryPrivateR2();t.after(()=>db.close());
 db.sqlite.exec("CREATE TRIGGER reject_issue BEFORE INSERT ON dtf_artwork_intents BEGIN SELECT RAISE(ABORT,'offline failure'); END");
 const r=await createDurableArtworkIntent({db,bucket,authorize,subjectId,orderId,bytes:png(),now:NOW});
 assert.equal(r.ok,false);assert.equal(db.count(),0);assert.equal(bucket.objects.size,0);
 assert.equal(r.checkoutEligible,false);
});
test("orphan deletion failure remains fail-closed and requires future sweeper",async t=>{
 const db=new SqliteD1(),bucket=new MemoryPrivateR2();t.after(()=>db.close());
 db.sqlite.exec("CREATE TRIGGER reject_issue BEFORE INSERT ON dtf_artwork_intents BEGIN SELECT RAISE(ABORT,'offline failure'); END");
 bucket.failDelete=true;
 const r=await createDurableArtworkIntent({db,bucket,authorize,subjectId,orderId,bytes:png(),now:NOW});
 assert.equal(r.ok,false);assert.equal(r.checkoutEligible,false);assert.equal(db.count(),0);
 assert.equal(bucket.objects.size,1);
});
