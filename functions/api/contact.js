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

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.RESEND_API_KEY) {
      return json({ success: false, error: "Email service is not configured yet." }, 500);
    }

    const body = await request.json();

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

    const toEmail = env.CONTACT_NOTIFY_EMAIL || env.ORDER_NOTIFY_EMAIL || "info@reasonablenoise.com";
    const fromEmail = env.ORDER_FROM_EMAIL || "ReasonableNoise <onboarding@resend.dev>";

    const subject = `ReasonableNoise contact: ${contactType} - ${name}`;

    const text = [
      "New ReasonableNoise contact request",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || "Not provided"}`,
      `Topic: ${contactType}`,
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

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      return json({
        success: false,
        error: resendData?.message || "Unable to send message.",
      }, 400);
    }

    return json({ success: true });
  } catch (error) {
    return json({
      success: false,
      error: "Unexpected contact form error.",
      detail: String(error?.message || error),
    }, 500);
  }
}
