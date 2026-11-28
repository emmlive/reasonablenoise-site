// Customer-facing read-only catalog; OFF by default until D1 acceptance.
// Archived and draft records never leave this endpoint. This is not a stock reservation.
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
  },
});
const visibleStatuses = new Set(["available", "out_of_stock"]);
const priceModes = new Set(["fixed", "starting_at", "quote_only"]);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imagePath = /^\/assets\/[a-zA-Z0-9/_-]+\.(?:png|jpg|jpeg|webp)$/;

export async function onRequestGet({ env }) {
  if (!env || env.RN_PUBLIC_CATALOG_ENABLED !== "true") {
    return reply({ success: false, error: "Catalog is not published." }, 503);
  }
  if (!env.RN_CATALOG_DB?.prepare) {
    return reply({ success: false, error: "Catalog is unavailable." }, 503);
  }
  try {
    const response = await env.RN_CATALOG_DB.prepare(
      "SELECT id, name, description, image_url, price_cents, price_mode, status FROM rn_catalog_products WHERE status IN ('available','out_of_stock') ORDER BY name"
    ).all();
    const rows = Array.isArray(response?.results) ? response.results : [];
    const products = [];
    for (const row of rows) {
      if (!row || !idPattern.test(row.id || "") ||
          typeof row.name !== "string" || !row.name.trim() || row.name.length > 120 ||
          typeof row.description !== "string" || row.description.length > 2000 ||
          !Number.isSafeInteger(row.price_cents) || row.price_cents < 0 ||
          !priceModes.has(row.price_mode) || !visibleStatuses.has(row.status) ||
          typeof row.image_url !== "string" ||
          (row.image_url !== "" && !imagePath.test(row.image_url))) {
        // Malformed visible records are a publication error, not a reason to
        // silently announce incorrect availability or partial prices.
        return reply({ success: false, error: "Catalog data requires review." }, 503);
      }
      products.push({
        id: row.id, name: row.name, description: row.description,
        image_url: row.image_url, price_cents: row.price_cents,
        price_mode: row.price_mode, status: row.status,
      });
    }
    return reply({ success: true, products });
  } catch (_) {
    return reply({ success: false, error: "Catalog is unavailable." }, 503);
  }
}

export async function onRequestPost() {
  return reply({ success: false, error: "Method not allowed." }, 405);
}
