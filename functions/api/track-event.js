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

function safeMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const output = {};

  for (const [key, value] of Object.entries(input)) {
    const safeKey = clean(key, 80).replace(/[^a-zA-Z0-9_\-]/g, "_");
    if (!safeKey) continue;

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[safeKey] = clean(value, 300);
    }
  }

  return output;
}

function eventKey(now, id) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");

  return `analytics/${yyyy}/${mm}/${dd}/${id}.json`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const id = crypto.randomUUID();
    const now = new Date();

    const event = {
      id,
      created_at: now.toISOString(),
      event_name: clean(body.eventName || body.event || "unknown_event", 120),
      page_path: clean(body.pagePath || "", 500),
      href: clean(body.href || "", 700),
      label: clean(body.label || "", 300),
      referrer: clean(body.referrer || "", 700),
      user_agent: clean(request.headers.get("user-agent") || "", 350),
      source: "reasonablenoise_site",
      metadata: safeMetadata(body.metadata),
    };

    let stored = false;

    if (env.ARTWORK_BUCKET?.put) {
      await env.ARTWORK_BUCKET.put(eventKey(now, id), JSON.stringify(event, null, 2), {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
        },
      });
      stored = true;
    }

    return json({ success: true, stored });
  } catch (error) {
    return json({
      success: false,
      error: "Unable to record analytics event.",
      detail: String(error?.message || error),
    }, 500);
  }
}
