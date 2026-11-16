// RN-3B1C Phase 13: synthetic server-side order ownership boundary.
// NO production session implementation or live-order schema/route integration.
import {bindVerifiedArtworkVersion,verifyDurableArtworkPin} from "./dtf-artwork-version-pin-rn3b1c.js";
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const fail=code=>({ok:false,code,checkoutEligible:false,deletionAuthorized:false,productionApproved:false});
const lookupSQL=`SELECT order_id FROM dtf_test_order_authority
WHERE order_id=? AND owner_subject_id=? AND workspace_id=?
AND order_type='dtf_quote' AND order_status IN ('draft','artwork_pending')
AND is_active=1`;
async function context(db,authenticate,request,orderId){
 if(!db?.prepare||typeof authenticate!=="function"||!ID.test(orderId||""))
  return {ok:false,code:"TRUSTED_AUTH_REQUIRED"};
 let principal;
 try{principal=await authenticate(request);}catch{return{ok:false,code:"AUTH_UNAVAILABLE"};}
 // 'verified' must originate from a server-owned authenticator, not request JSON.
 if(principal?.verified!==true||!ID.test(principal.subjectId||"")||
   !ID.test(principal.workspaceId||""))return{ok:false,code:"UNAUTHENTICATED"};
 const subjectId=principal.subjectId,workspaceId=principal.workspaceId;
 const authorize=async(subject,order)=>{
  if(subject!==subjectId||order!==orderId)return false;
  try{
   const row=await db.prepare(lookupSQL).bind(order,subject,workspaceId).first();
   return row?.order_id===order;
  }catch{return false;}
 };
 if(!await authorize(subjectId,orderId))return{ok:false,code:"ORDER_NOT_AUTHORIZED"};
 return{ok:true,subjectId,workspaceId,authorize};
}
// The caller's order ID is ONLY a lookup target: owner and workspace come
// exclusively from the trusted server-authenticated principal and D1 row.
// Caller-provided subjectId/workspaceId/authorize are intentionally ignored.
export async function bindOwnedArtworkVersion({
 db,store,authenticate,request,orderId,intentId,pinId,reference,now
}={}){
 const auth=await context(db,authenticate,request,orderId);
 if(!auth.ok)return fail(auth.code);
 const result=await bindVerifiedArtworkVersion({
  db,store,authorize:auth.authorize,subjectId:auth.subjectId,orderId,
  intentId,pinId,reference,now
 });
 if(!result.ok)return fail(result.code);
 // Re-evaluate entitlement after R2 and D1 work, not just before it.
 if(!await auth.authorize(auth.subjectId,orderId))return fail("ORDER_ACCESS_REVOKED");
 return {...result,checkoutEligible:false,deletionAuthorized:false,productionApproved:false};
}
export async function verifyOwnedArtworkVersion({
 db,store,authenticate,request,orderId,intentId,pinId
}={}){
 const auth=await context(db,authenticate,request,orderId);
 if(!auth.ok)return fail(auth.code);
 const result=await verifyDurableArtworkPin({
  db,store,authorize:auth.authorize,subjectId:auth.subjectId,orderId,intentId,pinId
 });
 if(!result.ok)return fail(result.code);
 if(!await auth.authorize(auth.subjectId,orderId))return fail("ORDER_ACCESS_REVOKED");
 return {...result,checkoutEligible:false,deletionAuthorized:false,productionApproved:false};
}
