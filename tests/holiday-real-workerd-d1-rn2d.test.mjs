// RN Holiday 2D: real Workerd + disposable Cloudflare D1 acceptance tests.
// No Stripe credentials, real customer sessions, deployment or provider networks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root=process.env.RN_MINIFLARE_ROOT;
if (!root) throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const { Miniflare } = await import(pathToFileURL(
  resolve(root, "node_modules", "miniflare", "dist", "src", "index.js")).href);
const source=readFileSync(new URL("../src/lib/holiday-review-ledger.mjs",import.meta.url),"utf8");
const migration=readFileSync(new URL("../migrations/holiday-disposable/0001_review_ledger.sql",import.meta.url),"utf8");
const workerSource=source
  .replaceAll("export const ", "const ")
  .replace("export async function recordHolidayReviewCandidate", "async function recordHolidayReviewCandidate")
  + [
    "export default {async fetch(request,env){",
    " const u=new URL(request.url);",
    " if(u.hostname!=='localhost'||request.method!=='POST')return new Response('LOCAL_ONLY',{status:404});",
    " if(u.pathname==='/record'){",
    "  const body=await request.json();",
    "  return Response.json(await recordHolidayReviewCandidate({",
    "   candidate:body.candidate,disposableDb:env.HOLIDAY_DISPOSABLE_D1,",
    "   allowDisposableWrite:body.allowDisposableWrite===true",
    "  }));",
    " }",
    " if(u.pathname==='/counts'){",
    "  const db=env.HOLIDAY_DISPOSABLE_D1;",
    "  const o=await db.prepare('SELECT COUNT(*) AS n FROM rn_holiday_review_orders').first();",
    "  const e=await db.prepare('SELECT COUNT(*) AS n FROM rn_holiday_review_events').first();",
    "  return Response.json({orders:o.n,events:e.n});",
    " }",
    " return new Response('LOCAL_ONLY',{status:404});",
    "}}"
  ].join("\n");
const reference="RNH-0123456789ABCDEF",sessionId="cs_test_holiday_123456";
const candidate=(override={})=>({
  status:"hold",reason:"durable_order_idempotency_and_refund_reconciliation_required",
  paymentAuthorized:false,fulfillmentAuthorized:false,emailAuthorized:false,
  deletionAuthorized:false,eventId:"evt_holiday123456",
  orderReference:reference,checkoutSessionId:sessionId,
  units:3,subtotalCents:7200,shippingCents:999,totalCents:8199,
  variants:[{id:"reindeer",size:"M",color:"white",quantity:2},
    {id:"owl",size:"XL",color:"heather-gray",quantity:1}],
  ...override
});
function mfOptions(path) {
  return { modules:true,script:workerSource,compatibilityDate:"2026-08-01",
    d1Databases:{HOLIDAY_DISPOSABLE_D1:"rn-holiday-2d-test-only"},
    ...(path?{d1Persist:path}:{}) };
}
function statements() {
  const bare=migration.split(/\r?\n/).filter(line=>!/^\s*--/.test(line)).join("\n");
  const parts=bare.split(";").map(s=>s.trim()).filter(Boolean);
  assert.equal(parts.length,4,"Unexpected Phase 2C DDL statement count");
  assert.match(parts[0],/^PRAGMA foreign_keys = ON$/);
  assert.match(parts[1],/^CREATE TABLE IF NOT EXISTS rn_holiday_review_orders/);
  assert.match(parts[2],/^CREATE TABLE IF NOT EXISTS rn_holiday_review_events/);
  assert.match(parts[3],/^CREATE INDEX IF NOT EXISTS rn_holiday_review_events_order/);
  return parts;
}
async function migrate(db){
  for(const sql of statements())await db.prepare(sql).run();
}
async function start(t,{persist=false}={}) {
  let dir=null;
  if(persist){
    dir=mkdtempSync(join(tmpdir(),"rn-holiday-2d-disposable-"));
    t.after(()=>rmSync(dir,{recursive:true,force:true}));
  }
  const mf=new Miniflare(mfOptions(dir));
  t.after(async()=>mf.dispose());
  const db=await mf.getD1Database("HOLIDAY_DISPOSABLE_D1");
  await migrate(db);
  const send=async(path,payload={})=>{
    const response=await mf.dispatchFetch("http://localhost"+path,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(payload)
    });
    assert.equal(response.status,200);
    return response.json();
  };
  const record=(c=candidate(),enabled=true)=>send("/record",
    {candidate:c,allowDisposableWrite:enabled});
  const counts=()=>send("/counts");
  return {mf,db,record,counts,dir};
}
const rowCount=async(db,table)=>(await db.prepare("SELECT COUNT(*) AS n FROM "+table).first()).n;
const ORDERS="rn_holiday_review_orders",EVENTS="rn_holiday_review_events";
function isNoAuthority(result){
  assert.ok(result.status==="hold"||result.status==="blocked",JSON.stringify(result));
  for(const key of ["paymentAuthorized","fulfillmentAuthorized","emailAuthorized","deletionAuthorized"])
    assert.equal(result[key],false,key);
}
test("real Workerd starts, uses actual migrated D1, and records only review/seen statuses",async t=>{
  const f=await start(t);
  const result=await f.record();isNoAuthority(result);
  assert.equal(result.reason,"review_only_recorded_no_fulfillment");
  assert.deepEqual(await f.counts(),{orders:1,events:1});
  assert.equal((await f.db.prepare("SELECT status FROM "+ORDERS).first()).status,"review_only");
  assert.equal((await f.db.prepare("SELECT status FROM "+EVENTS).first()).status,"seen_only");
});
test("Workerd refuses recording unless isolated write flag is explicit",async t=>{
  const f=await start(t);
  const result=await f.record(candidate(),false);
  assert.equal(result.reason,"ledger_disabled");
  assert.deepEqual(await f.counts(),{orders:0,events:0});
});
test("same signed/reconciled candidate replay in Workerd cannot duplicate D1 rows",async t=>{
  const f=await start(t);
  isNoAuthority(await f.record());
  const replay=await f.record();isNoAuthority(replay);
  assert.equal(replay.reason,"duplicate_review_event_ignored");
  assert.deepEqual(await f.counts(),{orders:1,events:1});
});
test("20 real concurrent Workerd fetches cannot duplicate one order/event",async t=>{
  const f=await start(t);
  const results=await Promise.all(Array.from({length:20},()=>f.record()));
  results.forEach(isNoAuthority);
  assert.deepEqual(await f.counts(),{orders:1,events:1});
});
test("distinct events on the same exact order preserve one order and several events",async t=>{
  const f=await start(t);
  const results=await Promise.all(Array.from({length:12},(_,i)=>
    f.record(candidate({eventId:"evt_parallel"+String(i).padStart(6,"0")}))));
  results.forEach(isNoAuthority);
  assert.deepEqual(await f.counts(),{orders:1,events:12});
});
test("foreign order reference or reused event ID cannot attach to another session",async t=>{
  const f=await start(t);
  isNoAuthority(await f.record());
  for(const altered of [
    {orderReference:"RNH-AAAAAAAAAAAAAAAA",checkoutSessionId:"cs_test_other123456"},
    {eventId:"evt_other123456",checkoutSessionId:"cs_test_other123456"},
    {eventId:"evt_other123456",orderReference:"RNH-AAAAAAAAAAAAAAAA"}
  ]){
    const result=await f.record(candidate(altered));isNoAuthority(result);
    assert.equal(result.status,"blocked");
  }
  assert.deepEqual(await f.counts(),{orders:1,events:1});
});
test("Workerd rejects changed item identity after original order is stored",async t=>{
  const f=await start(t);await f.record();
  const altered=candidate({eventId:"evt_altered123456",variants:[
    {id:"bear",size:"M",color:"white",quantity:2},
    {id:"owl",size:"XL",color:"heather-gray",quantity:1}
  ]});
  const result=await f.record(altered);
  assert.equal(result.reason,"identity_collision_or_unconfirmed_write");
  assert.deepEqual(await f.counts(),{orders:1,events:1});
});
test("real D1 batch throws on second statement CHECK violation and rolls back first",async t=>{
  const f=await start(t);
  const first=f.db.prepare(
    "INSERT INTO "+ORDERS+" (order_reference,checkout_session_id,payload_sha256,units,subtotal_cents,shipping_cents,total_cents,status) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(reference,sessionId,"a".repeat(64),1,2400,999,3399,"review_only");
  const badSecond=f.db.prepare(
    "INSERT INTO "+EVENTS+" (event_id,order_reference,checkout_session_id,payload_sha256,status) VALUES (?,?,?,?,?)"
  ).bind("evt_badtest123456",reference,sessionId,"a".repeat(64),"fulfilled");
  await assert.rejects(f.db.batch([first,badSecond]));
  assert.equal(await rowCount(f.db,ORDERS),0);
  assert.equal(await rowCount(f.db,EVENTS),0);
});
test("D1 schema rejects unauthorized status transitions",async t=>{
  const f=await start(t);await f.record();
  await assert.rejects(f.db.prepare("UPDATE "+ORDERS+" SET status='paid'").run());
  await assert.rejects(f.db.prepare("UPDATE "+EVENTS+" SET status='fulfilled'").run());
  assert.deepEqual(await f.counts(),{orders:1,events:1});
});
test("Workerd rejects invalid candidates before any ledger write",async t=>{
  const f=await start(t);
  for(const extra of [{paymentAuthorized:true},{orderReference:"RN-20261127-1111AAAA"},
    {units:2},{eventId:"evt_"},{status:"accepted"}]){
    const result=await f.record(candidate(extra));
    assert.equal(result.reason,"invalid_review_candidate");
  }
  assert.deepEqual(await f.counts(),{orders:0,events:0});
});
test("D1 data persists across actual Miniflare worker dispose/reopen",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"rn-holiday-2d-restart-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let first=new Miniflare(mfOptions(dir));
  try{
    const db=await first.getD1Database("HOLIDAY_DISPOSABLE_D1");
    await migrate(db);
    const res=await first.dispatchFetch("http://localhost/record",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({candidate:candidate(),allowDisposableWrite:true})
    });
    assert.equal(res.status,200);
    isNoAuthority(await res.json());
  }finally{await first.dispose();}
  const second=new Miniflare(mfOptions(dir));
  try{
    const db=await second.getD1Database("HOLIDAY_DISPOSABLE_D1");
    assert.equal(await rowCount(db,ORDERS),1);
    assert.equal(await rowCount(db,EVENTS),1);
    const res=await second.dispatchFetch("http://localhost/record",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({candidate:candidate(),allowDisposableWrite:true})
    });
    assert.equal(res.status,200);
    const replay=await res.json();
    isNoAuthority(replay);
    assert.equal(replay.reason,"duplicate_review_event_ignored");
    assert.equal(await rowCount(db,ORDERS),1);
    assert.equal(await rowCount(db,EVENTS),1);
  }finally{await second.dispose();}
});
test("Workerd probe has no public route, provider token or production binding",async t=>{
  const f=await start(t);
  const result=await f.mf.dispatchFetch("http://example.invalid/record",{method:"POST",body:"{}"});
  assert.equal(result.status,404);
  assert.doesNotMatch(workerSource,/onRequestPost|STRIPE_SECRET_KEY|RESEND_API_KEY|sk_live_|api\.stripe\.com|api\.resend\.com/);
  assert.match(workerSource,/HOLIDAY_DISPOSABLE_D1/);
});
