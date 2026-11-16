// RN-3B1C Phase26 — isolated staging preflight (read-only, no SDK integration).
// Self-reported evidence is NEVER a deployment or real-provider authorization.
export const PHASE26_PROVIDERS=Object.freeze(["clerk","supabase-auth"]);
export const PHASE26_GATES=Object.freeze([
 "separate-test-tenant",
 "disposable-accounts-only",
 "secret-storage-and-rotation",
 "official-sdk-version-pin",
 "worker-runtime-bundle",
 "verified-issuer-and-audience",
 "trusted-jwks-and-key-rotation",
 "callback-pkce-state-nonce",
 "cookie-csrf-origin",
 "revocation-and-recovery",
 "subject-to-local-customer-mapping",
 "d1-write-time-revocation-fence",
 "quote-ownership-manual-claim",
 "staging-isolation-rollback",
 "provider-rate-limit-and-logging",
 "independent-security-review"
]);
const REFERENCE=/^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,255}$/;
function blocked(reason,details){
 return {status:"NO_GO",reason,details,stagingApproved:false,
  providerSelected:false,credentialsAuthorized:false,accountCreationAuthorized:false,
  loginEnabled:false,customerRouteEnabled:false,dtfCheckoutEnabled:false,
  stripeAuthorized:false,r2MutationAuthorized:false,artworkDeletionAuthorized:false,
  deploymentAuthorized:false,productionApproved:false};
}
export function inspectProviderStagingPreflight(input){
 if(!input||typeof input!=="object"||Array.isArray(input))
  return blocked("INVALID_INPUT",[]);
 if(!PHASE26_PROVIDERS.includes(input.provider))
  return blocked("UNAPPROVED_PROVIDER",[]);
 if(!Array.isArray(input.evidence))
  return blocked("MISSING_EVIDENCE",[]);
 const evidence=new Map(),duplicates=new Set();
 for(const entry of input.evidence){
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||
   !PHASE26_GATES.includes(entry.gate))
   return blocked("UNKNOWN_OR_MALFORMED_EVIDENCE",[]);
  if(evidence.has(entry.gate))duplicates.add(entry.gate);
  else evidence.set(entry.gate,entry);
 }
 const details=PHASE26_GATES.map(gate=>{
  const e=evidence.get(gate);
  if(duplicates.has(gate))return {gate,state:"DUPLICATE"};
  if(!e)return {gate,state:"MISSING"};
  if(e.result==="failed")return {gate,state:"FAILED"};
  if(e.result==="not-tested")return {gate,state:"UNTESTED"};
  if(e.result!=="claimed-pass")return {gate,state:"INVALID_CLAIM"};
  if(typeof e.reference!=="string"||!REFERENCE.test(e.reference)||
   typeof e.reviewerRef!=="string"||!REFERENCE.test(e.reviewerRef))
   return {gate,state:"INVALID_REFERENCE"};
  return {gate,state:"CLAIMED_NOT_VERIFIED"};
 });
 // Neither a complete checklist nor a forged approval flag proves the provider.
 return blocked("INDEPENDENT_STAGING_AUTHORIZATION_REQUIRED",details);
}
export function planProviderStagingTasks(provider){
 if(!PHASE26_PROVIDERS.includes(provider))return blocked("UNAPPROVED_PROVIDER",[]);
 return blocked("PLAN_ONLY",PHASE26_GATES.map(gate=>({gate,state:"PLANNED"})));
}
