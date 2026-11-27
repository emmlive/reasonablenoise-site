// ReasonableNoise — isolated Print Artwork Library upload/proof gate.
// UNMOUNTED: no Cloudflare Pages route, no public endpoint, no live R2 writes.
// Only accepts PNG as a preliminary artwork candidate. Structural checks
// are NOT malware screening, full PNG decoding, or physical print approval.
const ENC = new TextEncoder();
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const PATH_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^v[1-9][0-9]*$/;
const HEX = /^[a-f0-9]{64}$/;
const AUDIT_REF = /^[a-zA-Z0-9_-]{8,80}$/;
const bytesToHex = bytes => Array.from(bytes, x => x.toString(16).padStart(2,"0")).join("");

function crc32(bytes) {
  let crc=0xffffffff;
  for(const value of bytes) {
    crc ^= value;
    for(let i=0;i<8;i++)crc = (crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
const u32 = (bytes,at) => (bytes[at]*0x1000000 + (bytes[at+1]<<16) +
  (bytes[at+2]<<8) + bytes[at+3])>>>0;
const pngSignature = [137,80,78,71,13,10,26,10];

export function inspectPngCandidate(raw) {
  if(!(raw instanceof Uint8Array)||raw.byteLength<45||raw.byteLength>MAX_BYTES)
    return {ok:false,reason:"invalid_file_size_or_type"};
  if(!pngSignature.every((v,i)=>raw[i]===v))
    return {ok:false,reason:"invalid_png_signature"};
  let pos=8,chunkCount=0,seenIHDR=false,seenIDAT=false,seenIEND=false;
  let width=0,height=0,bitDepth=0,colorType=0,seenACTL=false;
  while(pos<raw.byteLength) {
    if(pos+12>raw.byteLength)return {ok:false,reason:"truncated_png_chunk"};
    const size=u32(raw,pos),start=pos+8,end=start+size;
    if(size>MAX_BYTES||end+4>raw.byteLength)return {ok:false,reason:"oversized_png_chunk"};
    const type=String.fromCharCode(...raw.subarray(pos+4,pos+8));
    if(!/^[A-Za-z]{4}$/.test(type))return {ok:false,reason:"invalid_png_chunk_type"};
    const actualCRC=u32(raw,end),expectedCRC=crc32(raw.subarray(pos+4,end));
    if(actualCRC!==expectedCRC)return {ok:false,reason:"png_crc_mismatch"};
    chunkCount++;
    if(chunkCount>10000)return {ok:false,reason:"excessive_png_chunks"};
    if(!seenIHDR&&type!=="IHDR")return {ok:false,reason:"missing_initial_ihdr"};
    if(type==="IHDR") {
      if(seenIHDR||size!==13)return {ok:false,reason:"invalid_ihdr"};
      seenIHDR=true;
      width=u32(raw,start);height=u32(raw,start+4);
      bitDepth=raw[start+8];colorType=raw[start+9];
      if(width<1||height<1||width>15000||height>15000||width*height>MAX_PIXELS ||
         bitDepth!==8||![2,6].includes(colorType)||
         raw[start+10]!==0||raw[start+11]!==0||raw[start+12]!==0)
         return {ok:false,reason:"unsupported_png_format"};
    } else if(type==="acTL"||type==="fcTL"||type==="fdAT") {
      seenACTL=true;
    } else if(type==="IDAT") {
      if(size<1)return {ok:false,reason:"empty_png_idat"};
      seenIDAT=true;
    } else if(type==="IEND") {
      if(size!==0||!seenIDAT||end+4!==raw.byteLength)return {ok:false,reason:"invalid_png_end"};
      seenIEND=true;
      break;
    } else if(type[0]===type[0].toUpperCase() &&
      !["PLTE"].includes(type)) {
      // No unknown critical chunk may be silently interpreted as print-ready.
      return {ok:false,reason:"unsupported_critical_chunk"};
    }
    pos=end+4;
  }
  if(!seenIEND||seenACTL)return {ok:false,reason:"missing_end_or_animated_png"};
  return {ok:true,reason:"png_structure_preflight_only",widthPx:width,heightPx:height,
    mimeType:"image/png",sizeBytes:raw.byteLength};
}

const deny=reason=>({ok:false,reason,printReady:false,uploadApproved:false,
  downloadAuthorized:false});
function safeIdentity(identity) {
 return identity?.ok===true && identity?.reason==="verified_access_assertion" &&
  typeof identity.subject==="string" && identity.subject.length>0 &&
  typeof identity.email==="string" && identity.email.includes("@");
}
export function pendingArtworkKey({designId,version,sha256}) {
  if(!PATH_ID.test(String(designId||""))||
     !VERSION.test(String(version||""))||
     !HEX.test(String(sha256||"")))return null;
  return "print-library/proof-pending/"+designId+"/"+version+"/"+sha256+".png";
}
export async function stageArtworkCandidate({
  adminIdentity,designId,version,raw,expectedSha256,
  privateBucket,ledger,auditId
}={}) {
  if(!safeIdentity(adminIdentity)||!privateBucket||typeof privateBucket.put!=="function"||
     !ledger||typeof ledger.createPending!=="function"||
     !AUDIT_REF.test(String(auditId||"")))
    return deny("unverified_admin_or_unavailable_isolated_backend");
  const info=inspectPngCandidate(raw);
  if(!info.ok)return deny(info.reason);
  const sha256=bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",raw)));
  if(sha256!==expectedSha256)return deny("checksum_mismatch");
  const key=pendingArtworkKey({designId,version,sha256});
  if(!key)return deny("invalid_artwork_identity");
  const payload=Object.freeze({
    id:designId,version,sha256,proofFileKey:key,status:"proof_pending",
    printReady:false,proofApproved:false,rightsConfirmed:false,
    widthPx:info.widthPx,heightPx:info.heightPx,sizeBytes:info.sizeBytes,
    mimeType:info.mimeType,stagedBy:adminIdentity.subject,auditId
  });
  try {
    // No overwrite. For R2, onlyIf etagDoesNotMatch "*" is an atomic write precondition.
    const putResult=await privateBucket.put(key,raw,{
      onlyIf:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"image/png"},
      customMetadata:{sha256,artworkVersion:version}
    });
    if(!putResult)return deny("immutable_object_already_exists");
    const wrote=await ledger.createPending(payload);
    if(wrote!==true)return deny("pending_ledger_conflict_or_failure");
    return {ok:true,reason:"staged_for_proof_only",status:"proof_pending",
      designId,version,sha256,proofFileKey:key,printReady:false,
      uploadApproved:false,downloadAuthorized:false};
  } catch {
    // Failed metadata insert might leave an orphan immutable staging blob.
    // Never delete it automatically; reconciliation must be separately audited.
    return deny("isolated_storage_or_ledger_failure");
  }
}

// Proof approval DOES NOT promote files to print-ready. It only appends a
// human-attested review decision with a distinct reviewer and specific
// physical proof reference. A later separate gate must verify content,
// immutable approved R2 version, rights, print specs and order association.
export async function recordPhysicalProofReview({
  adminIdentity,pendingRecord,reviewerIdentity,physicalProofId,
  rightsEvidenceId,reviewId,ledger,decision
}={}) {
  if(!safeIdentity(adminIdentity)||!safeIdentity(reviewerIdentity)||
     adminIdentity.subject===reviewerIdentity.subject||
     !pendingRecord||pendingRecord.status!=="proof_pending"||
     pendingRecord.printReady!==false||
     !AUDIT_REF.test(String(physicalProofId||""))||
     !AUDIT_REF.test(String(rightsEvidenceId||""))||
     !AUDIT_REF.test(String(reviewId||""))||
     !["approved_for_next_gate","rejected"].includes(decision)||
     !ledger||typeof ledger.appendReview!=="function")
    return deny("invalid_proof_review_request");
  if(!pendingArtworkKey({designId:pendingRecord.id,
    version:pendingRecord.version,sha256:pendingRecord.sha256})||
    pendingRecord.proofFileKey!==pendingArtworkKey({
      designId:pendingRecord.id,version:pendingRecord.version,
      sha256:pendingRecord.sha256}))return deny("pending_file_identity_mismatch");
  const review=Object.freeze({
    reviewId,pendingAuditId:pendingRecord.auditId,
    designId:pendingRecord.id,version:pendingRecord.version,
    sha256:pendingRecord.sha256,physicalProofId,rightsEvidenceId,
    decision,reviewerId:reviewerIdentity.subject,
    status:"proof_review_recorded",printReady:false
  });
  try {
    if(await ledger.appendReview(review)!==true)
      return deny("review_ledger_conflict_or_failure");
    return {ok:true,reason:"proof_review_recorded_no_print_promotion",
      reviewId,decision,status:"proof_review_recorded",printReady:false,
      downloadAuthorized:false};
  } catch {
    return deny("review_ledger_failure");
  }
}
