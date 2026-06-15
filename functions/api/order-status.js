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

const STATUS_LABELS = {
  order_received: "Order received",
  artwork_review_started: "Artwork review started",
  ready_for_pickup: "Ready for pickup",
  shipped: "Shipped",
  completed: "Completed",
};

function isAllowedStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status);
}

async function readOrderRecord(env, orderReference) {
  if (!env.ARTWORK_BUCKET) {
    return {
      ok: false,
      status: 500,
      error: "ARTWORK_BUCKET is not configured.",
    };
  }

  const key = getOrderRecordKey(orderReference);
  const object = await env.ARTWORK_BUCKET.get(key);

  if (!object) {
    return {
      ok: false,
      status: 404,
      error: "Order record was not found.",
      key,
    };
  }

  const record = await object.json().catch(() => null);

  if (!record) {
    return {
      ok: false,
      status: 500,
      error: "Order record could not be parsed.",
      key,
    };
  }

  return {
    ok: true,
    key,
    record,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const orderReference = clean(url.searchParams.get("order_ref") || url.searchParams.get("orderReference"), 140);

  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized order status request." }, 401);
  }

  if (!orderReference) {
    return json({ success: false, error: "Missing order reference." }, 400);
  }

  const result = await readOrderRecord(env, orderReference);

  if (!result.ok) {
    return json({ success: false, error: result.error, key: result.key || "" }, result.status || 500);
  }

  return json({
    success: true,
    key: result.key,
    record: result.record,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));

  if (!isAuthorized(request, env, body)) {
    return json({ success: false, error: "Unauthorized order status update." }, 401);
  }

  const orderReference = clean(body.orderReference || body.order_ref, 140);
  const status = clean(body.status, 80);

  if (!orderReference) {
    return json({ success: false, error: "Missing order reference." }, 400);
  }

  if (!isAllowedStatus(status)) {
    return json({ success: false, error: "Invalid order status." }, 400);
  }

  const result = await readOrderRecord(env, orderReference);

  if (!result.ok) {
    return json({ success: false, error: result.error, key: result.key || "" }, result.status || 500);
  }

  const now = new Date().toISOString();
  const record = result.record;

  record.status = status;
  record.status_label = STATUS_LABELS[status];
  record.updated_at = now;

  record.fulfillment = record.fulfillment || {};
  record.fulfillment.carrier = clean(body.carrier, 120);
  record.fulfillment.tracking_number = clean(body.trackingNumber || body.tracking_number, 180);
  record.fulfillment.tracking_url = clean(body.trackingUrl || body.tracking_url, 700);

  record.timeline = Array.isArray(record.timeline) ? record.timeline : [];
  record.timeline.push({
    status,
    label: STATUS_LABELS[status],
    at: now,
    note: clean(body.note, 700),
    carrier: record.fulfillment.carrier || "",
    tracking_number: record.fulfillment.tracking_number || "",
    tracking_url: record.fulfillment.tracking_url || "",
    source: "admin_status_update_page",
  });

  await env.ARTWORK_BUCKET.put(result.key, JSON.stringify(record, null, 2), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
    },
  });

  return json({
    success: true,
    key: result.key,
    status,
    status_label: STATUS_LABELS[status],
    updated_at: now,
    record,
    customer_email_sent: false,
  });
}
