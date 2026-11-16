// RN-3B1C Phase 12: immutable D1 version pin, disposable/test-only contract.
// No live route, payment, delete, cleanup, or implicit production approval.
import {verifyPinnedArtworkVersion} from "./dtf-artwork-version-rn3b1c.js";
const ID=/^[A-Za-z0-9_-]{8,128}$/;
const KEY=/^dtf-intents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/artwork\.png$/;
const SHA=/^[a-f0-9]{64}$/,VERSION=/^[A-Za-z0-9:_-]{8,256}$/;
const bad=code=>({ok:false,code,checkoutEligible:false,deletionAuthorized:false,productionApproved:false});
function identity(intentId,ref){
 const m=KEY.exec(ref?.key||"");
 return !!m&&intentId==="intent_"+m[1].replaceAll("-","")&&
 VERSION.test(ref.version||"")&&SHA.test(ref.sha256||"")&&
 Number.isSafeInteger(ref.byteLength)&&ref.byteLength>=1&&ref.byteLength<=15728640;
}
async function authorized(authorize,subjectId,orderId){
 if(typeof authorize!=="function"||!ID.test(subjectId||"")||!ID.test(orderId||""))return false;
 try{return (await authorize(subjectId,orderId))===true;}catch{return false;}
}
const findSQL="SELECT * FROM dtf_artwork_version_pins WHERE pin_id=?";
const insertSQL=`INSERT INTO dtf_artwork_version_pins
(pin_id,intent_id,subject_id,order_id,object_key,object_version,sha256,byte_length,recorded_at)
VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`;
function equalRow(row,{pinId,intentId,subjectId,orderId,reference}){
 return row?.pin_id===pinId&&row.intent_id===intentId&&row.subject_id===subjectId&&
 row.order_id===orderId&&row.object_key===reference.key&&
 row.object_version===reference.version&&row.sha256===reference.sha256&&
 row.byte_length===reference.byteLength;
}
// Explicit auth and a fresh readback are required before inserting a first version pin.
// Database uniqueness, not caller ordering, enforces one pin per order/intent/object.
// No object deletion on a failed DB insert: it might belong to a concurrent writer.
export async function bindVerifiedArtworkVersion({
 db,store,authorize,subjectId,orderId,intentId,pinId,reference,now
}={}){
 if(!db?.prepare||!store?.head||!store?.get)return bad("MISSING_TRUSTED_ADAPTER");
 if(!ID.test(pinId||"")||!ID.test(intentId||"")||!identity(intentId,reference)||
 !Number.isSafeInteger(now)||now<0)return bad("INVALID_VERSION_PIN");
 if(!await authorized(authorize,subjectId,orderId))return bad("UNAUTHORIZED_ORDER");
 const verified=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference});
 if(!verified.ok)return bad("OBJECT_VERSION_UNVERIFIED");
 try{
  const res=await db.prepare(insertSQL).bind(pinId,intentId,subjectId,orderId,
   reference.key,reference.version,reference.sha256,reference.byteLength,now).run();
  if(res?.success!==true||res?.meta?.changes!==1)return bad("PIN_ALREADY_EXISTS_OR_WRITE_REJECTED");
  // A concurrent overwrite during the DB write must not be reported as a usable pin.
  const after=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference});
  if(!after.ok)return bad("VERSION_CHANGED_AFTER_PIN");
  return {ok:true,pinId,intentId,version:reference.version,
   checkoutEligible:false,deletionAuthorized:false,productionApproved:false};
 }catch{return bad("VERSION_PIN_WRITE_FAILED");}
}
// Read trusted D1 row, check matching server-provided identity and exact R2 version.
// Read-only verifier. No checkout or cleanup authority.
export async function verifyDurableArtworkPin({
 db,store,authorize,subjectId,orderId,intentId,pinId
}={}){
 if(!db?.prepare||!store?.head||!store?.get)return bad("MISSING_TRUSTED_ADAPTER");
 if(!ID.test(pinId||"")||!ID.test(intentId||""))return bad("INVALID_VERSION_PIN");
 if(!await authorized(authorize,subjectId,orderId))return bad("UNAUTHORIZED_ORDER");
 try{
  const row=await db.prepare(findSQL).bind(pinId).first();
  if(!row||row.subject_id!==subjectId||row.order_id!==orderId||
    row.intent_id!==intentId)return bad("PIN_NOT_FOUND_OR_FOREIGN");
  const reference={key:row.object_key,version:row.object_version,
   sha256:row.sha256,byteLength:row.byte_length};
  if(!identity(intentId,reference)||!equalRow(row,{pinId,intentId,subjectId,orderId,reference}))
   return bad("PIN_RECORD_INVALID");
  const verified=await verifyPinnedArtworkVersion({store,authorize,subjectId,orderId,intentId,reference});
  if(!verified.ok)return bad("PINNED_OBJECT_CHANGED");
  return{ok:true,pinId,intentId,version:reference.version,checkoutEligible:false,
   deletionAuthorized:false,productionApproved:false};
 }catch{return bad("VERSION_PIN_READ_FAILED");}
}
