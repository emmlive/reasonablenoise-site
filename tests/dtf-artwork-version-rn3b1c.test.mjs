import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {stageWriteOnceArtwork,verifyPinnedArtworkVersion} from "../functions/lib/dtf-artwork-version-rn3b1c.js";
const uuid="12345678-1234-4234-8234-123456789abc";
const key="dtf-intents/"+uuid+"/artwork.png",intentId="intent_"+uuid.replaceAll("-","");
const subjectId="subject_12345678",orderId="order_12345678";
const authorize=async(s,o)=>s===subjectId&&o===orderId;
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
const crc=a=>{let c=0xffffffff;for(const b of a){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const chunk=(type,data=Buffer.alloc(0))=>{const t=Buffer.from(type);return Buffer.concat([u32(data.length),t,data,u32(crc(Buffer.concat([t,data])))]);};
const png=(color=255)=>Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,color]))),chunk("IEND")]));
class AtomicFakeStore {
 constructor(){this.objects=new Map();this.counter=0;this.fail=false;this.mutateAt=null;}
 async putIfAbsent(k,b,meta){
  if(this.fail)throw Error("storage down");
  if(this.objects.has(k))return {created:false};
  this.counter++;
  const version="immutable_version_"+this.counter;
  this.objects.set(k,{bytes:Uint8Array.from(b),version,sha256:meta.sha256,byteLength:meta.byteLength});
  return{created:true,version};
 }
 async head(k){
  if(this.fail)throw Error("head down");
  if(this.mutateAt==="before_head"||this.mutateAt==="after_read"&&this.reads){
   const obj=this.objects.get(k);if(obj){obj.version="changed_version_9";this.mutateAt=null;}
  }
  const o=this.objects.get(k);return o&&{key:k,version:o.version,sha256:o.sha256,byteLength:o.byteLength};
 }
 async get(k){
  if(this.fail)throw Error("get down");
  this.reads=(this.reads||0)+1;
  const o=this.objects.get(k);return o&&{arrayBuffer:async()=>Uint8Array.from(o.bytes).buffer};
 }
}
const args=(store,over={})=>({store,authorize,subjectId,orderId,intentId,key,bytes:png(),...over});
async function issued(){const store=new AtomicFakeStore(),created=await stageWriteOnceArtwork(args(store));assert.equal(created.ok,true,JSON.stringify(created));return{store,created};}
test("atomic write-once creates pinned reference after two matching heads and PNG readback",async()=>{const {store,created}=await issued();assert.equal(store.objects.size,1);assert.match(created.objectRef.version,/^immutable_version_/);assert.equal(created.artworkImmutable,false);assert.equal(created.checkoutEligible,false);});
test("20 concurrent writes only one succeeds for same exact private key",async()=>{const store=new AtomicFakeStore();const out=await Promise.all(Array.from({length:20},()=>stageWriteOnceArtwork(args(store))));assert.equal(out.filter(x=>x.ok).length,1);assert.equal(store.objects.size,1);});
test("different bytes cannot overwrite existing object",async()=>{const {store}=await issued();const before=Uint8Array.from(store.objects.get(key).bytes);const r=await stageWriteOnceArtwork(args(store,{bytes:png(128)}));assert.equal(r.ok,false);assert.deepEqual(store.objects.get(key).bytes,before);});
test("same bytes cannot silently refresh version or overwrite",async()=>{const {store,created}=await issued();const r=await stageWriteOnceArtwork(args(store));assert.equal(r.ok,false);assert.equal(store.objects.get(key).version,created.objectRef.version);});
test("exact pinned version can be verified read-only",async()=>{const {store,created}=await issued();const r=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:created.objectRef});assert.equal(r.ok,true);assert.equal(r.deletionAuthorized,false);});
test("same-sized valid PNG substitution fails digest verification",async()=>{const {store,created}=await issued();store.objects.get(key).bytes=png(128);const r=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:created.objectRef});assert.equal(r.code,"VERSION_OR_CONTENT_CHANGED");});
test("same-content version change is rejected",async()=>{const {store,created}=await issued();store.objects.get(key).version="changed_version_9";const r=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:created.objectRef});assert.equal(r.ok,false);});
test("version changes between read and final head fail closed",async()=>{const {store,created}=await issued();store.mutateAt="after_read";const r=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:created.objectRef});assert.equal(r.ok,false);});
test("changed object during initial stage verification fails closed",async()=>{const store=new AtomicFakeStore();store.mutateAt="after_read";const r=await stageWriteOnceArtwork(args(store));assert.equal(r.ok,false);assert.equal(r.checkoutEligible,false);});
test("foreign subject/order cannot stage or inspect protected artwork",async()=>{const {store,created}=await issued();for(const changed of [{subjectId:"foreign_12345678"},{orderId:"foreign_12345678"}]){assert.equal((await stageWriteOnceArtwork(args(store,changed))).code,"UNAUTHORIZED_ORDER");assert.equal((await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:created.objectRef,...changed})).code,"UNAUTHORIZED_ORDER");}});
test("malformed identity, object key or version reference fails closed",async()=>{const {store,created}=await issued();for(const changed of [{intentId:"intent_fake_12345678"},{key:"orders/other.png"}]){assert.equal((await stageWriteOnceArtwork(args(store,changed))).ok,false);}for(const changed of [{version:".."},{sha256:"a"},{key:"orders/other.png"},{byteLength:-1}]){const r=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference:{...created.objectRef,...changed}});assert.equal(r.ok,false);}});
test("requires truly atomic putIfAbsent; ordinary put is not accepted",async()=>{const store={put:async()=>true,get:async()=>null,head:async()=>null};const r=await stageWriteOnceArtwork(args(store));assert.equal(r.code,"WRITE_ONCE_ADAPTER_REQUIRED");});
test("storage failures and unverified PNG never create checkout authorization",async()=>{const store=new AtomicFakeStore();store.fail=true;assert.equal((await stageWriteOnceArtwork(args(store))).ok,false);store.fail=false;const r=await stageWriteOnceArtwork(args(store,{bytes:Uint8Array.of(1,2,3)}));assert.equal(r.ok,false);assert.equal(r.checkoutEligible,false);});
test("no checkout, route, real R2 mutation, deletion or database integration",async()=>{const {readFileSync}=await import("node:fs");const s=readFileSync(new URL("../functions/lib/dtf-artwork-version-rn3b1c.js",import.meta.url),"utf8");assert.doesNotMatch(s,/bucket\.put|bucket\.delete|onRequestPost|onScheduled|checkout\.sessions|env\.|fetch\s*\(/);});
