import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { onRequestGet, onRequestPatch } from "../functions/api/admin-products.js";

const domain = "rn-unit-test.cloudflareaccess.com";
const aud = "rn-test-audience";
const email = "admin@example.com";
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
async function jwtFixture() {
  const keys = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
  jwk.kid = "test-key";
  const h = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
  const p = encode({ iss: `https://${domain}`, aud, email, exp: Math.floor(Date.now()/1000)+300 });
  const message = `${h}.${p}`;
  const sig = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(message));
  return { token: `${message}.${Buffer.from(sig).toString("base64url")}`, jwk };
}
function dbFixture() {
  const product = { id: "usdot-sticker-pair", name: "USDOT Sticker Pair", description: "", image_url: "", price_cents: 2900, price_mode: "fixed", status: "draft", version: 1 };
  const audits = [];
  return {
    product, audits,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async all() { return { results: [ { ...product } ] }; },
        async first() { return { ...product }; },
        _sql: sql,
        get _args() { return [...bound]; },
      };
    },
    async batch(statements) {
      const update = statements[0];
      const args = update._args;
      const expected = args.at(-1);
      const id = args.at(-2);
      const count = expected === product.version && id === product.id ? 1 : 0;
      if (count) {
        product.name = args[0];
        product.version++;
        audits.push({ id, actor: args.at(-3), version: product.version });
      }
      return [{ meta: { changes: count } }, { meta: { changes: count } }];
    },
  };
}
const context = (env, token, method = "GET", body = undefined, id = "usdot-sticker-pair") => ({
  env,
  request: new Request(`https://reasonablenoise.com/api/admin-products?id=${id}`, {
    method, headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }),
});

test("catalog admin routes remain closed when flag or database is missing", async () => {
  assert.equal((await onRequestGet(context({}))).status, 503);
  assert.equal((await onRequestPatch(context({ RN_CATALOG_ADMIN_ENABLED: "true" }, "", "PATCH", { version: 1, name: "New" }))).status, 503);
});

test("orders emergency token and forged Access email cannot authorize catalog writes", async () => {
  const env = { RN_CATALOG_ADMIN_ENABLED: "true", RN_CATALOG_DB: dbFixture(), RN_CATALOG_ADMIN_EMAILS: email, RN_ACCESS_TEAM_DOMAIN: domain, RN_ACCESS_AUD: aud, ADMIN_ORDER_TOKEN: "secret" };
  assert.equal((await onRequestPatch(context(env, "", "PATCH", { version: 1, name: "New" }))).status, 401);
  const forged = context(env, "", "PATCH", { version: 1, name: "New" });
  forged.request.headers.set("cf-access-authenticated-user-email", email);
  forged.request.headers.set("x-admin-order-token", "secret");
  assert.equal((await onRequestPatch(forged)).status, 401);
});

test("verified JWT permits product read/update and rejects stale revisions", async () => {
  const { token, jwk } = await jwtFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(String(input), `https://${domain}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  };
  try {
    const db = dbFixture();
    const env = { RN_CATALOG_ADMIN_ENABLED: "true", RN_CATALOG_DB: db, RN_CATALOG_ADMIN_EMAILS: email, RN_ACCESS_TEAM_DOMAIN: domain, RN_ACCESS_AUD: aud };
    assert.equal((await onRequestGet(context(env, token))).status, 200);
    const body = { version: 1, name: "Updated USDOT Sticker Pair" };
    const updated = await onRequestPatch(context(env, token, "PATCH", body));
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).product.version, 2);
    assert.equal(db.audits.length, 1);
    assert.equal((await onRequestPatch(context(env, token, "PATCH", body))).status, 409);
    assert.equal(db.audits.length, 1);
    assert.equal((await onRequestPatch(context(env, token, "PATCH", { version: 2, status: "bad-state" }))).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsigned payload and wrong audience rejected without calling trusted certs", async () => {
  const { token } = await jwtFixture();
  const env = { RN_CATALOG_ADMIN_ENABLED: "true", RN_CATALOG_DB: dbFixture(), RN_CATALOG_ADMIN_EMAILS: email, RN_ACCESS_TEAM_DOMAIN: domain, RN_ACCESS_AUD: "wrong-audience" };
  assert.equal((await onRequestGet(context(env, token))).status, 401);
  assert.equal((await onRequestGet(context(env, "x.y.z"))).status, 401);
});
