import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { webcrypto } from "node:crypto";
import { verifyPngRasterIntegrity,verifyArtworkIntegrity } from "../functions/lib/dtf-artwork-integrity-rn3b1c.js";
const sig=Uint8Array.from([137,80,78,71,13,10,26,10]);
function u32(n){return Uint8Array.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function crc32(arr) {
  let crc=0xffffffff;
  for(const v of arr) {
    crc^=v;
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data=[]) {
  const t=new TextEncoder().encode(type), d=Uint8Array.from(data);
  return Buffer.concat([u32(d.length),t,d,u32(crc32(Buffer.concat([t,d])))]);
}
function makePng({width=2,height=2,color=6,filter=0,raw,interlace=0}={}) {
  const ihdr=Buffer.concat([u32(width),u32(height),Uint8Array.from([8,color,0,0,interlace])]);
  const bytesPerRow=width*(color===6?4:3);
  const scanlines=raw ?? Buffer.concat(Array.from({length:height},()=>Buffer.concat([Uint8Array.from([filter]),new Uint8Array(bytesPerRow)])));
  return Uint8Array.from(Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(scanlines)),chunk("IEND")]));
}
function noCheckout(p) { assert.equal(p.checkoutEligible,false);assert.equal(p.productionApproved,false); }
test("valid full PNG inflated and scanlines reconstructed with SHA256 but no checkout",async()=>{
  const p=await verifyPngRasterIntegrity(makePng());
  assert.equal(p.integrity,"raster_stream_verified");
  assert.equal(p.fullRasterStreamDecoded,true);
  assert.match(p.sha256,/^[0-9a-f]{64}$/);
  assert.equal(p.artworkIntentBound,false); noCheckout(p);
});
test("all standard PNG row filter algorithms decode conservatively",async()=>{
  for(const filter of [0,1,2,3,4]){
    const p=await verifyPngRasterIntegrity(makePng({filter}));
    assert.equal(p.integrity,"raster_stream_verified");
    noCheckout(p);
  }
});
test("invalid PNG chunk CRC fails closed",async()=>{
  const b=makePng(); b[28]^=1;
  const p=await verifyPngRasterIntegrity(b);
  assert.equal(p.reason,"BAD_CHUNK_CRC");noCheckout(p);
});
test("truncated compressed raster or invalid scanline filter fails closed",async()=>{
  const p=await verifyPngRasterIntegrity(makePng({filter:5}));
  assert.equal(p.reason,"INVALID_SCANLINE_FILTER");noCheckout(p);
  const b=makePng();const truncated=b.slice(0,-3);
  assert.notEqual((await verifyPngRasterIntegrity(truncated)).integrity,"raster_stream_verified");
});
test("interlaced input goes to manual review; no false full-decode claim",async()=>{
  const p=await verifyPngRasterIntegrity(makePng({interlace:1}));
  assert.equal(p.reason,"UNSUPPORTED_PNG_LAYOUT");noCheckout(p);
});
test("decompression size mismatches are rejected",async()=>{
  const p=await verifyPngRasterIntegrity(makePng({raw:Uint8Array.from([0,0,0])}));
  assert.equal(p.reason,"DECODED_SIZE_MISMATCH");noCheckout(p);
});
test("pixel and decoded memory bounds fail closed before decompression",async()=>{
  for(const dimensions of [[100000,100000],[100000,1]]) {
    const p=await verifyPngRasterIntegrity(makePng({width:dimensions[0],height:dimensions[1],raw:Uint8Array.from([0])}));
    assert.notEqual(p.integrity,"raster_stream_verified");noCheckout(p);
  }
});
test("JPEG WebP PDF SVG PSD AI EPS and extension spoofing stay manual review",async()=>{
  for(const ext of ["jpg","jpeg","webp","pdf","svg","psd","ai","eps"]){
    const p=await verifyArtworkIntegrity(makePng(),"art."+ext);
    assert.equal(p.reason,"TRUSTED_DECODER_NOT_AVAILABLE_FOR_FORMAT");noCheckout(p);
  }
  const p=await verifyArtworkIntegrity(Uint8Array.from([1,2,3]),"art.png");
  assert.notEqual(p.integrity,"raster_stream_verified");noCheckout(p);
});
test("independent deterministic digest changes with file content",async()=>{
  const a=await verifyPngRasterIntegrity(makePng({filter:0}));
  const b=await verifyPngRasterIntegrity(makePng({filter:1}));
  assert.notEqual(a.sha256,b.sha256);
  noCheckout(a);noCheckout(b);
});
test("no file binding, storage, provider or Stripe behavior introduced",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../functions/lib/dtf-artwork-integrity-rn3b1c.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/stripe\.com|checkout\.sessions|fetch\(|R2_BUCKET|RESEND_API|create-checkout-session/);
  assert.match(source,/artworkIntentBound:false/);
});
