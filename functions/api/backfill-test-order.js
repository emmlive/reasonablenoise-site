function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function getAdminToken(env) {
  return clean(env.ADMIN_ORDER_TOKEN || env.ADMIN_DOWNLOAD_TOKEN || "", 500);
}

function isAuthorized(request, env, body = {}) {
  const url = new URL(request.url);
  const token = clean(
    url.searchParams.get("token") ||
      body.token ||
      request.headers.get("x-admin-order-token") ||
      "",
    500
  );

  const expected = getAdminToken(env);
  return Boolean(expected && token && token === expected);
}

function getOrderRecordKey(orderReference) {
  const safeReference = clean(orderReference, 140)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

  return `orders/status/${safeReference || "unknown-order"}.json`;
}

function generateTestReference() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const shortId = crypto.randomUUID().split("-")[0].toUpperCase();

  return `RN-TEST-${yyyy}${mm}${dd}-${shortId}`;
}

function buildTestOrderRecord(body = {}) {
  const now = new Date().toISOString();
  const orderReference = clean(body.orderReference || body.order_ref || generateTestReference(), 140);
  const email = clean(body.email || body.customerEmail || "", 300);

  return {
    order_reference: orderReference,
    status: "order_received",
    status_label: "Order received",
    created_at: now,
    updated_at: now,
    source: "admin_backfill_test_order",
    stripe: {
      event_id: "manual_test_record",
      session_id: "manual_test_record",
      payment_intent_id: "",
      payment_status: "manual_test",
      amount_total: "$0.00",
      amount_total_cents: 0,
      amount_subtotal_cents: 0,
      currency: "USD",
      checkout_price_label: "Manual test order",
      checkout_price_cents: "0",
      checkout_price_source: "admin_backfill_test_order",
      shipping_price_label: "",
      shipping_price_cents: "",
      shipping_price_source: "",
      shipping_price_note: "",
    },
    customer: {
      name: clean(body.name || "ReasonableNoise Test Customer", 200),
      business_name: clean(body.businessName || "Test Business", 200),
      email,
      phone: clean(body.phone || "Not provided", 80),
    },
    order: {
      sticker_type: clean(body.stickerType || "USDOT Sticker Pair - Test Order", 250),
      fulfillment_method: clean(body.fulfillmentMethod || "shipping", 80),
      usdot_number: clean(body.usdotNumber || "TEST-123456", 80),
      decal_display_name: clean(body.decalDisplayName || "ReasonableNoise Test", 250),
      size: clean(body.size || "12 x 4 inches", 120),
      quantity: clean(body.quantity || "1", 50),
      color_preference: clean(body.colorPreference || "White vinyl / black text", 160),
      material: clean(body.material || "Weatherproof vinyl", 160),
      notes: clean(body.notes || "Manual production smoke test record.", 700),
    },
    artwork: {
      object_key: "",
      filename: "No artwork - smoke test",
      size: "",
      type: "",
      upload_id: "",
    },
    fulfillment: {
      shipping_name: clean(body.shippingName || body.name || "ReasonableNoise Test Customer", 200),
      shipping_address: clean(
        body.shippingAddress ||
          "123 Test Street\nChicago, IL 60601\nUS",
        500
      ),
      carrier: "",
      tracking_number: "",
      tracking_url: "",
    },
    timeline: [
      {
        status: "order_received",
        label: "Order received",
        at: now,
        note: "Manual test/backfill order record created for production smoke testing.",
        source: "admin_backfill_test_order",
      },
    ],
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));

  if (!isAuthorized(request, env, body)) {
    return json({ success: false, error: "Unauthorized test order request." }, 401);
  }

  if (!env.ARTWORK_BUCKET) {
    return json({ success: false, error: "ARTWORK_BUCKET is not configured." }, 500);
  }

  const record = buildTestOrderRecord(body);
  const key = getOrderRecordKey(record.order_reference);

  const existing = await env.ARTWORK_BUCKET.get(key);

  if (existing && !body.overwrite) {
    return json({
      success: false,
      error: "Order record already exists. Pass overwrite=true to replace it.",
      key,
      order_reference: record.order_reference,
    }, 409);
  }

  await env.ARTWORK_BUCKET.put(key, JSON.stringify(record, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
    },
  });

  const siteUrl = clean(env.SITE_URL || "https://reasonablenoise.com", 300).replace(/\/$/, "");
  const token = encodeURIComponent(getAdminToken(env));
  const orderRef = encodeURIComponent(record.order_reference);

  return json({
    success: true,
    key,
    order_reference: record.order_reference,
    admin_update_url: `${siteUrl}/admin-order-update?order_ref=${orderRef}&token=${token}`,
    record,
  });
}
