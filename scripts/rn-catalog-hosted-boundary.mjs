// RN hosted preview negative-access probe. Never sends real credentials or writes.
// Requires explicit preview target and opt-in, uses only malformed PATCH with version 0.
import { fileURLToPath } from "node:url";

const production = new Set(["reasonablenoise.com","www.reasonablenoise.com"]);
export function validateProbeTarget(env = {}) {
  if (env.RN_TARGET_ENVIRONMENT !== "preview" ||
      env.RN_HOSTED_PROBE_APPROVED !== "read-only" ||
      env.RN_CATALOG_ADMIN_ENABLED !== "false") return false;
  const host = String(env.RN_PREVIEW_HOST || "");
  if (!host || host.length > 253 || host !== host.toLowerCase() ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      production.has(host) || host.endsWith(".reasonablenoise.com") ||
      host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return host.endsWith(".pages.dev") || env.RN_PREVIEW_CUSTOM_HOST_APPROVED === "true";
}

export function classifyDenied(response, teamDomain = "") {
  const code = response.status;
  if (code === 401 || code === 403) return { denied: true, edge_access_proven: false, code };
  if (code === 301 || code === 302 || code === 303 || code === 307 || code === 308) {
    const location = response.headers.get("location") || "";
    let target;
    try { target = new URL(location, "https://invalid.example"); } catch (_) { return { denied: false, edge_access_proven: false, code }; }
    const domain = String(teamDomain).toLowerCase();
    const recognized = Boolean(domain && /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) &&
      target.protocol === "https:" && target.hostname === domain &&
      target.pathname.startsWith("/cdn-cgi/access/"));
    return { denied: recognized, edge_access_proven: recognized, code };
  }
  return { denied: false, edge_access_proven: false, code };
}

export async function probeHostedPreview(env, fetcher = fetch) {
  if (!validateProbeTarget(env)) return { status: "BLOCKED_TARGET", requests_sent: 0 };
  const url = `https://${env.RN_PREVIEW_HOST}/api/admin-products`;
  const requests = [
    { name: "anonymous_get", init: { method: "GET", redirect: "manual" } },
    { name: "forged_header_get", init: { method: "GET", redirect: "manual",
      headers: { "cf-access-authenticated-user-email": "forged@example.invalid", "x-admin-order-token": "invalid-probe-value" } } },
    { name: "malformed_patch", init: { method: "PATCH", redirect: "manual",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "forged@example.invalid" },
      body: JSON.stringify({ version: 0 }) } },
  ];
  const results = [];
  for (const { name, init } of requests) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(8000) });
      const denied = classifyDenied(response, env.RN_ACCESS_TEAM_DOMAIN);
      results.push({ name, ...denied });
    } catch (_) {
      results.push({ name, denied: false, edge_access_proven: false, code: "NETWORK_ERROR" });
    }
  }
  const denied = results.every(r => r.denied);
  return {
    status: denied ? "NEGATIVE_BOUNDARY_PASS" : "BLOCKED",
    requests_sent: results.length, results,
    hosted_identity_verified: false, hosted_d1_binding_verified: false,
    // A redirect to Access is stronger evidence than a 401/403, but is not an authenticated test.
    edge_access_redirect_observed: results.some(r => r.edge_access_proven),
    production_release_approved: false,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await probeHostedPreview(process.env);
  // Never print response bodies, token values, account IDs, redirect URLs, or hostnames.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "NEGATIVE_BOUNDARY_PASS") process.exitCode = 1;
}
