import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {createDurableArtworkIntent,consumeDurableArtworkIntent} from "../functions/lib/dtf-artwork-durable-rn3b1c.js";
function u32(n){return Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function crc(arr){let x=0xffffffff;for(const v of arr){x^=v;for(let k=0;k<8;k++)x=(x>>>1)^((x&1)?0xedb88320:0);}return (x^0xffffffff)>>>0;}
function chunk(t,d=Buffer.alloc(0)){let b=Buffer.from(t);return Buffer.concat([u32(d.length),b,d,u32(crc(Buffer.concat([b,d])))]);}
function png(f=0){return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([f,0,0,0,255]))),chunk("IEND")]));}
class FakeD1{
 constructor(){this.rows=new Map();this.failInsert=false;this.failUpdate=false;}
 prepare(sql){return{bind:(...values)=>({
  first:async()=>{assert.match(sql,/^SELECT/);return this.rows.get(values[0])??null;},
  run:async()=>{
   if(sql.startsWith("INSERT")) {
    if(this.failInsert)throw Error("DB_DOWN");
    const [id,subject,order,key,sha,len,created,expiry]=values;
    if(this.rows.has(id)||[...this.rows.values()].some(r=>r.object_key===key))return{success:true,meta:{changes:0}};
    this.rows.set(id,{intent_id:id,version:1,subject_id:subject,order_id:order,object_key:key,sha256:sha,byte_length:len,created_at:created,expires_at:expiry,status:"issued",consumed_at:null});
    return{success:true,meta:{changes:1}};
   }
   assert.match(sql,/^UPDATE/);
   if(this.failUpdate)throw Error("DB_DOWN");
   const [now,id,subject,order,key,sha,size,createdLimit,expiryLimit]=values, r=this.rows.get(id);
   if(!r||r.subject_id!==subject||r.order_id!==order||r.object_key!==key||r.sha256!==sha||r.byte_length!==size||r.status!=="issued"||r.created_at>createdLimit||r.expires_at<=expiryLimit)return{success:true,meta:{changes:0}};
   this.rows.set(id,{...r,status:"consumed",consumed_at:now});return{success:true,meta:{changes:1}};
  }
 })};}
}
class FakeR2{
 constructor(){this.objects=new Map();this.failPut=false;this.failGet=false;this.failDelete=false;this.corrupt=false;}
 async put(k,b){if(this.failPut)throw Error("PUT_DOWN");this.objects.set(k,Uint8Array.from(b));}
 async get(k){if(this.failGet)throw Error("GET_DOWN");let b=this.objects.get(k);if(!b)return null;return{arrayBuffer:async()=>this.corrupt?Uint8Array.from([1,2,3]).buffer:Uint8Array.from(b).buffer};}
 async delete(k){if(this.failDelete)throw Error("DELETE_DOWN");this.objects.delete(k);}
}
const now=1800000000000,subjectId="subject_12345678",orderId="order_12345678";
const auth=async(s,o)=>s===subjectId&&o===orderId;
async function fixture(){const db=new FakeD1(),bucket=new FakeR2(),bytes=png();let issued=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes,now});assert.equal(issued.ok,true);return{db,bucket,bytes,issued};}
function consume(f,over={}){return consumeDurableArtworkIntent({db:f.db,bucket:f.bucket,authorize:auth,intentId:f.issued.intentId,subjectId,orderId,now:now+1,...over});}
test("persist only after round-trip verification, no checkout authority",async()=>{let f=await fixture();assert.equal(f.db.rows.size,1);assert.equal(f.bucket.objects.size,1);assert.equal(f.issued.checkoutEligible,false);assert.equal(f.issued.artworkIntentBound,true);});
test("one-time consume gates by atomic SQL affected-row count",async()=>{let f=await fixture();assert.equal((await consume(f)).ok,true);assert.equal((await consume(f)).ok,false);});
test("parallel consumers accept exactly one across shared database",async()=>{let f=await fixture();let out=await Promise.all(Array.from({length:30},()=>consume(f)));assert.equal(out.filter(r=>r.ok).length,1);});
test("foreign subject and order blocked before R2 access",async()=>{let f=await fixture();f.bucket.failGet=true;assert.equal((await consume(f,{subjectId:"foreign_12345678"})).code,"UNAUTHORIZED_ORDER");assert.equal((await consume(f,{orderId:"foreign_12345678"})).code,"UNAUTHORIZED_ORDER");});
test("expired and clock-reversed intent not consumed",async()=>{for(const t of [now-1,now+900000,now+900001]){let f=await fixture();assert.equal((await consume(f,{now:t})).ok,false);}});
test("changed private object content is not consumed",async()=>{let f=await fixture();f.bucket.corrupt=true;assert.equal((await consume(f)).code,"STORED_ARTWORK_MISMATCH");assert.equal(f.db.rows.get(f.issued.intentId).status,"issued");});
test("missing private object and R2 read outage fail closed",async()=>{for(const mode of ["missing","failure"]){let f=await fixture();if(mode==="missing")f.bucket.objects.clear();else f.bucket.failGet=true;assert.equal((await consume(f)).ok,false);}});
test("R2 put failure creates neither row nor object",async()=>{const db=new FakeD1(),bucket=new FakeR2();bucket.failPut=true;const r=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes:png(),now});assert.equal(r.ok,false);assert.equal(db.rows.size,0);});
test("R2 readback mismatch cleans up object and leaves no row",async()=>{const db=new FakeD1(),bucket=new FakeR2();bucket.corrupt=true;const r=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes:png(),now});assert.equal(r.ok,false);assert.equal(bucket.objects.size,0);assert.equal(db.rows.size,0);});
test("database insertion failure attempts R2 orphan cleanup",async()=>{const db=new FakeD1(),bucket=new FakeR2();db.failInsert=true;const r=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes:png(),now});assert.equal(r.ok,false);assert.equal(bucket.objects.size,0);assert.equal(db.rows.size,0);});
test("cleanup failure never creates checkout permission",async()=>{const db=new FakeD1(),bucket=new FakeR2();db.failInsert=true;bucket.failDelete=true;const r=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes:png(),now});assert.equal(r.ok,false);assert.equal(r.checkoutEligible,false);assert.equal(db.rows.size,0);});
test("database update failure leaves an issued intent",async()=>{let f=await fixture();f.db.failUpdate=true;assert.equal((await consume(f)).ok,false);assert.equal(f.db.rows.get(f.issued.intentId).status,"issued");});
test("untrusted or unavailable authorization fails before any object write",async()=>{const db=new FakeD1(),bucket=new FakeR2();for(const authorize of [undefined,async()=>false,async()=>{throw Error("down");}]){let r=await createDurableArtworkIntent({db,bucket,authorize,subjectId,orderId,bytes:png(),now});assert.equal(r.ok,false);}assert.equal(bucket.objects.size,0);});
test("invalid PNG and missing durable dependencies fail closed",async()=>{const db=new FakeD1(),bucket=new FakeR2();for(const args of [{bytes:png(5)},{db:null},{bucket:null}]){const r=await createDurableArtworkIntent({db,bucket,authorize:auth,subjectId,orderId,bytes:png(),now,...args});assert.equal(r.ok,false);}assert.equal(db.rows.size,0);});
test("no route, Stripe, production deployment, or R2 binding registration",async()=>{const {readFileSync}=await import("node:fs");let src=readFileSync(new URL("../functions/lib/dtf-artwork-durable-rn3b1c.js",import.meta.url),"utf8");assert.doesNotMatch(src,/checkout\.sessions|stripe\.com|fetch\(|onRequestPost|env\.ARTWORK_BUCKET/);});
