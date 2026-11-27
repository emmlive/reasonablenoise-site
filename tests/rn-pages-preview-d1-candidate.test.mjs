import test from "node:test";
import assert from "node:assert/strict";
import { makePreviewCandidate } from "../scripts/rn-pages-preview-d1-candidate.mjs";
const id = "19347f3f-5fb0-4e43-9d1c-a488eef5a1b7";
const baseline = `name = "reasonablenoise-site"
pages_build_output_dir = "./dist"
compatibility_date = "2026-06-12"

[env.production.vars]
RN_CATALOG_ADMIN_ENABLED = "false"

[[env.production.r2_buckets]]
binding = "ARTWORK_BUCKET"
bucket_name = "reasonablenoise-artwork"
`;
test("adds preview D1 only while preserving production artwork", () => {
  const out = makePreviewCandidate(baseline, id);
  assert.match(out, /\[\[env.preview.d1_databases\]\]/);
  assert.match(out, /database_name = "reasonablenoise-catalog-preview"/);
  assert.match(out, /\[\[env.production.r2_buckets\]\]/);
  assert.doesNotMatch(out, /\[\[env.production.d1_databases\]\]/);
});
test("rejects production D1 or default D1 tables", () => {
  for (const section of ["[[env.production.d1_databases]]", "[[d1_databases]]"]) {
    assert.throws(() => makePreviewCandidate(baseline + "\n" + section + '\nbinding = "RN_CATALOG_DB"\n', id), /BLOCKED/);
  }
});
test("rejects existing preview D1 or missing artwork R2", () => {
  assert.throws(() => makePreviewCandidate(baseline + "\n[[env.preview.d1_databases]]\n", id), /BLOCKED/);
  assert.throws(() => makePreviewCandidate(baseline.replace("ARTWORK_BUCKET", "OTHER"), id), /BLOCKED/);
});
test("rejects wrong project, enabled flag, invalid ID", () => {
  assert.throws(() => makePreviewCandidate(baseline.replace("reasonablenoise-site", "other-project"), id), /BLOCKED/);
  assert.throws(() => makePreviewCandidate(baseline.replace('RN_CATALOG_ADMIN_ENABLED = "false"', 'RN_CATALOG_ADMIN_ENABLED = "true"'), id), /BLOCKED/);
  assert.throws(() => makePreviewCandidate(baseline, "wrong"), /BLOCKED/);
});
