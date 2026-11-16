// RN-3B1C Phase 18: disposable quote -> review-only order conversion.
// Strictly no live customer auth, Stripe checkout, or order fulfillment.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const deny=code=>({ok:false,code,converted:false,checkoutEligible:false,
 paymentAuthorized:false,deletionAuthorized:false,productionApproved:false});
const SQL=`INSERT INTO dtf_test_conversion_orders(
 order_id,quote_id,quote_reference,workspace_id,owner_subject_id,quantity,
 shirt_source,print_placement,sizes_json,color,approved_total_cents,currency,
 created_at,order_status,checkout_enabled)
 SELECT ?,q.quote_id,q.quote_reference,q.workspace_id,q.owner_subject_id,
 q.quantity,q.shirt_source,q.print_placement,q.sizes_json,q.color,
 q.approved_total_cents,q.currency,?,'awaiting_customer_acceptance',0
 FROM dtf_test_approved_quotes q
 WHERE q.quote_id=? AND q.workspace_id=? AND q.approved_by=?
 AND q.quote_status='approved' AND q.approved_at>0
 AND q.approved_at<=? AND q.expires_at>?
 AND q.artwork_reviewed=1 AND q.pricing_reviewed=1 AND q.fulfillment_reviewed=1
 AND q.owner_subject_id<>''
 ON CONFLICT DO NOTHING`;
export async function convertApprovedQuoteForReview({
 db,authorizeOperator,request,quoteId,orderId,now,
 // Deliberately ignored: all client-supplied prices, identities and status.
 amountCents,subjectId,workspaceId,quoteStatus
}={}){
 if(!db?.prepare||typeof authorizeOperator!=="function")
  return deny("TRUSTED_OPERATOR_REQUIRED");
 if(!ID.test(quoteId||"")||!ID.test(orderId||"")||
  !Number.isSafeInteger(now)||now<1)return deny("INVALID_CONVERSION_INPUT");
 let actor;
 try{actor=await authorizeOperator(request);}catch{return deny("OPERATOR_VERIFIER_UNAVAILABLE");}
 if(actor?.verified!==true||actor?.role!=="dtf_quote_reviewer"||
  !ID.test(actor.subjectId||"")||!ID.test(actor.workspaceId||""))
  return deny("OPERATOR_NOT_AUTHORIZED");
 try{
  const result=await db.prepare(SQL).bind(orderId,now,quoteId,
   actor.workspaceId,actor.subjectId,now,now).run();
  if(result?.success!==true||result?.meta?.changes!==1)
   return deny("QUOTE_NOT_APPROVED_OR_ALREADY_CONVERTED");
  return {ok:true,orderId,converted:true,status:"awaiting_customer_acceptance",
   checkoutEligible:false,paymentAuthorized:false,deletionAuthorized:false,
   productionApproved:false};
 }catch{return deny("CONVERSION_WRITE_FAILED");}
}
