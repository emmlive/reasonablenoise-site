// RN-3B1C Phase 5: ephemeral local workerd + D1 + R2. Never deploy.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
// Load an explicitly isolated local dependency tree; do not mutate Astro's packages.
const isolatedRoot=process.env.RN_MINIFLARE_ROOT;
if(!isolatedRoot) throw Error("RN_MINIFLARE_ROOT_REQUIRED: install Miniflare outside the repository");
const miniflareModule=resolve(isolatedRoot,"node_modules","miniflare","dist","src","index.js");
const {Miniflare}=await import(pathToFileURL(miniflareModule).href);
import {createDurableArtworkIntent,consumeDurableArtworkIntent} from "../functions/lib/dtf-artwork-durable-rn3b1c.js";
const migration=readFileSync(new URL("../migrations/rn-3b1c-phase3-artwork-intents.sql",import.meta.url),"utf8");
const NOW=1800000000000,subjectId="subject_12345678",orderId="order_12345678";
const authorize=async(s,o)=>s===subjectId&&o===orderId;
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(t,d=Buffer.alloc(0)){const b=Buffer.from(t);return Buffer.concat([u32(d.length),b,d,u32(crc(Buffer.concat([b,d])))]);}
function png(filter=0){return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([filter,0,0,0,255]))),chunk("IEND")]));}
const worker=[
 "export default {",
 " async fetch(request,env) {",
 "  const url=new URL(request.url);",
 "  if(request.method!=='POST')return new Response('TEST_POST_ONLY',{status:405});",
 "  const input=await request.json();",
 "  if(url.pathname==='/cas'){",
 "   const result=await env.TEST_D1.prepare(",
 "    \"UPDATE dtf_artwork_intents SET status='consumed', consumed_at=? WHERE intent_id=? AND subject_id=? AND order_id=? AND status='issued' AND created_at<=? AND expires_at>?\"",
 "   ).bind(input.now,input.id,input.subjectId,input.orderId,input.now,input.now).run();",
 "   return Response.json({changes:result.meta.changes,success:result.success});",
 "  }",
 "  if(url.pathname==='/check'){",
 "   const row=await env.TEST_D1.prepare('SELECT * FROM dtf_artwork_intents WHERE intent_id=?').bind(input.id).first();",
 "   const object=row&&await env.TEST_R2.get(row.object_key);",
 "   const size=object?(await object.arrayBuffer()).byteLength:null;",
 "   return Response.json({found:!!row,status:row?.status??null,storedSize:size});",
 "  }",
 "  return new Response('NOT_FOUND',{status:404});",
 " }",
 "}"
].join("\n");
async function local(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  d1Databases:{TEST_D1:"rn3b1c-phase5-disposable-db"},
  r2Buckets:{TEST_R2:"rn3b1c-phase5-disposable-bucket"}});
 t.after(async()=>{await mf.dispose();});
 const db=await mf.getD1Database("TEST_D1");
 const bucket=await mf.getR2Bucket("TEST_R2");
 await db.exec(migration);
 return {mf,db,bucket};
}
async function fixture(t){
 const f=await local(t);
 const created=await createDurableArtworkIntent({...f,authorize,subjectId,orderId,bytes:png(),now:NOW});
 assert.equal(created.ok,true,JSON.stringify(created));
 return {...f,created};
}
const consume=(f,extra={})=>consumeDurableArtworkIntent({db:f.db,bucket:f.bucket,authorize,subjectId,orderId,intentId:f.created.intentId,now:NOW+1,...extra});
async function call(f,path,payload){
 const response=await f.mf.dispatchFetch("http://localhost:8787"+path,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
 assert.equal(response.status,200);
 return response.json();
}
test("local Workerd D1 migration and R2 round-trip persist matching record",async t=>{
 const f=await fixture(t);
 const row=await f.db.prepare("SELECT * FROM dtf_artwork_intents WHERE intent_id=?").bind(f.created.intentId).first();
 assert.equal(row.status,"issued");
 const result=await call(f,"/check",{id:f.created.intentId});
 assert.deepEqual(result,{found:true,status:"issued",storedSize:row.byte_length});
 assert.equal(f.created.checkoutEligible,false);
});
test("20 workerd calls share one atomic D1 replay fence",async t=>{
 const f=await fixture(t),payload={id:f.created.intentId,subjectId,orderId,now:NOW+1};
 const out=await Promise.all(Array.from({length:20},()=>call(f,"/cas",payload)));
 assert.equal(out.filter(x=>x.success===true&&x.changes===1).length,1);
 assert.equal((await call(f,"/check",{id:f.created.intentId})).status,"consumed");
 assert.equal((await consume(f)).ok,false);
});
test("host adapter and workerd race against same local database",async t=>{
 const f=await fixture(t),payload={id:f.created.intentId,subjectId,orderId,now:NOW+1};
 const out=await Promise.all([consume(f),call(f,"/cas",payload),call(f,"/cas",payload)]);
 assert.equal(out.filter(x=>x.ok===true||x.changes===1).length,1);
});
test("Workerd SQL rejects foreign subject/order and expired timestamps",async t=>{
 const f=await fixture(t);
 for(const changed of [{subjectId:"foreign_12345678"},{orderId:"foreign_12345678"},{now:NOW+900000},{now:NOW-1}]){
  const res=await call(f,"/cas",{id:f.created.intentId,subjectId,orderId,now:NOW+1,...changed});
  assert.equal(res.changes,0);
 }
 assert.equal((await consume(f)).ok,true);
});
test("local R2 tampering fails byte verification before consumption",async t=>{
 const f=await fixture(t);
 const row=await f.db.prepare("SELECT * FROM dtf_artwork_intents WHERE intent_id=?").bind(f.created.intentId).first();
 await f.bucket.put(row.object_key,png(1));
 assert.equal((await consume(f)).code,"STORED_ARTWORK_MISMATCH");
 assert.equal((await call(f,"/check",{id:f.created.intentId})).status,"issued");
});
test("missing local R2 object never changes intent state",async t=>{
 const f=await fixture(t);
 const row=await f.db.prepare("SELECT * FROM dtf_artwork_intents WHERE intent_id=?").bind(f.created.intentId).first();
 await f.bucket.delete(row.object_key);
 assert.equal((await consume(f)).ok,false);
 assert.equal((await call(f,"/check",{id:f.created.intentId})).status,"issued");
});
test("local D1 CHECK and UNIQUE constraints reject forged mutations",async t=>{
 const f=await fixture(t);
 const row=await f.db.prepare("SELECT * FROM dtf_artwork_intents WHERE intent_id=?").bind(f.created.intentId).first();
 await assert.rejects(f.db.prepare("UPDATE dtf_artwork_intents SET status='invalid' WHERE intent_id=?").bind(row.intent_id).run());
 await assert.rejects(f.db.prepare("UPDATE dtf_artwork_intents SET byte_length=0 WHERE intent_id=?").bind(row.intent_id).run());
 await assert.rejects(f.db.prepare("INSERT INTO dtf_artwork_intents (intent_id,version,subject_id,order_id,object_key,sha256,byte_length,created_at,expires_at,status) VALUES (?,1,?,?,?,?,?,?,?,'issued')").bind("intent_ffffffffffffffffffffffffffffffff",row.subject_id,row.order_id,row.object_key,row.sha256,row.byte_length,row.created_at,row.expires_at).run());
});
test("test-only Workerd probe has no public route integration or payment behavior",()=>{
 assert.doesNotMatch(worker,/checkout\.sessions|stripe\.com|ARTWORK_BUCKET|ADMIN_ORDER_TOKEN/);
 assert.match(worker,/TEST_D1/);
 assert.match(worker,/TEST_R2/);
});
