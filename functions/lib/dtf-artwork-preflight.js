// RN-3B1: bounded, conservative DTF artwork metadata preflight.
// This is NOT a full image decoder, print proof, or production authorization.
export const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;
const RASTER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const REVIEW_EXTENSIONS = new Set(["pdf", "svg", "ai", "eps", "psd"]);
const MAX_DIMENSION = 100000;
const TARGET_DPI = 300;
const WARNING_DPI = 150;

function result(status, codes, details = {}) {
  return {
    status,
    codes,
    targetDpi: TARGET_DPI,
    canAutoCheckout: false,
    productionApproved: false,
    ...details,
  };
}

function checkNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.5 && n <= 120 ? n : null;
}

function extensionOf(name) {
  return String(name || "").split(".").pop()?.toLowerCase() || "";
}

function ascii(bytes, offset, len) {
  return Array.from(bytes.subarray(offset, offset + len), b => String.fromCharCode(b)).join("");
}

function pngInfo(bytes) {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = bytes[24];
  const colorType = bytes[25];
  if (![1, 2, 4, 8, 16].includes(depth) || ![0, 2, 3, 4, 6].includes(colorType)) return null;
  return { width, height, transparency: [4, 6].includes(colorType) ? "alpha_channel_present" : "not_confirmed", format: "png" };
}

function jpegInfo(bytes) {
  if (bytes.length < 6 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 2;
  while (p + 4 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    while (bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (p + 2 > bytes.length) return null;
    const length = view.getUint16(p);
    if (length < 2 || p + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      return { width: view.getUint16(p + 5), height: view.getUint16(p + 3), transparency: "not_supported", format: "jpeg" };
    }
    p += length;
  }
  return null;
}

function webpInfo(bytes) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return null;
  const kind = ascii(bytes, 12, 4);
  if (kind === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height, transparency: (bytes[20] & 0x10) ? "alpha_possible" : "not_confirmed", format: "webp" };
  }
  if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, transparency: "not_supported", format: "webp" };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6));
    return { width, height, transparency: "not_confirmed", format: "webp" };
  }
  return null;
}

export function inspectArtworkBytes(input, { filename, widthInches, heightInches, declaredSize } = {}) {
  const width = checkNumber(widthInches);
  const height = checkNumber(heightInches);
  if (!width || !height) return result("cannot_print", ["INVALID_PRINT_DIMENSIONS"]);
  if (!(input instanceof Uint8Array)) return result("cannot_print", ["INVALID_FILE"]);
  if (!input.length || input.length > MAX_ARTWORK_BYTES || (declaredSize !== undefined && declaredSize !== input.length)) {
    return result("cannot_print", ["INVALID_FILE_SIZE"]);
  }
  const extension = extensionOf(filename);
  if (!RASTER_EXTENSIONS.has(extension) && !REVIEW_EXTENSIONS.has(extension)) {
    return result("cannot_print", ["UNSUPPORTED_FORMAT"]);
  }
  if (REVIEW_EXTENSIONS.has(extension)) {
    return result("review_recommended", ["SPECIALIST_FORMAT_REQUIRES_REVIEW"], {
      fileFormat: extension,
      printWidthInches: width,
      printHeightInches: height,
      imageDimensionsVerified: false,
    });
  }
  const info = extension === "png" ? pngInfo(input) :
    (extension === "jpg" || extension === "jpeg") ? jpegInfo(input) : webpInfo(input);
  if (!info || !Number.isInteger(info.width) || !Number.isInteger(info.height) ||
      info.width <= 0 || info.height <= 0 || info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    return result("cannot_print", ["UNREADABLE_OR_MISMATCHED_RASTER_HEADER"], { fileFormat: extension });
  }

  const horizontalDpi = Math.floor(info.width / width);
  const verticalDpi = Math.floor(info.height / height);
  const effectiveDpi = Math.min(horizontalDpi, verticalDpi);
  const detail = {
    fileFormat: info.format,
    pixelWidth: info.width,
    pixelHeight: info.height,
    printWidthInches: width,
    printHeightInches: height,
    effectiveDpi,
    transparency: info.transparency,
    imageDimensionsVerified: true,
    fullImageDecoded: false,
  };
  if (effectiveDpi < WARNING_DPI) return result("review_recommended", ["LOW_RESOLUTION"], detail);
  if (effectiveDpi < TARGET_DPI) return result("review_recommended", ["BELOW_TARGET_RESOLUTION"], detail);
  // Passing a header/size check does NOT prove pixel integrity, transparency or print suitability.
  return result("technical_pass", ["HEADER_AND_RESOLUTION_CHECK_PASSED", "FULL_DECODE_AND_PRINT_REVIEW_REQUIRED"], detail);
}
