// RN-3B1C Phase 2 — isolated, server-side, fail-closed artwork intent contract.
// Repository methods are injected. This module DOES NOT supply durable storage,
// authentication, a public API, checkout eligibility, or production authorization.
import { verifyArtworkIntegrity } from "./dtf-artwork-integrity-rn3b1c.js";

const MAX_TTL_MS = 15 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = (reason) => ({
  ok: false, reason, checkoutEligible: false, productionApproved: false,
});
function contextValid(context) {
  return Boolean(context && context.trustedServerIdentity === true &&
    typeof context.ownerId === "string" && ID_PATTERN.test(context.ownerId) &&
    typeof context.orderRef === "string" && ID_PATTERN.test(context.orderRef));
}
function dependenciesValid({ store, clock, idFactory } = {}) {
  return Boolean(store && typeof store.createIfAbsent === "function" &&
    typeof store.read === "function" && typeof store.consumeIfUnchanged === "function" &&
    clock && typeof clock.now === "function" &&
    typeof idFactory === "function");
}
function validNow(clock) {
  const value = clock.now();
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function verifiedProof(value) {
  return value?.integrity === "raster_stream_verified" &&
    value.fullRasterStreamDecoded === true &&
    value.artworkIntentBound === false &&
    typeof value.sha256 === "string" && DIGEST_PATTERN.test(value.sha256);
}
function validRecord(record) {
  return record && record.schema === "rn_dtf_artwork_intent_v1" &&
    typeof record.intentId === "string" && UUID_PATTERN.test(record.intentId) &&
    typeof record.ownerId === "string" && ID_PATTERN.test(record.ownerId) &&
    typeof record.orderRef === "string" && ID_PATTERN.test(record.orderRef) &&
    Number.isSafeInteger(record.byteLength) && record.byteLength > 0 && record.byteLength <= MAX_BYTES &&
    typeof record.sha256 === "string" && DIGEST_PATTERN.test(record.sha256) &&
    Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.expiresAt) &&
    record.createdAt >= 0 && record.expiresAt > record.createdAt &&
    record.expiresAt - record.createdAt <= MAX_TTL_MS &&
    record.state === "pending" && record.fileFormat === "png";
}
function sameBytes(a, b) {
  // Compare hashes without early exit; the digest is never accepted from a caller.
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function prepareArtworkIntent({ context, bytes, store, clock, idFactory } = {}) {
  if (!dependenciesValid({ store, clock, idFactory })) return deny("REPOSITORY_NOT_CONFIGURED");
  if (!contextValid(context)) return deny("UNAUTHORIZED_CONTEXT");
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) return deny("INVALID_ARTWORK");
  const now = validNow(clock);
  if (now === null) return deny("INVALID_CLOCK");
  const proof = await verifyArtworkIntegrity(bytes, "artwork.png");
  if (!verifiedProof(proof)) return deny("ARTWORK_REQUIRES_REVIEW");
  const intentId = idFactory();
  if (typeof intentId !== "string" || !UUID_PATTERN.test(intentId)) return deny("INVALID_INTENT_ID");
  const record = Object.freeze({
    schema: "rn_dtf_artwork_intent_v1",
    intentId, ownerId: context.ownerId, orderRef: context.orderRef,
    sha256: proof.sha256, byteLength: bytes.length, fileFormat: "png",
    createdAt: now, expiresAt: now + MAX_TTL_MS, state: "pending",
  });
  if (!validRecord(record)) return deny("INVALID_INTENT_RECORD");
  try {
    const created = await store.createIfAbsent(record);
    if (created !== true) return deny("INTENT_CREATE_FAILED");
  } catch { return deny("INTENT_CREATE_FAILED"); }
  // Intent must not be returned as checkout-ready: no ownership or storage attestations exist yet.
  return { ok: true, intentId, expiresAt: record.expiresAt,
    artworkIntentBound: false, checkoutEligible: false, productionApproved: false };
}

export async function consumeArtworkIntent({ context, intentId, bytes, store, clock, idFactory } = {}) {
  if (!dependenciesValid({ store, clock, idFactory })) return deny("REPOSITORY_NOT_CONFIGURED");
  if (!contextValid(context)) return deny("UNAUTHORIZED_CONTEXT");
  if (typeof intentId !== "string" || !UUID_PATTERN.test(intentId)) return deny("INVALID_INTENT_ID");
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) return deny("INVALID_ARTWORK");
  const now = validNow(clock);
  if (now === null) return deny("INVALID_CLOCK");
  let record;
  try { record = await store.read(intentId); }
  catch { return deny("INTENT_READ_FAILED"); }
  if (!validRecord(record) || record.intentId !== intentId) return deny("INTENT_NOT_AVAILABLE");
  if (record.ownerId !== context.ownerId || record.orderRef !== context.orderRef) return deny("INTENT_NOT_AVAILABLE");
  if (now < record.createdAt || now >= record.expiresAt) return deny("INTENT_EXPIRED");
  if (record.byteLength !== bytes.length) return deny("ARTWORK_MISMATCH");
  const proof = await verifyArtworkIntegrity(bytes, "artwork.png");
  if (!verifiedProof(proof) || !sameBytes(proof.sha256, record.sha256)) return deny("ARTWORK_MISMATCH");
  // Repository MUST atomically compare immutable record fields and state, then mark
  // the intent consumed. A normal read-followed-by-write adapter is not safe.
  let consumed;
  try { consumed = await store.consumeIfUnchanged(record); }
  catch { return deny("ATOMIC_CONSUME_FAILED"); }
  if (consumed !== true) return deny("INTENT_ALREADY_CONSUMED_OR_CHANGED");
  // Consumed means that synthetic intent check ran once; it is NOT payment authorization.
  return { ok: true, intentId, sha256: proof.sha256, validatedOnce: true,
    artworkIntentBound: false, checkoutEligible: false, productionApproved: false };
}
