// RN-3B1C Phase 19: review-only customer quote acceptance.
// Synthetic injected verifier is NOT a real customer session, CSRF, or production auth.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const deny=code=>({ok:false,code,accepted:false,checkoutEligible:false,
 paymentAuthorized:false,deletionAuthorized:false,productionApproved:false});
const SQL=`INSERT INTO dtf_test_customer_acceptances
 (acceptance_id,order_id,quote_id,catalog_version,customer_subject_id,workspace_id,
  accepted_total_cents,currency,accepted_at,decision,checkout_enabled)
 SELECT ?,o.order_id,q.quote_id,p.catalog_version,o.owner_subject_id,o.workspace_id,
  o.approved_total_cents,o.currency,?,'customer_quote_accepted_review_only',0
 FROM dtf_test_conversion_orders o
 JOIN dtf_test_approved_quotes q ON q.quote_id=o.quote_id
 JOIN dtf_test_quote_price_signoff p ON p.quote_id=q.quote_id
 JOIN dtf_test_pricing_catalog c ON c.catalog_version=p.catalog_version
 WHERE o.order_id=? AND o.owner_subject_id=? AND o.workspace_id=?
 AND o.order_status='awaiting_customer_acceptance' AND o.checkout_enabled=0
 AND q.quote_status='approved' AND q.owner_subject_id=o.owner_subject_id
 AND q.workspace_id=o.workspace_id AND q.expires_at>? AND q.approved_at<=?
 AND q.quantity=o.quantity AND q.shirt_source=o.shirt_source
 AND q.print_placement=o.print_placement AND q.sizes_json=o.sizes_json
 AND q.color=o.color AND q.approved_total_cents=o.approved_total_cents
 AND q.currency='usd' AND o.currency='usd'
 AND q.artwork_reviewed=1 AND q.pricing_reviewed=1 AND q.fulfillment_reviewed=1
 AND p.decision='approved' AND p.signed_by<>'' AND p.signed_at>0
 AND p.signed_at<=? AND p.reviewed_total_cents=o.approved_total_cents
 AND c.status='approved' AND c.approved_by<>'' AND c.approved_at>0
 AND c.approved_at<=? AND p.catalog_version=? AND o.approved_total_cents=?
 ON CONFLICT DO NOTHING`;
export async function acceptReviewedDtfQuote({
 db,verifyCustomerSession,request,acceptanceId,orderId,
 displayedCatalogVersion,displayedTotalCents,explicitConsent,now,
 // Deliberately never used as authority: client amount/owner/status.
 amountCents,customerId,workspaceId,checkout
}={}){
 if(!db?.prepare||typeof verifyCustomerSession!=="function")
  return deny("TRUSTED_CUSTOMER_VERIFIER_REQUIRED");
 if(!ID.test(acceptanceId||"")||!ID.test(orderId||"")||
  !ID.test(displayedCatalogVersion||"")||
  !Number.isSafeInteger(displayedTotalCents)||displayedTotalCents<1||
  !Number.isSafeInteger(now)||now<1||explicitConsent!==true)
  return deny("EXPLICIT_ACCEPTANCE_REQUIRED");
 let customer;
 try{customer=await verifyCustomerSession(request);}
 catch{return deny("CUSTOMER_SESSION_UNAVAILABLE");}
 if(customer?.verified!==true||customer?.csrfVerified!==true||
  customer?.role!=="customer"||!ID.test(customer.subjectId||"")||
  !ID.test(customer.workspaceId||""))
  return deny("CUSTOMER_NOT_AUTHENTICATED");
 try{
  const result=await db.prepare(SQL).bind(
   acceptanceId,now,orderId,customer.subjectId,customer.workspaceId,
   now,now,now,now,displayedCatalogVersion,displayedTotalCents
  ).run();
  if(result?.success!==true||result?.meta?.changes!==1)
   return deny("QUOTE_CHANGED_EXPIRED_OR_ALREADY_ACCEPTED");
  return {ok:true,accepted:true,acceptanceId,
   status:"customer_quote_accepted_review_only",checkoutEligible:false,
   paymentAuthorized:false,deletionAuthorized:false,productionApproved:false};
 }catch{return deny("ACCEPTANCE_WRITE_FAILED");}
}
