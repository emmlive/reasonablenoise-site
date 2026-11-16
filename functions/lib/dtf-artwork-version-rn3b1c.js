// RN-3B1C Phase 10: isolated contract for an external, truly atomic write-once
// private object adapter. NOT wired to real R2, customer endpoints or cleanup.
// R2 version tokens and conditional-create semantics require independent proof.
import {verifyArtworkIntegrity} from "./dtf-artwork-integrity-rn3b1c.js";
const KEY=/^dtf-intents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/artwork\.png$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX=15*1024*1024;
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const TOKEN=/^[A-Za-z0-9:_-]{8,256}$/;
const fail=code=>({ok:false,code,artworkImmutable:false,deletionAuthorized:false,checkoutEligible:false,productionApproved:false});
const goodBytes=b=>b instanceof Uint8Array&&b.byteLength>0&&b.byteLength<=MAX;
const identity=(key,intentId)=>{const m=KEY.exec(key||"");return !!m&&intentId==="intent_"+m[1].replaceAll("-","");};
const versionOK=v=>typeof v==="string"&&TOKEN.test(v);
async function checked(bytes){
 if(!goodBytes(bytes))return null;
 try {
  const result=await verifyArtworkIntegrity(bytes,"artwork.png");
  return result.integrity==="raster_stream_verified"&&SHA.test(result.sha256||"")?result:null;
 }catch{return null;}
}
async function authorized(authorize,subjectId,orderId){
 if(typeof authorize!=="function"||!ID.test(subjectId||"")||!ID.test(orderId||""))return false;
 try{return (await authorize(subjectId,orderId))===true;}catch{return false;}
}
function pinned(metadata,key){
 return metadata&&metadata.key===key&&versionOK(metadata.version)&&
  SHA.test(metadata.sha256||"")&&Number.isSafeInteger(metadata.byteLength)&&
  metadata.byteLength>0&&metadata.byteLength<=MAX;
}
async function snapshot(store,key){
 const before=await store.head(key);
 if(!pinned(before,key))return null;
 const body=await store.get(key);
 if(!body||typeof body.arrayBuffer!=="function")return null;
 const bytes=new Uint8Array(await body.arrayBuffer());
 const actual=await checked(bytes);
 if(!actual||bytes.byteLength!==before.byteLength||actual.sha256!==before.sha256)return null;
 const after=await store.head(key);
 if(!pinned(after,key)||after.version!==before.version||after.sha256!==before.sha256||
   after.byteLength!==before.byteLength)return null;
 return {key,version:before.version,sha256:actual.sha256,byteLength:bytes.byteLength};
}
// Caller must provide trusted adapter with an ATOMIC putIfAbsent implementation:
// preflight head()+put() is NOT equivalent and must never be used for this contract.
// Returns no deletion or checkout authority, even on success.
export async function stageWriteOnceArtwork({
 store,authorize,subjectId,orderId,intentId,key,bytes
}={}){
 if(!store||typeof store.putIfAbsent!=="function"||typeof store.get!=="function"||
   typeof store.head!=="function")return fail("WRITE_ONCE_ADAPTER_REQUIRED");
 if(!identity(key,intentId))return fail("INVALID_PRIVATE_OBJECT_IDENTITY");
 if(!await authorized(authorize,subjectId,orderId))return fail("UNAUTHORIZED_ORDER");
 const original=await checked(bytes);
 if(!original)return fail("ARTWORK_NOT_VERIFIED");
 try{
  // A duplicate or uncertain result is rejection; we do not delete any object.
  const created=await store.putIfAbsent(key,bytes,{
   contentType:"image/png",sha256:original.sha256,byteLength:bytes.byteLength
  });
  if(created?.created!==true||!versionOK(created.version))
   return fail("OBJECT_EXISTS_OR_WRITE_UNCONFIRMED");
  const current=await snapshot(store,key);
  if(!current||current.version!==created.version||current.sha256!==original.sha256||
    current.byteLength!==bytes.byteLength)return fail("VERSION_OR_CONTENT_CHANGED");
  return {ok:true,objectRef:current,artworkImmutable:false,
   deletionAuthorized:false,checkoutEligible:false,productionApproved:false};
 }catch{return fail("WRITE_ONCE_STORAGE_FAILURE");}
}
// Read-only: checks exact trusted reference against HEAD, decoded PNG, and
// another HEAD. It does not lock the object or prove future immutability.
export async function verifyPinnedArtworkVersion({
 store,authorize,subjectId,orderId,intentId,reference
}={}){
 if(!store||typeof store.get!=="function"||typeof store.head!=="function")
  return fail("VERSION_ADAPTER_REQUIRED");
 if(!reference||!identity(reference.key,intentId)||!pinned(reference,reference.key))
  return fail("INVALID_VERSION_REFERENCE");
 if(!await authorized(authorize,subjectId,orderId))return fail("UNAUTHORIZED_ORDER");
 try{
  const current=await snapshot(store,reference.key);
  if(!current||current.version!==reference.version||current.sha256!==reference.sha256||
     current.byteLength!==reference.byteLength)return fail("VERSION_OR_CONTENT_CHANGED");
  return {ok:true,objectRef:current,artworkImmutable:false,
    deletionAuthorized:false,checkoutEligible:false,productionApproved:false};
 }catch{return fail("VERSION_VERIFICATION_FAILED");}
}
