import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ci=readFileSync(new URL("../.github/workflows/rn-phase30-clerk-offline-sdk.yml",import.meta.url),"utf8");
const smoke=readFileSync(new URL("../scripts/phase30/real-clerk-sdk-deny-smoke.test.mjs",import.meta.url),"utf8");
test("official SDK exact version pinned to 3.29.0",()=>{
 assert.match(ci,/@clerk\/backend@3\.29\.0\b/);
 assert.match(smoke,/assert\.equal\(pkg\.version,"3\.29\.0"\)/);
});
test("SDK installed only in runner temp, not site dependencies",()=>{
 assert.match(ci,/RUNNER_TEMP/);
 assert.match(ci,/npm --prefix "\$RN_CLERK_OFFLINE_ROOT"/);
 assert.doesNotMatch(ci,/npm install --save(?:-dev)?\b/);
});
test("SDK must actually be imported and invoked, no SDK mocks",()=>{
 assert.match(smoke,/require\("@clerk\/backend"\)/);
 assert.match(smoke,/sdk\.createClerkClient/);
 assert.match(smoke,/client\.authenticateRequest\(request,/);
});
test("SDK tests deny-only request with zero network calls",()=>{
 assert.match(smoke,/assert\.equal\(result\.isAuthenticated,false\)/);
 assert.match(smoke,/assert\.equal\(calls,0,/);
 assert.match(smoke,/globalThis\.fetch=async/);
});
test("SDK tests use generated local test public key, no secrets",()=>{
 assert.match(smoke,/generateKeyPairSync\("rsa"/);
 assert.match(smoke,/publicKey/);
 assert.doesNotMatch(smoke,/process\.env\.CLERK_SECRET_KEY|process\.env\.CLERK_JWT_KEY|pk_live_/);
});
test("workflow has no write-scoped permissions, deploy, or secrets",()=>{
 assert.match(ci,/permissions:\s*\n  contents: read/);
 assert.doesNotMatch(ci,/secrets\.|wrangler deploy|pages deploy|stripe|npm publish/);
});
test("SDK smoke never turns fixture into customer/payment access",()=>{
 assert.match(smoke,/customerPrincipal:null/);
 assert.match(smoke,/dtfCheckoutEnabled:false/);
 assert.match(smoke,/paymentAuthorized:false/);
 assert.match(smoke,/artworkDeletionAuthorized:false/);
});
test("CI checks package files unchanged and no real provider account",()=>{
 assert.match(ci,/git diff --exit-code -- package\.json package-lock\.json/);
 assert.doesNotMatch(smoke,/clerk\.com\/v1|users\.create|signUp\.create|fetch\s*\(/);
});
