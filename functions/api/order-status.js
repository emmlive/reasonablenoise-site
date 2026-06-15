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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSiteUrl(env) {
  return (env.SITE_URL || "https://reasonablenoise.com").replace(/\/$/, "");
}

function getLogoUrl(env) {
  return `${getSiteUrl(env)}/assets/rn-logo.png`;
}

function customerCanBeNotified(record, status) {
  const email = clean(record?.customer?.email || "", 300);

  if (!email || email === "Not provided") {
    return false;
  }

  return status === "ready_for_pickup" || status === "shipped";
}

function getStatusEmailSubject(record, status) {
  const orderReference = record?.order_reference || "your order";

  if (status === "ready_for_pickup") {
    return `Your ReasonableNoise order is ready for pickup - ${orderReference}`;
  }

  if (status === "shipped") {
    return `Your ReasonableNoise order has shipped - ${orderReference}`;
  }

  return `ReasonableNoise order update - ${orderReference}`;
}

function buildCustomerStatusEmailHtml(record, status, env) {
  const logoUrl = getLogoUrl(env);
  const siteUrl = getSiteUrl(env);
  const fulfillment = record.fulfillment || {};
  const order = record.order || {};
  const customer = record.customer || {};

  const headline =
    status === "ready_for_pickup"
      ? "Your order is ready for pickup."
      : "Your order has shipped.";

  const body =
    status === "ready_for_pickup"
      ? "Good news — your ReasonableNoise order is ready for pickup. Please reply to this email if you need help coordinating pickup."
      : "Good news — your ReasonableNoise order has shipped. Tracking details are included below when available.";

  const trackingHtml =
    status === "shipped"
      ? `
        <div style="margin-top:18px;padding:18px;border:1px solid #e5e7eb;border-radius:18px;background:#f9fafb;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Shipping details</h2>
          <p style="margin:0 0 8px;"><strong>Carrier:</strong> ${escapeHtml(fulfillment.carrier || "Not provided")}</p>
          <p style="margin:0 0 8px;"><strong>Tracking number:</strong> ${escapeHtml(fulfillment.tracking_number || "Not provided")}</p>
          ${fulfillment.tracking_url ? `
            <p style="margin:14px 0 0;">
              <a href="${escapeHtml(fulfillment.tracking_url)}" style="display:inline-block;background:#050608;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">
                Track shipment
              </a>
            </p>
          ` : ""}
        </div>
      `
      : `
        <div style="margin-top:18px;padding:18px;border:1px solid #e5e7eb;border-radius:18px;background:#f9fafb;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Pickup details</h2>
          <p style="margin:0;color:#374151;">Reply to this email if you need pickup timing or pickup instructions.</p>
        </div>
      `;

  return `
    <div style="margin:0;padding:24px;background:#050608;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="padding:26px 30px;border-bottom:1px solid #eef2f7;background:#ffffff;">
          <img src="${escapeHtml(logoUrl)}" alt="ReasonableNoise" style="width:72px;height:72px;border-radius:18px;display:block;margin-bottom:14px;" />
          <p style="margin:0;color:#6b7280;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;font-weight:800;">Order update</p>
          <h1 style="margin:8px 0 0;font-size:30px;line-height:1.1;color:#111827;">${escapeHtml(headline)}</h1>
        </div>

        <div style="padding:30px;">
          <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#374151;">
            Hi ${escapeHtml(customer.name || "there")}, ${escapeHtml(body)}
          </p>

          <div style="padding:18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
            <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Order summary</h2>
            <p style="margin:0 0 8px;"><strong>Order reference:</strong> ${escapeHtml(record.order_reference || "")}</p>
            <p style="margin:0 0 8px;"><strong>Current status:</strong> ${escapeHtml(record.status_label || "")}</p>
            <p style="margin:0 0 8px;"><strong>Order type:</strong> ${escapeHtml(order.sticker_type || "Sticker order")}</p>
            <p style="margin:0;"><strong>Fulfillment:</strong> ${escapeHtml(order.fulfillment_method || "Not provided")}</p>
          </div>

          ${trackingHtml}

          <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#6b7280;">
            Questions? Reply to this email or visit <a href="${escapeHtml(siteUrl)}" style="color:#111827;font-weight:700;">ReasonableNoise</a>.
          </p>
        </div>
      </div>
    </div>
  `;
}

function buildCustomerStatusEmailText(record, status, env) {
  const fulfillment = record.fulfillment || {};
  const order = record.order || {};

  const headline =
    status === "ready_for_pickup"
      ? "Your order is ready for pickup."
      : "Your order has shipped.";

  const trackingText =
    status === "shipped"
      ? `
Shipping details
Carrier: ${fulfillment.carrier || "Not provided"}
Tracking number: ${fulfillment.tracking_number || "Not provided"}
Tracking URL: ${fulfillment.tracking_url || "Not provided"}
`
      : `
Pickup details
Reply to this email if you need pickup timing or pickup instructions.
`;

  return `
${headline}

Order reference: ${record.order_reference || ""}
Current status: ${record.status_label || ""}
Order type: ${order.sticker_type || "Sticker order"}
Fulfillment: ${order.fulfillment_method || "Not provided"}

${trackingText}

Questions? Reply to this email or visit ${getSiteUrl(env)}.
`.trim();
}

async function sendCustomerStatusEmail(env, record, status) {
  if (!customerCanBeNotified(record, status)) {
    return {
      sent: false,
      skipped: true,
      reason: "Status is internal-only or customer email is missing.",
    };
  }

  if (!env.RESEND_API_KEY) {
    return {
      sent: false,
      skipped: true,
      reason: "RESEND_API_KEY is not configured.",
    };
  }

  const to = clean(record?.customer?.email || "", 300);
  const from = env.ORDER_FROM_EMAIL || "ReasonableNoise Orders <onboarding@resend.dev>";

  const payload = {
    from,
    to,
    subject: getStatusEmailSubject(record, status),
    html: buildCustomerStatusEmailHtml(record, status, env),
    text: buildCustomerStatusEmailText(record, status, env),
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      sent: false,
      skipped: false,
      error: data?.message || "Resend customer status email failed.",
    };
  }

  return {
    sent: true,
    skipped: false,
    id: data?.id || null,
  };
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

  const customerEmailResult = await sendCustomerStatusEmail(env, record, status);

  record.timeline.push({
    status: customerEmailResult.sent ? "customer_email_sent" : "customer_email_not_sent",
    label: customerEmailResult.sent ? "Customer email sent" : "Customer email not sent",
    at: new Date().toISOString(),
    note: customerEmailResult.sent
      ? `Customer status email sent for ${STATUS_LABELS[status]}.`
      : customerEmailResult.reason || customerEmailResult.error || "Customer status email was not sent.",
    source: "admin_status_update_page",
    email_id: customerEmailResult.id || "",
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
    customer_email_sent: Boolean(customerEmailResult.sent),
    customer_email_result: customerEmailResult,
  });
}
