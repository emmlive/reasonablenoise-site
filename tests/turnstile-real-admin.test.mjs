import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost } from "../functions/api/admin-orders.js";

const ADMIN_TOKEN = "synthetic-only-admin-token";
const SECRET = "synthetic-only-real-secret";
const REAL_TOKEN = "synthetic-only-real-challenge";

async function probe(options = {}) {
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("secret"), SECRET);
    assert.equal(body.get("response"), REAL_TOKEN);

    if (options.networkError) throw new Error("Synthetic error carrying private detail");
    const response = options.response || {
      success: true,
      action: options.badAction ? "some_other_action" : "rn_admin_probe",
      hostname: options.badHostname ? "other.test" : "reasonablenoise.test",
      "error-codes": [],
    };
    return Response.json(response, { status: options.upstreamStatus || 200 });
  };

  try {
    const request = new Request(
      "https://reasonablenoise.test/api/admin-orders?" + (options.noRoute ? "unrelated=1" : "turnstile_real_verify=1"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.unauthorized ? {} : { "x-admin-order-token": ADMIN_TOKEN }),
        },
        body: options.badJson ? "not json" : JSON.stringify({ token: options.token ?? REAL_TOKEN }),
      }
    );
    const env = {
      ADMIN_ORDER_TOKEN: ADMIN_TOKEN,
      DTF_TURNSTILE_SECRET: options.noSecret ? "" : SECRET,
      ARTWORK_BUCKET: {
        async get() { throw new Error("R2 access forbidden in diagnostics"); },
        async put() { throw new Error("R2 mutation forbidden in diagnostics"); },
        async list() { throw new Error("R2 listing forbidden in diagnostics"); },
        async delete() { throw new Error("R2 deletion forbidden in diagnostics"); },
      },
    };
    const response = await onRequestPost({ request, env });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      payload: await response.json(),
      urls,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("unauthorized real-token endpoint rejects before outbound call", async () => {
  const x = await probe({ unauthorized: true });
  assert.equal(x.status, 401);
  assert.equal(x.urls.length, 0);
});

test("admin real-token POST rejects any other route before outbound call", async () => {
  const x = await probe({ noRoute: true });
  assert.equal(x.status, 404);
  assert.equal(x.urls.length, 0);
});

test("absent production secret fails closed without outbound call", async () => {
  const x = await probe({ noSecret: true });
  assert.equal(x.status, 503);
  assert.equal(x.urls.length, 0);
});

test("bad request JSON fails closed without outbound call", async () => {
  const x = await probe({ badJson: true });
  assert.equal(x.status, 400);
  assert.equal(x.urls.length, 0);
});

test("missing or oversized challenge tokens are rejected without outbound call", async () => {
  for (const token of ["", "x".repeat(2049)]) {
    const x = await probe({ token });
    assert.equal(x.status, 400);
    assert.equal(x.urls.length, 0);
  }
});

test("real valid token validates production secret, expected action and hostname", async () => {
  const x = await probe();
  assert.equal(x.status, 200);
  assert.equal(x.cacheControl, "no-store");
  assert.equal(x.payload.diagnostic, "real_admin_turnstile_validation");
  assert.deepEqual(x.payload.result, { status: "verified", verified: true, http_status: 200 });
  assert.deepEqual(x.urls, ["https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
  assert.ok(!JSON.stringify(x.payload).includes(SECRET));
  assert.ok(!JSON.stringify(x.payload).includes(REAL_TOKEN));
  assert.ok(!JSON.stringify(x.payload).includes(ADMIN_TOKEN));
});

test("invalid real token returns safe error codes and no verification", async () => {
  const x = await probe({ response: { success: false, "error-codes": ["invalid-input-response", "hidden-unrecognized-error"] } });
  assert.equal(x.status, 200);
  assert.deepEqual(x.payload.result, {
    status: "token_rejected", verified: false, http_status: 200,
    error_codes: ["invalid-input-response"],
  });
});

test("HTTP 400 with an invalid production secret is sanitized, not leaked", async () => {
  const x = await probe({
    upstreamStatus: 400,
    response: { success: false, "error-codes": ["invalid-input-secret", "bad-unknown-code"] },
  });
  assert.equal(x.status, 200);
  assert.deepEqual(x.payload.result, {
    status: "upstream_http_error", verified: false, http_status: 400,
    error_codes: ["invalid-input-secret"],
  });
});

test("real-token diagnostic never approves incorrect action", async () => {
  const x = await probe({ badAction: true });
  assert.deepEqual(x.payload.result, { status: "action_mismatch", verified: false, http_status: 200 });
});

test("real-token diagnostic never approves incorrect hostname", async () => {
  const x = await probe({ badHostname: true });
  assert.deepEqual(x.payload.result, { status: "hostname_mismatch", verified: false, http_status: 200 });
});

test("network exception fails closed without exposing exception text", async () => {
  const x = await probe({ networkError: true });
  assert.equal(x.payload.result.status, "fetch_or_runtime_error");
  assert.equal(x.payload.result.verified, false);
  assert.ok(!JSON.stringify(x.payload).includes("private detail"));
});

test("admin UI uses real site key, widget action, explicit user click, and no quote request", () => {
  const page = readFileSync(new URL("../src/pages/admin-orders.astro", import.meta.url), "utf8");
  assert.match(page, /PUBLIC_DTF_TURNSTILE_SITE_KEY/);
  assert.match(page, /id="rn-admin-real-turnstile"/);
  assert.match(page, /id="real-turnstile-button"/);
  assert.match(page, /action: "rn_admin_probe"/);
  assert.match(page, /realTurnstileButton\?\.addEventListener\("click"/);
  assert.match(page, /turnstile_real_verify=1/);
  assert.doesNotMatch(page, /fetch\("\/api\/contact"/);
});
