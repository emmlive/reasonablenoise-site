// RN catalog checkout availability gate.
// Opt-in only; does not mutate stock or make payment calls.
// Checkout product names are server-controlled; client-provided catalog IDs are ignored.
export const checkoutCatalogIds = Object.freeze({
  "USDOT Sticker Pair": "usdot-sticker-pair",
  "Extra USDOT Pair": "extra-usdot-pair",
  "One-Side USDOT Replacement": "one-side-usdot-replacement",
  "USDOT + Business Name Pair": "usdot-business-name-pair",
  "Truck Door Lettering": "truck-door-lettering",
  "Custom Business Decals": "custom-business-decals",
  "Fleet Lettering Package": "fleet-lettering",
  "Logo Sticker Batch": "logo-sticker-batch",
  "Design Cleanup / Layout Help": "design-cleanup",
});

export async function authorizeCatalogCheckout(env, checkoutPricing) {
  if (env?.RN_CATALOG_CHECKOUT_GATE_ENABLED !== "true") {
    return { allowed: true, gate_active: false };
  }
  const id = checkoutCatalogIds[checkoutPricing?.label];
  if (!id) return { allowed: false, status: 409, code: "CATALOG_PRODUCT_UNKNOWN" };
  if (!env?.RN_CATALOG_DB?.prepare) {
    return { allowed: false, status: 503, code: "CATALOG_UNAVAILABLE" };
  }
  try {
    const record = await env.RN_CATALOG_DB.prepare(
      "SELECT id, price_cents, price_mode, status, version FROM rn_catalog_products WHERE id = ?"
    ).bind(id).first();
    if (!record || record.id !== id) return { allowed: false, status: 409, code: "CATALOG_PRODUCT_NOT_FOUND" };
    if (record.status !== "available") return { allowed: false, status: 409, code: "PRODUCT_UNAVAILABLE" };
    if (!Number.isSafeInteger(record.price_cents) || record.price_cents < 0 ||
        !Number.isSafeInteger(record.version) || record.version < 1 ||
        !Number.isSafeInteger(checkoutPricing.amountCents) || checkoutPricing.amountCents <= 0) {
      return { allowed: false, status: 503, code: "CATALOG_INVALID" };
    }
    if (record.price_mode === "quote_only") return { allowed: false, status: 409, code: "QUOTE_REQUIRED" };
    // Never silently replace an existing server-owned Stripe amount.
    if (record.price_mode === "fixed" && record.price_cents !== checkoutPricing.amountCents) {
      return { allowed: false, status: 409, code: "PRICE_REVIEW_REQUIRED" };
    }
    if (record.price_mode === "starting_at" && checkoutPricing.amountCents < record.price_cents) {
      return { allowed: false, status: 409, code: "PRICE_REVIEW_REQUIRED" };
    }
    if (!["fixed", "starting_at"].includes(record.price_mode)) {
      return { allowed: false, status: 503, code: "CATALOG_INVALID" };
    }
    return { allowed: true, gate_active: true, product_id: id, version: record.version, price_cents: record.price_cents, price_mode: record.price_mode };
  } catch (_) {
    return { allowed: false, status: 503, code: "CATALOG_UNAVAILABLE" };
  }
}
