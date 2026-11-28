// Prepare a local-only Cloudflare Pages preview D1 candidate from the dashboard export.
// This script NEVER deploys, mutates Cloudflare, edits the source, or prints config values.
// Usage: node scripts/rn-pages-preview-d1-candidate.mjs <downloaded-wrangler.toml> <output-toml> <preview-d1-uuid>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function makePreviewCandidate(source, previewDatabaseId) {
  if (!uuidPattern.test(previewDatabaseId || "")) throw new Error("BLOCKED: invalid preview D1 ID");
  if (!/^(?:\s*name\s*=\s*"reasonablenoise-site"\s*$)/m.test(source)) throw new Error("BLOCKED: unexpected project");
  if (!/^\s*pages_build_output_dir\s*=\s*"\.?\/?dist"\s*$/m.test(source)) throw new Error("BLOCKED: output directory missing or unexpected");
  const tables = [];
  let current = null;
  for (const line of source.split(/\r?\n/)) {
    const header = line.match(/^\s*\[(\[)?([^\]]+)\](\])?\s*(?:#.*)?$/);
    if (header) {
      current = { name: header[2], array: Boolean(header[1]), lines: [] };
      tables.push(current);
    } else if (current) current.lines.push(line);
  }
  const binding = t => (t.lines.join("\n").match(/^\s*binding\s*=\s*"([^"]+)"\s*$/m) || [])[1];
  if (tables.some(t => (t.name === "d1_databases" || t.name === "env.production.d1_databases") && t.array)) {
    throw new Error("BLOCKED: production/default D1 table exists");
  }
  if (tables.some(t => t.name === "env.preview.d1_databases")) {
    throw new Error("BLOCKED: preview D1 config already exists; do not overwrite");
  }
  const productionArtwork = tables.filter(t => t.array && t.name === "env.production.r2_buckets" && binding(t) === "ARTWORK_BUCKET");
  if (productionArtwork.length !== 1 ||
      !/^\s*bucket_name\s*=\s*"reasonablenoise-artwork"\s*$/m.test(productionArtwork[0].lines.join("\n"))) {
    throw new Error("BLOCKED: production artwork R2 binding not matched");
  }
  if (/^\s*RN_CATALOG_ADMIN_ENABLED\s*=\s*"true"\s*$/m.test(source)) {
    throw new Error("BLOCKED: catalog flag enabled");
  }
  const result = source.replace(/\s*$/, "") + "\n\n[[env.preview.d1_databases]]\n" +
      'binding = "RN_CATALOG_DB"\n' +
      'database_name = "reasonablenoise-catalog-preview"\n' +
      'database_id = "' + previewDatabaseId + '"\n';
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const [src, dest, id] = process.argv.slice(2);
    if (!src || !dest || !id || path.resolve(src) === path.resolve(dest)) throw new Error("BLOCKED: source, distinct output, and ID required");
    if (fs.existsSync(dest)) throw new Error("BLOCKED: output already exists");
    const input = fs.readFileSync(src, "utf8");
    const output = makePreviewCandidate(input, id);
    fs.writeFileSync(dest, output, { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log("LOCAL_CANDIDATE_PASS: production artwork retained; production catalog D1 absent; preview catalog D1 added; NO DEPLOY");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
