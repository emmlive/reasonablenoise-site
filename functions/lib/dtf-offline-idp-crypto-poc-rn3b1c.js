// RN-3B1C Phase25 OFFLINE provider-shaped cryptographic token PoC.
// Not a provider SDK, production JWT verifier or customer auth endpoint.
// Pinned ephemeral fixture keys only. No network, account or database mutations.
const KID=/^[a-zA-Z0-9_-]{8,64}$/;
const AUTH_ID=/^[a-zA-Z0-9_:|-]{8,128}$/;
const deny=code=>({verified:false,code,provider:null,providerSubject:null,
 customerPrincipal:null,sessionAuthorized:false,quoteAcceptanceAuthorized:false,
 checkoutEligible:false,paymentAuthorized:false,deletionAuthorized:false,
 productionApproved:false});
const SPECS=Object.freeze({
 clerk:Object.freeze({algorithm:"RS256",maxAge:3600}),
 "supabase-auth":Object.freeze({algorithm:"ES256",maxAge:3600})
});
function bytes(segment,max){
 if(typeof segment!=="string"||!segment||segment.length>max||
  !/^[a-zA-Z0-9_-]+$/.test(segment)||segment.length%4===1)throw Error("INVALID_SEGMENT");
 return Uint8Array.from(atob(segment.replace(/-/g,"+").replace(/_/g,"/")+
  "=".repeat((4-segment.length%4)%4)),c=>c.charCodeAt(0));
}
function json(segment,max){
 const data=bytes(segment,max);
 if(data.length>4096)throw Error("TOO_LARGE");
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));
}
function allowedOrigin(value){
 try{
  const url=new URL(value);
  return url.origin===value&&(url.protocol==="https:"||
   (url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname)));
 }catch{return false;}
}
export async function verifyOfflineIdpFixture({
 provider,token,keyring,issuer,audience,authorizedParty,now
}={}){
 const spec=SPECS[provider];
 if(!spec||typeof token!=="string"||token.length>8192||!keyring||
  !allowedOrigin(authorizedParty)||typeof issuer!=="string"||!issuer||
  typeof audience!=="string"||!audience||!Number.isSafeInteger(now)||now<=0)
  return deny("FIXTURE_NOT_CONFIGURED");
 try{
  const bits=token.split(".");
  if(bits.length!==3)return deny("INVALID_JWT");
  const header=json(bits[0],2048),payload=json(bits[1],4096);
  if(header?.typ!=="JWT"||header?.alg!==spec.algorithm||
   !KID.test(header?.kid||"")||header?.crit!==undefined||
   header?.jku!==undefined||header?.x5u!==undefined||header?.jwk!==undefined)
   return deny("UNTRUSTED_JWT_HEADER");
  const jwk=Object.hasOwn(keyring,header.kid)?keyring[header.kid]:null;
  if(!jwk||typeof jwk!=="object"||jwk.kid!==header.kid||
   jwk.alg!==spec.algorithm||jwk.use!=="sig"||jwk.d!==undefined||
   (spec.algorithm==="RS256"&&(jwk.kty!=="RSA"||jwk.n?.length<300||!jwk.e))||
   (spec.algorithm==="ES256"&&(jwk.kty!=="EC"||jwk.crv!=="P-256")))
   return deny("UNTRUSTED_SIGNING_KEY");
  const algorithm=spec.algorithm==="RS256"?
   {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}:
   {name:"ECDSA",namedCurve:"P-256"};
  const key=await crypto.subtle.importKey("jwk",jwk,algorithm,false,["verify"]);
  const signature=bytes(bits[2],1024);
  const valid=await crypto.subtle.verify(
   spec.algorithm==="RS256"?algorithm:{name:"ECDSA",hash:"SHA-256"},
   key,signature,new TextEncoder().encode(bits[0]+"."+bits[1]));
  if(!valid)return deny("BAD_SIGNATURE");
  if(payload?.iss!==issuer||payload?.aud!==audience||
   !AUTH_ID.test(payload?.sub||"")||
   !Number.isSafeInteger(payload?.iat)||!Number.isSafeInteger(payload?.nbf)||
   !Number.isSafeInteger(payload?.exp)||payload.iat<=0||payload.iat>now||
   payload.nbf>now||payload.exp<=now||payload.exp<=payload.iat||
   payload.exp-payload.iat>spec.maxAge)
   return deny("INVALID_AUTH_CLAIMS");
  if(provider==="clerk"){
   if(payload?.azp!==authorizedParty||!AUTH_ID.test(payload?.sid||""))
    return deny("CLERK_FIXTURE_PARTY_OR_SESSION_MISMATCH");
  }else{
   // A Supabase authenticated role is not a local DTF order permission.
   if(payload?.role!=="authenticated"||
    !AUTH_ID.test(payload?.session_id||""))
    return deny("SUPABASE_FIXTURE_ROLE_OR_SESSION_MISMATCH");
  }
  // Never fabricate local customer ID, workspace, D1 epoch or CSRF.
  return{verified:true,provider,providerSubject:payload.sub,
   providerSessionId:provider==="clerk"?payload.sid:payload.session_id,
   customerPrincipal:null,sessionAuthorized:false,
   quoteAcceptanceAuthorized:false,checkoutEligible:false,
   paymentAuthorized:false,deletionAuthorized:false,productionApproved:false,
   evidenceScope:"OFFLINE_PROVIDER_SHAPED_CRYPTO_ONLY"};
 }catch{return deny("CRYPTO_VERIFICATION_FAILED");}
}
