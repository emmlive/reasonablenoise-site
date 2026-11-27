// RN Holiday 2F: fail-closed Stripe TEST-account provenance preflight.
// No routed handler, customer payment creation, D1 write or email.
// Provider-originated acceptance requires an explicitly authorized and configured
// ReasonableNoise test account, not a different merchant's live-mode account.
const ACCOUNT=/^acct_[A-Za-z0-9]{8,}$/;
const KEY=/^sk_test_[A-Za-z0-9_-]{8,}$/;
const deny=reason=>({status:"blocked",reason,
  paymentAuthorized:false,fulfillmentAuthorized:false,emailAuthorized:false,
  deletionAuthorized:false});
const hold=reason=>({status:"hold",reason,
  paymentAuthorized:false,fulfillmentAuthorized:false,emailAuthorized:false,
  deletionAuthorized:false});

export async function verifyHolidayProviderTestAccount({
  stripeTestKey,expectedStripeAccountId,fetcher,
  allowProviderTestRead=false, allowIsolatedWorkflow=false
}={}) {
  if(!allowProviderTestRead || !allowIsolatedWorkflow)
    return deny("provider_test_gate_disabled");
  if(!KEY.test(String(stripeTestKey||"")) ||
     !ACCOUNT.test(String(expectedStripeAccountId||"")) ||
     typeof fetcher!=="function")
    return deny("missing_authorized_test_account");
  let response;
  try {
    response=await fetcher("https://api.stripe.com/v1/account",{
      method:"GET",
      headers:{authorization:"Bearer "+stripeTestKey,accept:"application/json"}
    });
  } catch {
    return deny("stripe_account_unavailable");
  }
  if(!response?.ok) return deny("stripe_account_unavailable");
  let account;
  try { account=await response.json(); }
  catch { return deny("invalid_provider_response"); }
  if(account?.object!=="account" ||
     account?.id!==expectedStripeAccountId ||
     account?.livemode!==false)
    return deny("account_identity_or_mode_mismatch");
  // Explicitly not evidence of a completed test Checkout Session or webhook.
  return hold("test_account_verified_provider_event_still_required");
}
