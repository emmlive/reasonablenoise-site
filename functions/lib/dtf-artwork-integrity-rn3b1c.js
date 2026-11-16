// RN-3B1C — conservative full PNG stream integrity + SHA-256 fingerprint.
// Not a print proof, color-managed renderer, file store, order intent, or checkout approval.
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const PNG_SIG = [137,80,78,71,13,10,26,10];
function fail(reason) { return { integrity: "manual_review", reason, fullRasterStreamDecoded: false, checkoutEligible: false, productionApproved: false }; }
function u32(b,i) { return ((b[i]*16777216)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3])>>>0; }
function crc32(bytes,start,end) {
  let c = 0xffffffff;
  for(let i=start;i<end;i++) {
    c ^= bytes[i];
    for(let j=0;j<8;j++) c = (c>>>1) ^ ((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function ct(b,i) { return String.fromCharCode(...b.subarray(i,i+4)); }
function pngRowBytes(width, depth, type) {
  const channels = {0:1,2:3,3:1,4:2,6:4}[type];
  if (!channels) return null;
  const bits = width * channels * depth;
  if (!Number.isSafeInteger(bits)) return null;
  return Math.ceil(bits/8);
}
async function decodeBounded(stream, limit) {
  const reader = stream.getReader();
  const fragments = [];
  let used=0;
  try {
    while(true) {
      const {value,done} = await reader.read();
      if(done) break;
      used += value.byteLength;
      if(used > limit) { await reader.cancel().catch(()=>{}); throw Error("DECODE_LIMIT"); }
      fragments.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(used);
  let offset=0;
  for(const part of fragments) { buffer.set(part,offset); offset+=part.byteLength; }
  return buffer;
}
export async function verifyPngRasterIntegrity(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > MAX_BYTES) return fail("INVALID_FILE_SIZE");
  if (!PNG_SIG.every((v,i)=>bytes[i]===v)) return fail("NOT_PNG");
  if (typeof DecompressionStream !== "function" || !globalThis.crypto?.subtle) return fail("RUNTIME_DECODER_UNAVAILABLE");

  let offset=8, header=null, gotIdat=false, endedIdat=false, gotEnd=false, palette=false;
  const compressed=[];
  let compressedSize=0;
  while(offset + 12 <= bytes.length) {
    const length=u32(bytes,offset), start=offset+8, end=start+length;
    if (length > MAX_BYTES || !Number.isSafeInteger(end+4) || end+4 > bytes.length) return fail("BAD_CHUNK_LENGTH");
    const type=ct(bytes,offset+4);
    if(crc32(bytes,offset+4,end)!==u32(bytes,end)) return fail("BAD_CHUNK_CRC");
    if(!/^[A-Za-z]{4}$/.test(type)) return fail("INVALID_CHUNK_TYPE");
    if(!header && type!=="IHDR") return fail("NO_IHDR");
    if(type==="IHDR") {
      if(header || length!==13) return fail("INVALID_IHDR");
      const width=u32(bytes,start),height=u32(bytes,start+4),depth=bytes[start+8],color=bytes[start+9];
      if(!width||!height||width*height>MAX_PIXELS) return fail("PIXEL_LIMIT");
      const legal = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!legal[color]?.includes(depth) || bytes[start+10]!==0 || bytes[start+11]!==0 || bytes[start+12]!==0) return fail("UNSUPPORTED_PNG_LAYOUT");
      const rowBytes=pngRowBytes(width,depth,color);
      const expected=(rowBytes+1)*height;
      if(!Number.isSafeInteger(expected)||expected>MAX_DECODED_BYTES) return fail("DECODE_LIMIT");
      header={width,height,depth,color,rowBytes,expected};
    } else if(type==="PLTE") {
      if(gotIdat || palette || length===0 || length%3!==0 || length>768) return fail("BAD_PALETTE");
      palette=true;
    } else if(type==="IDAT") {
      if(endedIdat) return fail("NONCONTIGUOUS_IDAT");
      gotIdat=true; compressedSize+=length;
      if(compressedSize>MAX_BYTES) return fail("COMPRESSED_LIMIT");
      compressed.push(bytes.subarray(start,end));
    } else if(type==="IEND") {
      if(!gotIdat || length!==0 || end+4!==bytes.length) return fail("INVALID_END");
      gotEnd=true; break;
    } else if ((bytes[offset+4] & 0x20) === 0) {
      // Unsupported critical PNG chunks cannot be safely interpreted.
      return fail("UNKNOWN_CRITICAL_CHUNK");
    }
    if(gotIdat && type!=="IDAT") endedIdat=true;
    offset=end+4;
  }
  if(!gotEnd || !header || (header.color===3&&!palette) || compressedSize<2) return fail("INCOMPLETE_PNG");
  const joined = new Uint8Array(compressedSize);
  let at=0;
  for(const part of compressed){joined.set(part,at);at+=part.length;}
  let raw;
  try {
    raw = await decodeBounded(new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate")), header.expected);
  } catch { return fail("INVALID_OR_OVERSIZED_RASTER_STREAM"); }
  if(raw.length!==header.expected) return fail("DECODED_SIZE_MISMATCH");
  for(let row=0;row<header.height;row++){
    const filter=raw[row*(header.rowBytes+1)];
    if(filter>4) return fail("INVALID_SCANLINE_FILTER");
  }
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return { integrity:"raster_stream_verified", fileFormat:"png", pixelWidth:header.width,
    pixelHeight:header.height, sha256, fullRasterStreamDecoded:true,
    renderingVerified:false, colorVerified:false, artworkIntentBound:false,
    checkoutEligible:false, productionApproved:false,
    disclaimer:"PNG stream and chunk integrity verified only. This is not a print-ready approval." };
}

// No automatic raster-integrity approval for formats requiring another trusted full decoder.
export async function verifyArtworkIntegrity(bytes, filename) {
  const ext=String(filename||"").split(".").pop().toLowerCase();
  if(ext!=="png") return fail("TRUSTED_DECODER_NOT_AVAILABLE_FOR_FORMAT");
  return verifyPngRasterIntegrity(bytes);
}
