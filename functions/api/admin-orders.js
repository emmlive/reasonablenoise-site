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

// Admin-only, read-only Siteverify connectivity probe. These are public Cloudflare
// TEST credentials: no real challenge tokens or customer data are used.
const RN_TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const RN_TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const RN_SAFE_SITEVERIFY_CODES = new Set([
  "missing-input-secret", "invalid-input-secret", "missing-input-response",
  "invalid-input-response", "bad-request", "timeout-or-duplicate", "internal-error"
]);

async function probeTurnstileSiteverify(secret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: RN_TURNSTILE_DUMMY_TOKEN,
      }),
      signal: controller.signal,
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      // An upstream HTTP error can have a non-JSON body; never echo that body.
      return response.ok
        ? { result: "invalid_json", http_status: response.status }
        : { result: "upstream_http_error", http_status: response.status, error_codes: [] };
    }

    const errorCodes = Array.isArray(payload?.["error-codes"])
      ? payload["error-codes"].filter(code => RN_SAFE_SITEVERIFY_CODES.has(code)).slice(0, 5)
      : [];

    if (!response.ok) {
      return { result: "upstream_http_error", http_status: response.status, error_codes: errorCodes };
    }
    if (!payload || typeof payload !== "object" || typeof payload.success !== "boolean") {
      return { result: "invalid_schema", http_status: response.status };
    }

    return {
      result: "siteverify_reached",
      http_status: response.status,
      success: payload.success,
      error_codes: errorCodes,
    };
  } catch {
    return { result: "fetch_or_runtime_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleAdminTurnstileProbe(env) {
  const testPair = await probeTurnstileSiteverify(RN_TURNSTILE_TEST_SECRET);
  const configuredSecret = String(env.DTF_TURNSTILE_SECRET || "").trim();
  const productionSecret = configuredSecret
    ? await probeTurnstileSiteverify(configuredSecret)
    : { result: "secret_not_configured" };

  const response = json({
    success: true,
    diagnostic: "turnstile_siteverify_admin_probe",
    test_pair: testPair,
    production_secret: productionSecret,
    // A production key must not be the publicly documented always-pass test key.
    production_uses_test_secret: configuredSecret === RN_TURNSTILE_TEST_SECRET,
    note: "An invalid dummy token is expected to fail verification with a production secret. This probe never approves a customer request.",
  });
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized admin orders request." }, 401);
  }

  if (url.searchParams.get("turnstile_probe") === "1") {
    return handleAdminTurnstileProbe(env);
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


/**
 * Admin-only diagnostic using a REAL, fresh Turnstile token from the Admin Orders
 * widget. It consumes the diagnostic token and MUST NEVER write orders/artwork,
 * call Stripe or send email. It does not grant a bypass to any other endpoint.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("turnstile_real_verify") !== "1") {
    return json({ success: false, error: "Not found." }, 404);
  }
  if (!isAuthorized(request, env)) {
    return json({ success: false, error: "Unauthorized admin diagnostic request." }, 401);
  }

  const secret = String(env.DTF_TURNSTILE_SECRET || "").trim();
  if (!secret) return json({ success: false, error: "Production Turnstile secret is not configured." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "A JSON challenge token is required." }, 400);
  }
  const token = body?.token;
  if (typeof token !== "string" || !token || token.length > 2048) {
    return json({ success: false, error: "A fresh Turnstile token is required." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let result;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: controller.signal,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const errorCodes = Array.isArray(data?.["error-codes"])
      ? data["error-codes"].filter(code => RN_SAFE_SITEVERIFY_CODES.has(code)).slice(0, 5)
      : [];

    if (!response.ok) {
      result = { status: "upstream_http_error", verified: false, http_status: response.status, error_codes: errorCodes };
    } else if (data?.success !== true) {
      result = { status: "token_rejected", verified: false, http_status: response.status, error_codes: errorCodes };
    } else if (data.action !== "rn_admin_probe") {
      result = { status: "action_mismatch", verified: false, http_status: response.status };
    } else if (
      typeof data.hostname !== "string" ||
      data.hostname.toLowerCase() !== url.hostname.toLowerCase()
    ) {
      result = { status: "hostname_mismatch", verified: false, http_status: response.status };
    } else {
      result = { status: "verified", verified: true, http_status: response.status };
    }
  } catch {
    result = { status: "fetch_or_runtime_error", verified: false };
  } finally {
    clearTimeout(timeout);
  }
  const response = json({ success: true, diagnostic: "real_admin_turnstile_validation", result });
  response.headers.set("cache-control", "no-store");
  return response;
}
