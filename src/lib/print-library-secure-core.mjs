// RN secure Print Artwork Library core, deliberately UNMOUNTED.
// No Pages function route, no upload endpoint, no provider integration.
// A future route MUST validate a verified Cloudflare Access assertion
// before retrieving private R2 data, never trust forwarded email headers.
import {validApprovedPrintArtwork} from "./print-artwork-catalog.mjs";

function decodeBase64Url(value) {
  if(typeof value!=="string"||!/^[A-Za-z0-9_-]+$/.test(value))throw Error("invalid_base64");
  const padded=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
function parseJson(part) {
  const bytes=decodeBase64Url(part);
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
function safeFailure(reason="unauthorized") {
  return {ok:false,reason,printAuthorized:false,downloadAuthorized:false};
}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}

export async function verifyAdminAccessAssertion({request,jwks,issuer,audience,allowedEmails,nowSeconds=Date.now()/1000}={}) {
  try {
    if(!(request instanceof Request)||!Array.isArray(jwks)||jwks.length<1||
       typeof issuer!=="string"||!/^https:\/\/[a-z0-9.-]+\/?$/.test(issuer)||
       typeof audience!=="string"||!audience.trim()||
       !Array.isArray(allowedEmails)||!Number.isFinite(nowSeconds))return safeFailure();
    const token=request.headers.get("cf-access-jwt-assertion");
    if(typeof token!=="string"||token.length>8192)return safeFailure();
    const parts=token.split(".");
    if(parts.length!==3||parts.some(x=>!x))return safeFailure();
    const header=parseJson(parts[0]),claims=parseJson(parts[1]);
    if(header.alg!=="RS256"||header.typ!=="JWT"||typeof header.kid!=="string"||
       !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid))return safeFailure();
    const keys=jwks.filter(k=>k&&k.kty==="RSA"&&k.alg==="RS256"&&
      k.use==="sig"&&k.kid===header.kid&&typeof k.n==="string"&&typeof k.e==="string");
    if(keys.length!==1)return safeFailure();
    const email=typeof claims.email==="string"?claims.email.trim().toLowerCase():"";
    if(!email||!allowedEmails.map(x=>String(x).trim().toLowerCase()).includes(email)||
       claims.iss!==issuer||!(claims.aud===audience||
       Array.isArray(claims.aud)&&claims.aud.length===1&&claims.aud[0]===audience)||
       typeof claims.sub!=="string"||!claims.sub.trim()||
       !Number.isSafeInteger(claims.exp)||claims.exp<=nowSeconds||
       !Number.isSafeInteger(claims.iat)||claims.iat>nowSeconds+30||
       !Number.isSafeInteger(claims.nbf)||claims.nbf>nowSeconds+30||
       claims.exp-claims.iat>86400||
       claims.exp<=claims.iat)return safeFailure();
    const key=await crypto.subtle.importKey("jwk",keys[0],
      {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decodeBase64Url(parts[2]),
      new TextEncoder().encode(parts[0]+"."+parts[1]));
    if(!valid)return safeFailure();
    return {ok:true,reason:"verified_access_assertion",email,subject:claims.sub,
      printAuthorized:false,downloadAuthorized:false};
  }catch{
    return safeFailure();
  }
}

// Caller MUST retrieve approval record from trusted internal data, never
// client JSON. The caller's authorization and the order-to-artwork mapping
// are additional, independent conditions.
export async function readApprovedPrintFile({authorizedIdentity,approvalRecord,
  expectedDesignId,expectedVersion,boundOrderReference,approvedOrderReference,
  bucket,maxBytes=20*1024*1024}={}) {
  const blocked=reason=>({ok:false,reason,downloadAuthorized:false,printAuthorized:false});
  if(authorizedIdentity?.ok!==true||
     authorizedIdentity.reason!=="verified_access_assertion"||
     !validApprovedPrintArtwork(approvalRecord)||
     typeof expectedDesignId!=="string"||approvalRecord.id!==expectedDesignId||
     typeof expectedVersion!=="string"||approvalRecord.version!==expectedVersion||
     !/^RN-[A-Za-z0-9_-]{6,80}$/.test(String(boundOrderReference||""))||
     boundOrderReference!==approvedOrderReference||
     !bucket||typeof bucket.get!=="function"||
     !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>20*1024*1024)
    return blocked("unapproved_or_unbound");
  try {
    const obj=await bucket.get(approvalRecord.printFileR2Key);
    if(!obj||typeof obj.arrayBuffer!=="function")return blocked("missing_approved_file");
    if(!Number.isSafeInteger(obj.size)||obj.size<1||obj.size>maxBytes)
      return blocked("invalid_file_size");
    const raw=new Uint8Array(await obj.arrayBuffer());
    if(raw.byteLength!==obj.size||raw.byteLength>maxBytes)return blocked("invalid_file_size");
    const digest=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",raw)));
    if(digest!==approvalRecord.sha256)return blocked("checksum_mismatch");
    const bytes=raw;
    // No inline browser rendering; a later authenticated route may return
    // as attachment with nosniff, private/no-store cache policy and audit.
    return {ok:true,reason:"approved_file_integrity_verified",
      bytes,mimeType:approvalRecord.mimeType,
      downloadAuthorized:true,printAuthorized:false,
      sha256:digest};
  }catch{
    return blocked("private_storage_read_failed");
  }
}
