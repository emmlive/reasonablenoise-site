// RN-3B1C Phase 2: isolated server-only artwork-intent state machine.
// Caller MUST authenticate subject/order and supply a durable transactional store.
// This library neither uploads files nor authorizes checkout or production.
import { verifyArtworkIntegrity } from "./dtf-artwork-integrity-rn3b1c.js";

const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const KEY = /^dtf-intents\/[0-9a-f-]{36}\/artwork\.png$/;
function reject(code) { return { ok: false, code, checkoutEligible: false, productionApproved: false }; }
function allowedIdentity(s) { return typeof s === "string" && ID.test(s); }
function validTime(now) { return Number.isSafeInteger(now) && now >= 0; }
function validBytes(bytes) { return bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_BYTES; }
function validRecord(r) {
  return r && r.version === 1 && allowedIdentity(r.intentId) && allowedIdentity(r.subjectId) &&
    allowedIdentity(r.orderId) && typeof r.objectKey === "string" && KEY.test(r.objectKey) &&
    SHA.test(r.sha256 || "") && Number.isSafeInteger(r.byteLength) &&
    r.byteLength > 0 && r.byteLength <= MAX_BYTES &&
    validTime(r.createdAt) && validTime(r.expiresAt) &&
    r.expiresAt > r.createdAt && r.expiresAt - r.createdAt <= MAX_AGE_MS &&
    ["issued", "consumed"].includes(r.status);
}
function validStore(store) { return store && typeof store.atomic === "function"; }
function safeRandomId() {
  if (!globalThis.crypto?.randomUUID) return null;
  return crypto.randomUUID();
}
// All subjectId/orderId arguments must be derived from trusted server authorization,
// NEVER from browser fields. tx.insert must be insert-if-absent and tx.update must
// commit together, with rollback on error and serializable/unique-key protection.
export async function issueArtworkIntent({ store, subjectId, orderId, bytes, filename, now = Date.now() }) {
  if (!validStore(store)) return reject("NO_DURABLE_TRANSACTION");
  if (!allowedIdentity(subjectId) || !allowedIdentity(orderId)) return reject("INVALID_TRUSTED_IDENTITY");
  if (!validTime(now) || !validBytes(bytes) || filename !== "artwork.png") return reject("INVALID_INPUT");
  const inspected = await verifyArtworkIntegrity(bytes, filename);
  if (inspected.integrity !== "raster_stream_verified" || !SHA.test(inspected.sha256 || "")) return reject("ARTWORK_NOT_VERIFIED");
  const uuid = safeRandomId();
  if (!uuid) return reject("SECURE_RANDOM_UNAVAILABLE");
  const intentId = "intent_" + uuid.replaceAll("-", "");
  const record = Object.freeze({
    version: 1, intentId, subjectId, orderId,
    objectKey: "dtf-intents/" + uuid + "/artwork.png",
    sha256: inspected.sha256, byteLength: bytes.byteLength,
    createdAt: now, expiresAt: now + MAX_AGE_MS, status: "issued"
  });
  try {
    await store.atomic(async (tx) => {
      if (await tx.get(intentId)) throw Error("DUPLICATE_INTENT");
      await tx.insert(record);
    });
  } catch { return reject("INTENT_PERSISTENCE_FAILED"); }
  // No checkout token, customer-controlled storage key or payment approval is returned.
  return { ok: true, intentId, expiresAt: record.expiresAt,
    artworkIntentBound: false, checkoutEligible: false, productionApproved: false };
}

// This is a one-time *consumption* gate, not a payment authorization.
// Verified bytes MUST come from the private stored object via a trusted server adapter,
// not a second browser upload. tx must be serializable across all Workers.
export async function consumeArtworkIntent({ store, intentId, subjectId, orderId, storedBytes, storedObjectKey, now = Date.now() }) {
  if (!validStore(store)) return reject("NO_DURABLE_TRANSACTION");
  if (!allowedIdentity(intentId) || !allowedIdentity(subjectId) || !allowedIdentity(orderId) ||
      !validTime(now) || !validBytes(storedBytes) || typeof storedObjectKey !== "string") return reject("INVALID_INPUT");
  // Verify actual bytes, rather than believing a digest supplied by the client.
  const inspected = await verifyArtworkIntegrity(storedBytes, "artwork.png");
  if (inspected.integrity !== "raster_stream_verified" || !SHA.test(inspected.sha256 || "")) return reject("ARTWORK_NOT_VERIFIED");
  try {
    return await store.atomic(async (tx) => {
      const record = await tx.get(intentId);
      if (!validRecord(record)) return reject("INTENT_NOT_FOUND_OR_INVALID");
      if (record.subjectId !== subjectId || record.orderId !== orderId) return reject("UNAUTHORIZED_INTENT");
      if (record.status !== "issued") return reject("INTENT_ALREADY_USED");
      if (now >= record.expiresAt || now < record.createdAt) return reject("INTENT_EXPIRED_OR_INVALID_CLOCK");
      if (record.objectKey !== storedObjectKey || record.byteLength !== storedBytes.byteLength ||
          record.sha256 !== inspected.sha256) return reject("ARTWORK_MISMATCH");
      await tx.update({ ...record, status: "consumed" });
      return { ok: true, intentId, artworkIntentBound: true,
        checkoutEligible: false, productionApproved: false };
    });
  } catch { return reject("INTENT_TRANSACTION_FAILED"); }
}
