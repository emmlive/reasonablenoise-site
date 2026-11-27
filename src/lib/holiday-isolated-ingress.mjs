// RN Holiday 2G — locally scoped webhook ingress adapter, NOT a Pages Function.
// Never mount on reasonablenoise.com. For disposable local Workerd acceptance only.
// Stripe Checkout (even test mode), production fulfillment and emails stay disabled.
import {processHolidayIsolatedReview} from "./holiday-integrated-review.mjs";
const PATH="/__isolated/holiday/test-webhook";
const ORIGIN="http://localhost";
const fail=(status,reason)=>({
  httpStatus:status,status:"blocked",reason,paymentAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false
});
const hold=(reason)=>({
  httpStatus:200,status:"hold",reason,paymentAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false
});
export async function inspectIsolatedHolidayWebhook({
  request,webhookTestSecret,stripeTestKey,nowSeconds,fetcher,disposableDb,
  allowLocalIngress=false,allowIsolatedRead=false,
  allowDisposableWrite=false,allowIsolatedWorkflow=false,
  allowTaxPendingReview=false
}={}) {
  // Disallow provider delivery to production-domain webhook by construction.
  if(!allowLocalIngress || !allowIsolatedWorkflow ||
     !allowIsolatedRead || !allowDisposableWrite)
    return fail(403,"isolated_ingress_disabled");
  if(!(request instanceof Request))
    return fail(400,"invalid_request");
  let url;
  try{url=new URL(request.url);}catch{return fail(400,"invalid_request");}
  if(url.origin!==ORIGIN || url.pathname!==PATH || url.search!==""
      || url.hash!=="" || url.username!=="" || url.password!=="")
    return fail(404,"outside_disposable_local_origin");
  if(request.method!=="POST")return fail(405,"method_not_allowed");
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))
    return fail(415,"invalid_content_type");
  const signature=request.headers.get("stripe-signature");
  if(!signature || signature.length>512)return fail(400,"missing_or_oversized_signature");
  const length=request.headers.get("content-length");
  if(length!==null && (!/^\d+$/.test(length)||Number(length)>128000))
    return fail(413,"oversized_body");
  let rawBody;
  try{rawBody=await request.text();}
  catch{return fail(400,"unreadable_body");}
  if(rawBody.length>128000)return fail(413,"oversized_body");
  // Tax settings are currently pending. This explicit local test opt-in
  // permits REVIEW-ONLY ledger evidence, never tax or payment authorization.
  if(!allowTaxPendingReview)return hold("tax_policy_unconfirmed_no_provider_processing");
  if(!/^whsec_[A-Za-z0-9_-]{8,}$/.test(String(webhookTestSecret||"")) ||
     !/^sk_test_[A-Za-z0-9_-]{8,}$/.test(String(stripeTestKey||"")))
    return fail(403,"test_credentials_required");
  const result=await processHolidayIsolatedReview({
    rawBody,stripeSignature:signature,webhookTestSecret,stripeTestKey,nowSeconds,
    fetcher,disposableDb,
    allowIsolatedRead,allowDisposableWrite,allowIsolatedWorkflow
  });
  // Never reflect event metadata, customer PII, request body or secrets.
  if(result?.status!=="blocked" && result?.status!=="hold")
    return fail(500,"unexpected_review_result");
  return {
    httpStatus:result.status==="blocked"?422:200,
    status:result.status,reason:String(result.reason||"unclassified").slice(0,128),
    paymentAuthorized:false,fulfillmentAuthorized:false,
    emailAuthorized:false,deletionAuthorized:false
  };
}
