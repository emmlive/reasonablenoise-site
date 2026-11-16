// RN-3B1C Phase 3: isolated D1/R2 adapter contract. No route or live bindings.
// Callers must supply server-authenticated subject/order and authorize their pairing.
import { verifyArtworkIntegrity } from "./dtf-artwork-integrity-rn3b1c.js";
const MAX_BYTES=15*1024*1024, TTL=15*60*1000;
const ID=/^[A-Za-z0-9_-]{8,128}$/, SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY=/^dtf-intents\/([0-9a-f-]{36})\/artwork\.png$/;
const fail=(code)=>({ok:false,code,checkoutEligible:false,productionApproved:false});
const goodId=s=>typeof s==="string"&&ID.test(s);
const goodTime=t=>Number.isSafeInteger(t)&&t>=0&&Number.isSafeInteger(t+TTL);
const goodBytes=b=>b instanceof Uint8Array&&b.length>0&&b.length<=MAX_BYTES;
const goodDeps=(db,bucket,authorize)=>db?.prepare&&bucket?.get&&bucket?.put&&bucket?.delete&&typeof authorize==="function";
async function trusted(authorize,subjectId,orderId) {
  if(!goodId(subjectId)||!goodId(orderId)) return false;
  try { return (await authorize(subjectId,orderId))===true; } catch { return false; }
}
async function inspect(bytes) {
  if(!goodBytes(bytes)) return null;
  try {
    const r=await verifyArtworkIntegrity(bytes,"artwork.png");
    return r.integrity==="raster_stream_verified"&&SHA.test(r.sha256||"")?r:null;
  } catch {return null;}
}
async function fromObject(bucket,key) {
  const o=await bucket.get(key);
  if(!o||typeof o.arrayBuffer!=="function")return null;
  const b=new Uint8Array(await o.arrayBuffer());
  return goodBytes(b)?b:null;
}
function goodRecord(r) {
  if(!r||r.version!==1||!goodId(r.intent_id)||!goodId(r.subject_id)||!goodId(r.order_id)||
    !SHA.test(r.sha256||"")||!Number.isSafeInteger(r.byte_length)||
    r.byte_length<1||r.byte_length>MAX_BYTES||!goodTime(r.created_at)||
    !Number.isSafeInteger(r.expires_at)||r.expires_at-r.created_at!==TTL||
    !["issued","consumed"].includes(r.status))return false;
  const match=KEY.exec(r.object_key||"");
  return !!match&&UUID.test(match[1])&&r.intent_id==="intent_"+match[1].replaceAll("-","");
}
const insertSQL=`INSERT INTO dtf_artwork_intents
(intent_id,version,subject_id,order_id,object_key,sha256,byte_length,created_at,expires_at,status)
VALUES (?,1,?,?,?,?,?,?,?,'issued')`;
const findSQL="SELECT * FROM dtf_artwork_intents WHERE intent_id = ?";
const consumeSQL=`UPDATE dtf_artwork_intents SET status = 'consumed', consumed_at = ?
WHERE intent_id = ? AND subject_id = ? AND order_id = ? AND object_key = ?
AND sha256 = ? AND byte_length = ? AND status = 'issued'
AND created_at <= ? AND expires_at > ?`;

// Write private object, read it back, verify *stored* bytes, then persist intent.
// An object left behind when cleanup fails is an orphan, never an authorization.
export async function createDurableArtworkIntent({db,bucket,authorize,subjectId,orderId,bytes,now=Date.now()}={}) {
  if(!goodDeps(db,bucket,authorize))return fail("MISSING_TRUSTED_ADAPTER");
  if(!goodTime(now)||!goodBytes(bytes))return fail("INVALID_INPUT");
  if(!await trusted(authorize,subjectId,orderId))return fail("UNAUTHORIZED_ORDER");
  const original=await inspect(bytes);
  if(!original)return fail("ARTWORK_NOT_VERIFIED");
  if(!globalThis.crypto?.randomUUID)return fail("SECURE_RANDOM_UNAVAILABLE");
  const uuid=crypto.randomUUID();
  if(!UUID.test(uuid))return fail("INVALID_RANDOM_ID");
  const intentId="intent_"+uuid.replaceAll("-","");
  const objectKey="dtf-intents/"+uuid+"/artwork.png";
  let wrote=false, persisted=false, cleanupFailed=false;
  try {
    await bucket.put(objectKey,bytes,{httpMetadata:{contentType:"image/png"}});
    wrote=true;
    const stored=await fromObject(bucket,objectKey);
    const checked=stored&&await inspect(stored);
    if(!checked||checked.sha256!==original.sha256||stored.byteLength!==bytes.byteLength)
      return fail("STORED_ARTWORK_MISMATCH");
    const res=await db.prepare(insertSQL).bind(
      intentId,subjectId,orderId,objectKey,checked.sha256,stored.byteLength,now,now+TTL
    ).run();
    if(res?.success!==true||res?.meta?.changes!==1)return fail("INTENT_PERSISTENCE_FAILED");
    persisted=true;
    return {ok:true,intentId,expiresAt:now+TTL,artworkIntentBound:true,
      checkoutEligible:false,productionApproved:false};
  } catch {return fail("DURABLE_ISSUE_FAILED");}
  finally {
    if(wrote&&!persisted) {
      try {await bucket.delete(objectKey);} catch {cleanupFailed=true;}
      // Cleanup failure cannot grant checkout; external sweeper must reconcile orphaned objects.
    }
  }
}

// Requires private object read; an atomic conditional SQL UPDATE is the replay fence
// shared by all D1 transactions/Workers. No long-held transaction crosses an R2 read.
export async function consumeDurableArtworkIntent({db,bucket,authorize,intentId,subjectId,orderId,now=Date.now()}={}) {
  if(!goodDeps(db,bucket,authorize))return fail("MISSING_TRUSTED_ADAPTER");
  if(!goodId(intentId)||!goodTime(now))return fail("INVALID_INPUT");
  if(!await trusted(authorize,subjectId,orderId))return fail("UNAUTHORIZED_ORDER");
  try {
    const row=await db.prepare(findSQL).bind(intentId).first();
    if(!goodRecord(row))return fail("INTENT_NOT_FOUND_OR_INVALID");
    if(row.subject_id!==subjectId||row.order_id!==orderId)return fail("UNAUTHORIZED_INTENT");
    if(row.status!=="issued")return fail("INTENT_ALREADY_USED");
    if(now<row.created_at||now>=row.expires_at)return fail("INTENT_EXPIRED");
    const bytes=await fromObject(bucket,row.object_key);
    const checked=bytes&&await inspect(bytes);
    if(!checked||checked.sha256!==row.sha256||bytes.byteLength!==row.byte_length)
      return fail("STORED_ARTWORK_MISMATCH");
    const res=await db.prepare(consumeSQL).bind(now,intentId,subjectId,orderId,
      row.object_key,checked.sha256,bytes.byteLength,now,now).run();
    if(res?.success!==true||res?.meta?.changes!==1)return fail("REPLAY_OR_CONCURRENT_CHANGE");
    return {ok:true,intentId,artworkIntentBound:true,checkoutEligible:false,productionApproved:false};
  } catch {return fail("DURABLE_CONSUME_FAILED");}
}
