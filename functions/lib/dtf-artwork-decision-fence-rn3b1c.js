// RN-3B1C Phase 15: isolated D1 decision-time review reservation.
// A reservation is NOT customer authorization, fulfillment or checkout.
// Trusted resolver/verifier are injected TEST CONTRACTS, not production implementations.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const VERSION=/^[A-Za-z0-9:_-]{8,256}$/;
const SHA=/^[a-f0-9]{64}$/;
const deny=code=>({ok:false,code,reviewReserved:false,checkoutEligible:false,deletionAuthorized:false,productionApproved:false});
const INSERT=`INSERT INTO dtf_test_auth_decisions
 (decision_id,replay_id,session_id,order_id,pin_id,subject_id,workspace_id,
  session_epoch,order_epoch,decided_at,result)
 SELECT ?,?,s.session_id,o.order_id,p.pin_id,s.subject_id,s.workspace_id,
        s.session_epoch,o.order_epoch,?,'review_only'
 FROM dtf_test_session_epochs s
 JOIN dtf_test_order_epochs o ON o.order_id=? AND o.owner_subject_id=s.subject_id
  AND o.workspace_id=s.workspace_id
 JOIN dtf_artwork_version_pins p ON p.pin_id=? AND p.order_id=o.order_id
  AND p.subject_id=s.subject_id
 WHERE s.session_id=? AND s.subject_id=? AND s.workspace_id=?
  AND s.session_epoch=? AND s.revoked=0 AND s.expires_at>?
  AND o.order_epoch=? AND o.active=1 AND o.order_type='dtf_quote'
  AND o.order_status IN ('draft','artwork_pending')
  AND p.object_version=? AND p.sha256=? AND p.byte_length=?
 ON CONFLICT DO NOTHING`;
function validSession(s){
 return s?.verified===true&&ID.test(s.sessionId||"")&&ID.test(s.subjectId||"")&&
 ID.test(s.workspaceId||"")&&Number.isSafeInteger(s.sessionEpoch)&&s.sessionEpoch>=1;
}
// This is a serializable conditional D1 decision, NOT a transaction spanning R2.
// Any R2 readback before/after SQL is necessarily outside the D1 atomic fence.
export async function reserveReviewOnlyDecision({
 db,resolveVerifiedSession,verifyPinnedObject,request,
 orderId,pinId,decisionId,replayId,expectedOrderEpoch,objectRef,now
}={}){
 if(!db?.prepare||typeof resolveVerifiedSession!=="function"||
  typeof verifyPinnedObject!=="function")return deny("TRUSTED_ADAPTER_REQUIRED");
 if(![orderId,pinId,decisionId,replayId].every(x=>ID.test(x||""))||
  !Number.isSafeInteger(expectedOrderEpoch)||expectedOrderEpoch<1||
  !Number.isSafeInteger(now)||now<0||
  !VERSION.test(objectRef?.version||"")||!SHA.test(objectRef?.sha256||"")||
  !Number.isSafeInteger(objectRef?.byteLength)||objectRef.byteLength<1||
  objectRef.byteLength>15728640)return deny("INVALID_DECISION_INPUT");
 let session;
 try{session=await resolveVerifiedSession(request);}catch{return deny("SESSION_VERIFIER_UNAVAILABLE");}
 if(!validSession(session))return deny("SESSION_NOT_VERIFIED");
 let pinned;
 try{pinned=await verifyPinnedObject({orderId,pinId,subjectId:session.subjectId,
  workspaceId:session.workspaceId,reference:objectRef});}
 catch{return deny("R2_VERIFIER_UNAVAILABLE");}
 if(pinned?.ok!==true||pinned?.version!==objectRef.version||
  pinned?.sha256!==objectRef.sha256||pinned?.byteLength!==objectRef.byteLength)
  return deny("PINNED_OBJECT_NOT_VERIFIED");
 try{
  // Single statement observes current owner/order/session epochs and replay fence
  // in the same SQLite write decision, rather than trusting a prior SELECT.
  const result=await db.prepare(INSERT).bind(
   decisionId,replayId,now,orderId,pinId,session.sessionId,
   session.subjectId,session.workspaceId,session.sessionEpoch,now,
   expectedOrderEpoch,objectRef.version,objectRef.sha256,objectRef.byteLength
  ).run();
  if(result?.success!==true||result?.meta?.changes!==1)
   return deny("DECISION_REPLAY_OR_REVOKED");
  // A later revocation may occur; the decision remains review-only and
  // cannot be converted into fulfillment/checkout/deletion authority.
  return{ok:true,decisionId,reviewReserved:true,
   checkoutEligible:false,deletionAuthorized:false,productionApproved:false};
 }catch{return deny("DECISION_WRITE_FAILED");}
}
