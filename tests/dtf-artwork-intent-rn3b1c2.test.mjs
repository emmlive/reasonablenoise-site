import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { prepareArtworkIntent, consumeArtworkIntent } from "../functions/lib/dtf-artwork-intent-rn3b1c2.js";

function u32(n) { return Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]); }
function crc32(b) { let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
function chunk(tag,data=Buffer.alloc(0)) {
  const t=Buffer.from(tag), d=Buffer.from(data);
  return Buffer.concat([u32(d.length),t,d,u32(crc32(Buffer.concat([t,d])))]);
}
function png(filter=0) {
  const h=Buffer.concat([u32(2),u32(2),Buffer.from([8,6,0,0,0])]);
  const row=Buffer.concat([Buffer.from([filter]),Buffer.alloc(8)]);
  return Uint8Array.from(Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR",h),chunk("IDAT",deflateSync(Buffer.concat([row,row]))),chunk("IEND"),
  ]));
}
function harness() {
  const records=new Map();
  let now=1000;
  let next=1;
  const calls={create:0,read:0,consume:0};
  const store={
    async createIfAbsent(record) {
      calls.create++;
      if(records.has(record.intentId))return false;
      records.set(record.intentId,{...record});return true;
    },
    async read(id){calls.read++;const r=records.get(id);return r?{...r}:null;},
    async consumeIfUnchanged(expected){
      calls.consume++;
      const current=records.get(expected.intentId);
      if(!current || current.state!=="pending")return false;
      if(Object.keys(expected).some(k=>current[k]!==expected[k]))return false;
      records.set(expected.intentId,{...current,state:"consumed"});return true;
    },
  };
  const deps={store,clock:{now:()=>now},idFactory:()=>`00000000-0000-4000-8000-${String(next++).padStart(12,"0")}`};
  const context={trustedServerIdentity:true,ownerId:"owner_123",orderRef:"order_123"};
  return {records,calls,deps,context,time:n=>{now=n;}};
}
const prepare=(h,extra={})=>prepareArtworkIntent({...h.deps,context:h.context,bytes:png(),...extra});
const consume=(h,id,extra={})=>consumeArtworkIntent({...h.deps,context:h.context,intentId:id,bytes:png(),...extra});
const noPayment=(v)=>{assert.equal(v.checkoutEligible,false);assert.equal(v.productionApproved,false);};

test("server verifies bytes and creates expiring pending intent without checkout readiness",async()=>{
  const h=harness();const r=await prepare(h);assert.equal(r.ok,true);noPayment(r);
  assert.equal(r.artworkIntentBound,false);assert.equal(h.calls.create,1);
  const record=h.records.get(r.intentId);
  assert.match(record.sha256,/^[0-9a-f]{64}$/);
  assert.equal(record.byteLength,png().length);
  assert.equal(record.expiresAt-record.createdAt,900000);
  assert.equal(record.state,"pending");
});
test("matching exact bytes can be consumed once, never used as a checkout token",async()=>{
  const h=harness();const made=await prepare(h);
  const first=await consume(h,made.intentId);assert.equal(first.ok,true);noPayment(first);
  assert.equal(first.validatedOnce,true);assert.equal(first.artworkIntentBound,false);
  const again=await consume(h,made.intentId);
  assert.equal(again.ok,false);assert.equal(again.reason,"INTENT_NOT_AVAILABLE");noPayment(again);
  assert.equal(h.calls.consume,1);
});
test("altered valid PNG is rejected even when dimensions and file size match",async()=>{
  const h=harness(),made=await prepare(h);
  const different=png(1);
  const p=await consume(h,made.intentId,{bytes:different});
  assert.equal(p.ok,false);assert.equal(p.reason,"ARTWORK_MISMATCH");noPayment(p);
  assert.equal(h.calls.consume,0);
});
test("different owner and order cannot consume another intent",async()=>{
  const h=harness(),made=await prepare(h);
  for(const context of [{...h.context,ownerId:"owner_456"},{...h.context,orderRef:"order_456"}]) {
    const p=await consume(h,made.intentId,{context});
    assert.equal(p.reason,"INTENT_NOT_AVAILABLE");noPayment(p);
  }
  assert.equal(h.calls.consume,0);
});
test("expiration and clock rollback block consumption before writes",async()=>{
  const h=harness(),made=await prepare(h);
  h.time(901000);
  assert.equal((await consume(h,made.intentId)).reason,"INTENT_EXPIRED");
  h.time(999);
  assert.equal((await consume(h,made.intentId)).reason,"INTENT_EXPIRED");
  assert.equal(h.calls.consume,0);
});
test("missing trusted identity or malformed IDs fail closed before storage",async()=>{
  const h=harness();
  for(const context of [null,{}, {...h.context,trustedServerIdentity:false},{...h.context,ownerId:"../escape"},{...h.context,orderRef:"x"}]) {
    const p=await prepare(h,{context});
    assert.equal(p.reason,"UNAUTHORIZED_CONTEXT");noPayment(p);
  }
  assert.equal(h.calls.create,0);
});
test("unsupported or corrupt artwork does not create an intent",async()=>{
  const h=harness();
  for(const bytes of [new Uint8Array(0),new Uint8Array([1,2,3]),png().subarray(0,40)]) {
    const p=await prepare(h,{bytes});assert.equal(p.ok,false);noPayment(p);
  }
  assert.equal(h.calls.create,0);
});
test("duplicate intent IDs and create errors fail closed",async()=>{
  const h=harness();const first=await prepare(h);assert.equal(first.ok,true);
  h.deps.idFactory=()=>first.intentId;
  const duplicate=await prepare(h);assert.equal(duplicate.reason,"INTENT_CREATE_FAILED");noPayment(duplicate);
  h.deps.store.createIfAbsent=async()=>{throw Error("offline");};
  const error=await prepare(h);assert.equal(error.reason,"INTENT_CREATE_FAILED");noPayment(error);
});
test("atomic compare-and-consume rejects stale records and concurrent reuse",async()=>{
  const h=harness(),made=await prepare(h);
  const current=h.records.get(made.intentId);
  h.records.set(made.intentId,{...current,sha256:"f".repeat(64)});
  const altered=await consume(h,made.intentId);
  assert.equal(altered.reason,"ARTWORK_MISMATCH");noPayment(altered);
  h.records.set(made.intentId,{...current});
  h.deps.store.consumeIfUnchanged=async()=>false;
  const race=await consume(h,made.intentId);
  assert.equal(race.reason,"INTENT_ALREADY_CONSUMED_OR_CHANGED");noPayment(race);
});
test("invalid clock, missing adapter or storage errors reject without authorization",async()=>{
  const h=harness();
  assert.equal((await prepare(h,{clock:{now:()=>NaN}})).reason,"INVALID_CLOCK");
  assert.equal((await prepare(h,{store:{}})).reason,"REPOSITORY_NOT_CONFIGURED");
  const made=await prepare(h);
  const failure=await consume(h,made.intentId,{store:{...h.deps.store,read:async()=>{throw Error("offline");}}});
  assert.equal(failure.reason,"INTENT_READ_FAILED");noPayment(failure);
  const consumeFailure=await consume(h,made.intentId,{store:{...h.deps.store,consumeIfUnchanged:async()=>{throw Error("offline");}}});
  assert.equal(consumeFailure.reason,"ATOMIC_CONSUME_FAILED");noPayment(consumeFailure);
});
test("source contains no provider calls, persistent store or payment side effects",()=>{
  const source=readFileSync(new URL("../functions/lib/dtf-artwork-intent-rn3b1c2.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/fetch\(|stripe\.com|checkout\.sessions|R2_BUCKET|RESEND_API|payment_intent/);
  assert.match(source,/consumeIfUnchanged\(record\)/);
  assert.match(source,/artworkIntentBound: false, checkoutEligible: false, productionApproved: false/);
});
