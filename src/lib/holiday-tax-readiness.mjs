// RN Holiday 2F-tax: read-only Stripe Tax readiness evaluation.
// Isolated module: no routed handler, tax mutation, payment, email, D1 or R2.
// Never infers a state's registration from address or test-mode merchant status.
const none=reason=>({
  status:"blocked",reason,
  paymentAuthorized:false,checkoutAuthorized:false,taxCollectionAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false
});
const hold=reason=>({
  status:"hold",reason,
  paymentAuthorized:false,checkoutAuthorized:false,taxCollectionAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false
});
const TAX_STATUS=new Set(["active","pending"]);
export function evaluateHolidayTaxReadiness({
  settings,registrations,accountLivemode=false,
  taxPolicyConfirmed=false,headOfficeConfirmed=false,
  businessRegistrationConfirmed=false,
  productTaxCodeConfirmed=false,priceTaxBehaviorConfirmed=false
}={}) {
  if(accountLivemode!==false)return none("live_mode_forbidden");
  if(settings?.object!=="tax.settings"||settings?.livemode!==false||
     !TAX_STATUS.has(settings.status)||
     registrations?.object!=="list"||!Array.isArray(registrations.data)||
     registrations.has_more!==false)
    return none("tax_evidence_missing_or_untrusted");
  if(settings.status!=="active"||settings.head_office==null)
    return hold("head_office_and_tax_settings_pending");
  if(registrations.data.length===0)
    return hold("no_tax_registrations_recorded");
  if(!taxPolicyConfirmed||!headOfficeConfirmed||!businessRegistrationConfirmed)
    return hold("business_tax_policy_and_registrations_unconfirmed");
  if(!productTaxCodeConfirmed||!priceTaxBehaviorConfirmed||
     settings.defaults?.tax_code==null||settings.defaults?.tax_behavior==null)
    return hold("product_tax_code_and_price_behavior_unconfirmed");
  // Read-only evidence does not prove Stripe Tax collection or jurisdictional
  // sufficiency; requires separate tax calculation and owner-reviewed policy.
  return hold("tax_read_only_preflight_complete_test_calculation_and_owner_signoff_required");
}

export async function inspectHolidayTaxReadiness({
  stripeTestKey,fetcher,allowIsolatedRead=false,accountLivemode=false,
  ...ownerConfirmations
}={}) {
  if(!allowIsolatedRead)return none("tax_read_disabled");
  if(accountLivemode!==false||!/^sk_test_[A-Za-z0-9_-]{8,}$/.test(String(stripeTestKey||""))||
     typeof fetcher!=="function")return none("test_account_or_client_missing");
  const get=async(path)=>{
    let response;
    try{
      response=await fetcher("https://api.stripe.com/v1/"+path,{
        method:"GET",headers:{
          authorization:"Bearer "+stripeTestKey,accept:"application/json"
        }
      });
      if(!response?.ok)return null;
      return await response.json();
    }catch{return null;}
  };
  // Both calls are read-only, fixed-path, and do not expose provider PII.
  const settings=await get("tax/settings");
  if(!settings)return none("tax_settings_unavailable");
  const registrations=await get("tax/registrations?limit=100");
  if(!registrations)return none("tax_registrations_unavailable");
  return evaluateHolidayTaxReadiness({
    settings,registrations,accountLivemode,...ownerConfirmations
  });
}
