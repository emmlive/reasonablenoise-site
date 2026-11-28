import test from "node:test";
import assert from "node:assert/strict";
import { makeDisabledPreviewAuthCandidate } from "../scripts/rn-pages-preview-disabled-auth-candidate.mjs";

const original = `name = "reasonablenoise-site"
pages_build_output_dir = "./dist"

[env.production.vars]
STRIPE_SECRET_KEY = "existing-private-production-value"
ORDER_FROM_EMAIL = "existing@example.invalid"

[[env.production.r2_buckets]]
binding = "ARTWORK_BUCKET"
bucket_name = "reasonablenoise-artwork"

[[env.preview.d1_databases]]
binding = "RN_CATALOG_DB"
database_name = "reasonablenoise-catalog-preview"
database_id = "19347f3f-5fb0-4e43-9d1c-a488eef5a1b7"
`;

test("adds only disabled Preview admin switch, preserving production unchanged", () => {
  const output = makeDisabledPreviewAuthCandidate(original);
  assert.equal(output, original.trimEnd() + '\n\n[env.preview.vars]\nRN_CATALOG_ADMIN_ENABLED = "false"\n');
  assert.match(output, /\[env.production.vars\]/);
  assert.match(output, /\[\[env.production.r2_buckets\]\]/);
  assert.doesNotMatch(output, /\[\[env.production.d1_databases\]\]/);
});
test("rejects missing or multiple preview D1 bindings", () => {
  assert.throws(() => makeDisabledPreviewAuthCandidate(original.replace('[[env.preview.d1_databases]]', '[[env.production.d1_databases]]')), /BLOCKED/);
  assert.throws(() => makeDisabledPreviewAuthCandidate(original + '\n[[env.preview.d1_databases]]\n'), /BLOCKED/);
});
test("rejects preexisting preview vars or enabled catalog", () => {
  assert.throws(() => makeDisabledPreviewAuthCandidate(original + '\n[env.preview.vars]\n'), /BLOCKED/);
  assert.throws(() => makeDisabledPreviewAuthCandidate(original + '\nRN_CATALOG_ADMIN_ENABLED = "true"\n'), /BLOCKED/);
});
test("rejects unsafe project and mutated production artwork", () => {
  assert.throws(() => makeDisabledPreviewAuthCandidate(original.replace("reasonablenoise-site", "other")), /BLOCKED/);
  assert.throws(() => makeDisabledPreviewAuthCandidate(original.replace('bucket_name = "reasonablenoise-artwork"', 'bucket_name = "other"')), /BLOCKED/);
});
