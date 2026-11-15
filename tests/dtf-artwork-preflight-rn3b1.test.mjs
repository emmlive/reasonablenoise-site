import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectArtworkBytes, MAX_ARTWORK_BYTES } from "../functions/lib/dtf-artwork-preflight.js";
import { onRequestPost, onRequestGet } from "../functions/api/dtf-artwork-preflight.js";

function png(width, height, colorType = 6) {
  const b = new Uint8Array(33);
  b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const d = new DataView(b.buffer);
  d.setUint32(16,width);d.setUint32(20,height);b[24]=8;b[25]=colorType;
  return b;
}
function jpeg(width,height) {
  const b = new Uint8Array([255,216,255,192,0,17,8,0,0,0,0,3,1,17,0,2,17,1,3,17,1,255,217]);
  const d = new DataView(b.buffer);
  d.setUint16(7,height);d.setUint16(9,width);
  return b;
}
function webp(width,height) {
  const b = new Uint8Array(30);
  b.set([82,73,70,70,22,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0]);
  const w = width - 1, h = height - 1;
  b[24]=w&255;b[25]=(w>>>8)&255;b[26]=(w>>>16)&255;
  b[27]=h&255;b[28]=(h>>>8)&255;b[29]=(h>>>16)&255;
  return b;
}
function inspect(bytes,filename,widthInches="10.5",heightInches="11") {
  return inspectArtworkBytes(bytes,{filename,widthInches,heightInches,declaredSize:bytes.length});
}

test("300dpi PNG header passes metadata checks but never approves production or checkout", () => {
  const r=inspect(png(3150,3300),"artwork.png");
  assert.equal(r.status,"technical_pass");
  assert.equal(r.effectiveDpi,300);
  assert.equal(r.transparency,"alpha_channel_present");
  assert.equal(r.fullImageDecoded,false);
  assert.equal(r.canAutoCheckout,false);
  assert.equal(r.productionApproved,false);
});
test("PNG insufficient pixels triggers a review warning", () => {
  const r=inspect(png(800,800),"small.png");
  assert.equal(r.status,"review_recommended");
  assert.deepEqual(r.codes,["LOW_RESOLUTION"]);
  assert.equal(r.canAutoCheckout,false);
});
test("PNG 200dpi triggers below-target review", () => {
  const r=inspect(png(2100,2200),"medium.png");
  assert.deepEqual(r.codes,["BELOW_TARGET_RESOLUTION"]);
});
test("valid dimension JPEG requires review-free header but never declares transparency", () => {
  const r=inspect(jpeg(3600,3600),"artwork.jpeg");
  assert.equal(r.status,"technical_pass");
  assert.equal(r.transparency,"not_supported");
});
test("valid WebP VP8X dimensions can be detected conservatively", () => {
  const r=inspect(webp(3150,3300),"artwork.webp");
  assert.equal(r.status,"technical_pass");
  assert.equal(r.pixelWidth,3150);
});
test("extension spoofing cannot pass PNG preflight", () => {
  const r=inspect(new Uint8Array([1,2,3,4,5]),"fake.png");
  assert.equal(r.status,"cannot_print");
  assert.deepEqual(r.codes,["UNREADABLE_OR_MISMATCHED_RASTER_HEADER"]);
});
test("truncated and malformed raster headers fail closed", () => {
  assert.equal(inspect(png(0,100),"bad.png").status,"cannot_print");
  assert.equal(inspect(new Uint8Array([255,216,255,192,0]),"bad.jpg").status,"cannot_print");
  const badWebp=webp(3150,3300);badWebp[4]=21;
  assert.equal(inspect(badWebp,"bad.webp").status,"cannot_print");
});
test("PDF SVG AI EPS PSD are specialist review, not automatic raster approvals", () => {
  for(const ext of ["pdf","svg","ai","eps","psd"]) {
    const r=inspect(new Uint8Array([37,80,68,70]),"print."+ext);
    assert.equal(r.status,"review_recommended");
    assert.equal(r.imageDimensionsVerified,false);
    assert.equal(r.canAutoCheckout,false);
  }
});
test("unsupported extensions and invalid dimensions are blocking", () => {
  assert.deepEqual(inspect(new Uint8Array([1,2,3]),"test.exe").codes,["UNSUPPORTED_FORMAT"]);
  assert.deepEqual(inspect(png(3150,3300),"test.png",0,11).codes,["INVALID_PRINT_DIMENSIONS"]);
  assert.deepEqual(inspect(png(3150,3300),"test.png","abc",11).codes,["INVALID_PRINT_DIMENSIONS"]);
});
test("max-file bound and declared-byte mismatch are blocking", () => {
  assert.deepEqual(inspectArtworkBytes(new Uint8Array(1),{filename:"a.png",widthInches:10,heightInches:10,declaredSize:2}).codes,["INVALID_FILE_SIZE"]);
  assert.deepEqual(inspectArtworkBytes(new Uint8Array(MAX_ARTWORK_BYTES+1),{filename:"a.png",widthInches:10,heightInches:10}).codes,["INVALID_FILE_SIZE"]);
});

function request(file=png(3150,3300),opts={}) {
  const f=new FormData();
  f.set("artwork",new File([file],opts.filename||"artwork.png",{type:"image/png"}));
  f.set("widthInches",String(opts.widthInches??"10.5"));
  f.set("heightInches",String(opts.heightInches??"11"));
  if (!opts.noToken) f.set("cf-turnstile-response","synthetic-valid-token");
  return new Request("https://reasonablenoise.com/api/dtf-artwork-preflight",{method:"POST",body:f});
}
async function run(opts={}) {
  const original=globalThis.fetch;
  const out=[];
  globalThis.fetch=async (url,init)=>{
    out.push({url:String(url),params:new URLSearchParams(init.body)});
    if(opts.networkError) throw new Error("simulated provider error; never return this");
    return Response.json({
      success:opts.success??true,
      action:opts.action??"dtf_preflight",
      hostname:opts.hostname??"reasonablenoise.com"
    },{status:opts.httpStatus??200});
  };
  try {
    const env=opts.env??{DTF_TURNSTILE_SECRET:"synthetic-secret",ARTWORK_BUCKET:{put(){throw Error("Forbidden write");}},RESEND_API_KEY:"forbidden",STRIPE_SECRET_KEY:"forbidden"};
    const response=await onRequestPost({request:request(opts.bytes||png(3150,3300),opts),env});
    return {status:response.status,body:await response.json(),out};
  } finally {globalThis.fetch=original;}
}
test("secure preflight sends Siteverify with correct secret and action only, no R2 or Stripe", async () => {
  const r=await run();
  assert.equal(r.status,200);
  assert.equal(r.body.report.status,"technical_pass");
  assert.equal(r.body.report.canAutoCheckout,false);
  assert.equal(r.out.length,1);
  assert.equal(r.out[0].url,"https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(r.out[0].params.get("secret"),"synthetic-secret");
});
test("preflight requires secret before reading or contacting provider",async()=>{
  const r=await run({env:{}});
  assert.equal(r.status,503);assert.equal(r.out.length,0);
});
test("missing token never invokes upstream provider",async()=>{
  const r=await run({noToken:true});
  assert.equal(r.status,400);assert.equal(r.out.length,0);
});
test("rejected, wrong-action, and wrong-hostname Turnstile responses fail closed",async()=>{
  for(const o of [{success:false},{action:"dtf_artwork"},{hostname:"other.example"}]){
    const r=await run(o);assert.equal(r.status,400);assert.equal(r.body.success,false);
  }
});
test("upstream HTTP failure and network error fail closed and sanitize response",async()=>{
  for(const o of [{httpStatus:503},{networkError:true}]){
    const r=await run(o);assert.equal(r.status,503);
    assert.doesNotMatch(JSON.stringify(r.body),/synthetic-secret|simulated provider error/);
  }
});
test("corrupt file returns cannot_print without write, checkout or payment",async()=>{
  const r=await run({bytes:new Uint8Array([1,2,3])});
  assert.equal(r.status,200);assert.equal(r.body.report.status,"cannot_print");assert.equal(r.out.length,1);
});
test("read-only API GET is rejected",async()=>{
  const r=await onRequestGet();
  assert.equal(r.status,405);
});
test("preflight code is not connected to existing checkout or webhook",()=>{
  const api=readFileSync(new URL("../functions/api/dtf-artwork-preflight.js",import.meta.url),"utf8");
  assert.doesNotMatch(api,/create-checkout-session|stripe\.com|ARTWORK_BUCKET\.put|RESEND_API_KEY|STRIPE_SECRET_KEY/);
  assert.match(api,/dtf_preflight/);
  assert.match(api,/cache-control/);
});
