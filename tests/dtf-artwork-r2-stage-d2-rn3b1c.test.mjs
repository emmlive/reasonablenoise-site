// RN-3B1C Phase 11 D2: local-only stage boundary diagnostic; no live R2.
import test from "node:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {deflateSync} from "node:zlib";
import {createLocalR2WriteOnceAdapter} from "../functions/lib/dtf-artwork-r2-conditional-rn3b1c.js";
import {stageWriteOnceArtwork} from "../functions/lib/dtf-artwork-version-rn3b1c.js";
const root=process.env.RN_MINIFLARE_ROOT;
if(!root)throw Error("RN_MINIFLARE_ROOT_REQUIRED");
const {Miniflare}=await import(pathToFileURL(resolve(root,"node_modules","miniflare","dist","src","index.js")).href);
const uuid="12345678-1234-4234-8234-123456789abc",key="dtf-intents/"+uuid+"/artwork.png",intentId="intent_"+uuid.replaceAll("-","");
const u32=n=>Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);
function crc(arr){let c=0xffffffff;for(const b of arr){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const t=Buffer.from(type);return Buffer.concat([u32(data.length),t,data,u32(crc(Buffer.concat([t,data])))]);}
const bytes=Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",Buffer.concat([u32(1),u32(1),Buffer.from([8,6,0,0,0])])),chunk("IDAT",deflateSync(Buffer.from([0,0,0,0,255]))),chunk("IEND")]));
function safe(err){return String(err?.name||"Error")+": "+String(err?.message||"unknown").slice(0,350);}
test("D2 trace first local R2 conditional create and pinned snapshot",async t=>{
 const mf=new Miniflare({modules:true,script:"export default {async fetch(){return new Response('LOCAL_ONLY')}}",compatibilityDate:"2026-08-01",r2Buckets:{TEST_R2:"rn3b1c-phase11-stage-d2-disposable"}});
 t.after(async()=>mf.dispose());
 const bucket=await mf.getR2Bucket("TEST_R2");
 const adapter=createLocalR2WriteOnceAdapter(bucket);
 const calls=[];
 const store={
  async putIfAbsent(...args){
   calls.push("put:start");
   try{const r=await adapter.putIfAbsent(...args);calls.push("put:"+(r?.created===true?"created":"not-created"));return r;}
   catch(e){calls.push("put:throw:"+safe(e));throw e;}
  },
  async head(...args){
   calls.push("head:start");
   try{const r=await adapter.head(...args);calls.push("head:"+(r?"valid":"invalid"));return r;}
   catch(e){calls.push("head:throw:"+safe(e));throw e;}
  },
  async get(...args){
   calls.push("get:start");
   try{const r=await adapter.get(...args);calls.push("get:"+(r?"found":"missing"));return r;}
   catch(e){calls.push("get:throw:"+safe(e));throw e;}
  }
 };
 const result=await stageWriteOnceArtwork({store,authorize:async()=>true,subjectId:"subject_12345678",orderId:"order_12345678",intentId,key,bytes});
 console.log("D2_CALLS="+JSON.stringify(calls));
 console.log("D2_STAGE_CODE="+(result.ok?"OK":result.code));
 const raw=await bucket.head(key);
 console.log("D2_RAW_HEAD="+JSON.stringify({found:!!raw,versionType:typeof raw?.version,versionLength:raw?.version?.length,size:raw?.size,metaKeys:Object.keys(raw?.customMetadata||{})}));
 assert.equal(result.ok,true,JSON.stringify(result));
});
