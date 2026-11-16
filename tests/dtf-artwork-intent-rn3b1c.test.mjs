import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { issueArtworkIntent, consumeArtworkIntent } from "../functions/lib/dtf-artwork-intent-rn3b1c.js";
function u32(n){return Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const t=Buffer.from(type);return Buffer.concat([u32(data.length),t,data,u32(crc(Buffer.concat([t,data])))]);}
function png(filter=0){return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([filter,0,0,0,255]))),chunk("IEND")]));}
class MemoryTransactionalStore{
  constructor(){this.rows=new Map();this.chain=Promise.resolve();this.fail=false;}
  async atomic(fn){
    const previous=this.chain;let unlock;this.chain=new Promise(r=>unlock=r);
    await previous;
    const snapshot=new Map([...this.rows].map(([k,v])=>[k,{...v}]));
    const tx={get:async id=>snapshot.get(id),insert:async row=>{if(snapshot.has(row.intentId))throw Error("duplicate");snapshot.set(row.intentId,{...row});},update:async row=>{if(!snapshot.has(row.intentId))throw Error("missing");snapshot.set(row.intentId,{...row});}};
    try {const result=await fn(tx);if(this.fail)throw Error("rollback");this.rows=snapshot;return result;} finally {unlock();}
  }
}
const subjectId="subject_12345678",orderId="order_12345678",now=1_800_000_000_000;
async function fixture(){const store=new MemoryTransactionalStore(),bytes=png();const issued=await issueArtworkIntent({store,subjectId,orderId,bytes,filename:"artwork.png",now});assert.equal(issued.ok,true);const record=store.rows.get(issued.intentId);return {store,bytes,issued,record};}
function request(f,over={}){return {store:f.store,intentId:f.issued.intentId,subjectId,orderId,storedBytes:f.bytes,storedObjectKey:f.record.objectKey,now:now+1,...over};}
test("issue stores server-derived immutable digest and object key, without checkout permission",async()=>{const f=await fixture();assert.match(f.record.sha256,/^[a-f0-9]{64}$/);assert.equal(f.record.byteLength,f.bytes.length);assert.match(f.record.objectKey,/^dtf-intents\//);assert.equal(f.issued.checkoutEligible,false);assert.equal(f.issued.artworkIntentBound,false);});
test("consume binds exact stored bytes and identity once, without authorizing payment",async()=>{const f=await fixture();const a=await consumeArtworkIntent(request(f));assert.equal(a.ok,true);assert.equal(a.artworkIntentBound,true);assert.equal(a.checkoutEligible,false);assert.equal(f.store.rows.get(f.issued.intentId).status,"consumed");assert.equal((await consumeArtworkIntent(request(f))).code,"INTENT_ALREADY_USED");});
test("wrong subject and wrong order cannot consume",async()=>{for(const changed of [{subjectId:"foreign_12345678"},{orderId:"foreign_12345678"}]){const f=await fixture();assert.equal((await consumeArtworkIntent(request(f,changed))).code,"UNAUTHORIZED_INTENT");assert.equal(f.store.rows.get(f.issued.intentId).status,"issued");}});
test("object substitution, changed bytes, and changed size rejected",async()=>{for(const changed of [{storedObjectKey:"dtf-intents/foreign/artwork.png"},{storedBytes:png(1)},{storedBytes:png().slice(0,-2)}]){const f=await fixture();const result=await consumeArtworkIntent(request(f,changed));assert.equal(result.ok,false);assert.equal(f.store.rows.get(f.issued.intentId).status,"issued");}});
test("expiry and backwards clock fail closed",async()=>{for(const time of [now-1,now+900000,now+900001]){const f=await fixture();assert.equal((await consumeArtworkIntent(request(f,{now:time}))).ok,false);}});
test("parallel consumers: exactly one succeeds",async()=>{const f=await fixture();const out=await Promise.all(Array.from({length:12},()=>consumeArtworkIntent(request(f))));assert.equal(out.filter(x=>x.ok).length,1);});
test("transaction rollback leaves intent usable",async()=>{const f=await fixture();f.store.fail=true;assert.equal((await consumeArtworkIntent(request(f))).code,"INTENT_TRANSACTION_FAILED");assert.equal(f.store.rows.get(f.issued.intentId).status,"issued");f.store.fail=false;assert.equal((await consumeArtworkIntent(request(f))).ok,true);});
test("failed issue persistence never returns an issued authorization",async()=>{const f=new MemoryTransactionalStore();f.fail=true;const r=await issueArtworkIntent({store:f,subjectId,orderId,bytes:png(),filename:"artwork.png",now});assert.equal(r.ok,false);assert.equal(f.rows.size,0);});
test("unsupported file, invalid identities, absent storage and forged intent fail closed",async()=>{const store=new MemoryTransactionalStore();for(const options of [{filename:"artwork.pdf"},{subjectId:"bad"},{bytes:new Uint8Array([1,2,3])},{store:null}]){const a=await issueArtworkIntent({store,subjectId,orderId,bytes:png(),filename:"artwork.png",now,...options});assert.equal(a.ok,false);}const f=await fixture();assert.equal((await consumeArtworkIntent(request(f,{intentId:"intent_00000000000000000000000000000000"}))).ok,false);});
test("server contract has no Stripe, fetch, or R2 access",async()=>{const {readFileSync}=await import("node:fs");const source=readFileSync(new URL("../functions/lib/dtf-artwork-intent-rn3b1c.js",import.meta.url),"utf8");assert.doesNotMatch(source,/stripe\.com|checkout\.sessions|fetch\(|ARTWORK_BUCKET|\.put\(/);});
