// RN-3B1C Phase27 — mockable provider SDK evidence adapters, NOT customer auth.
// Deliberately no real SDK, D1, issuer, login route, or customer authority.
const SUBJECT=/^[A-Za-z0-9_:|-]{8,128}$/;
const deny=code=>({ok:false,code,provider:null,providerSubject:null,
 providerSessionId:null,customerPrincipal:null,workspaceId:null,
 csrfVerified:false,sessionAuthorized:false,quoteAcceptanceAuthorized:false,
 checkoutEligible:false,paymentAuthorized:false,deletionAuthorized:false,
 productionApproved:false});
function accepted(provider,subject,session){
 return{...deny("PROVIDER_IDENTITY_EVIDENCE_ONLY"),ok:true,provider,
  providerSubject:subject,providerSessionId:session};
}
function sameOriginRequest(request){
 if(!(request instanceof Request)||request.method!=="POST")return false;
 try{
  const target=new URL(request.url);
  if(target.protocol!=="https:" && !(target.protocol==="http:"&&
   ["localhost","127.0.0.1"].includes(target.hostname)))return false;
  if(request.headers.get("origin")!==target.origin)return false;
  const fetchSite=request.headers.get("sec-fetch-site");
  return !fetchSite||fetchSite==="same-origin";
 }catch{return false;}
}
export async function inspectMockClerkSdkRequest({request,clerkClient}={}){
 if(!sameOriginRequest(request)||typeof clerkClient?.authenticateRequest!=="function")
  return deny("MOCK_CLERK_DEPENDENCY_OR_ORIGIN_MISSING");
 try{
  const origin=new URL(request.url).origin;
  const state=await clerkClient.authenticateRequest(request,{
   authorizedParties:[origin],acceptsToken:"session_token"
  });
  if(state?.isAuthenticated!==true||state?.status!=="signed-in"||
   state?.tokenType!=="session_token"||typeof state?.toAuth!=="function")
   return deny("MOCK_CLERK_SESSION_UNVERIFIED");
  const auth=state.toAuth();
  if(!SUBJECT.test(auth?.userId||"")||!SUBJECT.test(auth?.sessionId||""))
   return deny("MOCK_CLERK_IDENTITY_MISSING");
  return accepted("clerk",auth.userId,auth.sessionId);
 }catch{return deny("MOCK_CLERK_SDK_ERROR");}
}
export async function inspectMockSupabaseSdkRequest({request,supabase}={}){
 if(!sameOriginRequest(request)||typeof supabase?.auth?.getClaims!=="function")
  return deny("MOCK_SUPABASE_DEPENDENCY_OR_ORIGIN_MISSING");
 const authorization=request.headers.get("authorization");
 // Explicit bearer only: mock getClaims does not establish browser cookie CSRF.
 if(typeof authorization!=="string"||!/^Bearer [A-Za-z0-9._-]{16,4096}$/.test(authorization))
  return deny("MOCK_SUPABASE_BEARER_MISSING");
 try{
  const token=authorization.slice(7);
  const response=await supabase.auth.getClaims(token);
  if(response?.error||!response?.data?.claims)
   return deny("MOCK_SUPABASE_CLAIMS_UNVERIFIED");
  const claims=response.data.claims;
  if(claims.role!=="authenticated"||!SUBJECT.test(claims.sub||"")||
   !SUBJECT.test(claims.session_id||""))
   return deny("MOCK_SUPABASE_IDENTITY_MISSING");
  return accepted("supabase-auth",claims.sub,claims.session_id);
 }catch{return deny("MOCK_SUPABASE_SDK_ERROR");}
}
