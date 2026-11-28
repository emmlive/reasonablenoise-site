// Branch-level RN catalog preview API isolation.
// Prevents ANY legacy API handler from running on Pages preview hosts.
// This does not replace the Cloudflare Access edge policy or the catalog JWT/D1 gates.
// Production hosts pass through unchanged, including the canonical project pages.dev host.
const productionHosts = new Set([
  "reasonablenoise.com",
  "www.reasonablenoise.com",
  "reasonablenoise-site.pages.dev",
]);

function blocked() {
  return new Response(JSON.stringify({
    success: false,
    error: "This operation is unavailable in the catalog preview.",
  }), {
    status: 403,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export function catalogPreviewDecision(request) {
  let target;
  try { target = new URL(request.url); } catch (_) { return "deny"; }
  // Do not trust user-provided identity, branch, or environment headers.
  // Do not grant API execution to unknown custom hostnames.
  if (target.protocol !== "https:" && target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
    return "deny";
  }
  if (productionHosts.has(target.hostname)) return "production-pass";
  if (target.hostname === "localhost" || target.hostname === "127.0.0.1") return "local-pass";
  const legacyPreviewHost = /^[a-z0-9-]+\.reasonablenoise-site\.pages\.dev$/.test(target.hostname);
  // Separate, catalog-only Pages acceptance project. Its canonical and hashed hosts
  // must NEVER be interpreted as production pass-through.
  const isolatedCatalogHost = /^(?:[a-z0-9-]+\.)?reasonablenoise-catalog-isolated\.pages\.dev$/.test(target.hostname);
  if (!legacyPreviewHost && !isolatedCatalogHost) return "deny";
  if (target.pathname !== "/api/admin-products") return "deny";
  if (request.method !== "GET" && request.method !== "PATCH") return "deny";
  return "catalog-pass";
}

export function onRequest(context) {
  const decision = catalogPreviewDecision(context.request);
  return decision === "catalog-pass" || decision === "production-pass" || decision === "local-pass"
    ? context.next()
    : blocked();
}
