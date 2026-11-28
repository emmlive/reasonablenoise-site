// RN catalog administration. Disabled unless explicitly configured in the target environment.
// No ADMIN_ORDER_TOKEN fallback: product edits require a verified Cloudflare Access JWT.
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const statuses = new Set(["available", "out_of_stock", "draft", "archived"]);
const fields = ["name", "description", "image_url", "price_cents", "price_mode", "status"];
const encoder = new TextEncoder();

function base64urlToBytes(value) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function parseJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(part)));
}
function allowedEmails(env) {
  return String(env.RN_CATALOG_ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
export async function verifyCatalogAdminAccess(request, env) {
  const domain = String(env.RN_ACCESS_TEAM_DOMAIN || "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
  const audience = String(env.RN_ACCESS_AUD || "").trim();
  if (!domain || !/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(domain) || !audience || !allowedEmails(env).length) return null;
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  const segments = token.split(".");
  if (segments.length !== 3 || token.length > 12000) return null;
  try {
    const header = parseJwtPart(segments[0]);
    const payload = parseJwtPart(segments[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== `https://${domain}` ||
        !(Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience) ||
        !Number.isFinite(payload.exp) || payload.exp <= now ||
        (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now))) return null;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!allowedEmails(env).includes(email)) return null;
    const response = await fetch(`https://${domain}/cdn-cgi/access/certs`, { redirect: "error" });
    if (!response.ok) return null;
    const certificates = await response.json();
    const keys = Array.isArray(certificates.keys) ? certificates.keys : [];
    const jwk = keys.find(k => k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256"));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64urlToBytes(segments[2]), encoder.encode(`${segments[0]}.${segments[1]}`));
    return verified ? email : null;
  } catch (_) { return null; }
}
function validatePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !Number.isSafeInteger(body.version) || body.version < 1) return "Valid version is required.";
  const keys = Object.keys(body).filter(k => k !== "version");
  if (!keys.length || keys.some(k => !fields.includes(k))) return "Unsupported or empty product update.";
  if ("name" in body && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120)) return "Invalid name.";
  if ("description" in body && (typeof body.description !== "string" || body.description.length > 2000)) return "Invalid description.";
  if ("image_url" in body && (typeof body.image_url !== "string" || body.image_url.length > 500 ||
      (body.image_url && !/^\/assets\/[a-zA-Z0-9/_-]+\.(png|jpg|jpeg|webp)$/.test(body.image_url)))) return "Image must be an approved local asset path.";
  if ("price_cents" in body && (!Number.isSafeInteger(body.price_cents) || body.price_cents < 0 || body.price_cents > 100000000)) return "Invalid price.";
  if ("price_mode" in body && !["fixed", "starting_at", "quote_only"].includes(body.price_mode)) return "Invalid price mode.";
  if ("status" in body && !statuses.has(body.status)) return "Invalid status.";
  return null;
}
async function authorize(context) {
  const { request, env } = context;
  if (env.RN_CATALOG_ADMIN_ENABLED !== "true") return { error: reply({ success: false, error: "Catalog administration disabled." }, 503) };
  if (!env.RN_CATALOG_DB?.prepare || !env.RN_CATALOG_DB?.batch) return { error: reply({ success: false, error: "Catalog database unavailable." }, 503) };
  const actor = await verifyCatalogAdminAccess(request, env);
  if (!actor) return { error: reply({ success: false, error: "Unauthorized." }, 401) };
  return { actor };
}
export async function onRequestGet(context) {
  const access = await authorize(context);
  if (access.error) return access.error;
  try {
    const rows = await context.env.RN_CATALOG_DB.prepare("SELECT id, name, description, image_url, price_cents, price_mode, status, version, updated_at FROM rn_catalog_products ORDER BY name").all();
    return reply({ success: true, products: rows.results || [] });
  } catch (_) { return reply({ success: false, error: "Catalog read failed." }, 503); }
}
export async function onRequestPatch(context) {
  const access = await authorize(context);
  if (access.error) return access.error;
  const request = context.request;
  if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") return reply({ success: false, error: "JSON required." }, 415);
  let body;
  try { body = await request.json(); } catch (_) { return reply({ success: false, error: "Invalid JSON." }, 400); }
  const problem = validatePatch(body);
  if (problem) return reply({ success: false, error: problem }, 400);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 80) return reply({ success: false, error: "Invalid product ID." }, 400);
  const entries = Object.entries(body).filter(([k]) => k !== "version");
  const sql = entries.map(([k]) => `${k} = ?`).join(", ");
  const update = context.env.RN_CATALOG_DB.prepare(
    `UPDATE rn_catalog_products SET ${sql}, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = ? WHERE id = ? AND version = ?`
  ).bind(...entries.map(([,v]) => v), access.actor, id, body.version);
  const audit = context.env.RN_CATALOG_DB.prepare(
    "INSERT INTO rn_catalog_audit (product_id, actor_email, previous_version, next_version, patch_json) SELECT id, ?, ?, version, ? FROM rn_catalog_products WHERE id = ? AND version = ? AND updated_by = ? AND changes() = 1"
  ).bind(access.actor, body.version, JSON.stringify(Object.fromEntries(entries)), id, body.version + 1, access.actor);
  try {
    const results = await context.env.RN_CATALOG_DB.batch([update, audit]);
    if (!results?.[0]?.meta?.changes) return reply({ success: false, error: "Product missing or version conflict." }, 409);
    const product = await context.env.RN_CATALOG_DB.prepare("SELECT id, name, description, image_url, price_cents, price_mode, status, version, updated_at FROM rn_catalog_products WHERE id = ?").bind(id).first();
    return reply({ success: true, product });
  } catch (_) { return reply({ success: false, error: "Catalog update failed." }, 503); }
}
