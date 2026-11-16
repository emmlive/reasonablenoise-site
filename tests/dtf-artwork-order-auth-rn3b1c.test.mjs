// RN-3B1C Phase 13: synthetic server-authenticated order gate + local D1/R2.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createLocalR2WriteOnceAdapter} from "../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js";
import {stageWriteOnceArtwork} from "../functions/lib/dtf-artwork-version-rn3b1c.js";
import {bindOwnedArtworkVersion,verifyOwnedArtworkVersion} from "../functions/lib/dtf-artwork-order-auth-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const uuid="12345678-1234-4234-8234-123456789abc";
const key="dtf-intents/"+uuid+"/artwork.png",intentId="intent_"+uuid.replaceAll("-","");
const subjectId="subject_12345678",otherSubject="subject_87654321";
const workspaceId="workspace_12345678",otherWorkspace="workspace_87654321";
const orderId="order_12345678",pinId="pin_12345678",now=1800000000000;
const worker="export default {async fetch(){return new Response('LOCAL_PHASE13_ONLY')}}";
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(a){let c=0xffffffff;for(const v of a){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,d=Buffer.alloc(0)){const t=Buffer.from(type);return Buffer.concat([u32(d.length),t,d,u32(crc(Buffer.concat([t,d])))]);}
function png(color=255){return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,color]))),chunk("IEND")]));}
const sqlRead=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
const pinSQL=sqlRead("rn-3b1c-phase12-version-pins.sql");
const orderSQL=sqlRead("rn-3b1c-phase13-synthetic-order-authority.sql");
async function fixture(t){
 const mf=new Miniflare({modules:true,script:worker,compatibilityDate:"2026-08-01",
  d1Databases:{TEST_D1:"rn3b1c-phase13-disposable"},
  r2Buckets:{TEST_R2:"rn3b1c-phase13-disposable"}});
 t.after(async()=>mf.dispose());
 const db=await mf.getD1Database("TEST_D1"),bucket=await mf.getR2Bucket("TEST_R2");
 const p=pinSQL.split(/\r?\n/).filter(line=>! /^\s*--/.test(line)).join("\n");
 const pinStatements=p.match(/CREATE TABLE[\s\S]*?\n\);|CREATE TRIGGER[\s\S]*?\bEND;/g)||[];
 assert.equal(pinStatements.length,3);
 assert.equal(pinStatements.reduce((s,part)=>s.replace(part,""),p).trim(),"");
 for(const part of pinStatements)await db.prepare(part.replace(/;\s*$/,"")).run();
 const q=orderSQL.split(/\r?\n/).filter(line=>! /^\s*--/.test(line)).join("\n");
 const orderStatements=q.split(";").map(x=>x.trim()).filter(Boolean);
 assert.equal(orderStatements.length,2);
 for(const part of orderStatements)await db.prepare(part).run();
 await db.prepare("INSERT INTO dtf_test_order_authority VALUES (?,?,?,?,?,?)").bind(orderId,subjectId,workspaceId,"dtf_quote","draft",1).run();
 const store=createLocalR2WriteOnceAdapter(bucket);
 const created=await stageWriteOnceArtwork({store,authorize:async(s,o)=>s===subjectId&&o===orderId,subjectId,orderId,intentId,key,bytes:png()});
 assert.equal(created.ok,true,JSON.stringify(created));
 const sessions=new Map([
  ["good_session",{verified:true,subjectId,workspaceId}],
  ["foreign_session",{verified:true,subjectId:otherSubject,workspaceId}],
  ["other_workspace",{verified:true,subjectId,workspaceId:otherWorkspace}]
 ]);
 const authenticate=async request=>sessions.get(request?.sessionToken)||null;
 const request={sessionToken:"good_session"};
 const args={db,store,authenticate,request,orderId,intentId,pinId,reference:created.objectRef,now};
 const rows=()=>db.prepare("SELECT * FROM dtf_artwork_version_pins").all();
 const change=async(fields)=>db.prepare("UPDATE dtf_test_order_authority SET "+fields[0]+"=? WHERE order_id=?").bind(fields[1],orderId).run();
 return{db,bucket,store,args,rows,change,sessions};
}
const verify=f=>verifyOwnedArtworkVersion(({reference,now,...rest})=>rest)(f.args);
test("local synthetic order-authority schema and two immutable pin triggers apply",async t=>{
 const f=await fixture(t);
 const r=await f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='dtf_artwork_version_pins'").all();
 assert.equal(r.results.length,2);
 assert.equal((await f.rows()).results.length,0);
});
test("trusted server principal and owned active DTF draft bind version once",async t=>{
 const f=await fixture(t);
 const r=await bindOwnedArtworkVersion(f.args);
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal((await f.rows()).results[0].subject_id,subjectId);
 assert.equal(r.checkoutEligible,false);
});
test("owned version record can be read through same trusted session",async t=>{
 const f=await fixture(t);
 assert.equal((await bindOwnedArtworkVersion(f.args)).ok,true);
 const r=await verify(f);
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(r.deletionAuthorized,false);
});
test("forged request subject/workspace fields cannot override server principal",async t=>{
 const f=await fixture(t);
 const forged={sessionToken:"foreign_session",subjectId,workspaceId,verified:true};
 const r=await bindOwnedArtworkVersion({...f.args,request:forged,subjectId,workspaceId,authorize:async()=>true});
 assert.equal(r.code,"ORDER_NOT_AUTHORIZED");
 assert.equal((await f.rows()).results.length,0);
});
test("foreign workspace cannot bind another workspace order",async t=>{
 const f=await fixture(t);
 const r=await bindOwnedArtworkVersion({...f.args,request:{sessionToken:"other_workspace"}});
 assert.equal(r.code,"ORDER_NOT_AUTHORIZED");
});
test("missing or invalid server session rejects before storage binding",async t=>{
 const f=await fixture(t);
 for(const request of [{},{sessionToken:"bad"},{sessionToken:null}]){
  const r=await bindOwnedArtworkVersion({...f.args,request});
  assert.equal(r.code,"UNAUTHENTICATED");
 }
 assert.equal((await f.rows()).results.length,0);
});
test("missing or failing authenticator rejects without writing pin",async t=>{
 const f=await fixture(t);
 const a=await bindOwnedArtworkVersion({...f.args,authenticate:null});
 const b=await bindOwnedArtworkVersion({...f.args,authenticate:async()=>{throw Error("SESSION_DOWN");}});
 assert.equal(a.code,"TRUSTED_AUTH_REQUIRED");
 assert.equal(b.code,"AUTH_UNAVAILABLE");
 assert.equal((await f.rows()).results.length,0);
});
test("inactive, cancelled, paid, or non-DTF order cannot bind",async t=>{
 for(const [field,value] of [["is_active",0],["order_status","cancelled"],["order_status","paid"],["order_type","other"]]){
  const f=await fixture(t);
  if(field==="order_type"){
   await f.db.prepare("PRAGMA ignore_check_constraints=ON").run();
  }
  await f.change([field,value]);
  const r=await bindOwnedArtworkVersion(f.args);
  assert.equal(r.ok,false);
  assert.equal((await f.rows()).results.length,0);
 }
});
test("20 concurrent binds with trusted principal commit exactly once",async t=>{
 const f=await fixture(t);
 const out=await Promise.all(Array.from({length:20},(_,i)=>bindOwnedArtworkVersion({...f.args,pinId:"pin_12345678_"+i})));
 assert.equal(out.filter(r=>r.ok).length,1);
 assert.equal((await f.rows()).results.length,1);
});
test("revoked order access blocks reading already-bound version",async t=>{
 const f=await fixture(t);
 assert.equal((await bindOwnedArtworkVersion(f.args)).ok,true);
 await f.change(["order_status","cancelled"]);
 const r=await verify(f);
 assert.equal(r.code,"ORDER_NOT_AUTHORIZED");
});
test("R2 unconditional overwrite is detected despite authenticated order",async t=>{
 const f=await fixture(t);
 assert.equal((await bindOwnedArtworkVersion(f.args)).ok,true);
 await f.bucket.put(key,png(80),{httpMetadata:{contentType:"image/png"}});
 assert.equal((await verify(f)).code,"PINNED_OBJECT_CHANGED");
});
test("D1 authorization lookup outage fails closed and cannot create pin",async t=>{
 const f=await fixture(t);
 const db={prepare(sql){if(sql.includes("dtf_test_order_authority"))throw Error("DB_DOWN");return f.db.prepare(sql);}};
 const r=await bindOwnedArtworkVersion({...f.args,db});
 assert.equal(r.code,"ORDER_NOT_AUTHORIZED");
 assert.equal((await f.rows()).results.length,0);
});
test("Phase 13 has no production auth provider, live order route, payment or deletion",()=>{
 const source=readFileSync(new URL("../functions/lib/dtf-artwork-order-auth-rn3b1c.js",import.meta.url),"utf8");
 assert.doesNotMatch(source,/checkout\.sessions|stripe\.com|bucket\.delete|bucket\.put|onRequestPost|onScheduled|fetch\s*\(/);
 assert.match(orderSQL,/DO NOT APPLY TO PRODUCTION/);
});
