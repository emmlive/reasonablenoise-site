// RN print library preview: catalog metadata only, NOT approved production files.
// No R2 access, authorization, remote writes, downloads or fulfillment authority.
// Only signed-off and versioned R2 artwork may be marked ready in a later gate.
const concepts=Object.freeze([
 {id:"spirit",name:"Spirit",collection:"Varsity"},
 {id:"legends",name:"Legends",collection:"Varsity"},
 {id:"victory",name:"Victory",collection:"Varsity"},
 {id:"ambition",name:"Ambition",collection:"Varsity"},
 {id:"forest-club",name:"Forest Club",collection:"Creative"},
 {id:"sunset-pals",name:"Sunset Pals",collection:"Creative"}
]);
export const PRINT_ARTWORK_CONCEPTS=Object.freeze(concepts.map(x=>Object.freeze({
 ...x,status:"concept",version:"concept-v1",
 previewPath:"/shirt-concepts/"+x.id+".svg",
 printReady:false,downloadAllowed:false,
 printFileR2Key:null,sha256:null,approvedAt:null,
 proofId:null
})));
export function validApprovedPrintArtwork(record){
  if(!record || typeof record!=="object" || Array.isArray(record) ||
     record.status!=="print_ready" ||
     record.printReady!==true ||
     record.rightsConfirmed!==true ||
     record.proofApproved!==true ||
     !/^[a-zA-Z0-9_-]{3,100}$/.test(String(record.approverId||"")) ||
     typeof record.approvedAt!=="string" ||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(record.approvedAt) ||
     !Number.isFinite(Date.parse(record.approvedAt)) ||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(record.id||"")) ||
     !/^v[1-9][0-9]*$/.test(String(record.version||"")) ||
     !/^[a-f0-9]{64}$/.test(String(record.sha256||"")) ||
     !/^[a-zA-Z0-9_-]{6,64}$/.test(String(record.proofId||"")) ||
     !Number.isSafeInteger(record.widthPx)||record.widthPx<1 ||
     !Number.isSafeInteger(record.heightPx)||record.heightPx<1 ||
     !Number.isFinite(record.printWidthInches)||record.printWidthInches<=0 ||
     !Number.isFinite(record.printHeightInches)||record.printHeightInches<=0 ||
     !["image/png","image/tiff","application/pdf"].includes(record.mimeType) ||
     typeof record.printFileR2Key!=="string" ||
     !/^print-library\/approved\/[a-z0-9-]+\/v[1-9][0-9]*\/[a-zA-Z0-9_-]+\.(?:png|tiff|pdf)$/.test(record.printFileR2Key) ||
     !record.printFileR2Key.includes("/"+record.id+"/"+record.version+"/")) return false;
  const ext=record.printFileR2Key.split(".").pop();
  const mimeByExt={png:"image/png",tiff:"image/tiff",pdf:"application/pdf"};
  if(mimeByExt[ext]!==record.mimeType)return false;
  return true;
}
export function displayPrintArtworkStatus(record){
 if(validApprovedPrintArtwork(record))return "Print ready";
 if(record?.status==="proof_pending")return "Proof pending — not printable";
 return "Concept — not printable";
}
