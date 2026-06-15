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

function decodeAccessJwtEmail(jwt) {
  try {
    const parts = String(jwt || "").split(".");
    if (parts.length < 2) return "";

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded));

    return clean(payload.email || payload.common_name || "", 300).toLowerCase();
  } catch (error) {
    return "";
  }
}

function getCloudflareAccessEmail(request) {
  const directEmail = clean(
    request.headers.get("cf-access-authenticated-user-email") ||
      request.headers.get("Cf-Access-Authenticated-User-Email") ||
      "",
    300
  ).toLowerCase();

  if (directEmail) return directEmail;

  return decodeAccessJwtEmail(
    request.headers.get("cf-access-jwt-assertion") ||
      request.headers.get("Cf-Access-Jwt-Assertion") ||
      ""
  );
}

function getAllowedAdminEmails(env) {
  return String(env.ADMIN_ACCESS_EMAIL || "reasonablenoise@gmail.com")
    .split(",")
    .map((email) => clean(email, 300).toLowerCase())
    .filter(Boolean);
}

function isCloudflareAccessAuthorized(request, env) {
  const email = getCloudflareAccessEmail(request);
  const allowedEmails = getAllowedAdminEmails(env);

  return Boolean(email && allowedEmails.includes(email));
}

function isAuthorized(request, env, body = {}) {
  if (isCloudflareAccessAuthorized(request, env)) {
    return true;
  }

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

function summarizeOrder(record, key) {
  const customer = record.customer || {};
  const order = record.order || {};
  const stripe = record.stripe || {};
  const fulfillment = record.fulfillment || {};

  return {
    key,
    order_reference: record.order_reference || "",
    status: record.status || "",
    status_label: record.status_label || record.status || "",
    created_at: record.created_at || "",
    updated_at: record.updated_at || "",
    customer_name: customer.name || "",
    customer_email: customer.email || "",
    business_name: customer.business_name || "",
    order_type: order.sticker_type || "",
    fulfillment_method: order.fulfillment_method || "",
    amount_total: stripe.amount_total || "",
    shipping_name: fulfillment.shipping_name || "",
    tracking_number: fulfillment.tracking_number || "",
    carrier: fulfillment.carrier || "",
    source: record.source || "",
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized admin orders request." }, 401);
  }

  if (!env.ARTWORK_BUCKET) {
    return json({ success: false, error: "ARTWORK_BUCKET is not configured." }, 500);
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
  const cursor = clean(url.searchParams.get("cursor") || "", 500);

  const listOptions = {
    prefix: "orders/status/",
    limit,
  };

  if (cursor) {
    listOptions.cursor = cursor;
  }

  const listed = await env.ARTWORK_BUCKET.list(listOptions);

  const orders = [];

  for (const item of listed.objects || []) {
    try {
      const object = await env.ARTWORK_BUCKET.get(item.key);
      if (!object) continue;

      const record = await object.json().catch(() => null);
      if (!record) continue;

      orders.push(summarizeOrder(record, item.key));
    } catch (error) {
      orders.push({
        key: item.key,
        order_reference: "",
        status: "read_error",
        status_label: "Read error",
        updated_at: item.uploaded?.toISOString?.() || "",
        error: String(error?.message || error),
      });
    }
  }

  orders.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

  return json({
    success: true,
    orders,
    count: orders.length,
    cursor: listed.truncated ? listed.cursor || "" : "",
    truncated: Boolean(listed.truncated),
  });
}


export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized admin delete request." }, 401);
  }

  if (!env.ARTWORK_BUCKET) {
    return json({ success: false, error: "ARTWORK_BUCKET is not configured." }, 500);
  }

  const orderReference = clean(url.searchParams.get("order_ref") || url.searchParams.get("orderReference"), 140);

  if (!orderReference) {
    return json({ success: false, error: "Missing order reference." }, 400);
  }

  if (!orderReference.startsWith("RN-TEST-")) {
    return json({
      success: false,
      error: "Only RN-TEST-* records can be deleted from this endpoint.",
    }, 403);
  }

  const key = getOrderRecordKey(orderReference);
  const existing = await env.ARTWORK_BUCKET.get(key);

  if (!existing) {
    return json({
      success: false,
      error: "Test order record was not found.",
      key,
      order_reference: orderReference,
    }, 404);
  }

  await env.ARTWORK_BUCKET.delete(key);

  return json({
    success: true,
    deleted: true,
    key,
    order_reference: orderReference,
  });
}
