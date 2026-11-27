// Read-only hosted *configuration* preflight for RN catalog.
// No Cloudflare API calls, no credentials, no mutation; PASS does NOT prove hosted access.
import { fileURLToPath } from "node:url";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessDomain = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isFalse = value => value === "false" || value === "0" || value === "unset";

export function validateHostedReadiness(env = {}) {
  const checks = [
    ["preview_only", env.RN_TARGET_ENVIRONMENT === "preview"],
    ["catalog_switch_off", isFalse(env.RN_CATALOG_ADMIN_ENABLED || "unset")],
    ["binding_name", env.RN_CATALOG_BINDING_NAME === "RN_CATALOG_DB"],
    ["preview_db_valid", uuid.test(env.RN_PREVIEW_D1_DATABASE_ID || "")],
    ["production_catalog_binding_absent", env.RN_PRODUCTION_CATALOG_BINDING_PRESENT === "false"],
    ["access_team_valid", accessDomain.test(env.RN_ACCESS_TEAM_DOMAIN || "")],
    ["access_audience_present", /^[a-zA-Z0-9_-]{16,128}$/.test(env.RN_ACCESS_AUD || "")],
    ["admin_allowlist", Boolean((env.RN_CATALOG_ADMIN_EMAILS || "").split(",").map(x => x.trim()).filter(Boolean).length) &&
      (env.RN_CATALOG_ADMIN_EMAILS || "").split(",").map(x => x.trim()).every(x => emailPattern.test(x))],
    ["preview_host_distinct_from_production", Boolean(env.RN_PREVIEW_HOST) &&
      /^[a-z0-9.-]+$/.test(env.RN_PREVIEW_HOST) &&
      !["reasonablenoise.com", "www.reasonablenoise.com"].includes(env.RN_PREVIEW_HOST)],
    ["access_route_covers_admin_api", env.RN_ACCESS_APPLICATION_PATH === "/api/admin-products*" ||
      env.RN_ACCESS_APPLICATION_PATH === "*.reasonablenoise-site.pages.dev"],
  ];
  const failed = checks.filter(([, pass]) => !pass).map(([name]) => name);
  return { status: failed.length ? "BLOCKED" : "CONFIG_PRECHECK_PASS",
    checks: Object.fromEntries(checks), failed,
    hosted_identity_verified: false, hosted_d1_binding_verified: false, production_release_approved: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = validateHostedReadiness(process.env);
  // Never print audience, user emails, DB IDs, JWTs, or any environment variable values.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "CONFIG_PRECHECK_PASS") process.exitCode = 1;
}
