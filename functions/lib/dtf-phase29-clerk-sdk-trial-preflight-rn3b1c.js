// RN-3B1C Phase29: non-routed Clerk official SDK trial manifest preflight.
// This is a static preflight, NOT an actual Clerk SDK invocation.
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const version=/^[1-9]\d*\.\d+\.\d+$/;
const localOrigin=x=>{
 try{
  if(typeof x!=="string")return false;
  const u=new URL(x);
  return u.origin===x && u.protocol==="http:" &&
   (u.hostname==="localhost"||u.hostname==="127.0.0.1");
 }catch{return false;}
};
export const PHASE29_REQUIRED_PROBES=Object.freeze([
 "official-sdk-import-and-worker-bundle",
 "offline-jwt-key-authenticate-request",
 "authorized-party-and-audience-mismatch",
 "accepts-session-token-only",
 "signed-out-handshake-and-m2m-rejection",
 "expired-future-and-tampered-jwt",
 "unknown-kid-and-key-rotation",
 "logout-revoke-and-session-epoch",
 "csrf-origin-and-cross-site",
 "recovery-callback-and-redirect",
 "canonical-customer-mapping",
 "d1-write-time-authorization-fence",
 "provider-outage-fail-closed",
 "disposable-tenant-cleanup"
]);
const deny=(reason,checks=[])=>({
 status:"NO_GO",reason,checks,
 provider:"clerk",recommendedPackage:"@clerk/backend",
 localTrialOnly:true,offlineSdkExecuted:false,realTokenVerified:false,
 jwtKeyTrusted:false,providerAccountAuthorized:false,
 credentialsAuthorized:false,packageInstallationAuthorized:false,
 authRouteEnabled:false,customerPrincipal:null,
 localSessionAuthorized:false,dtfQuoteAcceptanceAuthorized:false,
 dtfCheckoutEnabled:false,paymentAuthorized:false,
 artworkDeletionAuthorized:false,productionApproved:false,
 deploymentAuthorized:false
});
export function inspectClerkOfflineTrialManifest(input){
 if(!isObject(input))return deny("INVALID_MANIFEST");
 if(input.provider!=="clerk"||input.environment!=="offline-local"||
  input.runtime!=="workerd")return deny("INVALID_ENVIRONMENT");
 if(input.package!=="@clerk/backend"||
  typeof input.version!=="string"||!version.test(input.version))
  return deny("PACKAGE_NOT_EXACTLY_PINNED");
 if(input.acceptsToken!=="session_token"||
  input.networkless!==true||input.allowProviderFetch!==false)
  return deny("UNSAFE_SDK_MODE");
 if(!localOrigin(input.authorizedParty)||input.requestOrigin!==input.authorizedParty)
  return deny("INVALID_LOCAL_ORIGIN");
 if(typeof input.audience!=="string"||
  !/^[A-Za-z0-9_-]{8,80}$/.test(input.audience))
  return deny("MISSING_AUDIENCE");
 // Never accept a real key/secret in this manifest. Actual secrets need a separate approval.
 if(input.jwtKey!==undefined||input.secretKey!==undefined||
  input.publishableKey!==undefined||input.token!==undefined)
  return deny("CREDENTIAL_MATERIAL_FORBIDDEN");
 if(!Array.isArray(input.probeResults))return deny("MISSING_PROBES");
 const byName=new Map(),duplicates=new Set();
 for(const row of input.probeResults){
  if(!isObject(row)||!PHASE29_REQUIRED_PROBES.includes(row.name))
   return deny("MALFORMED_PROBE");
  if(byName.has(row.name))duplicates.add(row.name);
  else byName.set(row.name,row);
 }
 const checks=PHASE29_REQUIRED_PROBES.map(name=>{
  if(duplicates.has(name))return{name,result:"DUPLICATE"};
  const r=byName.get(name);
  if(!r)return{name,result:"MISSING"};
  if(r.result==="fail")return{name,result:"FAIL"};
  if(r.result==="not-run")return{name,result:"NOT_RUN"};
  if(r.result!=="self-reported-pass")return{name,result:"INVALID_RESULT"};
  return{name,result:"CLAIM_ONLY"};
 });
 return deny("INDEPENDENT_REAL_SDK_PROOF_REQUIRED",checks);
}
export function phase29ClerkProbePlan(){
 return deny("PLANNING_ONLY",PHASE29_REQUIRED_PROBES.map(name=>({name,result:"PLANNED"})));
}
