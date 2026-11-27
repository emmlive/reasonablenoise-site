const PRODUCTS = Object.freeze({
  reindeer: "Season's Greetings Tee",
  bear: "Holiday Cheer Tee",
  owl: "Holiday Hoots Tee",
  gingerbread: "Ginger Snap Tee",
});
const COLORS = new Set(["white", "cream", "heather-gray"]);
const SIZES = new Set(["S", "M", "L", "XL", "2XL"]);
const UNIT_CENTS = 2400;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function validateCart(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const rows = [];
  let totalUnits = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { id, size, color, quantity } = entry;
    if (!Object.hasOwn(PRODUCTS, id) || !SIZES.has(size) || !COLORS.has(color)) return null;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 12) return null;
    totalUnits += quantity;
    if (totalUnits > 12) return null;
    rows.push({ id, size, color, quantity });
  }
  return rows;
}

export async function onRequestPost({ request, env }) {
  // Separate launch gates. This endpoint is deliberately TEST-MODE ONLY until
  // independently reviewed holiday webhooks and fulfillment are operational.
  if (env.RN_HOLIDAY_CHECKOUT_ENABLED !== "true") {
    return json({ error: "Holiday checkout is not available yet." }, 503);
  }
  if (!/^sk_test_[A-Za-z0-9]+$/.test(String(env.STRIPE_SECRET_KEY || ""))) {
    return json({ error: "Holiday test checkout is not configured." }, 503);
  }
  const siteUrl = String(env.SITE_URL || "https://reasonablenoise.com").replace(/\/$/, "");
  let siteOrigin;
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    return json({ error: "Checkout configuration error." }, 503);
  }
  if (request.headers.get("origin") !== siteOrigin) {
    return json({ error: "Invalid checkout origin." }, 403);
  }
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON required." }, 415);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return json({ error: "Cart is too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const items = validateCart(body?.items);
  if (!items) return json({ error: "Choose valid shirt designs, sizes, colors and quantities." }, 400);

  const reference = "RNH-" + crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", siteUrl + "/holiday-order-return?session_id={CHECKOUT_SESSION_ID}");
  params.set("cancel_url", siteUrl + "/holiday-shirts?checkout=cancelled");
  params.set("client_reference_id", reference);
  params.set("billing_address_collection", "auto");
  params.set("phone_number_collection[enabled]", "true");
  params.set("shipping_address_collection[allowed_countries][0]", "US");
  params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "999");
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
  params.set("shipping_options[0][shipping_rate_data][display_name]", "Standard US shipping");
  params.set("metadata[source]", "reasonablenoise");
  params.set("metadata[order_type]", "holiday_shirt_test");
  params.set("metadata[order_reference]", reference);
  params.set("metadata[fulfillment_status]", "manual_review_only");
  items.forEach(({ id, size, color, quantity }, i) => {
    const prefix = `line_items[${i}]`;
    params.set(`${prefix}[quantity]`, String(quantity));
    params.set(`${prefix}[price_data][currency]`, "usd");
    params.set(`${prefix}[price_data][unit_amount]`, String(UNIT_CENTS));
    params.set(`${prefix}[price_data][product_data][name]`, PRODUCTS[id] + " — " + size + " / " + color);
    params.set(`${prefix}[price_data][product_data][description]`, "Seasonal holiday T-shirt; artwork subject to print approval.");
  });

  let response;
  try {
    response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.STRIPE_SECRET_KEY,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": reference,
      },
      body: params.toString(),
    });
  } catch {
    return json({ error: "Unable to start checkout. Please try again." }, 502);
  }
  if (!response.ok) return json({ error: "Unable to start checkout. Please try again." }, 502);
  const session = await response.json();
  if (!/^https:\/\/checkout\.stripe\.com\//.test(String(session?.url || ""))) {
    return json({ error: "Invalid checkout destination." }, 502);
  }
  return json({ url: session.url });
}

export const __holidayTest = { validateCart, PRODUCTS, UNIT_CENTS };
