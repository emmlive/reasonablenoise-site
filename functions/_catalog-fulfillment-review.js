// RN catalog paid-order fulfillment review.
// A paid Stripe session issued while available is honored, but changes in
// catalog availability/revision after checkout require manual fulfillment review.
// This never rejects a verified paid order, mutates stock, sends email, or calls Stripe.
function result(required, reason, observations = {}) {
  return Object.freeze({
    required,
    checked: true,
    reason,
    ...observations,
  });
}

export async function classifyPaidCatalogFulfillment(env, snapshot) {
  if (env?.RN_CATALOG_FULFILLMENT_REVIEW_ENABLED !== "true" || !snapshot) {
    return Object.freeze({ required: false, checked: false, reason: "not_enabled" });
  }

  if (!env?.RN_CATALOG_DB?.prepare) {
    return result(true, "catalog_unavailable");
  }

  try {
    const record = await env.RN_CATALOG_DB.prepare(
      "SELECT id, status, version, price_cents, price_mode FROM rn_catalog_products WHERE id = ?"
    ).bind(snapshot.product_id).first();

    if (!record || record.id !== snapshot.product_id) {
      return result(true, "catalog_product_missing");
    }
    if (!Number.isSafeInteger(record.version) || record.version < 1 ||
        !Number.isSafeInteger(record.price_cents) || record.price_cents < 0 ||
        !["fixed", "starting_at", "quote_only"].includes(record.price_mode) ||
        !["available", "out_of_stock", "draft", "archived"].includes(record.status)) {
      return result(true, "catalog_invalid");
    }

    const observations = { observed_status: record.status, observed_version: record.version };
    if (record.status !== "available") {
      return result(true, "availability_changed", observations);
    }
    if (record.version !== snapshot.catalog_version ||
        record.price_cents !== snapshot.catalog_price_cents ||
        record.price_mode !== snapshot.price_mode) {
      return result(true, "catalog_revision_changed", observations);
    }
    return result(false, "catalog_still_available", observations);
  } catch (_) {
    return result(true, "catalog_unavailable");
  }
}
