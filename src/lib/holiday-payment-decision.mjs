// RN Holiday 2A: offline cryptographic webhook decision only; no routed handler,
// payment fulfillment, production permissions, emails, D1, or R2 mutations.
// Successful signature verification creates only a candidate requiring Stripe retrieval.
const REFERENCE = /^RNH-[A-F0-9]{16}$/;
const EVENT_ID = /^evt_[A-Za-z0-9]{6,}$/;
const SESSION_ID = /^cs_test_[A-Za-z0-9_]{6,}$/;
const RECOGNIZED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
]);
const encoder = new TextEncoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function equalHex(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function parseSignature(header) {
  const pieces = String(header || "").split(",");
  let timestamp = null;
  const signatures = [];
  for (const item of pieces) {
    const [key, value] = item.trim().split("=");
    if (key === "t" && /^\d{9,12}$/.test(value || "") && timestamp === null) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/.test(value || "")) signatures.push(value);
  }
  return { timestamp, signatures };
}
export async function verifyHolidayStripeEvent({ rawBody, stripeSignature, secret, nowSeconds }) {
  // No production key material, request objects or arbitrary JSON are trusted.
  if (typeof rawBody !== "string" || rawBody.length > 128000 || !rawBody ||
      typeof secret !== "string" || !/^whsec_[A-Za-z0-9]{8,}$/.test(secret) ||
      !Number.isSafeInteger(nowSeconds)) return { status: "blocked", reason: "invalid_input" };
  const { timestamp, signatures } = parseSignature(stripeSignature);
  if (!Number.isSafeInteger(timestamp) || !signatures.length ||
      Math.abs(nowSeconds - timestamp) > 300) return { status: "blocked", reason: "invalid_signature" };
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + rawBody)));
  if (!signatures.some(sig => equalHex(sig, expected))) {
    return { status: "blocked", reason: "invalid_signature" };
  }
  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: "blocked", reason: "invalid_json" }; }
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      !EVENT_ID.test(String(event.id || "")) || !/^202[0-9]-[0-9]{2}-[0-9]{2}$/.test("2026-11-27")) {
    return { status: "blocked", reason: "invalid_event" };
  }
  if (event.livemode !== false || !RECOGNIZED.has(event.type)) {
    return { status: "blocked", reason: "out_of_scope" };
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return { status: "hold", reason: "non_payable_event", eventId: event.id };
  }
  const s = event.data?.object;
  const m = s?.metadata;
  if (s?.object !== "checkout.session" || s?.mode !== "payment" ||
      !SESSION_ID.test(String(s?.id || "")) || s.payment_status !== "paid" ||
      s.currency !== "usd" || !Number.isSafeInteger(s.amount_total) || s.amount_total < 2400 ||
      m?.source !== "reasonablenoise" || m?.order_type !== "holiday_shirt_test" ||
      m?.fulfillment_status !== "manual_review_only" ||
      !REFERENCE.test(String(m?.order_reference || "")) ||
      s.client_reference_id !== m.order_reference) {
    return { status: "blocked", reason: "invalid_holiday_session" };
  }
  // This never grants order ownership, fulfillment or permission to send email:
  // event contents can be stale or lack verified line items/customer provenance.
  return {
    status: "hold",
    reason: "retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe",
    eventId: event.id,
    checkoutSessionId: s.id,
    orderReference: m.order_reference,
    paymentAuthorized: false,
    fulfillmentAuthorized: false,
    emailAuthorized: false,
    deletionAuthorized: false,
  };
}
