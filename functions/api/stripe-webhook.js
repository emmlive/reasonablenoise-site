function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUsd(amountCents, currency = "usd") {
  const amount = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase(),
  }).format(amount);
}


function formatFileSize(bytes) {
  const parsed = Number(bytes || 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "Not uploaded";
  }

  if (parsed < 1024) return `${parsed} B`;
  if (parsed < 1024 * 1024) return `${Math.round(parsed / 1024)} KB`;

  return `${(parsed / (1024 * 1024)).toFixed(1)} MB`;
}

function parseStripeSignature(header) {
  const parts = String(header || "").split(",");
  const parsed = { timestamp: "", signatures: [] };

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") parsed.timestamp = value;
    if (key === "v1") parsed.signatures.push(value);
  }

  return parsed;
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeCompareHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;

  const { timestamp, signatures } = parseStripeSignature(signatureHeader);

  if (!timestamp || signatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const toleranceSeconds = 300;

  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = await hmacSha256Hex(webhookSecret, signedPayload);

  return signatures.some((signature) => safeCompareHex(signature, expectedSignature));
}

function formatAddress(address) {
  if (!address) return "No shipping address";

  const lines = [
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(", "),
    address.country,
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "No shipping address";
}

function orderDetailsFromSession(session) {
  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};
  const shippingDetails = session.shipping_details || {};

  return {
    sessionId: session.id || "",
    paymentStatus: session.payment_status || "",
    orderReference: metadata.order_reference || session.client_reference_id || session.id || "",
    amountTotal: formatUsd(session.amount_total, session.currency),
    amountTotalCents: Number(session.amount_total || 0),
    amountSubtotalCents: Number(session.amount_subtotal || 0),
    currency: String(session.currency || "usd").toUpperCase(),
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : "",

    checkoutPriceLabel: metadata.checkout_price_label || "",
    checkoutPriceCents: metadata.checkout_price_cents || "",
    checkoutPriceSource: metadata.checkout_price_source || "",
    shippingPriceLabel: metadata.shipping_price_label || "",
    shippingPriceCents: metadata.shipping_price_cents || "",
    shippingPriceSource: metadata.shipping_price_source || "",
    shippingPriceNote: metadata.shipping_price_note || "",

    customerName:
      metadata.customer_name ||
      customerDetails.name ||
      "Not provided",

    businessName: metadata.business_name || "Not provided",

    email:
      metadata.email ||
      customerDetails.email ||
      session.customer_email ||
      "Not provided",

    phone:
      metadata.phone ||
      customerDetails.phone ||
      "Not provided",

    stickerType: metadata.sticker_type || "Sticker order",
    fulfillmentMethod: metadata.fulfillment_method || "Not provided",
    usdotNumber: metadata.usdot_number || "Not provided",
    decalDisplayName: metadata.decal_display_name || "Not provided",
    size: metadata.size || "Not provided",
    quantity: metadata.quantity || "Not provided",
    colorPreference: metadata.color_preference || "Not provided",
    material: metadata.material || "Not provided",
    notes: metadata.notes || "None",

    artworkObjectKey: metadata.artwork_object_key || "",
    artworkFilename: metadata.artwork_filename || "",
    artworkSize: metadata.artwork_size || "",
    artworkType: metadata.artwork_type || "",
    uploadId: metadata.upload_id || "",

    shippingName: shippingDetails.name || customerDetails.name || "Not provided",
    shippingAddress: formatAddress(shippingDetails.address),
  };
}


function getOrderRecordKey(orderReference) {
  const safeReference = String(orderReference || "unknown-order")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

  return `orders/status/${safeReference || "unknown-order"}.json`;
}

function buildInitialOrderRecord(order, event) {
  const now = new Date().toISOString();

  return {
    order_reference: order.orderReference || "",
    status: "order_received",
    status_label: "Order received",
    created_at: now,
    updated_at: now,
    source: "stripe_webhook",
    stripe: {
      event_id: event?.id || "",
      session_id: order.sessionId || "",
      payment_intent_id: order.paymentIntentId || "",
      payment_status: order.paymentStatus || "",
      amount_total: order.amountTotal || "",
      amount_total_cents: Number(order.amountTotalCents || 0),
      amount_subtotal_cents: Number(order.amountSubtotalCents || 0),
      currency: order.currency || "USD",
      checkout_price_label: order.checkoutPriceLabel || "",
      checkout_price_cents: order.checkoutPriceCents || "",
      checkout_price_source: order.checkoutPriceSource || "",
      shipping_price_label: order.shippingPriceLabel || "",
      shipping_price_cents: order.shippingPriceCents || "",
      shipping_price_source: order.shippingPriceSource || "",
      shipping_price_note: order.shippingPriceNote || "",
    },
    customer: {
      name: order.customerName || "",
      business_name: order.businessName || "",
      email: order.email || "",
      phone: order.phone || "",
    },
    order: {
      sticker_type: order.stickerType || "",
      fulfillment_method: order.fulfillmentMethod || "",
      usdot_number: order.usdotNumber || "",
      decal_display_name: order.decalDisplayName || "",
      size: order.size || "",
      quantity: order.quantity || "",
      color_preference: order.colorPreference || "",
      material: order.material || "",
      notes: order.notes || "",
    },
    artwork: {
      object_key: order.artworkObjectKey || "",
      filename: order.artworkFilename || "",
      size: order.artworkSize || "",
      type: order.artworkType || "",
      upload_id: order.uploadId || "",
    },
    fulfillment: {
      shipping_name: order.shippingName || "",
      shipping_address: order.shippingAddress || "",
    },
    timeline: [
      {
        status: "order_received",
        label: "Order received",
        at: now,
        note: "Customer completed Stripe Checkout. Initial confirmation emails were sent or attempted.",
      },
    ],
  };
}

async function storeInitialOrderRecord(env, order, event) {
  const key = getOrderRecordKey(order?.orderReference);

  if (!env.ARTWORK_BUCKET) {
    return {
      stored: false,
      key,
      skipped: true,
      error: "ARTWORK_BUCKET is not configured.",
    };
  }

  try {
    const existing = await env.ARTWORK_BUCKET.get(key);

    if (existing) {
      return {
        stored: false,
        key,
        existing: true,
      };
    }

    const record = buildInitialOrderRecord(order, event);

    await env.ARTWORK_BUCKET.put(key, JSON.stringify(record, null, 2), {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
    });

    return {
      stored: true,
      key,
      existing: false,
    };
  } catch (error) {
    return {
      stored: false,
      key,
      error: String(error?.message || error),
    };
  }
}

function getAdminArtworkDownloadUrl(order, env) {
  if (!order || !order.artworkObjectKey || !env || !env.ADMIN_DOWNLOAD_TOKEN) {
    return "";
  }

  const siteUrl = getSiteUrl(env);
  const key = encodeURIComponent(order.artworkObjectKey);
  const token = encodeURIComponent(env.ADMIN_DOWNLOAD_TOKEN);

  return `${siteUrl}/api/download-artwork?key=${key}&token=${token}`;
}
function buildEmailHtml(order, env) {
  const fulfillmentLabel =
    order.fulfillmentMethod === "shipping"
      ? "Shipping"
      : order.fulfillmentMethod === "local_pickup"
        ? "Local pickup"
        : order.fulfillmentMethod;

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 720px;">
      <h1 style="margin: 0 0 8px;">New paid ReasonableNoise order</h1>
      <p style="margin: 0 0 24px; color: #4b5563;">
        A customer completed Stripe Checkout.
      </p>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px;">Payment</h2>
        <p><strong>Order reference:</strong> ${escapeHtml(order.orderReference)}</p>
        <p><strong>Total paid:</strong> ${escapeHtml(order.amountTotal)}</p>
        <p><strong>Payment status:</strong> ${escapeHtml(order.paymentStatus)}</p>
        <p><strong>Stripe Checkout Session:</strong> ${escapeHtml(order.sessionId)}</p>
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px;">Customer</h2>
        <p><strong>Name:</strong> ${escapeHtml(order.customerName)}</p>
        <p><strong>Business:</strong> ${escapeHtml(order.businessName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(order.email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(order.phone)}</p>
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px;">Order details</h2>
        <p><strong>Sticker type:</strong> ${escapeHtml(order.stickerType)}</p>
        <p><strong>Fulfillment:</strong> ${escapeHtml(fulfillmentLabel)}</p>
        <p><strong>USDOT number:</strong> ${escapeHtml(order.usdotNumber)}</p>
        <p><strong>Display name on decal:</strong> ${escapeHtml(order.decalDisplayName)}</p>
        <p><strong>Size:</strong> ${escapeHtml(order.size)}</p>
        <p><strong>Quantity:</strong> ${escapeHtml(order.quantity)}</p>
        <p><strong>Color:</strong> ${escapeHtml(order.colorPreference)}</p>
        <p><strong>Material:</strong> ${escapeHtml(order.material)}</p>
        <p><strong>Notes:</strong><br />${escapeHtml(order.notes).replaceAll("\n", "<br />")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <p><strong>Artwork file:</strong> ${escapeHtml(order.artworkFilename || "Not uploaded")}</p>
        <p><strong>Artwork size:</strong> ${escapeHtml(formatFileSize(order.artworkSize))}</p>
        <p><strong>Artwork type:</strong> ${escapeHtml(order.artworkType || "Not uploaded")}</p>
        <p><strong>R2 private key:</strong><br />${escapeHtml(order.artworkObjectKey || "Not uploaded")}</p>
        <p><strong>Upload ID:</strong> ${escapeHtml(order.uploadId || "Not uploaded")}</p>
        ${getAdminArtworkDownloadUrl(order, env) ? `
          <div style="margin-top:16px;">
            <a href="${escapeHtml(getAdminArtworkDownloadUrl(order, env))}" style="display:inline-block;background:#050608;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:800;">
              Download artwork securely
            </a>
          </div>
        ` : ""}
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px;">
        <h2 style="margin: 0 0 12px;">Shipping</h2>
        <p><strong>Shipping name:</strong> ${escapeHtml(order.shippingName)}</p>
        <p style="white-space: pre-line;"><strong>Shipping address:</strong><br />${escapeHtml(order.shippingAddress)}</p>
      </div>
    </div>
  `;
}

function buildEmailText(order, env) {
  return `
New paid ReasonableNoise order

Payment
Order reference: ${order.orderReference}
Total paid: ${order.amountTotal}
Payment status: ${order.paymentStatus}
Stripe Checkout Session: ${order.sessionId}

Customer
Name: ${order.customerName}
Business: ${order.businessName}
Email: ${order.email}
Phone: ${order.phone}

Order details
Sticker type: ${order.stickerType}
Fulfillment: ${order.fulfillmentMethod}
USDOT number: ${order.usdotNumber}
Display name on decal: ${order.decalDisplayName}
Size: ${order.size}
Quantity: ${order.quantity}
Color: ${order.colorPreference}
Material: ${order.material}
Notes: ${order.notes}

Artwork
Artwork file: ${order.artworkFilename || "Not uploaded"}
Artwork size: ${formatFileSize(order.artworkSize)}
Artwork type: ${order.artworkType || "Not uploaded"}
R2 private key: ${order.artworkObjectKey || "Not uploaded"}
Upload ID: ${order.uploadId || "Not uploaded"}
Download artwork: ${getAdminArtworkDownloadUrl(order, env) || "Not available"}

Shipping
Shipping name: ${order.shippingName}
Shipping address:
${order.shippingAddress}
`.trim();
}

async function sendOrderEmail(env, order) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (!env.ORDER_NOTIFY_EMAIL) {
    throw new Error("ORDER_NOTIFY_EMAIL is not configured.");
  }

  const from = env.ORDER_FROM_EMAIL || "ReasonableNoise Orders <onboarding@resend.dev>";

  const payload = {
    from,
    to: env.ORDER_NOTIFY_EMAIL,
    subject: `New paid ReasonableNoise order ${order.orderReference} - ${order.amountTotal}`,
    html: buildEmailHtml(order, env),
    text: buildEmailText(order, env),
  };

  if (order.email && order.email !== "Not provided") {
    payload.reply_to = order.email;
  }

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
    throw new Error(data?.message || "Resend email failed.");
  }

  return data;
}



function getSiteUrl(env) {
  return (env.SITE_URL || "https://reasonablenoise.com").replace(/\/$/, "");
}

function getLogoUrl(env) {
  return `${getSiteUrl(env)}/assets/rn-logo.png`;
}

function buildCustomerConfirmationHtml(order, env) {
  const logoUrl = getLogoUrl(env);
  const siteUrl = getSiteUrl(env);

  const fulfillmentLabel =
    order.fulfillmentMethod === "shipping"
      ? "Shipping"
      : order.fulfillmentMethod === "local_pickup"
        ? "Local pickup"
        : order.fulfillmentMethod || "Not provided";

  const nextStep =
    order.fulfillmentMethod === "shipping"
      ? "We will review your order details and prepare your stickers for shipment. If we need anything else, we will contact you."
      : "We will review your order details and follow up when your stickers are ready for local pickup.";

  return `
    <div style="margin:0;padding:24px;background:#050608;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:#050608;padding:30px 34px;border-bottom:1px solid #1f2937;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="76" style="vertical-align:middle;">
                <img src="${logoUrl}" alt="ReasonableNoise logo" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:18px;background:#050608;border:1px solid rgba(255,255,255,0.16);" />
              </td>
              <td style="vertical-align:middle;padding-left:14px;">
                <div style="font-size:13px;letter-spacing:3px;color:#67e8f9;font-weight:800;text-transform:uppercase;">Payment received</div>
                <div style="font-size:28px;line-height:1.2;color:#ffffff;font-weight:800;margin-top:7px;">Your sticker order has started.</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:34px;">
          <p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:#374151;">
            Thank you for your order. We received your payment and order details successfully. ReasonableNoise will review your sticker request and prepare the next step.
          </p>

          <div style="margin:0 0 22px;padding:20px;border:1px solid #e5e7eb;border-radius:18px;background:#f9fafb;">
            <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Payment summary</h2>
            <p style="margin:6px 0;color:#374151;"><strong>Total paid:</strong> ${escapeHtml(order.amountTotal || "Not provided")}</p>
            <p style="margin:6px 0;color:#374151;"><strong>Payment status:</strong> ${escapeHtml(order.paymentStatus || "Paid")}</p>
          </div>

          <div style="margin:0 0 22px;padding:20px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
            <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Order details</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;">
              <tr><td style="padding:8px 0;color:#6b7280;">Sticker type</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.stickerType || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Fulfillment</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(fulfillmentLabel)}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">USDOT number</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.usdotNumber || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Display name</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.decalDisplayName || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Size</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.size || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Quantity</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.quantity || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Color</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.colorPreference || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Material</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.material || "Not provided")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Artwork file</td><td style="padding:8px 0;color:#111827;font-weight:700;">${escapeHtml(order.artworkFilename || "Not uploaded")}</td></tr>
            </table>
          </div>

          <div style="margin:0 0 24px;padding:20px;border:1px solid #e5e7eb;border-radius:18px;background:#f9fafb;">
            <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Next step</h2>
            <p style="margin:0;color:#374151;line-height:1.7;">${escapeHtml(nextStep)}</p>
          </div>

          <div style="text-align:center;margin-top:28px;">
            <a href="${siteUrl}/upload-design/" style="display:inline-block;background:#050608;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:800;">
              Start another order
            </a>
          </div>

          <p style="margin:28px 0 0;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">
            If anything looks incorrect, reply to this email and we will help you update your order.
          </p>
        </div>
      </div>
    </div>
  `;
}
function buildCustomerConfirmationText(order) {
  return `
Your ReasonableNoise order ${order.orderReference} has started

Order reference: ${order.orderReference}

Thank you. We received your payment and order details.

Payment
Total paid: ${order.amountTotal}
Status: ${order.paymentStatus}

Order summary
Sticker type: ${order.stickerType}
Fulfillment: ${order.fulfillmentMethod}
USDOT number: ${order.usdotNumber}
Display name on decal: ${order.decalDisplayName}
Size: ${order.size}
Quantity: ${order.quantity}
Color: ${order.colorPreference}
Material: ${order.material}

Next step
We will review your order details and follow up if we need anything else.

If anything looks incorrect, reply to this email with your correction.
`.trim();
}

async function sendCustomerConfirmationEmail(env, order) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, skipped: true, error: "RESEND_API_KEY is not configured." };
  }

  if (!order.email || order.email === "Not provided") {
    return { sent: false, skipped: true, error: "Customer email is missing." };
  }

  const from = env.ORDER_FROM_EMAIL || "ReasonableNoise Orders <orders@reasonablenoise.com>";

  const payload = {
    from,
    to: order.email,
    subject: `Your ReasonableNoise order ${order.orderReference} has started`,
    html: buildCustomerConfirmationHtml(order, env),
    text: buildCustomerConfirmationText(order),
  };

  if (env.ORDER_NOTIFY_EMAIL) {
    payload.reply_to = env.ORDER_NOTIFY_EMAIL;
  }

  try {
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
      return { sent: false, skipped: false, error: data?.message || "Customer email failed." };
    }

    return { sent: true, id: data?.id || null };
  } catch (error) {
    return { sent: false, skipped: false, error: String(error?.message || error) };
  }
}



function getStripeEventMarkerKey(eventId) {
  const safeId = String(eventId || "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 160);

  return safeId ? `system/stripe-events/${safeId}.json` : "";
}

async function hasProcessedStripeEvent(env, eventId) {
  if (!env.ARTWORK_BUCKET || !eventId) {
    return false;
  }

  const markerKey = getStripeEventMarkerKey(eventId);
  if (!markerKey) return false;

  const existing = await env.ARTWORK_BUCKET.get(markerKey);
  return Boolean(existing);
}

async function markStripeEventProcessed(env, eventId, details = {}) {
  if (!env.ARTWORK_BUCKET || !eventId) {
    return;
  }

  const markerKey = getStripeEventMarkerKey(eventId);
  if (!markerKey) return;

  await env.ARTWORK_BUCKET.put(
    markerKey,
    JSON.stringify({
      eventId,
      processedAt: new Date().toISOString(),
      ...details,
    }, null, 2),
    {
      httpMetadata: {
        contentType: "application/json",
      },
    }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      return json({ success: false, error: "STRIPE_WEBHOOK_SECRET is not configured." }, 500);
    }

    const rawBody = await request.text();
    const signatureHeader = request.headers.get("stripe-signature");

    const isValid = await verifyStripeSignature(
      rawBody,
      signatureHeader,
      env.STRIPE_WEBHOOK_SECRET
    );

    if (!isValid) {
      return json({ success: false, error: "Invalid Stripe signature." }, 400);
    }

    const event = JSON.parse(rawBody);

    if (event.type !== "checkout.session.completed") {
      return json({
        success: true,
        received: true,
        ignored: event.type,
      });
    }

    const session = event.data?.object;

    if (!session) {
      return json({ success: false, error: "Missing checkout session." }, 400);
    }

    const alreadyProcessed = await hasProcessedStripeEvent(env, event.id);

    if (alreadyProcessed) {
      return json({
        success: true,
        received: true,
        duplicate: true,
        skipped_emails: true,
        event_id: event.id,
      });
    }

    const order = orderDetailsFromSession(session);
    const orderRecordResult = await storeInitialOrderRecord(env, order, event);
    const emailResult = await sendOrderEmail(env, order);
    const customerEmailResult = await sendCustomerConfirmationEmail(env, order);

    await markStripeEventProcessed(env, event.id, {
      checkoutSessionId: session.id || "",
      orderReference: order.orderReference || "",
      orderRecordKey: orderRecordResult?.key || "",
      orderRecordStored: Boolean(orderRecordResult?.stored),
      emailId: emailResult?.id || null,
      customerEmailId: customerEmailResult?.id || null,
    });

    return json({
      success: true,
      received: true,
      duplicate: false,
      event_id: event.id,
      email_id: emailResult?.id || null,
      customer_email_result: customerEmailResult,
      order_record: orderRecordResult,
    });
  } catch (error) {
    return json({
      success: false,
      error: String(error?.message || error),
    }, 500);
  }
}

export async function onRequestGet() {
  return json({
    success: true,
    message: "ReasonableNoise Stripe webhook endpoint is available. Use POST from Stripe.",
  });
}







