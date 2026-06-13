function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeFileName(name) {
  return String(name || "artwork-file")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function randomId() {
  return crypto.randomUUID();
}

function getExtension(filename) {
  const parts = String(filename || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.ARTWORK_BUCKET) {
      return json({
        success: false,
        error: "Artwork storage is not configured.",
      }, 500);
    }

    const formData = await request.formData();
    const file = formData.get("artwork");

    if (!file || typeof file === "string") {
      return json({
        success: false,
        error: "Please choose an artwork or reference file.",
      }, 400);
    }

    const maxBytes = 15 * 1024 * 1024;

    if (file.size > maxBytes) {
      return json({
        success: false,
        error: "File is too large. Please upload a file under 15 MB.",
      }, 400);
    }

    const originalFilename = safeFileName(file.name);
    const extension = getExtension(originalFilename);

    const allowedExtensions = new Set([
      "png",
      "jpg",
      "jpeg",
      "webp",
      "pdf",
      "svg",
      "ai",
      "eps",
      "psd",
    ]);

    if (extension && !allowedExtensions.has(extension)) {
      return json({
        success: false,
        error: "Unsupported file type. Please upload PNG, JPG, PDF, SVG, AI, EPS, PSD, or WEBP.",
      }, 400);
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");

    const uploadId = randomId();
    const objectKey = `orders/${yyyy}/${mm}/${dd}/${uploadId}/${originalFilename}`;

    await env.ARTWORK_BUCKET.put(objectKey, file.stream(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
      customMetadata: {
        originalFilename,
        uploadedAt: now.toISOString(),
        uploadId,
      },
    });

    return json({
      success: true,
      artworkObjectKey: objectKey,
      artworkFilename: originalFilename,
      artworkSize: file.size,
      artworkType: file.type || "application/octet-stream",
      uploadId,
    });
  } catch (error) {
    return json({
      success: false,
      error: "Unexpected artwork upload error.",
      detail: String(error?.message || error),
    }, 500);
  }
}

export async function onRequestGet() {
  return json({
    success: true,
    message: "ReasonableNoise artwork upload endpoint is available. Use POST with multipart form data.",
  });
}
