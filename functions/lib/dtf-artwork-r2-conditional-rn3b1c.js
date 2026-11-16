// RN-3B1C Phase 11: test-only bridge from local R2 Worker binding to
// Phase 10 write-once contract. Not a deployed production storage adapter.
// Cloudflare R2 documentation supports onlyIf: Headers("If-None-Match: *").
// Its conditional put returns null if object exists; R2Object.version identifies upload.
const TOKEN=/^[A-Za-z0-9:_-]{8,256}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX=15*1024*1024;
function headRef(o,key){
 if(!o||o.key!==key||!TOKEN.test(o.version||"")||
   !Number.isSafeInteger(o.size)||o.size<1||o.size>MAX)return null;
 const sha256=o.customMetadata?.rnSha256, byteLength=Number(o.customMetadata?.rnByteLength);
 if(!SHA.test(sha256||"")||!Number.isSafeInteger(byteLength)||byteLength!==o.size)return null;
 return {key,version:o.version,sha256,byteLength};
}
export function createLocalR2WriteOnceAdapter(bucket){
 if(!bucket?.put||!bucket?.head||!bucket?.get)return null;
 return {
  async putIfAbsent(key,bytes,{sha256,byteLength,contentType}={}){
   if(!SHA.test(sha256||"")||!Number.isSafeInteger(byteLength)||byteLength!==bytes?.byteLength||
     contentType!=="image/png")return {created:false};
   const headers=new Headers({"If-None-Match":"*"});
   const stored=await bucket.put(key,bytes,{
    onlyIf:headers,
    httpMetadata:{contentType:"image/png"},
    customMetadata:{rnSha256:sha256,rnByteLength:String(byteLength)}
   });
   if(!stored)return {created:false};
   return {created:true,version:stored.version};
  },
  async head(key){return headRef(await bucket.head(key),key);},
  async get(key){return bucket.get(key);}
 };
}
// No R2 delete/list and no receipt/checkout endpoint is created.
