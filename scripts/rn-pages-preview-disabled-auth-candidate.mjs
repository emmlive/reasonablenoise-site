// Local-only addition to an already validated Pages Preview D1 config candidate.
// Deliberately never collects the Access AUD, email allowlist, or provider secrets.
// No Cloudflare API, no deployment, no writes except distinct requested local output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function makeDisabledPreviewAuthCandidate(source) {
  if (!/^\s*name\s*=\s*"reasonablenoise-site"\s*$/m.test(source)) throw new Error("BLOCKED: wrong Pages project");
  if (!/^\s*pages_build_output_dir\s*=\s*"\.?\/?dist"\s*$/m.test(source)) throw new Error("BLOCKED: missing build output");
  if (!/^\[\[env\.production\.r2_buckets\]\]/m.test(source) ||
      !/binding\s*=\s*"ARTWORK_BUCKET"/.test(source) ||
      !/bucket_name\s*=\s*"reasonablenoise-artwork"/.test(source)) throw new Error("BLOCKED: artwork binding mismatch");
  if (/^\[\[(?:env\.production\.)?d1_databases\]\]/m.test(source)) throw new Error("BLOCKED: production/default D1 exists");
  const sections = [...source.matchAll(/^\s*\[\[env\.preview\.d1_databases\]\]\s*$/gm)];
  if (sections.length !== 1 ||
      !/^\s*binding\s*=\s*"RN_CATALOG_DB"\s*$/m.test(source) ||
      !/^\s*database_name\s*=\s*"reasonablenoise-catalog-preview"\s*$/m.test(source)) {
    throw new Error("BLOCKED: preview catalog D1 missing or unexpected");
  }
  if (/^\s*\[env\.preview\.vars\]\s*$/m.test(source)) throw new Error("BLOCKED: preview vars already exist; manual review required");
  if (/^\s*RN_CATALOG_ADMIN_ENABLED\s*=\s*"true"\s*$/m.test(source)) throw new Error("BLOCKED: catalog feature enabled");
  if (/^\s*(?:RN_ACCESS_AUD|RN_CATALOG_ADMIN_EMAILS|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RESEND_API_KEY)\s*=/m.test(source)) {
    throw new Error("BLOCKED: secret-like values found in config; do not persist");
  }
  return source.replace(/\s*$/, "") + "\n\n[env.preview.vars]\nRN_CATALOG_ADMIN_ENABLED = \"false\"\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath || path.resolve(inputPath) === path.resolve(outputPath) || fs.existsSync(outputPath)) throw new Error("BLOCKED: distinct new output path required");
    const result = makeDisabledPreviewAuthCandidate(fs.readFileSync(inputPath, "utf8"));
    fs.writeFileSync(outputPath, result, { flag: "wx", mode: 0o600 });
    process.stdout.write("PREVIEW_DISABLED_AUTH_CANDIDATE_PASS: D1 remains preview-only, production R2 preserved, catalog flag false, no secrets, NO DEPLOY\n");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
