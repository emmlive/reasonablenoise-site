// RN Holiday 2E — isolated synthetic Stripe event -> retrieved test session
// -> disposable D1 review. Not a Cloudflare Pages route or live payment processor.
// All outcomes deny payment, fulfillment, email and deletion authorization.
import { verifyHolidayStripeEvent } from "./holiday-payment-decision.mjs";
import { reconcileHolidayTestCandidate } from "./holiday-stripe-reconciliation.mjs";
import { recordHolidayReviewCandidate } from "./holiday-review-ledger.mjs";

const noAuthority=(status,reason)=>({
  status,reason,paymentAuthorized:false,fulfillmentAuthorized:false,
  emailAuthorized:false,deletionAuthorized:false
});
const safe=(result)=>{
  // Restrict returned data to decision fields; never leak PII or payment tokens.
  if(result?.status!=="hold" && result?.status!=="blocked")
    return noAuthority("blocked","invalid_decision");
  return noAuthority(result.status,String(result.reason||"unclassified_hold"));
};

export async function processHolidayIsolatedReview({
  rawBody,stripeSignature,webhookTestSecret,nowSeconds,
  stripeTestKey,fetcher,disposableDb,
  allowIsolatedRead=false,allowDisposableWrite=false,
  allowIsolatedWorkflow=false
}={}) {
  // This must never run implicitly when a request reaches a deployed endpoint.
  if(!allowIsolatedWorkflow || !allowIsolatedRead || !allowDisposableWrite)
    return noAuthority("blocked","integration_disabled");
  if(typeof webhookTestSecret!=="string" || !webhookTestSecret.startsWith("whsec_") ||
     typeof stripeTestKey!=="string" || !stripeTestKey.startsWith("sk_test_"))
    return noAuthority("blocked","invalid_test_credentials");
  try {
    const signed=await verifyHolidayStripeEvent({
      rawBody,stripeSignature,secret:webhookTestSecret,nowSeconds
    });
    if(signed.status!=="hold" ||
       signed.reason!=="retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe")
      return safe(signed);
    const reconciled=await reconcileHolidayTestCandidate({
      candidate:signed,stripeTestKey,fetcher,allowIsolatedRead:true
    });
    if(reconciled.status!=="hold" ||
       reconciled.reason!=="durable_order_idempotency_and_refund_reconciliation_required")
      return safe(reconciled);
    const recorded=await recordHolidayReviewCandidate({
      candidate:reconciled,disposableDb,allowDisposableWrite:true
    });
    return safe(recorded);
  } catch {
    return noAuthority("blocked","isolated_pipeline_failed");
  }
}
