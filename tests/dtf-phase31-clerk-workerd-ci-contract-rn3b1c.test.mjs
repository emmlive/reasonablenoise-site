import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(new URL("../.github/workflows/rn-phase31-clerk-workerd-offline.yml",import.meta.url),"utf8");
const smoke=readFileSync(new URL("../scripts/phase31/real-clerk-workerd-deny-only.test.mjs",import.meta.url),"utf8");

test("three exact SDK, bundler and Workerd runtime versions pinned",()=>{
 for(const id of ["@clerk/backend@3.29.0","miniflare@4.20260730.0","esbuild@0.28.2"])
  assert.ok(workflow.includes(id),id);
});
test("CI is feature branch scoped and repo permission read-only",()=>{
 assert.match(workflow,/feature\/rn-3b1c-phase31-clerk-workerd-compat-20261116/);
 assert.match(workflow,/permissions:\s*\n  contents: read/);
 assert.doesNotMatch(workflow,/secrets\.|wrangler deploy|npm publish/);
});
test("npm installs only into disposable GitHub Actions runner temp",()=>{
 assert.match(workflow,/RUNNER_TEMP/);
 assert.match(workflow,/npm --prefix "\$RN_CLERK_WORKERD_ROOT" install/);
 assert.doesNotMatch(workflow,/npm install --save-dev/);
});
test("real SDK is imported into ESM browser/worker bundle",()=>{
 assert.match(smoke,/import \{createClerkClient\} from "@clerk\/backend"/);
 assert.match(smoke,/await build\(/);
 assert.match(smoke,/bundle:true/);
 assert.match(smoke,/external:\["node:\*"\]/);
});
test("real Miniflare Workerd startup and HTTP dispatch required",()=>{
 assert.match(smoke,/new Miniflare\(/);
 assert.match(smoke,/modules:true,scriptPath:bundle/);
 assert.match(smoke,/compatibilityFlags:\["nodejs_compat"\]/);
 assert.match(smoke,/mf\.dispatchFetch/);
});
test("runtime must call actual SDK authenticateRequest, not mock",()=>{
 assert.match(smoke,/client\.authenticateRequest\(probe,/);
 assert.match(smoke,/await mf\.dispatchFetch/);
 assert.doesNotMatch(smoke,/authenticateRequest:async/);
});
test("negative probe demands exact missing-secret result and no network",()=>{
 assert.match(smoke,/Missing Clerk Secret Key/);
 assert.match(smoke,/result:"MISSING_KEY_DENIED"/);
 assert.match(smoke,/networkAttempts:0/);
 assert.match(smoke,/PROVIDER_NETWORK_FORBIDDEN/);
});
test("no positive session or local customer principal authority",()=>{
 for(const guard of ["authenticated:false","customerPrincipal:null",
  "paymentAuthorized:false","quoteAcceptanceAuthorized:false",
  "artworkDeletionAuthorized:false"]) assert.ok(smoke.includes(guard));
 assert.doesNotMatch(smoke,/createUser|signUp\.create|signIn\.create/);
});
test("probe is only a synthetic local path, not site or payment route",()=>{
 assert.match(smoke,/__rn_phase31_local_probe/);
 assert.match(smoke,/not-a-customer-route/);
 assert.doesNotMatch(smoke,/onRequestPost|functions\/api\/|STRIPE_SECRET_KEY|ARTWORK_BUCKET/);
});
test("CI checks original site dependency files unchanged",()=>{
 assert.match(workflow,/git diff --exit-code -- package\.json package-lock\.json/);
 assert.match(workflow,/git status --short/);
});
test("Workerd compatibility date matches pinned binary maximum from failed CI",()=>{
 assert.match(workflow,/miniflare@4\.20260730\.0/);
 assert.match(smoke,/compatibilityDate:"2026-08-06"/);
 assert.doesNotMatch(smoke,/compatibilityDate:"2026-11-01"/);
});
