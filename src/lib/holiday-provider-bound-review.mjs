// RN Holiday Phase 2H — account-bound isolated review, NOT provider acceptance.
// No Pages route, no external destination, no Stripe checkout creation or email.
// Every result is HOLD or BLOCKED; only a disposable review ledger may be written.
import { verifyHolidayProviderTestAccount } from "./holiday-provider-test-preflight.mjs";
import { processHolidayIsolatedReview } from "./holiday-integrated-review.mjs";

const REASONABLENOISE_ACCOUNT = "acct_1JFBGfEHvJ1pMLLA";
const safe = (status, reason) => ({
  status, reason,
  paymentAuthorized: false,
  checkoutAuthorized: false,
  taxCollectionAuthorized: false,
  fulfillmentAuthorized: false,
  emailAuthorized: false,
  deletionAuthorized: false
});

export async function processHolidayAccountBoundReview({
  rawBody, stripeSignature, webhookTestSecret, nowSeconds,
  stripeTestKey, fetcher, disposableDb,
  allowIsolatedWorkflow=false, allowIsolatedRead=false,
  allowDisposableWrite=false, allowProviderAccountRead=false,
  allowTaxPendingReview=false
}={}) {
  if (!allowIsolatedWorkflow || !allowIsolatedRead ||
      !allowDisposableWrite || !allowProviderAccountRead)
    return safe("blocked", "provider_bound_review_disabled");
  // Tax remains pending in Stripe's test environment. This opt-in is solely
  // for isolated REVIEW-ONLY evidence, not collection or tax authorization.
  if (!allowTaxPendingReview)
    return safe("hold", "tax_policy_unconfirmed_no_provider_processing");
  if (typeof stripeTestKey!=="string" ||
      !/^sk_test_[A-Za-z0-9_-]{8,}$/.test(stripeTestKey) ||
      !/^whsec_[A-Za-z0-9_-]{8,}$/.test(String(webhookTestSecret||"")) ||
      typeof fetcher!=="function")
    return safe("blocked", "test_credentials_or_client_missing");

  // First prove the test API key belongs to this EXACT merchant identity,
  // not a different connected test merchant or the same merchant in live mode.
  const identity = await verifyHolidayProviderTestAccount({
    stripeTestKey,
    expectedStripeAccountId: REASONABLENOISE_ACCOUNT,
    fetcher,
    allowProviderTestRead: true,
    allowIsolatedWorkflow: true
  });
  if (identity.status!=="hold" ||
      identity.reason!=="test_account_verified_provider_event_still_required")
    return safe("blocked", "provider_account_identity_unverified");

  // Existing 2A -> 2B -> 2C chain independently validates webhook HMAC,
  // retrieves session and full line-items from test Stripe, and writes only
  // to a caller-supplied disposable D1 review ledger. No provider mutation.
  const result = await processHolidayIsolatedReview({
    rawBody, stripeSignature, webhookTestSecret, nowSeconds,
    stripeTestKey, fetcher, disposableDb,
    allowIsolatedRead: true, allowDisposableWrite: true,
    allowIsolatedWorkflow: true
  });
  if (!["hold", "blocked"].includes(result?.status))
    return safe("blocked", "invalid_review_result");
  return safe(result.status, String(result.reason||"review_unclassified").slice(0,128));
}
