function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function clean(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 450);
}

function centsFromEnv(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCheckoutPricing(stickerType, env) {
  const normalized = String(stickerType || "").toLowerCase();

  const options = [
    {
      match: ["extra usdot"],
      label: "Extra USDOT Pair",
      amountCents: 2500,
      description: "Add another matching USDOT sticker pair in the same order.",
    },
    {
      match: ["one-side", "one side", "replacement"],
      label: "One-Side USDOT Replacement",
      amountCents: 1800,
      description: "One replacement USDOT decal for one door or side.",
    },
    {
      match: ["usdot + business", "usdot plus business", "business name pair"],
      label: "USDOT + Business Name Pair",
      amountCents: 3900,
      description: "USDOT number with company or legal business name.",
    },
    {
      match: ["truck door"],
      label: "Truck Door Lettering",
      amountCents: 6900,
      description: "Business name, phone, website, or simple vehicle lettering.",
    },
    {
      match: ["fleet"],
      label: "Fleet Lettering Package",
      amountCents: 5900,
      description: "Starting price for matching fleet lettering.",
    },
    {
      match: ["logo sticker batch", "logo / artwork", "logo artwork", "artwork printing"],
      label: "Logo Sticker Batch",
      amountCents: 3500,
      description: "Starter batch pricing for logo sticker orders.",
    },
    {
      match: ["design cleanup", "design help"],
      label: "Design Cleanup / Layout Help",
      amountCents: 1500,
      description: "Basic design cleanup, layout help, or print prep.",
    },
    {
      match: ["custom business", "custom decal"],
      label: "Custom Business Decals",
      amountCents: 3500,
      description: "Starting price for custom business decals.",
    },
    {
      match: ["usdot"],
      label: "USDOT Sticker Pair",
      amountCents: 2900,
      description: "Launch price for one standard USDOT sticker pair.",
    },
  ];

  const selected = options.find((option) =>
    option.match.some((needle) => normalized.includes(needle))
  );

  if (selected) {
    return {
      ...selected,
      source: "server_price_map",
    };
  }

  return {
    label: "Custom Sticker Order Deposit",
    amountCents: centsFromEnv(env.ORDER_DEPOSIT_CENTS, 2500),
    description: "Custom sticker order deposit.",
    source: "env_fallback",
  };
}


function createOrderReference() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const shortId = crypto.randomUUID().split("-")[0].toUpperCase();

  return `RN-${yyyy}${mm}${dd}-${shortId}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.STRIPE_SECRET_KEY) {
      return json({ success: false, error: "Stripe is not configured yet." }, 500);
    }

    const body = await request.json();

    const fulfillmentMethod =
      body.fulfillmentMethod === "shipping" ? "shipping" : "local_pickup";

    const siteUrl = (env.SITE_URL || "https://reasonablenoise.com").replace(/\/$/, "");
    const shippingCents = centsFromEnv(env.SHIPPING_CENTS, 999);

    const customerName = clean(body.customerName);
    const businessName = clean(body.businessName);
    const email = clean(body.email);
    const phone = clean(body.phone);
    const stickerType = clean(body.stickerType, "Custom sticker order");
    const usdotNumber = clean(body.usdotNumber);
    const decalDisplayName = clean(body.decalDisplayName);
    const size = clean(body.size);
    const quantity = clean(body.quantity, "1");
    const colorPreference = clean(body.colorPreference);
    const material = clean(body.material);
    const notes = clean(body.notes);
    const artworkObjectKey = clean(body.artworkObjectKey);
    const artworkFilename = clean(body.artworkFilename);
    const artworkSize = clean(body.artworkSize);
    const artworkType = clean(body.artworkType);
    const uploadId = clean(body.uploadId);
    const orderReference = createOrderReference();
    const checkoutPricing = resolveCheckoutPricing(stickerType, env);

    if (!email || !customerName) {
      return json({
        success: false,
        error: "Please enter your name and email before checkout.",
      }, 400);
    }

    const params = new URLSearchParams();

    params.set("mode", "payment");
    params.set("success_url", `${siteUrl}/order-success?session_id={CHECKOUT_SESSION_ID}&order_ref=${encodeURIComponent(orderReference)}`);
    params.set("cancel_url", `${siteUrl}/upload-design?checkout=cancelled`);
    params.set("customer_email", email);
    params.set("client_reference_id", orderReference);
    params.set("phone_number_collection[enabled]", "true");

    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(checkoutPricing.amountCents));
    params.set("line_items[0][price_data][product_data][name]", `ReasonableNoise ${checkoutPricing.label}`);
    params.set(
      "line_items[0][price_data][product_data][description]",
      `${checkoutPricing.description} — ${fulfillmentMethod === "shipping" ? "Shipping" : "Local pickup"}`
    );

    if (fulfillmentMethod === "shipping") {
      params.set("shipping_address_collection[allowed_countries][0]", "US");

      params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shippingCents));
      params.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
      params.set("shipping_options[0][shipping_rate_data][display_name]", "Standard shipping");
      params.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
      params.set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", "3");
      params.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
      params.set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", "7");
    }

    params.set("metadata[order_reference]", orderReference);
    params.set("metadata[customer_name]", customerName);
    params.set("metadata[business_name]", businessName);
    params.set("metadata[email]", email);
    params.set("metadata[phone]", phone);
    params.set("metadata[sticker_type]", stickerType);
    params.set("metadata[checkout_price_label]", checkoutPricing.label);
    params.set("metadata[checkout_price_cents]", String(checkoutPricing.amountCents));
    params.set("metadata[checkout_price_source]", checkoutPricing.source);
    params.set("metadata[fulfillment_method]", fulfillmentMethod);
    params.set("metadata[usdot_number]", usdotNumber);
    params.set("metadata[decal_display_name]", decalDisplayName);
    params.set("metadata[size]", size);
    params.set("metadata[quantity]", quantity);
    params.set("metadata[color_preference]", colorPreference);
    params.set("metadata[material]", material);
    params.set("metadata[notes]", notes);
    params.set("metadata[artwork_object_key]", artworkObjectKey);
    params.set("metadata[artwork_filename]", artworkFilename);
    params.set("metadata[artwork_size]", artworkSize);
    params.set("metadata[artwork_type]", artworkType);
    params.set("metadata[upload_id]", uploadId);

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return json({
        success: false,
        error: stripeData?.error?.message || "Unable to create Stripe Checkout session.",
      }, 400);
    }

    return json({
      success: true,
      url: stripeData.url,
      id: stripeData.id,
    });
  } catch (error) {
    return json({
      success: false,
      error: "Unexpected checkout error.",
      detail: String(error?.message || error),
    }, 500);
  }
}


