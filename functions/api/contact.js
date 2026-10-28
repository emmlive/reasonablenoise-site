function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function clean(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 1000);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MAX_DTF_ARTWORK_BYTES = 15 * 1024 * 1024;
const ALLOWED_DTF_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "pdf", "svg", "ai", "eps", "psd"]);

function isDtfContact(contactType) {
  return /^dtf(?:\s|-|$)/i.test(String(contactType || "").trim());
}

function safeArtworkFilename(name) {
  return String(name || "artwork-file")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function makeDtfQuoteReference(now) {
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  return `DTF-${date}-${crypto.randomUUID().split("-")[0].toUpperCase()}`;
}

function getPrivateArtworkLink(env, objectKey) {
  if (!env.ADMIN_DOWNLOAD_TOKEN || !objectKey) return "";
  const siteUrl = (env.SITE_URL || "https://reasonablenoise.com").replace(/\/$/, "");
  return `${siteUrl}/api/download-artwork?key=${encodeURIComponent(objectKey)}&token=${encodeURIComponent(env.ADMIN_DOWNLOAD_TOKEN)}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let uploadedArtworkKey = "";

  try {
    if (!env.RESEND_API_KEY) {
      return json({ success: false, error: "Email service is not configured yet." }, 500);
    }

    const multipart = String(request.headers.get("content-type") || "")
      .toLowerCase().startsWith("multipart/form-data");
    const submitted = multipart ? await request.formData() : await request.json();
    const body = multipart ? Object.fromEntries(submitted.entries()) : submitted;

    const name = clean(body.name);
    const email = clean(body.email);
    const phone = clean(body.phone);
    const contactType = clean(body.contactType, "General question");
    const message = clean(body.message);

    if (!name || !email || !message) {
      return json({
        success: false,
        error: "Please enter your name, email, and message.",
      }, 400);
    }

    const isDtf = isDtfContact(contactType);
    const artworkFile = multipart ? submitted.get("artwork") : null;
    const hasArtwork = Boolean(
      artworkFile && typeof artworkFile !== "string" &&
      (artworkFile.name || artworkFile.size)
    );

    if (hasArtwork && !isDtf) {
      return json({ success: false, error: "Artwork can only be attached to a DTF quote request here." }, 400);
    }

    const now = new Date();
    const quoteReference = isDtf ? makeDtfQuoteReference(now) : "";
    let artwork = null;

    if (hasArtwork) {
      if (!Number.isFinite(artworkFile.size) || artworkFile.size <= 0 || artworkFile.size > MAX_DTF_ARTWORK_BYTES) {
        return json({ success: false, error: "Artwork must be a nonempty file of 15 MB or less." }, 400);
      }

      const originalName = safeArtworkFilename(artworkFile.name);
      const extension = originalName.split(".").pop().toLowerCase();
      if (!ALLOWED_DTF_EXTENSIONS.has(extension)) {
        return json({ success: false, error: "Unsupported artwork. Choose PNG, JPG, WEBP, PDF, SVG, AI, EPS, or PSD." }, 400);
      }

      // Do not accept files when they cannot be stored and retrieved privately.
      if (!env.ARTWORK_BUCKET || !env.ADMIN_DOWNLOAD_TOKEN) {
        return json({ success: false, error: "Secure artwork submission is unavailable. Please submit the quote without the file and we will follow up." }, 503);
      }

      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      uploadedArtworkKey = `dtf-quotes/${yyyy}/${mm}/${dd}/${quoteReference}/${originalName}`;

      await env.ARTWORK_BUCKET.put(uploadedArtworkKey, artworkFile.stream(), {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {
          originalFilename: originalName,
          uploadedAt: now.toISOString(),
          quoteReference,
          source: "dtf_quote",
        },
      });
      artwork = {
        filename: originalName,
        size: artworkFile.size,
        objectKey: uploadedArtworkKey,
        downloadUrl: getPrivateArtworkLink(env, uploadedArtworkKey),
      };
    }

    const toEmail = env.CONTACT_NOTIFY_EMAIL || env.ORDER_NOTIFY_EMAIL || "info@reasonablenoise.com";
    const fromEmail = env.ORDER_FROM_EMAIL || "ReasonableNoise <onboarding@resend.dev>";

    const subject = `ReasonableNoise contact: ${contactType} - ${name}${quoteReference ? ` (${quoteReference})` : ""}`;

    const text = [
      "New ReasonableNoise contact request",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || "Not provided"}`,
      `Topic: ${contactType}`,
      ...(quoteReference ? [`DTF quote reference: ${quoteReference}`] : []),
      ...(artwork ? [
        `Artwork: ${artwork.filename} (${artwork.size} bytes)`,
        `Private artwork key: ${artwork.objectKey}`,
        `Secure artwork download: ${artwork.downloadUrl}`,
      ] : isDtf ? ["Artwork: Not attached"] : []),
      "",
      "Message:",
      message,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
        <h2>New ReasonableNoise contact request</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
        <p><strong>Topic:</strong> ${escapeHtml(contactType)}</p>
        ${quoteReference ? `<p><strong>DTF quote reference:</strong> ${escapeHtml(quoteReference)}</p>` : ""}
        ${artwork ? `
          <p><strong>Artwork:</strong> ${escapeHtml(artwork.filename)} (${artwork.size} bytes)</p>
          <p><strong>Private R2 key:</strong> ${escapeHtml(artwork.objectKey)}</p>
          <p><a href="${escapeHtml(artwork.downloadUrl)}">Download DTF artwork securely</a></p>
        ` : isDtf ? "<p><strong>Artwork:</strong> Not attached</p>" : ""}
        <hr />
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>
      </div>
    `;

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: email,
        subject,
        html,
        text,
      }),
    });

    const resendData = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      if (uploadedArtworkKey) {
        try { await env.ARTWORK_BUCKET.delete(uploadedArtworkKey); } catch { /* keep private if cleanup fails */ }
        uploadedArtworkKey = "";
      }
      return json({
        success: false,
        error: resendData?.message || "Unable to send message.",
      }, 400);
    }

    return json({ success: true, ...(quoteReference ? { quoteReference } : {}) });
  } catch (error) {
    if (uploadedArtworkKey && env.ARTWORK_BUCKET) {
      try { await env.ARTWORK_BUCKET.delete(uploadedArtworkKey); } catch { /* private orphan may require cleanup */ }
    }
    return json({
      success: false,
      error: "Unexpected contact form error.",
    }, 500);
  }
}
