// Signed catalog snapshot v1. Generated on the server at Checkout creation and
// verified from Stripe-signed session metadata before paid-order side effects.
// The HMAC key is configured only in the intended isolated environment.
const fields = Object.freeze([
  "catalog_product_id",
  "catalog_product_version",
  "catalog_price_cents",
  "catalog_price_mode",
  "catalog_checkout_label",
  "catalog_checkout_cents",
  "catalog_order_reference",
]);
const productIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const orderRefPattern = /^RN-\d{8}-[A-F0-9]{8}$/;
const digits = /^[1-9]\d{0,8}$/;
const allowedModes = new Set(["fixed", "starting_at"]);
const encoder = new TextEncoder();

function parsePayload(metadata) {
  if (metadata?.catalog_snapshot_version !== "1") return null;
  if (fields.some(k => typeof metadata[k] !== "string")) return null;
  const data = Object.fromEntries(fields.map(k => [k, metadata[k]]));
  if (!productIdPattern.test(data.catalog_product_id) || data.catalog_product_id.length > 80 ||
      !digits.test(data.catalog_product_version) ||
      !digits.test(data.catalog_checkout_cents) ||
      !digits.test(data.catalog_price_cents) ||
      !allowedModes.has(data.catalog_price_mode) ||
      !data.catalog_checkout_label || data.catalog_checkout_label.length > 120 ||
      !orderRefPattern.test(data.catalog_order_reference)) return null;
  const productCents = Number(data.catalog_price_cents);
  const checkoutCents = Number(data.catalog_checkout_cents);
  const version = Number(data.catalog_product_version);
  if (!Number.isSafeInteger(productCents) || !Number.isSafeInteger(checkoutCents) ||
      !Number.isSafeInteger(version) || version < 1 ||
      (data.catalog_price_mode === "fixed" && checkoutCents !== productCents) ||
      (data.catalog_price_mode === "starting_at" && checkoutCents < productCents)) return null;
  return data;
}

function payloadText(data) {
  return JSON.stringify(["rn-catalog-order-v1", ...fields.map(k => data[k])]);
}

async function calculateMac(key, message) {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", imported, encoder.encode(message));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}

function equalMac(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a || "") || !/^[0-9a-f]{64}$/.test(b || "")) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function validKey(key) {
  return typeof key === "string" && key.length >= 32;
}

export async function createCatalogSnapshot(decision, checkoutPricing, orderReference, secret) {
  if (!decision?.gate_active || !validKey(secret)) return null;
  const candidate = {
    catalog_snapshot_version: "1",
    catalog_product_id: decision.product_id,
    catalog_product_version: String(decision.version),
    catalog_price_cents: String(decision.price_cents),
    catalog_price_mode: decision.price_mode,
    catalog_checkout_label: checkoutPricing.label,
    catalog_checkout_cents: String(checkoutPricing.amountCents),
    catalog_order_reference: orderReference,
  };
  const data = parsePayload(candidate);
  if (!data) return null;
  return {
    ...candidate,
    catalog_snapshot_mac: await calculateMac(secret, payloadText(data)),
  };
}

export async function verifyCatalogSnapshot(metadata, session, secret, required) {
  const names = [...fields, "catalog_snapshot_version", "catalog_snapshot_mac"];
  const hasSnapshot = names.some(key => metadata && Object.prototype.hasOwnProperty.call(metadata, key));
  if (!hasSnapshot && !required) return { ok: true, legacy: true, snapshot: null };
  if (!hasSnapshot || !validKey(secret)) return { ok: false, code: "CATALOG_SNAPSHOT_UNAVAILABLE" };
  const data = parsePayload(metadata);
  if (!data || typeof metadata.catalog_snapshot_mac !== "string")
    return { ok: false, code: "CATALOG_SNAPSHOT_INVALID" };
  // All order identity, pricing and currency values must match the Stripe session,
  // not only the authenticated metadata blob.
  if (session?.client_reference_id !== data.catalog_order_reference ||
      metadata.order_reference !== data.catalog_order_reference ||
      metadata.checkout_price_label !== data.catalog_checkout_label ||
      metadata.checkout_price_cents !== data.catalog_checkout_cents ||
      String(session.currency || "").toLowerCase() !== "usd" ||
      !Number.isSafeInteger(session.amount_subtotal) ||
      session.amount_subtotal !== Number(data.catalog_checkout_cents)) {
    return { ok: false, code: "CATALOG_SNAPSHOT_MISMATCH" };
  }
  const expected = await calculateMac(secret, payloadText(data));
  if (!equalMac(expected, metadata.catalog_snapshot_mac)) {
    return { ok: false, code: "CATALOG_SNAPSHOT_INVALID" };
  }
  return {
    ok: true, legacy: false,
    snapshot: Object.freeze({
      format: "rn-catalog-order-v1",
      product_id: data.catalog_product_id,
      catalog_version: Number(data.catalog_product_version),
      catalog_price_cents: Number(data.catalog_price_cents),
      price_mode: data.catalog_price_mode,
      checkout_label: data.catalog_checkout_label,
      checkout_cents: Number(data.catalog_checkout_cents),
      order_reference: data.catalog_order_reference,
      signature: metadata.catalog_snapshot_mac,
    }),
  };
}
