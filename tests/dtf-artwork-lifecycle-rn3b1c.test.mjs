import test from "node:test";
import assert from "node:assert/strict";
import {planArtworkLifecycle} from "../functions/lib/dtf-artwork-lifecycle-rn3b1c.js";
const now=1800000000000,ttl=900000,grace=86400000;
const uuid="12345678-1234-4234-8234-123456789abc";
const key="dtf-intents/"+uuid+"/artwork.png";
const id="intent_"+uuid.replaceAll("-","");
const row=(changes={})=>({version:1,intent_id:id,subject_id:"subject_12345678",order_id:"order_12345678",
 object_key:key,sha256:"a".repeat(64),byte_length:99,created_at:now-ttl-grace-1,
 expires_at:now-grace-1,status:"issued",consumed_at:null,...changes});
const object=(changes={})=>({key,uploadedAt:now-grace-ttl-1,size:99,...changes});
const plan=(changes={})=>planArtworkLifecycle({rows:[row()],objects:[object()],
 protectedOrderIds:new Set(),now,inventoryComplete:true,...changes});
test("expired issued intent enters manual review, never deletion",()=>{let p=plan();assert.equal(p.ok,true);assert.equal(p.items[0].reason,"EXPIRED_UNCONSUMED_INTENT");assert.equal(p.items[0].action,"manual_review");assert.equal(p.deletionAuthorized,false);});
test("protected order always held",()=>assert.equal(plan({protectedOrderIds:new Set(["order_12345678"])}).items[0].reason,"PROTECTED_ORDER"));
test("consumed artwork retained even beyond expiry",()=>assert.equal(plan({rows:[row({status:"consumed",consumed_at:now-grace})]}).items[0].reason,"CONSUMED_ARTWORK_RETENTION_UNKNOWN"));
test("active and grace-period intents never proposed for cleanup",()=>{for(const t of [now+1,now-grace+1]){const r=row({expires_at:t,created_at:t-ttl});assert.equal(plan({rows:[r]}).items[0].action,"hold");}});
test("missing object creates investigation finding rather than deleting row",()=>{const p=plan({objects:[]});assert.equal(p.items[0].reason,"DATABASE_ROW_MISSING_OBJECT");assert.equal(p.deletionAuthorized,false);});
test("old orphan needs manual review; newly uploaded orphan is held",()=>{const old=plan({rows:[]});assert.equal(old.items[0].reason,"OLD_UNREFERENCED_OBJECT");assert.equal(old.items[0].action,"manual_review");const recent=plan({rows:[],objects:[object({uploadedAt:now-1})]});assert.equal(recent.items[0].reason,"POSSIBLE_IN_FLIGHT_UPLOAD");});
test("invalid or unknown object key and future timestamp always held",()=>{for(const changed of [{key:"orders/other/customer.png"},{uploadedAt:now+1},{size:-1}]){const p=plan({objects:[object(changed)]});assert.equal(p.items[0].action,"hold");}});
test("duplicate object or row snapshot entries fail closed",()=>{for(const changes of [{objects:[object(),object()]},{rows:[row(),row()]}]){const p=plan(changes);assert.ok(p.items.every(i=>i.action==="hold"));}});
test("metadata mismatch held for investigation",()=>assert.equal(plan({objects:[object({size:98})]}).items[0].reason,"SIZE_MISMATCH_REQUIRES_INVESTIGATION"));
test("corrupt intent state and digest fail closed",()=>{for(const changed of [{status:"invalid"},{sha256:"x"},{expires_at:now}]){const p=plan({rows:[row(changed)]});assert.equal(p.items[0].reason,"INVALID_INTENT_RECORD");}});
test("incomplete inventory, untrusted clock or missing protected-order set reject plan",()=>{for(const changes of [{inventoryComplete:false},{now:-1},{protectedOrderIds:null},{rows:null}]){const p=plan(changes);assert.equal(p.ok,false);assert.equal(p.deletionAuthorized,false);}});
test("no network, R2 deletion, payments or production mutation in module",async()=>{const {readFileSync}=await import("node:fs");const s=readFileSync(new URL("../functions/lib/dtf-artwork-lifecycle-rn3b1c.js",import.meta.url),"utf8");assert.doesNotMatch(s,/fetch\s*\(|bucket\.delete\s*\(|db\.prepare\s*\(|checkout\.sessions|onRequestPost|onScheduled/);});
