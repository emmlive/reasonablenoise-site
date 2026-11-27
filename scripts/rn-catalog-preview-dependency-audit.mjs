// Static read-only audit of Cloudflare Pages Functions' binding dependencies.
// No credentials, Cloudflare API, deploy, files written, or runtime invocation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const forbiddenPreviewLiveBindings = Object.freeze([
  "ARTWORK_BUCKET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY", "ADMIN_ORDER_TOKEN", "ADMIN_DOWNLOAD_TOKEN"
]);

export function inventoryPagesFunctions(directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith(".js")).sort().map(file => {
    const source = fs.readFileSync(path.join(directory, file), "utf8");
    const references = [...new Set([...source.matchAll(/\b(?:context\.env|ctx\.env|env)\.([A-Z][A-Z0-9_]+)/g)].map(match => match[1]))].sort();
    return { route: "/api/" + file.replace(/\.js$/, ""), references };
  });
}

export function assessPreviewCompatibility(inventory, previewBindingNames) {
  const names = new Set(previewBindingNames);
  const missing = inventory.map(({ route, references }) => ({
    route, missing: references.filter(name => !names.has(name))
  })).filter(x => x.missing.length);
  const forbidden = [...names].filter(name => forbiddenPreviewLiveBindings.includes(name));
  const catalog = inventory.find(x => x.route === "/api/admin-products");
  const catalogDbBound = Boolean(catalog && names.has("RN_CATALOG_DB"));
  return {
    audit_result: forbidden.length ? "BLOCKED_LIVE_RESOURCES" :
      missing.length ? "PREVIEW_COMPATIBILITY_NOT_ESTABLISHED" : "STATIC_REFERENCES_COVERED",
    catalog_db_bound_in_candidate: catalogDbBound,
    routes_with_unprovided_references: missing,
    unsafe_preview_binding_names: forbidden,
    dynamic_reads_not_proven_absent: true,
    production_unmodified: true,
    deployment_approved: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve("functions/api");
  const inventory = inventoryPagesFunctions(directory);
  const assessment = assessPreviewCompatibility(inventory, [
    "RN_CATALOG_DB"
  ]);
  console.log(JSON.stringify({ inventory, assessment }, null, 2));
  if (assessment.audit_result !== "STATIC_REFERENCES_COVERED") process.exitCode = 2;
}
