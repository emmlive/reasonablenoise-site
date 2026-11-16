// RN-3B1C Phase 7 — durable manual-review claim contract (never object deletion).
// Requires an external trusted operator authorization callback and a fresh Phase 6
// complete-inventory plan. One row records state; this is NOT immutable audit history.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const KEY=/^dtf-intents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/artwork\.png$/;
const REASONS=new Set(["EXPIRED_UNCONSUMED_INTENT","OLD_UNREFERENCED_OBJECT"]);
const reject=code=>({ok:false,code,deletionAuthorized:false,checkoutEligible:false,productionApproved:false});
const time=x=>Number.isSafeInteger(x)&&x>=0;
async function authorized(authorize,operatorId){
 if(typeof authorize!=="function"||typeof operatorId!=="string"||!ID.test(operatorId))return false;
 try{return(await authorize(operatorId))===true;}catch{return false;}
}
// Caller supplies ONLY a freshly recomputed, complete, trusted snapshot;
// this phase doesn't read R2 or D1 records to check freshness. Not a production API.
export async function claimArtworkReview({db,authorize,operatorId,claimId,finding,plan,now}={}){
 if(!db?.prepare)return reject("MISSING_DURABLE_DB");
 if(!await authorized(authorize,operatorId))return reject("UNAUTHORIZED_OPERATOR");
 if(!time(now)||!ID.test(claimId||"")||!plan||plan.ok!==true||
    plan.deletionAuthorized!==false||plan.productionApproved!==false||
    !Array.isArray(plan.items)||!finding||typeof finding.key!=="string")
    return reject("INVALID_REVIEW_REQUEST");
 const matches=plan.items.filter(item=>item.key===finding.key&&item.intentId===finding.intentId&&
   item.action==="manual_review"&&item.reason===finding.reason);
 if(matches.length!==1||!KEY.test(finding.key)||!REASONS.has(finding.reason)||
    (finding.intentId!==null&&!ID.test(finding.intentId||"")))
   return reject("NOT_A_UNIQUE_REVIEW_CANDIDATE");
 try {
   const result=await db.prepare(
    "INSERT INTO dtf_artwork_review_claims (claim_id,object_key,intent_id,operator_id,reason,state,claimed_at,updated_at,attempts) VALUES (?,?,?,?,?,'claimed',?,?,0) ON CONFLICT DO NOTHING"
   ).bind(claimId,finding.key,finding.intentId,operatorId,finding.reason,now,now).run();
   if(result?.success!==true||result?.meta?.changes!==1)return reject("DUPLICATE_OR_DATABASE_REJECTED");
   return{ok:true,claimId,state:"claimed",deletionAuthorized:false,checkoutEligible:false,productionApproved:false};
 }catch{return reject("CLAIM_WRITE_FAILED");}
}
// A crashed/abandoned claim becomes needs_review, NEVER queued for deletion.
// CAS ensures only a single claimant can change an eligible state snapshot.
export async function recoverStaleArtworkReview({db,authorize,operatorId,claimId,now,staleAfterMs=3600000}={}){
 if(!db?.prepare)return reject("MISSING_DURABLE_DB");
 if(!await authorized(authorize,operatorId))return reject("UNAUTHORIZED_OPERATOR");
 if(!ID.test(claimId||"")||!time(now)||staleAfterMs!==3600000)
   return reject("INVALID_RECOVERY_REQUEST");
 try{
   const result=await db.prepare(
    "UPDATE dtf_artwork_review_claims SET state='needs_review',operator_id=?,updated_at=?,attempts=attempts+1 WHERE claim_id=? AND state='claimed' AND updated_at<=? AND attempts<3"
   ).bind(operatorId,now,claimId,now-staleAfterMs).run();
   if(result?.success!==true||result?.meta?.changes!==1)return reject("NOT_STALE_OR_ALREADY_RECOVERED");
   return{ok:true,claimId,state:"needs_review",deletionAuthorized:false,checkoutEligible:false,productionApproved:false};
 }catch{return reject("RECOVERY_WRITE_FAILED");}
}
// No auto-retry from needs_review: a separately authorized human decision is required.
