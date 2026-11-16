// RN-3B1C Phase 21: disposable atomic session/quote acceptance, NO live route.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const deny=code=>({ok:false,code,accepted:false,checkoutEligible:false,
 paymentAuthorized:false,deletionAuthorized:false,productionApproved:false});
const INSERT=[
"INSERT INTO dtf_test_customer_acceptances",
" (acceptance_id,order_id,quote_id,catalog_version,customer_subject_id,workspace_id,",
" accepted_total_cents,currency,accepted_at,decision,checkout_enabled)",
" SELECT ?,o.order_id,q.quote_id,p.catalog_version,s.subject_id,s.workspace_id,",
" o.approved_total_cents,o.currency,?,'customer_quote_accepted_review_only',0",
" FROM dtf_test_customer_sessions_v20 s",
" JOIN dtf_test_conversion_orders o ON o.owner_subject_id=s.subject_id AND o.workspace_id=s.workspace_id",
" JOIN dtf_test_approved_quotes q ON q.quote_id=o.quote_id AND q.owner_subject_id=s.subject_id AND q.workspace_id=s.workspace_id",
" JOIN dtf_test_quote_price_signoff p ON p.quote_id=q.quote_id",
" JOIN dtf_test_pricing_catalog c ON c.catalog_version=p.catalog_version",
" WHERE s.session_id=? AND s.subject_id=? AND s.workspace_id=?",
" AND s.session_epoch=? AND s.revoked=0 AND s.expires_at>?",
" AND o.order_id=? AND o.order_status='awaiting_customer_acceptance' AND o.checkout_enabled=0",
" AND q.quote_status='approved' AND q.approved_at>0 AND q.approved_at<=? AND q.expires_at>?",
" AND q.artwork_reviewed=1 AND q.pricing_reviewed=1 AND q.fulfillment_reviewed=1",
" AND q.quantity=o.quantity AND q.shirt_source=o.shirt_source",
" AND q.print_placement=o.print_placement AND q.sizes_json=o.sizes_json",
" AND q.color=o.color AND q.approved_total_cents=o.approved_total_cents",
" AND q.currency='usd' AND o.currency='usd'",
" AND p.decision='approved' AND p.signed_by<>'' AND p.signed_at>0",
" AND p.signed_at<=? AND p.reviewed_total_cents=o.approved_total_cents",
" AND c.status='approved' AND c.approved_by<>'' AND c.approved_at>0",
" AND c.approved_at<=? AND c.currency='usd'",
" AND p.catalog_version=? AND o.approved_total_cents=?",
" ON CONFLICT DO NOTHING"
].join(" ");
export async function acceptDtfQuoteWithAtomicSessionFence({
 db,verifyCustomerSession,request,acceptanceId,orderId,
 displayedCatalogVersion,displayedTotalCents,explicitConsent,now,
 // Deliberately ignored: untrusted customer/price/payment input.
 amountCents,customerId,workspaceId,checkout
}={}){
 if(!db?.prepare||typeof verifyCustomerSession!=="function")
  return deny("TRUSTED_SESSION_VERIFIER_REQUIRED");
 if(!ID.test(acceptanceId||"")||!ID.test(orderId||"")||
  !ID.test(displayedCatalogVersion||"")||
  !Number.isSafeInteger(displayedTotalCents)||displayedTotalCents<1||
  !Number.isSafeInteger(now)||now<1000||explicitConsent!==true)
  return deny("INVALID_OR_MISSING_EXPLICIT_ACCEPTANCE");
 let principal;
 try{principal=await verifyCustomerSession(request);}
 catch{return deny("CUSTOMER_VERIFIER_UNAVAILABLE");}
 if(principal?.verified!==true||principal?.csrfVerified!==true||
  principal?.role!=="customer"||!ID.test(principal?.subjectId||"")||
  !ID.test(principal?.workspaceId||"")||!ID.test(principal?.sessionId||"")||
  !Number.isSafeInteger(principal?.sessionEpoch)||principal.sessionEpoch<1)
  return deny("CUSTOMER_SESSION_NOT_VERIFIED");
 // Phase20 session times are seconds; Phase18/19 quote times are milliseconds.
 const nowSeconds=Math.floor(now/1000);
 try{
  // Revocation, epoch, owner and all quote conditions are observed by ONE D1 write.
  const result=await db.prepare(INSERT).bind(
   acceptanceId,now,principal.sessionId,principal.subjectId,principal.workspaceId,
   principal.sessionEpoch,nowSeconds,orderId,now,now,now,now,
   displayedCatalogVersion,displayedTotalCents
  ).run();
  if(result?.success!==true||result?.meta?.changes!==1)
   return deny("SESSION_REVOKED_QUOTE_CHANGED_OR_REPLAY");
  return{ok:true,accepted:true,acceptanceId,
   status:"customer_quote_accepted_review_only",
   checkoutEligible:false,paymentAuthorized:false,deletionAuthorized:false,
   productionApproved:false};
 }catch{return deny("ATOMIC_ACCEPTANCE_WRITE_FAILED");}
}
