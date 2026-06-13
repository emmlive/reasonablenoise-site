function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function isSafeArtworkKey(key) {
  return (
    typeof key === "string" &&
    key.startsWith("orders/") &&
    !key.includes("..") &&
    !key.startsWith("/") &&
    key.length <= 1024
  );
}

function getDownloadFilename(key) {
  return String(key || "artwork-file").split("/").pop() || "artwork-file";
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    if (!env.ARTWORK_BUCKET) {
      return json({ success: false, error: "Artwork storage is not configured." }, 500);
    }

    if (!env.ADMIN_DOWNLOAD_TOKEN) {
      return json({ success: false, error: "Admin artwork download is not configured." }, 500);
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const token = url.searchParams.get("token") || "";

    if (!token || token !== env.ADMIN_DOWNLOAD_TOKEN) {
      return json({ success: false, error: "Unauthorized artwork download." }, 401);
    }

    if (!isSafeArtworkKey(key)) {
      return json({ success: false, error: "Invalid artwork key." }, 400);
    }

    const object = await env.ARTWORK_BUCKET.get(key);

    if (!object) {
      return json({ success: false, error: "Artwork file was not found." }, 404);
    }

    const filename = getDownloadFilename(key);
    const headers = new Headers();

    object.writeHttpMetadata(headers);

    if (!headers.get("content-type")) {
      headers.set("content-type", "application/octet-stream");
    }

    headers.set("content-disposition", `attachment; filename="${filename.replaceAll('"', '')}"`);
    headers.set("cache-control", "private, no-store");

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return json({
      success: false,
      error: "Unexpected artwork download error.",
      detail: String(error?.message || error),
    }, 500);
  }
}
