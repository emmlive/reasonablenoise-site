import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {deflateSync} from "node:zlib";
import {readFileSync} from "node:fs";
import {
 inspectPngCandidate,pendingArtworkKey,stageArtworkCandidate,
 recordPhysicalProofReview
} from "../src/lib/print-library-upload-approval-isolated.mjs";

const id = subject=>({ok:true,reason:"verified_access_assertion",
  subject,email:subject+"@example.test"});
const reviewer=id("reviewer-001"),preparer=id("preparer-001");
function u32(n){const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;}
function crc32(b){
 let c=0xffffffff;
 for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 return (c^0xffffffff)>>>0;
}
function chunk(type,data=Buffer.alloc(0)){
 const contents=Buffer.concat([Buffer.from(type),data]);
 return Buffer.concat([u32(data.length),contents,u32(crc32(contents))]);
}
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function png(width=300,height=300){
 const ihdr=Buffer.concat([u32(width),u32(height),Buffer.from([8,6,0,0,0])]);
 const scanline=Buffer.alloc(height*(1+width*4));
 // All transparent black pixels, 0 PNG filter per row.
 for(let y=0;y<height;y++)scanline[y*(1+width*4)]=0;
 return new Uint8Array(Buffer.concat([signature,chunk("IHDR",ihdr),
   chunk("IDAT",deflateSync(scanline)),chunk("IEND")]));
}
const validPng=png();
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function storage(){
 const files=new Map(),calls=[];
 return {files,calls,async put(key,data,opts){
  calls.push({key,opts});
  if(files.has(key))return null;
  if(opts?.onlyIf?.etagDoesNotMatch!=="*"||
     opts?.httpMetadata?.contentType!=="image/png")throw Error("unsafe_upload");
  files.set(key,new Uint8Array(data));return {etag:"synthetic-etag"};
 }};
}
function ledger(){
 const pending=new Map(),review=new Map();
 return {pending,review,async createPending(record){
   const key=record.id+"/"+record.version;
   if(pending.has(key)||[...pending.values()].some(x=>x.auditId===record.auditId))return false;
   pending.set(key,record);return true;
 },async appendReview(record){
   if(review.has(record.reviewId)||![...pending.values()].some(x=>
      x.auditId===record.pendingAuditId&&x.sha256===record.sha256))return false;
   review.set(record.reviewId,record);return true;
 }};
}
function args(overrides={}){
 return {adminIdentity:preparer,designId:"spirit",version:"v1",raw:validPng,
   expectedSha256:hash(validPng),privateBucket:storage(),ledger:ledger(),
   auditId:"audit_123456",...overrides};
}
function safe(r){assert.equal(r.printReady,false);assert.equal(r.downloadAuthorized,false);}
test("valid real compressed RGBA PNG with correct per-chunk CRC accepted as preliminary candidate",()=>{
 const r=inspectPngCandidate(validPng);assert.equal(r.ok,true);
 assert.equal(r.widthPx,300);assert.equal(r.heightPx,300);
 assert.equal(r.reason,"png_structure_preflight_only");
});
test("empty, oversized and non-PNG bytes rejected",()=>{
 for(const f of [undefined,new Uint8Array(0),new Uint8Array(15*1024*1024+1),
   new Uint8Array(60)]){
 assert.equal(inspectPngCandidate(f).ok,false);
 }
});
test("tampered IDAT and forged signature rejected",()=>{
 const forged=new Uint8Array(validPng);forged[0]=0;
 const tampered=new Uint8Array(validPng);tampered[tampered.length-20]^=2;
 assert.equal(inspectPngCandidate(forged).ok,false);
 assert.equal(inspectPngCandidate(tampered).ok,false);
});
test("truncated, trailing data and invalid dimensions rejected",()=>{
 const truncated=new Uint8Array(validPng.subarray(0,validPng.length-3));
 const trailer=new Uint8Array([...validPng,1,2]);
 assert.equal(inspectPngCandidate(truncated).ok,false);
 assert.equal(inspectPngCandidate(trailer).ok,false);
 assert.equal(inspectPngCandidate(png(15001,1)).ok,false);
});
test("unsupported PNG bit depth/color or critical chunks cannot be silently accepted",()=>{
 const body=Buffer.from(validPng),ihdr=Buffer.from(body.subarray(16,29));
 ihdr[8]=16;
 const bad=Buffer.concat([signature,chunk("IHDR",ihdr),
   chunk("IDAT",deflateSync(Buffer.alloc(5))),chunk("IEND")]);
 assert.equal(inspectPngCandidate(new Uint8Array(bad)).ok,false);
});
test("animated PNG acTL is rejected",()=>{
 const head=Buffer.from(validPng);
 const animated=Buffer.concat([head.subarray(0,33),chunk("acTL",Buffer.alloc(8)),head.subarray(33)]);
 assert.equal(inspectPngCandidate(new Uint8Array(animated)).ok,false);
});
test("only safe pending key with hash, version and design namespace is allowed",()=>{
 const h=hash(validPng);
 assert.equal(pendingArtworkKey({designId:"spirit",version:"v1",sha256:h}),
   "print-library/proof-pending/spirit/v1/"+h+".png");
 for(const designId of ["../../admin","Spirit","spirit/other"]){
 assert.equal(pendingArtworkKey({designId,version:"v1",sha256:h}),null);
 }
});
test("valid preliminary file is stored only under proof-pending with immutable if-none-match",async()=>{
 const a=args(),r=await stageArtworkCandidate(a);
 assert.equal(r.ok,true);safe(r);assert.equal(r.status,"proof_pending");
 assert.ok(r.proofFileKey.startsWith("print-library/proof-pending/"));
 assert.equal(a.privateBucket.files.size,1);
 assert.equal(a.ledger.pending.size,1);
 const record=[...a.ledger.pending.values()][0];
 assert.equal(record.rightsConfirmed,false);assert.equal(record.proofApproved,false);
 assert.equal(record.stagedBy,preparer.subject);
});
test("same design/version replay cannot overwrite object and never create a new ledger entry",async()=>{
 const a=args();
 assert.equal((await stageArtworkCandidate(a)).ok,true);
 const r=await stageArtworkCandidate(a);safe(r);
 assert.equal(r.ok,false);assert.equal(a.privateBucket.files.size,1);
 assert.equal(a.ledger.pending.size,1);
});
test("same version with different bytes may create orphan pending R2 but cannot change immutable ledger",async()=>{
 const a=args();assert.equal((await stageArtworkCandidate(a)).ok,true);
 const changed=png(301,300);
 const b={...a,raw:changed,expectedSha256:hash(changed),auditId:"audit_other123"};
 const r=await stageArtworkCandidate(b);safe(r);assert.equal(r.ok,false);
 assert.equal(a.ledger.pending.size,1);
 assert.equal(a.privateBucket.files.size,2); // reconciliation needed, never silently delete
});
test("unverified identity and absent backend cause no writes",async()=>{
 for(const adminIdentity of [null,{ok:false},{ok:true},{}]){
  const a=args({adminIdentity}),r=await stageArtworkCandidate(a);
  safe(r);assert.equal(r.ok,false);assert.equal(a.privateBucket.calls.length,0);
 }
});
test("mismatched SHA-256 fails before any write",async()=>{
 const a=args({expectedSha256:"b".repeat(64)});
 const r=await stageArtworkCandidate(a);safe(r);assert.equal(r.ok,false);
 assert.equal(r.reason,"checksum_mismatch");
 assert.equal(a.privateBucket.calls.length,0);
});
test("invalid audit ref, version, or unsafe design blocks writes",async()=>{
 for(const patch of [{auditId:"x"},{version:"v0"},{designId:"../orders"}]){
 const a=args(patch),r=await stageArtworkCandidate(a);
 safe(r);assert.equal(r.ok,false);assert.equal(a.privateBucket.calls.length,0);
 }
});
test("private bucket or ledger failure fails closed",async()=>{
 const a=args({privateBucket:{put:async()=>{throw Error("storage fail")}}});
 const r=await stageArtworkCandidate(a);safe(r);assert.equal(r.ok,false);
 const b=args({ledger:{createPending:async()=>{throw Error("db fail")}}});
 const bad=await stageArtworkCandidate(b);safe(bad);assert.equal(bad.ok,false);
});
test("separate reviewer may append proof review, but cannot mark it print ready",async()=>{
 const a=args();await stageArtworkCandidate(a);
 const pending=[...a.ledger.pending.values()][0];
 const r=await recordPhysicalProofReview({
 adminIdentity:preparer,reviewerIdentity:reviewer,pendingRecord:pending,
 physicalProofId:"physical_123456",rightsEvidenceId:"rights_123456",
 reviewId:"review_123456",decision:"approved_for_next_gate",ledger:a.ledger});
 assert.equal(r.ok,true);safe(r);
 assert.equal(r.reason,"proof_review_recorded_no_print_promotion");
 assert.equal(a.ledger.review.size,1);assert.equal(a.ledger.pending.size,1);
});
test("preparer may not self-approve physical proof",async()=>{
 const a=args();await stageArtworkCandidate(a);
 const pending=[...a.ledger.pending.values()][0];
 const r=await recordPhysicalProofReview({adminIdentity:preparer,reviewerIdentity:preparer,
 pendingRecord:pending,physicalProofId:"physical_123456",rightsEvidenceId:"rights_123456",
 reviewId:"review_123456",decision:"approved_for_next_gate",ledger:a.ledger});
 safe(r);assert.equal(r.ok,false);assert.equal(a.ledger.review.size,0);
});
test("no proof evidence or rights record means no review",async()=>{
 const a=args();await stageArtworkCandidate(a);
 const pending=[...a.ledger.pending.values()][0];
 for(const patch of [{physicalProofId:""},{rightsEvidenceId:""},{reviewId:"bad"},
  {decision:"print_ready"},{pendingRecord:{...pending,printReady:true}}]){
 const r=await recordPhysicalProofReview({adminIdentity:preparer,reviewerIdentity:reviewer,
 pendingRecord:pending,physicalProofId:"physical_123456",rightsEvidenceId:"rights_123456",
 reviewId:"review_123456",decision:"approved_for_next_gate",ledger:a.ledger,...patch});
 safe(r);assert.equal(r.ok,false);
 }
 assert.equal(a.ledger.review.size,0);
});
test("review replay cannot create multiple approvals",async()=>{
 const a=args();await stageArtworkCandidate(a);
 const pending=[...a.ledger.pending.values()][0];
 const opts={adminIdentity:preparer,reviewerIdentity:reviewer,pendingRecord:pending,
 physicalProofId:"physical_123456",rightsEvidenceId:"rights_123456",
 reviewId:"review_123456",decision:"rejected",ledger:a.ledger};
 assert.equal((await recordPhysicalProofReview(opts)).ok,true);
 const r=await recordPhysicalProofReview(opts);safe(r);assert.equal(r.ok,false);
 assert.equal(a.ledger.review.size,1);
});
test("no live endpoint, no Stripe, no mail, no deletion or print-ready promotion",()=>{
 const source=readFileSync(new URL("../src/lib/print-library-upload-approval-isolated.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/onRequestGet|onRequestPost|checkout\.sessions|RESEND_API_KEY|STRIPE_SECRET_KEY|\.delete\(|\/api\/admin/);
 assert.match(source,/proof_pending/);
 assert.match(source,/printReady:false/);
});
