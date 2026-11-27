import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PRINT_ARTWORK_CONCEPTS,validApprovedPrintArtwork,displayPrintArtworkStatus} from "../src/lib/print-artwork-catalog.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const admin=read("src/pages/admin-orders.astro");
const valid={
 id:"spirit",version:"v1",status:"print_ready",printReady:true,rightsConfirmed:true,
 proofApproved:true,approverId:"approved-admin",approvedAt:"2026-11-27T22:00:00Z",
 sha256:"a".repeat(64),proofId:"proof_12345",widthPx:3600,heightPx:4200,
 printWidthInches:12,printHeightInches:14,mimeType:"image/png",
 printFileR2Key:"print-library/approved/spirit/v1/artwork_123456.png"
};
test("six current artwork concepts stay explicitly unapproved",()=>{
 assert.equal(PRINT_ARTWORK_CONCEPTS.length,6);
 assert.deepEqual(PRINT_ARTWORK_CONCEPTS.map(x=>x.id),
 ["spirit","legends","victory","ambition","forest-club","sunset-pals"]);
 for(const x of PRINT_ARTWORK_CONCEPTS){
  assert.equal(x.status,"concept");
  assert.equal(x.printReady,false);
  assert.equal(x.downloadAllowed,false);
  assert.equal(x.printFileR2Key,null);
  assert.equal(x.sha256,null);
  assert.equal(x.proofId,null);
  assert.equal(displayPrintArtworkStatus(x),"Concept — not printable");
  assert.equal(validApprovedPrintArtwork(x),false);
 }
});
test("approved print asset requires full proof, rights, hash and versioned R2 identity",()=>{
 assert.equal(validApprovedPrintArtwork(valid),true);
 assert.equal(displayPrintArtworkStatus(valid),"Print ready");
});
test("rejected: wrong, pending, or concept statuses",()=>{
 for(const status of ["concept","proof_pending","unknown",null]){
  assert.equal(validApprovedPrintArtwork({...valid,status}),false);
 }
});
test("rejected: all incomplete rights and physical proof checks",()=>{
 for(const patch of [{rightsConfirmed:false},{proofApproved:false},
   {approverId:null},{approvedAt:null},{proofId:null},{proofId:"bad id"}]){
  assert.equal(validApprovedPrintArtwork({...valid,...patch}),false);
 }
});
test("rejected: missing, malformed or nonspecific hash",()=>{
 for(const hash of [null,"","z".repeat(64),"a".repeat(63),"abc"]){
  assert.equal(validApprovedPrintArtwork({...valid,sha256:hash}),false);
 }
});
test("rejected: unsafe R2 traversal, wrong namespace or another design",()=>{
 for(const k of ["../../customer.svg","orders/2026/11/file.png",
   "print-library/approved/legends/v1/artwork_123456.png",
   "print-library/approved/spirit/v2/artwork_123456.png",
   "print-library/approved/spirit/v1/../../secret.pdf"]){
  assert.equal(validApprovedPrintArtwork({...valid,printFileR2Key:k}),false);
 }
});
test("rejected: missing image dimensions and physical print sizes",()=>{
 for(const patch of [{widthPx:0},{heightPx:-5},{widthPx:1.5},
   {printWidthInches:0},{printHeightInches:NaN}]){
  assert.equal(validApprovedPrintArtwork({...valid,...patch}),false);
 }
});
test("rejected: SVG concept is not an approved production-format file",()=>{
 assert.equal(validApprovedPrintArtwork({...valid,mimeType:"image/svg+xml"}),false);
 assert.equal(validApprovedPrintArtwork({...valid,printFileR2Key:"print-library/approved/spirit/v1/artwork.svg"}),false);
});
test("rejected: unsafe versions, ids or mismatched paths",()=>{
 for(const patch of [{id:"../spirit"},{version:"concept-v1"},{version:"v0"},{id:"SPIRIT"}]){
  assert.equal(validApprovedPrintArtwork({...valid,...patch}),false);
 }
});
test("proof-pending status always displays as not printable",()=>{
 assert.equal(displayPrintArtworkStatus({status:"proof_pending"}),"Proof pending — not printable");
});
test("admin dashboard shows print library and all concepts locked",()=>{
 assert.match(admin,/Print Artwork Library/);
 assert.match(admin,/PRINT_ARTWORK_CONCEPTS\.map/);
 assert.match(admin,/Print download locked/);
 assert.match(admin,/type="button" disabled/);
 assert.match(admin,/0 approved print files/);
});
test("admin library preview does not add file download or upload powers",()=>{
 assert.doesNotMatch(admin,/api\/admin-print-artwork|api\/print-artwork/);
 assert.match(admin,/printFileR2Key|private R2 approval-and-download API/);
});
test("admin baseline still loads existing order backend",()=>{
 assert.match(admin,/\/api\/admin-orders\?limit=50/);
 assert.match(admin,/Cloudflare Access/);
});
test("print library model is pure and has no network/provider capability",()=>{
 const model=read("src/lib/print-artwork-catalog.mjs");
 assert.doesNotMatch(model,/fetch\(|\.get\(|\.put\(|\.delete\(|sk_live_|ARTWORK_BUCKET|process\.env|onRequestPost|onRequestGet/);
});
