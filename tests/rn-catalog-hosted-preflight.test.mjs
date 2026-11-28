import test from "node:test";
import assert from "node:assert/strict";
import { validateHostedReadiness } from "../scripts/rn-catalog-hosted-preflight.mjs";

const preview = {
  RN_TARGET_ENVIRONMENT: "preview",
  RN_CATALOG_ADMIN_ENABLED: "false",
  RN_CATALOG_BINDING_NAME: "RN_CATALOG_DB",
  RN_PREVIEW_D1_DATABASE_ID: "68fbc4e1-1312-4ab3-a241-77a4c815f100",
  RN_PRODUCTION_CATALOG_BINDING_PRESENT: "false",
  RN_ACCESS_TEAM_DOMAIN: "rn-acceptance.cloudflareaccess.com",
  RN_ACCESS_AUD: "example-acceptance-aud-tag",
  RN_CATALOG_ADMIN_EMAILS: "operator@example.com",
  RN_PREVIEW_HOST: "reasonablenoise-catalog-isolated.pages.dev",
  RN_ACCESS_APPLICATION_PATH: "/api/admin-products*",
};

test("complete preview config passes only as configuration precheck", () => {
  const result = validateHostedReadiness(preview);
  assert.equal(result.status, "CONFIG_PRECHECK_PASS");
  assert.equal(result.hosted_identity_verified, false);
  assert.equal(result.hosted_d1_binding_verified, false);
  assert.equal(result.production_release_approved, false);
});

test("production target or enabled catalog blocks", () => {
  assert.equal(validateHostedReadiness({ ...preview, RN_TARGET_ENVIRONMENT: "production" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_CATALOG_ADMIN_ENABLED: "true" }).status, "BLOCKED");
});

test("missing preview binding or present/unknown production catalog binding blocks", () => {
  assert.equal(validateHostedReadiness({ ...preview, RN_CATALOG_BINDING_NAME: "ARTWORK_BUCKET" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_PRODUCTION_CATALOG_BINDING_PRESENT: "true" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_PRODUCTION_CATALOG_BINDING_PRESENT: "" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_PRODUCTION_CATALOG_BINDING_PRESENT: undefined }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_PREVIEW_D1_DATABASE_ID: "invalid" }).status, "BLOCKED");
});

test("Access app and preview route must be explicit", () => {
  assert.equal(validateHostedReadiness({ ...preview, RN_ACCESS_AUD: "" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_ACCESS_APPLICATION_PATH: "/admin-orders/*" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_PREVIEW_HOST: "reasonablenoise.com" }).status, "BLOCKED");
  assert.equal(validateHostedReadiness({ ...preview, RN_CATALOG_ADMIN_EMAILS: "" }).status, "BLOCKED");
});

test("Pages-wide Access destination is accepted only for the exact ReasonableNoise preview domain", () => {
  const pagesProtected = { ...preview, RN_ACCESS_APPLICATION_PATH: "*.reasonablenoise-catalog-isolated.pages.dev" };
  assert.equal(validateHostedReadiness(pagesProtected).status, "CONFIG_PRECHECK_PASS");
  for (const unsafe of ["*.pages.dev", "*.reasonablenoise.com", "*.other-site.pages.dev", "reasonablenoise-site.pages.dev", ""]) {
    assert.equal(validateHostedReadiness({ ...pagesProtected, RN_ACCESS_APPLICATION_PATH: unsafe }).status, "BLOCKED", unsafe);
  }
});

test("readiness refuses any other Pages project or production hostname", () => {
  const allowedBranch = validateHostedReadiness({
    ...preview, RN_PREVIEW_HOST: "abc123.reasonablenoise-catalog-isolated.pages.dev",
  });
  assert.equal(allowedBranch.status, "CONFIG_PRECHECK_PASS");
  for (const hostname of [
    "reasonablenoise-site.pages.dev",
    "abc.reasonablenoise-site.pages.dev",
    "other-catalog.pages.dev",
    "reasonablenoise.com",
    "www.reasonablenoise.com",
    "reasonablenoise-catalog-isolated.pages.dev.evil.example",
    "a.b.reasonablenoise-catalog-isolated.pages.dev",
  ]) {
    assert.equal(validateHostedReadiness({ ...preview, RN_PREVIEW_HOST: hostname }).status, "BLOCKED", hostname);
  }
});
