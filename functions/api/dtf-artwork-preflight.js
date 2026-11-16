import { inspectArtworkBytes, MAX_ARTWORK_BYTES } from "../lib/dtf-artwork-preflight.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function failure(error, status = 400) {
  return json({ success: false, error }, status);
}
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_HOSTNAMES = new Set(["reasonablenoise.com", "www.reasonablenoise.com"]);

export async function onRequestPost({ request, env }) {
  // Isolated RN-3B1 diagnostic: no Stripe, Resend, R2, admin or production-order writes.
  if (!env?.DTF_TURNSTILE_SECRET) return failure("Artwork inspection is not configured.", 503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return failure("Expected artwork form submission.", 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_ARTWORK_BYTES + 65536) return failure("Artwork is too large.", 413);

  let body;
  try { body = await request.formData(); }
  catch { return failure("Invalid artwork form."); }

  const file = body.get("artwork");
  if (!file || typeof file === "string" || !file.name || !Number.isFinite(file.size)) {
    return failure("Choose an artwork file.");
  }
  if (file.size < 1 || file.size > MAX_ARTWORK_BYTES) return failure("Artwork must be between 1 byte and 15 MB.", 413);
  const width = String(body.get("widthInches") ?? "");
  const height = String(body.get("heightInches") ?? "");
  const token = String(body.get("cf-turnstile-response") || "");
  if (token.length < 1 || token.length > 2048) return failure("Complete the artwork security challenge.");

  let verify;
  try {
    const params = new URLSearchParams({
      secret: env.DTF_TURNSTILE_SECRET,
      response: token,
    });
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!response.ok) return failure("Artwork inspection security verification is unavailable.", 503);
    verify = await response.json();
  } catch {
    return failure("Artwork inspection security verification is unavailable.", 503);
  }
  if (verify?.success !== true || verify?.action !== "dtf_preflight" ||
      !ALLOWED_HOSTNAMES.has(verify?.hostname)) {
    return failure("Artwork security verification failed.");
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const report = inspectArtworkBytes(bytes, {
      filename: file.name,
      widthInches: width,
      heightInches: height,
      declaredSize: file.size,
    });
    return json({
      success: true,
      report,
      // This report is informational and is NOT a trusted checkout authorization.
      disclaimer: "Preliminary file metadata check. Full artwork review is required before production.",
    });
  } catch {
    return failure("Artwork could not be inspected.");
  }
}

export async function onRequestGet() {
  return failure("Use POST to inspect artwork.", 405);
}
