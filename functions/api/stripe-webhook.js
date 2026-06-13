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
    amountTotal: formatUsd(session.amount_total, session.currency),
    currency: String(session.currency || "usd").toUpperCase(),

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

    shippingName: shippingDetails.name || customerDetails.name || "Not provided",
    shippingAddress: formatAddress(shippingDetails.address),
  };
}

function buildEmailHtml(order) {
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
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px;">
        <h2 style="margin: 0 0 12px;">Shipping</h2>
        <p><strong>Shipping name:</strong> ${escapeHtml(order.shippingName)}</p>
        <p style="white-space: pre-line;"><strong>Shipping address:</strong><br />${escapeHtml(order.shippingAddress)}</p>
      </div>
    </div>
  `;
}

function buildEmailText(order) {
  return `
New paid ReasonableNoise order

Payment
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
    subject: `New paid ReasonableNoise order - ${order.amountTotal}`,
    html: buildEmailHtml(order),
    text: buildEmailText(order),
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


function buildCustomerConfirmationHtml(order) {
  const fulfillmentLabel =
    order.fulfillmentMethod === "shipping"
      ? "Shipping"
      : order.fulfillmentMethod === "local_pickup"
        ? "Local pickup"
        : order.fulfillmentMethod;

  const nextStep =
    order.fulfillmentMethod === "shipping"
      ? "We will review your order details and follow up if we need anything else before preparing your stickers for shipment."
      : "We will review your order details and follow up when your stickers are ready for local pickup.";

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 680px;">
      <h1 style="margin: 0 0 8px;">Your ReasonableNoise order has started</h1>
      <p style="margin: 0 0 24px; color: #4b5563;">
        Thank you. We received your payment and order details.
      </p>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px;">Payment</h2>
        <p><strong>Total paid:</strong> ${escapeHtml(order.amountTotal)}</p>
        <p><strong>Status:</strong> ${escapeHtml(order.paymentStatus)}</p>
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 12px;">Order summary</h2>
        <p><strong>Sticker type:</strong> ${escapeHtml(order.stickerType)}</p>
        <p><strong>Fulfillment:</strong> ${escapeHtml(fulfillmentLabel)}</p>
        <p><strong>USDOT number:</strong> ${escapeHtml(order.usdotNumber)}</p>
        <p><strong>Display name on decal:</strong> ${escapeHtml(order.decalDisplayName)}</p>
        <p><strong>Size:</strong> ${escapeHtml(order.size)}</p>
        <p><strong>Quantity:</strong> ${escapeHtml(order.quantity)}</p>
        <p><strong>Color:</strong> ${escapeHtml(order.colorPreference)}</p>
        <p><strong>Material:</strong> ${escapeHtml(order.material)}</p>
      </div>

      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 16px;">
        <h2 style="margin: 0 0 12px;">Next step</h2>
        <p>${escapeHtml(nextStep)}</p>
        <p style="margin-top: 16px; color: #4b5563;">
          If anything looks incorrect, reply to this email with your correction.
        </p>
      </div>
    </div>
  `;
}

function buildCustomerConfirmationText(order) {
  return `
Your ReasonableNoise order has started

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
    subject: "Your ReasonableNoise order has started",
    html: buildCustomerConfirmationHtml(order),
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

    const order = orderDetailsFromSession(session);
    const emailResult = await sendOrderEmail(env, order);
    const customerEmailResult = await sendCustomerConfirmationEmail(env, order);

    return json({
      success: true,
      received: true,
      event_id: event.id,
      email_id: emailResult?.id || null,
      customer_email_result: customerEmailResult,
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

