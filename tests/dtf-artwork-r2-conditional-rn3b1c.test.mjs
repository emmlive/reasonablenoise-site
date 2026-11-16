// RN-3B1C Phase 11: disposable Miniflare R2 only. Not remote Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createLocalR2WriteOnceAdapter} from "../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js";
import {stageWriteOnceArtwork,verifyPinnedArtworkVersion} from "../functions/lib/dtf-artwork-version-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const worker="export default {async fetch(){return new Response('LOCAL_TEST_ONLY')}}";
const uuid="12345678-1234-4234-8234-123456789abc",key="dtf-intents/"+uuid+"/artwork.png";
const intentId="intent_"+uuid.replaceAll("-",""),subjectId="subject_12345678",orderId="order_12345678";
const authorize=async (s,o)=>s===subjectId&&o===orderId;
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(arr){let c=0xffffffff;for(const b of arr){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const t=Buffer.from(type);return Buffer.concat([u32(data.length),t,data,u32(crc(Buffer.concat([t,data])))]);}
function png(color=255){return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,color]))),chunk("IEND")]));}
async function local(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  r2Buckets:{TEST_R2:"rn3b1c-phase11-disposable-conditional-bucket"}});
 t.after(async()=>mf.dispose());
 const bucket=await mf.getR2Bucket("TEST_R2");
 const store=createLocalR2WriteOnceAdapter(bucket);assert.ok(store);
 return {bucket,store};
}
const args=(store,more={})=>({store,authorize,subjectId,orderId,intentId,key,bytes:png(),...more});
async function issued(t){const f=await local(t);const result=await stageWriteOnceArtwork(args(f.store));assert.equal(result.ok,true,JSON.stringify(result));return {...f,result};}
test("local R2 conditional put creates absent object with stable version reference",async t=>{
 const f=await issued(t);const current=await f.bucket.head(key);
 assert.equal(current.version,f.result.objectRef.version);
 assert.equal(current.size,f.result.objectRef.byteLength);
 assert.equal(f.result.checkoutEligible,false);
});
test("20 concurrent local R2 conditional creates allow only one successful write",async t=>{
 const f=await local(t);
 const results=await Promise.all(Array.from({length:20},()=>stageWriteOnceArtwork(args(f.store))));
 assert.equal(results.filter(x=>x.ok).length,1,JSON.stringify(results.map(x=>x.code)));
 assert.equal((await f.bucket.head(key)).version,results.find(x=>x.ok).objectRef.version);
});
test("duplicate same-content conditional put returns false without changing version",async t=>{
 const f=await issued(t);const second=await stageWriteOnceArtwork(args(f.store));
 assert.equal(second.ok,false);
 assert.equal((await f.bucket.head(key)).version,f.result.objectRef.version);
});
test("different PNG content cannot replace existing local R2 object",async t=>{
 const f=await issued(t);
 assert.equal((await stageWriteOnceArtwork(args(f.store,{bytes:png(100)}))).ok,false);
 assert.equal((await f.bucket.head(key)).version,f.result.objectRef.version);
});
test("exact R2 pinned version and stored PNG can be reverified",async t=>{
 const f=await issued(t);
 const checked=await verifyPinnedArtworkVersion({store:f.store,authorize,subjectId,orderId,intentId,reference:f.result.objectRef});
 assert.equal(checked.ok,true,JSON.stringify(checked));
 assert.equal(checked.artworkImmutable,false);
});
test("unconditional overwrite changes version and invalidates pinned proof",async t=>{
 const f=await issued(t),original=f.result.objectRef;
 await f.bucket.put(key,png(100),{httpMetadata:{contentType:"image/png"},customMetadata:{rnSha256:original.sha256,rnByteLength:String(original.byteLength)}});
 assert.notEqual((await f.bucket.head(key)).version,original.version);
 const checked=await verifyPinnedArtworkVersion({store:f.store,authorize,subjectId,orderId,intentId,reference:original});
 assert.equal(checked.ok,false);
});
test("malformed or absent metadata cannot be mistaken for a valid version reference",async t=>{
 const f=await local(t);await f.bucket.put(key,png());
 assert.equal(await f.store.head(key),null);
 const checked=await verifyPinnedArtworkVersion({store:f.store,authorize,subjectId,orderId,intentId,reference:{key,version:"fake_version_123",sha256:"a".repeat(64),byteLength:70}});
 assert.equal(checked.ok,false);
});
test("foreign owner or order cannot issue or verify same R2 object",async t=>{
 const f=await issued(t);
 assert.equal((await stageWriteOnceArtwork(args(f.store,{subjectId:"foreign_12345678"}))).ok,false);
 assert.equal((await verifyPinnedArtworkVersion({store:f.store,authorize,subjectId,orderId:"foreign_12345678",intentId,reference:f.result.objectRef})).ok,false);
});
test("store bridge refuses non-atomic or non-R2-like dependencies",()=>{
 assert.equal(createLocalR2WriteOnceAdapter(null),null);
 assert.equal(createLocalR2WriteOnceAdapter({put:()=>{},head:()=>{}}),null);
});
test("R2 local adapter passes create-only POJO condition, never unconditional",async t=>{
 const f=await local(t);
 const seen=[];
 const wrapping={
  put:async(k,b,opts)=>{seen.push(opts?.onlyIf);return f.bucket.put(k,b,opts);},
  head:k=>f.bucket.head(k),get:k=>f.bucket.get(k)
 };
 const store=createLocalR2WriteOnceAdapter(wrapping);
 const first=await stageWriteOnceArtwork(args(store));
 assert.equal(first.ok,true,JSON.stringify(first));
 const duplicate=await stageWriteOnceArtwork(args(store));
 assert.equal(duplicate.ok,false);
 assert.deepEqual(seen,[{etagDoesNotMatch:"*"},{etagDoesNotMatch:"*"}]);
});
test("conditional R2 precondition is a live declaration, not escaped into a comment",async()=>{
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\\n/,"Literal backslash-newline escapes forbidden in bridge source");
 assert.match(source,/^\s*const condition=\{etagDoesNotMatch:"\*"\};\s*$/m);
 assert.match(source,/onlyIf:condition/);
});
test("test bridge has no R2 delete, customer route or checkout activation",()=>{
 const source=readFileSync(new URL("../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js",import.meta.url),"utf8");
 assert.match(source,/etagDoesNotMatch/);
 assert.doesNotMatch(source,/bucket\.delete\s*\(|bucket\.list\s*\(|onRequestPost|onScheduled|checkout\.sessions|stripe\.com|ADMIN_ORDER_TOKEN/);
});
