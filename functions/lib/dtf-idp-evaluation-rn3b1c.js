// RN-3B1C Phase 24: read-only, evidence-gated identity provider evaluation.
// No provider selection or claims may authorize a production authentication route.
export const DTF_IDP_CANDIDATES=Object.freeze([
 Object.freeze({id:"clerk",name:"Clerk",category:"managed-auth-ui",
  source:"https://clerk.com/docs/reference/backend/authenticate-request",
  priceSource:"https://clerk.com/pricing",
  finding:"Workers-compatible backend auth; explicitly configure authorizedParties and validate session/revocation integration",
  openQuestion:"Demonstrate Pages Functions, account-to-quote ownership, logout/revocation and CSRF in isolated staging"}),
 Object.freeze({id:"supabase-auth",name:"Supabase Auth",category:"managed-auth-and-db",
  source:"https://supabase.com/docs/guides/auth/choosing-a-server-package",
  priceSource:"https://supabase.com/pricing",
  finding:"WebCrypto-compatible signed JWT verification; session and refresh token handling differ by server/browser package",
  openQuestion:"Demonstrate Cloudflare Pages cookie/PKCE lifecycle, asymmetric JWKS, D1 ownership fencing and revocation"}),
 Object.freeze({id:"auth0",name:"Auth0",category:"oidc-provider",
  source:"https://auth0.com/pricing",
  priceSource:"https://auth0.com/pricing",
  finding:"OIDC identity platform with managed authentication options; Workers integration not verified in this phase",
  openQuestion:"Prove Workers integration with PKCE, issuer/JWKS/nonce, state, callback, revocation and account recovery"})
]);
export const DTF_IDP_CRITERIA=Object.freeze([
 Object.freeze({id:"worker-runtime",weight:20}),
 Object.freeze({id:"cryptographic-verification",weight:20}),
 Object.freeze({id:"session-revocation",weight:15}),
 Object.freeze({id:"account-recovery",weight:10}),
 Object.freeze({id:"d1-order-ownership",weight:15}),
 Object.freeze({id:"csrf-browser",weight:10}),
 Object.freeze({id:"cost-portability",weight:10})
]);
const IDs=new Set(DTF_IDP_CANDIDATES.map(p=>p.id));
const CRITERIA=new Set(DTF_IDP_CRITERIA.map(c=>c.id));
const empty=()=>({status:"NO_SELECTION",chosenProvider:null,
 productionApproved:false,authActivationAuthorized:false,
 quoteAcceptanceAuthorized:false,checkoutEligible:false,
 paymentAuthorized:false,deletionAuthorized:false,
 evaluated:false,reason:"INDEPENDENT_PROVIDER_REVIEW_REQUIRED"});
export function assessDtfIdentityProviderProposal(proposal){
 const result=empty();
 if(!proposal||typeof proposal!=="object"||Array.isArray(proposal))return result;
 if(!IDs.has(proposal.providerId))return {...result,reason:"UNKNOWN_PROVIDER"};
 if(!Array.isArray(proposal.evidence))return {...result,reason:"NO_EVIDENCE"};
 const seen=new Set();let score=0,unknown=0;
 for(const item of proposal.evidence){
  if(!item||typeof item!=="object"||!CRITERIA.has(item.criterion)||
   seen.has(item.criterion))return {...result,reason:"INVALID_OR_DUPLICATE_CRITERION"};
  seen.add(item.criterion);
  const criterion=DTF_IDP_CRITERIA.find(x=>x.id===item.criterion);
  if(item.result==="unknown"||item.result==="not-tested"){unknown++;continue;}
  // Evidence is a proposed assessment, NOT independently verified vendor capability.
  if(!["met","unmet"].includes(item.result)||typeof item.evidenceRef!=="string"||
   !/^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,255}$/.test(item.evidenceRef))
   return {...result,reason:"INVALID_EVIDENCE"};
  if(item.result==="met")score+=criterion.weight;
 }
 if(seen.size!==CRITERIA.size)return {...result,reason:"INCOMPLETE_EVIDENCE"};
 return{...result,evaluated:true,providerId:proposal.providerId,
  proposedScore:score,unknownCount:unknown,
  reason:"PROPOSAL_ONLY_NOT_VERIFIED"};
}
