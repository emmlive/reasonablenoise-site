// RN Print Shop — draft-only product catalog and availability decision core.
// UNMOUNTED: no live admin write route, production pricing change, or Stripe call.
// Future admin endpoints must pass verified Access identity and transaction-safe
// optimistic-concurrency ledger adapters. Existing orders remain unaffected.
const definitions=Object.freeze([
 {id:"usdot-sticker-pair",name:"USDOT Sticker Pair",category:"stickers",startingPriceCents:2900,salesMode:"checkout"},
 {id:"extra-usdot-pair",name:"Extra USDOT Pair",category:"stickers",startingPriceCents:2500,salesMode:"checkout"},
 {id:"usdot-replacement",name:"One-Side USDOT Replacement",category:"stickers",startingPriceCents:1800,salesMode:"checkout"},
 {id:"usdot-business-name",name:"USDOT + Business Name Pair",category:"stickers",startingPriceCents:3900,salesMode:"checkout"},
 {id:"custom-business-decals",name:"Custom Business Decals",category:"decals",startingPriceCents:3500,salesMode:"checkout"},
 {id:"truck-door-lettering",name:"Truck Door Lettering",category:"lettering",startingPriceCents:6900,salesMode:"checkout"},
 {id:"fleet-lettering",name:"Fleet Lettering Package",category:"lettering",startingPriceCents:5900,salesMode:"checkout"},
 {id:"logo-sticker-batch",name:"Logo Sticker Batch",category:"stickers",startingPriceCents:3500,salesMode:"checkout"},
 {id:"design-cleanup",name:"Design Cleanup / Layout Help",category:"services",startingPriceCents:1500,salesMode:"checkout"},
 {id:"dtf-shirts",name:"DTF Custom T-Shirts",category:"apparel",startingPriceCents:null,salesMode:"quote"},
 {id:"holiday-shirts",name:"Holiday T-Shirts",category:"apparel",startingPriceCents:2400,salesMode:"draft_checkout"}
]);
export const PRINTSHOP_PRODUCTS=Object.freeze(definitions.map(p=>Object.freeze({...p,
 availability:"unconfigured",revision:0,stockQuantity:null})));
const knownIds=new Set(definitions.map(p=>p.id));
const states=new Set(["available","out_of_stock","paused"]);
const isInt=n=>Number.isSafeInteger(n);
const deny=reason=>({ok:false,reason,canCheckout:false,persisted:false});
export function isKnownProduct(id){return typeof id==="string"&&knownIds.has(id);}
export function productDefinition(id){return PRINTSHOP_PRODUCTS.find(p=>p.id===id)||null;}
export function validateCatalogRecord(record) {
 return !!(record&&typeof record==="object"&&!Array.isArray(record)&&
  isKnownProduct(record.id)&&states.has(record.availability)&&
  isInt(record.revision)&&record.revision>=1&&
  typeof record.name==="string"&&record.name.trim().length>0&&record.name.length<=90&&
  typeof record.description==="string"&&record.description.length<=500&&
  (record.priceCents===null||(isInt(record.priceCents)&&record.priceCents>0&&record.priceCents<=10000000))&&
  (record.stockQuantity===null||(isInt(record.stockQuantity)&&record.stockQuantity>=0&&record.stockQuantity<=1000000))&&
  typeof record.updatedBy==="string"&&record.updatedBy.length>=3&&
  typeof record.updatedAt==="string"&&
  !Number.isNaN(Date.parse(record.updatedAt))&&
  typeof record.auditId==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(record.auditId));
}
export function checkoutAvailabilityDecision({productId,record,featureEnabled=false}={}) {
 if(!featureEnabled)return deny("stock_gate_not_enabled");
 if(!isKnownProduct(productId)||!validateCatalogRecord(record)||
    record.id!==productId)return deny("catalog_record_unavailable");
 const product=productDefinition(productId);
 if(product.salesMode!=="checkout")return deny("checkout_not_supported");
 if(record.availability!=="available")return deny("product_not_available");
 if(record.stockQuantity!==null&&record.stockQuantity<1)return deny("no_stock");
 return {ok:true,reason:"stock_preflight_only",canCheckout:true,persisted:false,
  productId,revision:record.revision};
}
export function visibleAvailability(record) {
 if(!validateCatalogRecord(record))return "Availability not configured";
 if(record.availability==="out_of_stock"||record.stockQuantity===0)return "Out of stock";
 if(record.availability==="paused")return "Temporarily unavailable";
 return "Available";
}
export function resolveStickerProductId(label) {
 // Mapping exactly matches the existing server-owned Stripe price label.
 // No fallback is accepted: ambiguous/custom deposits require review.
 const map={
  "USDOT Sticker Pair":"usdot-sticker-pair",
  "Extra USDOT Pair":"extra-usdot-pair",
  "One-Side USDOT Replacement":"usdot-replacement",
  "USDOT + Business Name Pair":"usdot-business-name",
  "Custom Business Decals":"custom-business-decals",
  "Truck Door Lettering":"truck-door-lettering",
  "Fleet Lettering Package":"fleet-lettering",
  "Logo Sticker Batch":"logo-sticker-batch",
  "Design Cleanup / Layout Help":"design-cleanup"
 };
 return Object.hasOwn(map,label)?map[label]:null;
}
function trustedAdmin(identity){
 return identity?.ok===true&&identity.reason==="verified_access_assertion"&&
  typeof identity.subject==="string"&&/^[a-zA-Z0-9_-]{3,100}$/.test(identity.subject);
}
export async function updateProductCatalog({
 adminIdentity,productId,expectedRevision,changes,auditId,storage,nowISOString
}={}) {
 if(!trustedAdmin(adminIdentity))return deny("unauthorized_admin");
 if(!isKnownProduct(productId)||!isInt(expectedRevision)||expectedRevision<0||
    !changes||typeof changes!=="object"||Array.isArray(changes)||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(String(auditId||""))||
    typeof nowISOString!=="string"||Number.isNaN(Date.parse(nowISOString))||
    !storage||typeof storage.getProduct!=="function"||
    typeof storage.compareAndSwap!=="function")return deny("invalid_edit_request");
 const keys=Object.keys(changes);
 if(keys.length===0||keys.some(k=>!["name","description","priceCents","availability","stockQuantity"].includes(k)))
   return deny("forbidden_catalog_edit");
 try{
  const existing=await storage.getProduct(productId);
  if(existing!==null&&(!validateCatalogRecord(existing)||existing.id!==productId))
    return deny("untrusted_catalog_record");
  const actualRevision=existing?.revision??0;
  if(actualRevision!==expectedRevision)return deny("stale_revision");
  const product=productDefinition(productId);
  const next={
   id:productId,
   name:existing?.name??product.name,
   description:existing?.description??"",
   priceCents:existing?.priceCents??product.startingPriceCents,
   availability:existing?.availability??"paused",
   stockQuantity:existing?.stockQuantity??null,
   ...changes,
   revision:actualRevision+1,
   updatedBy:adminIdentity.subject,updatedAt:nowISOString,auditId
  };
  if(!validateCatalogRecord(next))return deny("invalid_product_values");
  // Adapter must atomically assert expectedRevision, update record and append
  // auditId-unique event in the SAME transaction. No split writes.
  const saved=await storage.compareAndSwap({productId,expectedRevision,nextRecord:next,
   auditEvent:{auditId,actor:adminIdentity.subject,productId,
    previousRevision:actualRevision,nextRevision:next.revision,
    previousAvailability:existing?.availability??"unconfigured",
    nextAvailability:next.availability,at:nowISOString}});
  if(saved!==true)return deny("conflict_or_audit_failure");
  return {ok:true,reason:"catalog_change_recorded",persisted:true,
   canCheckout:false,record:next};
 }catch{return deny("catalog_storage_failed");}
}
