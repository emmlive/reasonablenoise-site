import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PRINTSHOP_PRODUCTS,productDefinition,isKnownProduct,validateCatalogRecord,
 checkoutAvailabilityDecision,visibleAvailability,resolveStickerProductId,
 updateProductCatalog} from "../src/lib/printshop-catalog-stock.mjs";
const admin=readFileSync(new URL("../src/pages/admin-orders.astro",import.meta.url),"utf8");
const checkout=readFileSync(new URL("../functions/api/create-checkout-session.js",import.meta.url),"utf8");
const actor={ok:true,reason:"verified_access_assertion",subject:"staff_100"};
const today="2026-11-27T21:30:00Z";
const entry={id:"usdot-sticker-pair",name:"USDOT Sticker Pair",description:"",
 priceCents:2900,availability:"available",stockQuantity:null,revision:1,
 updatedBy:"staff_100",updatedAt:today,auditId:"audit_12345"};
const decision=(record,productId="usdot-sticker-pair",featureEnabled=true)=>
 checkoutAvailabilityDecision({productId,record,featureEnabled});
const memory=()=>{
 let current=null;let events=[];
 return {events,getProduct:async()=>current,compareAndSwap:async({expectedRevision,nextRecord,auditEvent})=>{
  if((current?.revision??0)!==expectedRevision||
    events.some(e=>e.auditId===auditEvent.auditId))return false;
  current=nextRecord;events.push(auditEvent);return true;
 },current:()=>current};
};
const edit=(storage,changes,rest={})=>updateProductCatalog({
 adminIdentity:actor,productId:"usdot-sticker-pair",expectedRevision:0,
 changes,auditId:"audit_12345",nowISOString:today,storage,...rest});
test("known 11 products, no invented live availability",()=>{
 assert.equal(PRINTSHOP_PRODUCTS.length,11);
 assert.equal(new Set(PRINTSHOP_PRODUCTS.map(p=>p.id)).size,11);
 assert.ok(PRINTSHOP_PRODUCTS.every(p=>p.availability==="unconfigured"&&p.revision===0));
});
test("every printed product definition has known distinct sales mode",()=>{
 assert.ok(PRINTSHOP_PRODUCTS.some(p=>p.salesMode==="quote"));
 assert.ok(PRINTSHOP_PRODUCTS.some(p=>p.salesMode==="draft_checkout"));
 assert.ok(PRINTSHOP_PRODUCTS.some(p=>p.salesMode==="checkout"));
 assert.equal(productDefinition("unknown"),null);
 assert.equal(isKnownProduct("../../orders"),false);
});
test("existing server-owned sticker labels map to exact SKU, no fallback",()=>{
 const map={"USDOT Sticker Pair":"usdot-sticker-pair",
 "Extra USDOT Pair":"extra-usdot-pair",
 "One-Side USDOT Replacement":"usdot-replacement",
 "USDOT + Business Name Pair":"usdot-business-name",
 "Custom Business Decals":"custom-business-decals",
 "Truck Door Lettering":"truck-door-lettering",
 "Fleet Lettering Package":"fleet-lettering",
 "Logo Sticker Batch":"logo-sticker-batch",
 "Design Cleanup / Layout Help":"design-cleanup"};
 for(const [label,id] of Object.entries(map)){
 assert.equal(resolveStickerProductId(label),id);
 assert.ok(checkout.includes('label: "'+label+'"'));
 }
 assert.equal(resolveStickerProductId("Custom Sticker Order Deposit"),null);
 assert.equal(resolveStickerProductId("USDOT Sticker Pair - changed by customer"),null);
});
test("validated available checkout record supports preflight only, not order settlement",()=>{
 assert.equal(validateCatalogRecord(entry),true);
 const d=decision(entry);
 assert.equal(d.ok,true);assert.equal(d.canCheckout,true);
 assert.equal(d.reason,"stock_preflight_only");assert.equal(d.persisted,false);
});
test("stock gate disabled defaults fail closed in core",()=>{
 const d=checkoutAvailabilityDecision({productId:entry.id,record:entry});
 assert.equal(d.canCheckout,false);assert.equal(d.reason,"stock_gate_not_enabled");
});
test("out-of-stock and paused products do not checkout",()=>{
 for(const availability of ["out_of_stock","paused"]){
 const r=decision({...entry,availability});
 assert.equal(r.canCheckout,false);
 }
});
test("zero stock rejects even if status says available",()=>{
 const r=decision({...entry,stockQuantity:0});
 assert.equal(r.canCheckout,false);assert.equal(visibleAvailability({...entry,stockQuantity:0}),"Out of stock");
});
test("quote-only DTF and draft holiday are never authorized via sticker checkout",()=>{
 for(const id of ["dtf-shirts","holiday-shirts"]){
 const p=decision({...entry,id},id);assert.equal(p.canCheckout,false);
 assert.equal(p.reason,"checkout_not_supported");
 }
});
test("stale and malformed or missing records fail closed",()=>{
 for(const record of [null,{}, {...entry,revision:0},{...entry,priceCents:-3},
  {...entry,id:"../other"},{...entry,availability:"sold"}]){
 assert.equal(decision(record).canCheckout,false);
 }
});
test("availability labels distinguish not configured, paused, and out of stock",()=>{
 assert.equal(visibleAvailability(null),"Availability not configured");
 assert.equal(visibleAvailability({...entry,availability:"paused"}),"Temporarily unavailable");
 assert.equal(visibleAvailability({...entry,availability:"out_of_stock"}),"Out of stock");
 assert.equal(visibleAvailability(entry),"Available");
});
test("verified admin may make a versioned out-of-stock update with audit event",async()=>{
 const storage=memory();
 const r=await edit(storage,{availability:"out_of_stock"});
 assert.equal(r.ok,true);assert.equal(r.persisted,true);
 assert.equal(storage.current().revision,1);assert.equal(storage.events.length,1);
 assert.equal(storage.current().availability,"out_of_stock");
 assert.equal(decision(storage.current()).canCheckout,false);
});
test("admin may edit product name, description and price with typed checks",async()=>{
 const storage=memory();
 const r=await edit(storage,{name:"USDOT Stickers",description:"Truck lettering",priceCents:3100,availability:"available"});
 assert.equal(r.ok,true);assert.equal(r.record.priceCents,3100);
 assert.equal(r.record.name,"USDOT Stickers");
});
test("unverified identity must not touch storage",async()=>{
 for(const adminIdentity of [null,{}, {ok:true,reason:"not_signed",subject:"staff_100"}]){
 const store=memory();const r=await edit(store,{availability:"out_of_stock"},{adminIdentity});
 assert.equal(r.ok,false);assert.equal(store.events.length,0);
 }
});
test("forbidden changes to IDs or internal audit fields rejected",async()=>{
 for(const changes of [{id:"custom-business-decals"},{auditId:"fake_audit"},
  {revision:500},{updatedBy:"fake"},{salesMode:"checkout"}]){
 const storage=memory(),r=await edit(storage,changes);
 assert.equal(r.ok,false);assert.equal(storage.events.length,0);
 }
});
test("unsupported negative, unbounded and float prices/stock rejected",async()=>{
 for(const changes of [{priceCents:-1},{priceCents:1.1},{priceCents:10000001},
  {stockQuantity:-1},{stockQuantity:1.5},{name:""},{description:"x".repeat(501)}]){
 const storage=memory(),r=await edit(storage,changes);
 assert.equal(r.ok,false);assert.equal(storage.events.length,0);
 }
});
test("optimistic concurrency prevents stale last-writer-wins edits",async()=>{
 const storage=memory();
 assert.equal((await edit(storage,{availability:"out_of_stock"})).ok,true);
 const second=await edit(storage,{availability:"available"},{auditId:"audit_other01"});
 assert.equal(second.ok,false);assert.equal(second.reason,"stale_revision");
 assert.equal(storage.current().availability,"out_of_stock");
});
test("single audit ID cannot be replayed against new revision",async()=>{
 const storage=memory();
 await edit(storage,{availability:"out_of_stock"});
 const r=await edit(storage,{availability:"available"},{expectedRevision:1});
 assert.equal(r.ok,false);assert.equal(storage.events.length,1);
});
test("backend conflict or unavailable store fail closed",async()=>{
 const store=memory();
 const r=await edit(store,{availability:"available"},{storage:{getProduct:async()=>null,compareAndSwap:async()=>false}});
 assert.equal(r.ok,false);assert.equal(r.reason,"conflict_or_audit_failure");
 const e=await edit(store,{availability:"available"},{storage:{getProduct:async()=>{throw Error("offline")},compareAndSwap:async()=>true}});
 assert.equal(e.ok,false);
});
test("catalog preview is in admin and explicitly does not save or change production",()=>{
 assert.match(admin,/Products &amp; Availability/);
 assert.match(admin,/data-local-stock-preview/);
 assert.match(admin,/DRAFT · 0 live availability records/);
 assert.match(admin,/No Save control/);
 assert.match(admin,/PRINTSHOP_PRODUCTS\.map/);
});
test("no new API route, Stripe modifications or production auto-checkout bypass",()=>{
 const model=readFileSync(new URL("../src/lib/printshop-catalog-stock.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(model,/onRequestPost|onRequestGet|fetch\(|STRIPE_SECRET_KEY|\.put\(|checkout\.sessions/);
 assert.match(checkout,/export async function onRequestPost/);
 assert.doesNotMatch(checkout,/printshop-catalog-stock/);
});
