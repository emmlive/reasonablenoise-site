// RN-3B1C Phase 11 D1 — isolated diagnostic. No live R2 / secrets.
import test from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const key="dtf-intents/12345678-1234-4234-8234-123456789abc/artwork.png";
const tiny=new Uint8Array([1,2,3,4]);
function detail(err){return String(err?.name||"Error")+": "+String(err?.message||"no message").slice(0,400);}
test("D1 local R2 verify R2Conditional POJO put/head/get and duplicate rejection",async t=>{
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('TEST_ONLY')}}",compatibilityDate:"2026-08-01",r2Buckets:{TEST_R2:"rn3b1c-phase11-diagnostic-disposable"}});
 t.after(async()=>mf.dispose());
 const bucket=await mf.getR2Bucket("TEST_R2");
 let result;
 try{
  result=await bucket.put(key,tiny,{onlyIf:{etagDoesNotMatch:"*"},customMetadata:{rnSha256:"a".repeat(64),rnByteLength:"4"},httpMetadata:{contentType:"image/png"}});
 }catch(err){assert.fail("CONDITIONAL_PUT_THROW: "+detail(err));}
 assert.ok(result,"CONDITIONAL_PUT_RETURNED_NULL_FOR_ABSENT_KEY");
 console.log("D1_CONDITIONAL_PUT_VERSION_TYPE="+typeof result.version);
 let meta;
 try{meta=await bucket.head(key);}catch(err){assert.fail("HEAD_THROW: "+detail(err));}
 assert.ok(meta,"HEAD_NULL_AFTER_PUT");
 console.log("D1_HEAD_VERSION_TYPE="+typeof meta.version);
 console.log("D1_HEAD_CUSTOM_METADATA_KEYS="+Object.keys(meta.customMetadata||{}).sort().join(","));
 let obj;
 try{obj=await bucket.get(key);}catch(err){assert.fail("GET_THROW: "+detail(err));}
 assert.ok(obj,"GET_NULL_AFTER_PUT");
 try{assert.deepEqual(Array.from(new Uint8Array(await obj.arrayBuffer())),Array.from(tiny));}
 catch(err){assert.fail("ARRAYBUFFER_OR_BYTES: "+detail(err));}
 let second;
 try{second=await bucket.put(key,tiny,{onlyIf:{etagDoesNotMatch:"*"}});}
 catch(err){assert.fail("SECOND_CONDITIONAL_PUT_THROW: "+detail(err));}
 assert.equal(second,null,"DUPLICATE_CONDITIONAL_PUT_SHOULD_RETURN_NULL");
});
