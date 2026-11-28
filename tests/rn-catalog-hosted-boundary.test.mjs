import test from "node:test";
import assert from "node:assert/strict";
import { validateProbeTarget, classifyDenied, probeHostedPreview } from "../scripts/rn-catalog-hosted-boundary.mjs";

const config = { RN_TARGET_ENVIRONMENT:"preview", RN_HOSTED_PROBE_APPROVED:"read-only",
  RN_CATALOG_ADMIN_ENABLED:"false", RN_PREVIEW_HOST:"rn-disposable-branch.pages.dev",
  RN_ACCESS_TEAM_DOMAIN:"rn-preview.cloudflareaccess.com" };

const deny = (status, location) => new Response(null, {
  status, headers: location ? { location } : {},
});

test("refuses production and unapproved network requests without calling fetch", async () => {
  let called = 0;
  const fake = async () => { called++; throw Error("unreachable"); };
  for (const entry of [
    { ...config, RN_PREVIEW_HOST:"reasonablenoise.com" },
    { ...config, RN_PREVIEW_HOST:"www.reasonablenoise.com" },
    { ...config, RN_PREVIEW_HOST:"catalog.reasonablenoise.com" },
    { ...config, RN_PREVIEW_HOST:"127.0.0.1" },
    { ...config, RN_HOSTED_PROBE_APPROVED:"" },
    { ...config, RN_TARGET_ENVIRONMENT:"production" },
    { ...config, RN_CATALOG_ADMIN_ENABLED:"true" },
  ]) {
    assert.equal(validateProbeTarget(entry), false);
    assert.equal((await probeHostedPreview(entry, fake)).status, "BLOCKED_TARGET");
  }
  assert.equal(called, 0);
});

test("same-team Access redirect is recognized without reporting hosted verification", async () => {
  const location="https://rn-preview.cloudflareaccess.com/cdn-cgi/access/login/something";
  const response=deny(302,location);
  assert.equal(classifyDenied(response,config.RN_ACCESS_TEAM_DOMAIN).edge_access_proven,true);
  assert.equal(classifyDenied(deny(302,"https://attacker.example/cdn-cgi/access/login"),config.RN_ACCESS_TEAM_DOMAIN).denied,false);
  assert.equal(classifyDenied(deny(503),config.RN_ACCESS_TEAM_DOMAIN).denied,false);
});

test("three anonymous/forged/malformed requests deny; no product write payload", async () => {
  let n=0;
  const seen=[];
  const fake=async (url, init) => {
    n++; seen.push({url,init});
    return deny(302,"https://rn-preview.cloudflareaccess.com/cdn-cgi/access/login");
  };
  const r=await probeHostedPreview(config,fake);
  assert.equal(r.status,"NEGATIVE_BOUNDARY_PASS");
  assert.equal(r.edge_access_redirect_observed,true);
  assert.equal(r.hosted_identity_verified,false);
  assert.equal(r.hosted_d1_binding_verified,false);
  assert.equal(r.production_release_approved,false);
  assert.equal(n,3);
  assert.ok(seen.every(x=>x.url==="https://rn-disposable-branch.pages.dev/api/admin-products"));
  assert.deepEqual(seen.map(x=>x.init.method),["GET","GET","PATCH"]);
  assert.deepEqual(JSON.parse(seen[2].init.body),{version:0});
  assert.ok(seen.every(x=>x.init.redirect==="manual"));
});

test("401 and 403 prove denial but not Access application wiring", async () => {
  const r=await probeHostedPreview(config,async () => deny(401));
  assert.equal(r.status,"NEGATIVE_BOUNDARY_PASS");
  assert.equal(r.edge_access_redirect_observed,false);
});

test("404 and disabled feature 503 cannot be mistaken for hosted PASS", async () => {
  for (const status of [200,404,503]) {
    const r=await probeHostedPreview(config,async () => deny(status));
    assert.equal(r.status,"BLOCKED");
  }
});
