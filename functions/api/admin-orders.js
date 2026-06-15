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

function isAuthorized(request, env) {
  const url = new URL(request.url);
  const token = clean(
    url.searchParams.get("token") ||
      request.headers.get("x-admin-order-token") ||
      "",
    500
  );

  const expected = getAdminToken(env);

  return Boolean(expected && token && token === expected);
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
