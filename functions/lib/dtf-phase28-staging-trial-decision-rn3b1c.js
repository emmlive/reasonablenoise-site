// RN-3B1C Phase28: offline nonbinding staging trial decision, never auth.
export const PHASE28_TRIAL_ORDER=Object.freeze(["clerk","supabase-auth"]);
export const PHASE28_TRIAL_CONTROLS=Object.freeze([
 "written-nonproduction-authorization",
 "dedicated-disposable-provider-tenant",
 "separate-operator-and-least-privilege",
 "credentials-in-isolated-secret-store",
 "synthetic-accounts-without-real-email",
 "explicit-origin-redirect-allowlist",
 "pinned-sdk-and-worker-bundle",
 "cryptographic-issuer-audience-and-key",
 "session-expiry-and-revocation-probes",
 "csrf-cookie-and-cross-origin-probes",
 "recovery-logout-rotation-probes",
 "d1-isolated-local-ownership-probes",
 "separate-rollback-and-cleanup-plan",
 "external-independent-review"
]);
const refPattern=/^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,255}$/;
const isRecord=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const stop=(reason,items=[])=>({
 status:"NO_GO",reason,providerSelected:null,
 preferredTrialCandidate:"clerk",
 fallbackTrialCandidate:"supabase-auth",
 checks:items,stagingProvisioningAuthorized:false,
 credentialCreationAuthorized:false,realSdkAuthorized:false,
 customerLoginEnabled:false,productionAuthAuthorized:false,
 customerPrincipal:null,dtfOrderOwnershipGranted:false,
 quoteAcceptanceAuthorized:false,dtfCheckoutEnabled:false,
 paymentAuthorized:false,artworkDeletionAuthorized:false,
 deployAuthorized:false
});
export function evaluatePhase28TrialRequest(request){
 if(!isRecord(request))return stop("INVALID_TRIAL_REQUEST");
 if(!PHASE28_TRIAL_ORDER.includes(request.provider))
  return stop("INVALID_TRIAL_CANDIDATE");
 if(request.environment!=="disposable-staging")
  return stop("ISOLATION_UNPROVEN");
 if(!Array.isArray(request.attestations))return stop("MISSING_ATTESTATIONS");
 const byName=new Map(),duplicates=new Set();
 for(const item of request.attestations){
  if(!isRecord(item)||!PHASE28_TRIAL_CONTROLS.includes(item.control))
   return stop("MALFORMED_ATTESTATION");
  if(byName.has(item.control))duplicates.add(item.control);
  else byName.set(item.control,item);
 }
 const checks=PHASE28_TRIAL_CONTROLS.map(control=>{
  const item=byName.get(control);
  if(duplicates.has(control))return{control,status:"DUPLICATE"};
  if(!item)return{control,status:"MISSING"};
  if(item.state==="failed")return{control,status:"FAILED"};
  if(item.state==="not-run")return{control,status:"NOT_RUN"};
  if(item.state!=="claimed-pass")return{control,status:"INVALID_STATE"};
  if(typeof item.evidenceRef!=="string"||!refPattern.test(item.evidenceRef)||
   typeof item.reviewerRef!=="string"||!refPattern.test(item.reviewerRef))
   return{control,status:"INVALID_EVIDENCE"};
  return{control,status:"CLAIM_ONLY"};
 });
 return stop("SEPARATE_PROVIDER_APPROVAL_REQUIRED",checks);
}
export function getPhase28TrialRecommendation(){
 return stop("PLANNING_ONLY",[
  {provider:"clerk",status:"FIRST_TRIAL_CANDIDATE_ONLY",
   rationale:"Browser-focused session-oriented candidate; verify official Clerk backend on isolated Workers"},
  {provider:"supabase-auth",status:"SECOND_TRIAL_CANDIDATE_ONLY",
   rationale:"Confirm cookie SSR versus Bearer Workers flow before real integration"}
 ]);
}
