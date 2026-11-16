// RN-3B1C Phase 20: route-independent, fail-closed signed customer-session verifier.
// NOT WIRED to production endpoints; no customer issuer or production keys configured.
// A successful read is not payment authority or a safe later-write authorization.
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const KID=/^[A-Za-z0-9_-]{8,64}$/;
const SHA=/^[a-f0-9]{64}$/;
const deny=code=>({verified:false,csrfVerified:false,code,checkoutEligible:false,
 paymentAuthorized:false,deletionAuthorized:false,productionApproved:false});
function b64urlBytes(s){
 if(typeof s!=="string"||s.length>8192||!/^[A-Za-z0-9_-]+$/.test(s)||s.length%4===1)
  throw Error("BAD_BASE64URL");
 const binary=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function decodeJson(s){
 const bytes=b64urlBytes(s);
 if(bytes.length>4096)throw Error("BAD_JSON_SIZE");
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
function cookieValue(header,name){
 if(!header||header.length>8192)return null;
 const matches=header.split(";").map(part=>part.trim()).filter(part=>part.startsWith(name+"="));
 if(matches.length!==1)return null;
 const val=matches[0].slice(name.length+1);
 return val.length>0&&val.length<=4096?val:null;
}
async function sha256Hex(value){
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function constantTimeHex(a,b){
 if(!SHA.test(a||"")||!SHA.test(b||""))return false;
 let diff=0;
 for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
const DB_SQL="SELECT session_id,subject_id,workspace_id,session_epoch,csrf_sha256,expires_at,revoked FROM dtf_test_customer_sessions_v20 WHERE session_id=?";
export async function verifyDtfCustomerSession({request,db,keyring,issuer,audience,now}={}){
 if(!request?.headers||typeof request.url!=="string"||!db?.prepare||
  !keyring||typeof issuer!=="string"||!issuer||typeof audience!=="string"||!audience||
  !Number.isSafeInteger(now)||now<=0)return deny("VERIFIER_NOT_CONFIGURED");
 try{
  const url=new URL(request.url);
  if(request.method!=="POST")return deny("MUTATION_METHOD_REQUIRED");
  if(url.protocol!=="https:"&&!(url.protocol==="http:"&&
   ["localhost","127.0.0.1"].includes(url.hostname)))
   return deny("SECURE_ORIGIN_REQUIRED");
  // Only use actual request URL origin, not forwarded host or body claims.
  if(request.headers.get("origin")!==url.origin)return deny("ORIGIN_MISMATCH");
  const fetchSite=request.headers.get("sec-fetch-site");
  if(fetchSite&&fetchSite!=="same-origin")return deny("CROSS_SITE_REQUEST");
  const csrf=request.headers.get("x-rn-csrf");
  if(typeof csrf!=="string"||csrf.length<24||csrf.length>256||
    !/^[A-Za-z0-9_-]+$/.test(csrf))return deny("CSRF_MISSING");
  const token=cookieValue(request.headers.get("cookie"),"__Host-rn_dtf_session");
  if(!token)return deny("SESSION_COOKIE_MISSING");
  const parts=token.split(".");
  if(parts.length!==3||parts[0].length>2048||parts[1].length>4096||
   parts[2].length>1024)return deny("INVALID_JWT");
  const header=decodeJson(parts[0]);
  if(header?.alg!=="EdDSA"||header?.typ!=="JWT"||!KID.test(header?.kid||"")||
   header?.crit!==undefined||header?.jku!==undefined||header?.x5u!==undefined)
   return deny("INVALID_JWT_HEADER");
  const key=Object.prototype.hasOwnProperty.call(keyring,header.kid)?keyring[header.kid]:null;
  if(!key||!(key instanceof Uint8Array)||key.length!==32)
   return deny("UNKNOWN_SIGNING_KEY");
  const jwt=decodeJson(parts[1]);
  const signed=new TextEncoder().encode(parts[0]+"."+parts[1]);
  const signature=b64urlBytes(parts[2]);
  if(signature.length!==64)return deny("INVALID_SIGNATURE");
  const publicKey=await crypto.subtle.importKey("raw",key,{name:"Ed25519"},false,["verify"]);
  if(!(await crypto.subtle.verify({name:"Ed25519"},publicKey,signature,signed)))
   return deny("SIGNATURE_FAILED");
  if(jwt?.iss!==issuer||jwt?.aud!==audience||jwt?.role!=="customer"||
    !ID.test(jwt?.sub||"")||!ID.test(jwt?.wid||"")||
    !ID.test(jwt?.sid||"")||!Number.isSafeInteger(jwt?.epoch)||jwt.epoch<1||
    !Number.isSafeInteger(jwt?.iat)||!Number.isSafeInteger(jwt?.nbf)||
    !Number.isSafeInteger(jwt?.exp)||jwt.iat<=0||jwt.iat>now||
    jwt.nbf>now||jwt.exp<=now||jwt.exp<=jwt.iat||
    jwt.exp-jwt.iat>3600)return deny("INVALID_SESSION_CLAIMS");
  const dbRow=await db.prepare(DB_SQL).bind(jwt.sid).first();
  if(dbRow?.session_id!==jwt.sid||dbRow?.subject_id!==jwt.sub||
   dbRow?.workspace_id!==jwt.wid||dbRow?.session_epoch!==jwt.epoch||
   dbRow?.revoked!==0||!Number.isSafeInteger(dbRow?.expires_at)||
   dbRow.expires_at<=now||dbRow.expires_at<jwt.exp)
   return deny("SESSION_REVOKED_OR_STALE");
  if(!constantTimeHex(await sha256Hex(csrf),dbRow.csrf_sha256))
   return deny("CSRF_MISMATCH");
  return{verified:true,csrfVerified:true,role:"customer",subjectId:jwt.sub,
   workspaceId:jwt.wid,sessionId:jwt.sid,sessionEpoch:jwt.epoch,
   checkoutEligible:false,paymentAuthorized:false,deletionAuthorized:false,
   productionApproved:false};
 }catch{return deny("SESSION_VERIFICATION_FAILED");}
}
