// RN-3B1C Phase 23: read-only authorization readiness evidence inventory.
// A manifest is NEVER authority to issue sessions, mutate orders, or activate checkout.
// This module must remain outside all customer production request paths.
export const DTF_AUTH_READINESS_GATES=Object.freeze([
 {id:"issuer-selection",owner:"product-security",proof:"Approved issuer and account ownership model"},
 {id:"issuer-signature",owner:"identity-security",proof:"Issuer/audience/pinned signing-key lifecycle independently verified"},
 {id:"session-issuance",owner:"identity-security",proof:"Secure cookie issuance, expiry, key rotation and server-side revocation"},
 {id:"csrf-browser",owner:"application-security",proof:"CSRF nonce lifecycle, same-origin and real browser verification"},
 {id:"account-recovery",owner:"identity-security",proof:"Verified signup/login, email confirmation, logout and account recovery"},
 {id:"owner-binding",owner:"data-security",proof:"Durable verified account-to-quote/order mapping and transfer policy"},
 {id:"atomic-decision",owner:"database-security",proof:"Authenticated decision-time same-write session and order fence"},
 {id:"schema-permissions",owner:"cloudflare-security",proof:"Least-privilege Cloudflare D1 schema, migration and access review"},
 {id:"provider-runtime",owner:"cloudflare-security",proof:"Independent staging Workerd/D1 and concurrency isolation evidence"},
 {id:"quote-pricing",owner:"business-approval",proof:"Approved final rate card, price versioning, quote expiry and corrections"},
 {id:"acceptance-ux",owner:"product-security",proof:"Real customer acceptance UX, accessibility, audit and consent validation"},
 {id:"abuse-controls",owner:"application-security",proof:"Rate limits, request size, replay control and support workflows"},
 {id:"deployment-safety",owner:"release-management",proof:"Staging release, rollback, monitoring, secret handling and incident plan"},
 {id:"dependency-review",owner:"application-security",proof:"Dependency vulnerability audit and remediation evidence"}
]);
const GATE_IDS=new Set(DTF_AUTH_READINESS_GATES.map(g=>g.id));
const SHA256=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,255}$/;
const deny=(code,gates)=>({status:"BLOCKED",code,
 reviewCandidate:false,liveIntegrationAuthorized:false,checkoutAuthorized:false,
 paymentAuthorized:false,artworkDeletionAuthorized:false,
 productionDeploymentAuthorized:false,gates});
export function inspectDtfAuthReadinessEvidence(evidence){
 // This evaluates completeness only, not provenance or correctness.
 // Never infer an approval from user/body-provided booleans.
 const input=(evidence&&typeof evidence==="object"&&!Array.isArray(evidence))?evidence:{};
 const entries=Array.isArray(input.entries)?input.entries:[];
 const byId=new Map();
 const duplicates=new Set();
 for(const e of entries){
  if(!e||typeof e!=="object"||Array.isArray(e)||!GATE_IDS.has(e.id))continue;
  if(byId.has(e.id))duplicates.add(e.id);
  else byId.set(e.id,e);
 }
 const gates=DTF_AUTH_READINESS_GATES.map(g=>{
  const entry=byId.get(g.id);
  let condition="MISSING";
  if(duplicates.has(g.id))condition="DUPLICATE";
  else if(entry){
   if(entry.status==="blocked")condition="BLOCKED";
   else if(entry.status!=="reviewed")condition="UNVERIFIED";
   else if(typeof entry.evidenceRef!=="string"||!REF.test(entry.evidenceRef)||
    typeof entry.sha256!=="string"||!SHA256.test(entry.sha256)||
    typeof entry.reviewerRole!=="string"||entry.reviewerRole!==g.owner||
    typeof entry.reviewerRef!=="string"||!REF.test(entry.reviewerRef))
    condition="INVALID_EVIDENCE_METADATA";
   else condition="CLAIMED_REVIEWED_NOT_TRUSTED";
  }
  return{id:g.id,owner:g.owner,condition};
 });
 // Even a fully populated manifest must never turn into a runtime go decision.
 return deny("EXTERNAL_INDEPENDENT_APPROVAL_REQUIRED",gates);
}
export function listDtfAuthBlockers(evidence){
 const report=inspectDtfAuthReadinessEvidence(evidence);
 return Object.freeze({
  ...report,
  missing:report.gates.filter(g=>g.condition==="MISSING").map(g=>g.id),
  disputed:report.gates.filter(g=>g.condition!=="MISSING").map(g=>g.id),
  total:DTF_AUTH_READINESS_GATES.length
 });
}
