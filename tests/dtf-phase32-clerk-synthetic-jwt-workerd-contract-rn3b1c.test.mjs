import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ci=readFileSync(new URL("../.github/workflows/rn-phase32-clerk-synthetic-jwt-workerd.yml",import.meta.url),"utf8");
const smoke=readFileSync(new URL("../scripts/phase32/real-clerk-workerd-synthetic-jwt.test.mjs",import.meta.url),"utf8");
test("real SDK version and Workerd tooling pinned",()=>{
 for(const x of ["@clerk/backend@3.29.0","miniflare@4.20260730.0","esbuild@0.28.2"])
  assert.ok(ci.includes(x),x);
});
test("isolated workflow branch and read-only repository permissions",()=>{
 assert.match(ci,/feature\/rn-3b1c-phase32-clerk-synthetic-jwt-workerd-20261116/);
 assert.match(ci,/permissions:\s*\n  contents: read/);
 assert.doesNotMatch(ci,/secrets\.|wrangler deploy|npm publish/);
});
test("SDK installation belongs to disposable runner temp root",()=>{
 assert.match(ci,/RUNNER_TEMP/);
 assert.match(ci,/npm --prefix "\$RN_CLERK_WORKERD_ROOT" install/);
 assert.match(ci,/git diff --exit-code -- package\.json package-lock\.json/);
});
test("real official Clerk verifyToken imported and invoked",()=>{
 assert.match(smoke,/import \{verifyToken\} from "@clerk\/backend"/);
 assert.match(smoke,/await verifyToken\(token,/);
 assert.doesNotMatch(smoke,/verifyToken:async/);
});
test("locally generated RSA pair is used without provider secrets",()=>{
 assert.match(smoke,/generateKeyPairSync\("rsa"/);
 assert.match(smoke,/sign\("RSA-SHA256"/);
 assert.match(smoke,/jwtKey:__PUBLIC_KEY__/);
 assert.doesNotMatch(smoke,/process\.env\.CLERK_SECRET_KEY|sk_live_|pk_live_/);
});
test("positive synthetic fixture must verify cryptographically",()=>{
 assert.match(smoke,/\["valid",valid,true\]/);
 assert.match(smoke,/assert\.deepEqual\(data\.verdicts,cases\.map/);
});
test("modified or foreign signature is expected to fail",()=>{
 assert.match(smoke,/\["tampered-signature",tampered,false\]/);
 assert.match(smoke,/\["foreign-signing-key",issue\(claims,foreignKeys\.privateKey\),false\]/);
});
test("expired and not-before claims are rejected",()=>{
 assert.match(smoke,/\["expired",issue/);
 assert.match(smoke,/\["future-nbf",issue/);
});
test("issuer, audience, and authorized party mismatches rejected",()=>{
 for(const kind of ["wrong-audience","wrong-authorized-party","wrong-issuer"])
  assert.ok(smoke.includes(kind));
 assert.match(smoke,/issuer:__ISSUER__,audience:__AUDIENCE__/);
 assert.match(smoke,/authorizedParties:\[__ORIGIN__\]/);
});
test("missing token is never accepted",()=>{
 assert.match(smoke,/\["no-token","",false\]/);
});
test("actual Miniflare Workerd processes SDK probe",()=>{
 assert.match(smoke,/new Miniflare\(/);
 assert.match(smoke,/compatibilityDate:"2026-08-06"/);
 assert.match(smoke,/modulesRoot:out,scriptPath:bundle/);
 assert.match(smoke,/mf\.dispatchFetch/);
});
test("worker never maps synthetic claims to ReasonableNoise authority",()=>{
 for(const x of ["scope:\"SYNTHETIC_CRYPTO_ONLY\"","customerPrincipal:null",
  "localSessionAuthorized:false","dtfCheckoutEnabled:false",
  "paymentAuthorized:false","artworkDeletionAuthorized:false","productionApproved:false"])
  assert.ok(smoke.includes(x),x);
});
test("zero outbound network and no production route or payment integration",()=>{
 assert.match(smoke,/EXTERNAL_NETWORK_FORBIDDEN/);
 assert.match(smoke,/assert\.equal\(data\.networkAttempts,0\)/);
 assert.doesNotMatch(smoke,/onRequestPost|functions\/api\/|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY/);
});
test("unknown external path remains 404 and no real login created",()=>{
 assert.match(smoke,/not-an-auth-route/);
 assert.match(smoke,/assert\.equal\(wrong\.status,404\)/);
 assert.doesNotMatch(smoke,/signIn\.create|signUp\.create|users\.create/);
});
test("R1 explicitly unwraps Clerk JWT return type without swallowing positive failures",()=>{
 assert.match(smoke,/Object\.hasOwn\(result,"data"\)/);
 assert.match(smoke,/Object\.hasOwn\(result,"errors"\)/);
 assert.match(smoke,/const claims=isWrapped\?result\.data:result/);
 assert.match(smoke,/verified=!hasErrors&&claims\?\.sub/);
 assert.match(smoke,/assert\.equal\(data\.validFixtureDiagnostic,"CLAIMS_VERIFIED"\)/);
 assert.doesNotMatch(smoke,/catch\{verified=false;\}/);
});

test("R2 classifies Workerd verifier exceptions without printing raw error data",()=>{
 for(const category of [
  "TOKEN_VERIFICATION_EXCEPTION","MISSING_CLERK_SECRET_KEY",
  "WEBCRYPTO_RUNTIME_ERROR","PUBLIC_KEY_RUNTIME_ERROR",
  "JS_TYPE_ERROR","JS_REFERENCE_ERROR","JS_SYNTAX_ERROR",
  "JS_RANGE_ERROR","GENERIC_SDK_ERROR","UNKNOWN_EXCEPTION"
 ])assert.ok(smoke.includes(category),category);
 assert.match(smoke,/type==="TypeError"/);
 assert.match(smoke,/typeof error\?\.message==="string"/);
 assert.match(smoke,/validFixtureDiagnostic/);
 assert.match(smoke,/assert\.equal\(data\.validFixtureDiagnostic,"CLAIMS_VERIFIED"\)/);
 assert.doesNotMatch(smoke,/console\.(?:log|error)\(error\)|JSON\.stringify\(error\)|error\.stack/);
});

test("R3 independently verifies valid RS256 fixture using real Workerd WebCrypto",()=>{
 assert.match(smoke,/__VALID_TOKEN__\.split/);
 assert.match(smoke,/crypto\.subtle\.importKey\("spki"/);
 assert.match(smoke,/crypto\.subtle\.verify\("RSASSA-PKCS1-v1_5"/);
 assert.match(smoke,/independentSignatureDiagnostic=valid\?"VALID_SIGNATURE":"INVALID_SIGNATURE"/);
 assert.match(smoke,/assert\.equal\(data\.independentSignatureDiagnostic,"VALID_SIGNATURE"/);
 assert.match(smoke,/assert\.deepEqual\(data\.verdicts,cases\.map/);
 assert.match(smoke,/assert\.equal\(data\.validFixtureDiagnostic,"CLAIMS_VERIFIED"\)/);
 assert.doesNotMatch(smoke,/console\.log\([^)]*(?:token|keys\.privateKey)\)/);
});
