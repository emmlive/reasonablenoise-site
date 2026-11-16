// RN-3B1C Phase 6: OFFLINE lifecycle reconciliation planner.
// Pure inspection only: NO R2 delete/put/list, D1 writes, or payment calls.
// Never treat a cleanup recommendation as deletion permission.
const UUID="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY=new RegExp("^dtf-intents/("+UUID+")/artwork\\.png$");
const SHA=/^[0-9a-f]{64}$/;
const TTL=15*60*1000, GRACE=24*60*60*1000;
const no=(reason)=>({action:"hold",reason});
const safeTime=x=>Number.isSafeInteger(x)&&x>=0;
const validRow=r=>{
 if(!r||r.version!==1||!["issued","consumed"].includes(r.status)||
   typeof r.subject_id!=="string"||!r.subject_id||
   typeof r.order_id!=="string"||!r.order_id||
   !SHA.test(r.sha256||"")||!Number.isSafeInteger(r.byte_length)||
   r.byte_length<1||r.byte_length>15*1024*1024||
   !safeTime(r.created_at)||!safeTime(r.expires_at)||
   r.expires_at-r.created_at!==TTL)return false;
 const match=KEY.exec(r.object_key||"");
 if(!match||r.intent_id!=="intent_"+match[1].replaceAll("-",""))return false;
 return r.status!=="consumed"||safeTime(r.consumed_at);
};
const validObject=o=>o&&typeof o.key==="string"&&safeTime(o.uploadedAt)&&
 Number.isSafeInteger(o.size)&&o.size>=0&&o.size<=15*1024*1024;
// Snapshot is a *complete verified synthetic inventory*, not a live bucket listing.
// Missing/duplicate/unrecognized facts fail closed. Candidate means REVIEW, NEVER DELETE.
export function planArtworkLifecycle({rows,objects,protectedOrderIds,now,inventoryComplete=false}={}){
 if(!Array.isArray(rows)||!Array.isArray(objects)||!(protectedOrderIds instanceof Set)||
   !safeTime(now)||inventoryComplete!==true)
   return {ok:false,reason:"UNTRUSTED_OR_INCOMPLETE_SNAPSHOT",items:[],deletionAuthorized:false};
 const byKey=new Map(), seenRows=new Set(), duplicateKeys=new Set();
 for(const row of rows){
   if(!row||typeof row.object_key!=="string")return{ok:false,reason:"INVALID_ROW_SNAPSHOT",items:[],deletionAuthorized:false};
   if(byKey.has(row.object_key))duplicateKeys.add(row.object_key);
   byKey.set(row.object_key,row);
   if(typeof row.intent_id==="string"){
     if(seenRows.has(row.intent_id))duplicateKeys.add(row.object_key);
     seenRows.add(row.intent_id);
   }
 }
 const counts=new Map();
 for(const object of objects) {
   if(!object||typeof object.key!=="string")return{ok:false,reason:"INVALID_OBJECT_SNAPSHOT",items:[],deletionAuthorized:false};
   counts.set(object.key,(counts.get(object.key)||0)+1);
 }
 const items=[];
 for(const object of objects) {
   const row=byKey.get(object.key);
   let finding;
   if(counts.get(object.key)!==1||duplicateKeys.has(object.key))finding=no("DUPLICATE_SNAPSHOT_ENTRY");
   else if(!validObject(object)||!KEY.test(object.key))finding=no("UNKNOWN_OBJECT_OR_METADATA");
   else if(object.uploadedAt>now)finding=no("FUTURE_OBJECT_TIMESTAMP");
   else if(!row) {
     // An orphan in a snapshot may still be a pending writer: never auto-delete.
     finding=now-object.uploadedAt>=GRACE?
       {action:"manual_review",reason:"OLD_UNREFERENCED_OBJECT"}:
       no("POSSIBLE_IN_FLIGHT_UPLOAD");
   } else if(!validRow(row))finding=no("INVALID_INTENT_RECORD");
   else if(protectedOrderIds.has(row.order_id))finding=no("PROTECTED_ORDER");
   else if(object.size!==row.byte_length)finding=no("SIZE_MISMATCH_REQUIRES_INVESTIGATION");
   else if(row.status==="consumed")finding=no("CONSUMED_ARTWORK_RETENTION_UNKNOWN");
   else if(now<row.expires_at)finding=no("ACTIVE_INTENT");
   else if(now-row.expires_at<GRACE)finding=no("EXPIRED_IN_GRACE_PERIOD");
   else finding={action:"manual_review",reason:"EXPIRED_UNCONSUMED_INTENT"};
   items.push({key:object.key,intentId:row?.intent_id??null,...finding});
 }
 for(const row of rows){
   if(!counts.has(row.object_key)){
     items.push({key:row.object_key,intentId:row.intent_id??null,...no("DATABASE_ROW_MISSING_OBJECT")});
   }
 }
 return {ok:true,items,manualReviewCount:items.filter(i=>i.action==="manual_review").length,
   deletionAuthorized:false,checkoutEligible:false,productionApproved:false};
}
// Deliberately no cleanup executor. Object deletion requires separate authorization,
// fresh D1 state and object version checks, durable audit & retry design.
