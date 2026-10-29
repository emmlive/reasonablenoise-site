import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/api/admin-orders.js";

const TEST_SECRET = "1x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const ADMIN_TOKEN = "synthetic-admin-order-token";
const PROD_SECRET = "synthetic-production-secret";

async function checkProbe(options = {}) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), params: new URLSearchParams(init.body) });
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init.method, "POST");
    assert.equal(new URLSearchParams(init.body).get("response"), DUMMY_TOKEN);

    if (options.networkFailure) throw new Error("Synthetic fetch blocked");
    if (options.upstreamStatus) {
      return options.upstreamErrorCodes
        ? Response.json({ success: false, "error-codes": options.upstreamErrorCodes }, { status: options.upstreamStatus })
        : new Response("Synthetic gateway error", { status: options.upstreamStatus });
    }
    if (options.invalidJson) {
      return new Response("{ broken JSON", { status: 200 });
    }

    const secret = new URLSearchParams(init.body).get("secret");
    if (secret === TEST_SECRET) {
      return Response.json({
        success: true,
        hostname: "example.test",
        action: "test",
        "error-codes": [],
      });
    }
    return Response.json({
      success: false,
      "error-codes": options.badProductionSecret
        ? ["invalid-input-secret"]
        : ["invalid-input-response"],
    });
  };
  console.error = () => { throw new Error("Probe must not log sensitive data"); };

  try {
    const request = new Request(
      "https://reasonablenoise.test/api/admin-orders?turnstile_probe=1",
      { headers: options.unauthorized ? {} : { "x-admin-order-token": ADMIN_TOKEN } }
    );

    const env = {
      ADMIN_ORDER_TOKEN: ADMIN_TOKEN,
      DTF_TURNSTILE_SECRET: options.missingSecret ? undefined : PROD_SECRET,
      ARTWORK_BUCKET: {
        async list() { throw new Error("Probe must not list R2"); },
        async get() { throw new Error("Probe must not read R2"); },
        async put() { throw new Error("Probe must not write R2"); },
      },
    };

    const response = await onRequestGet({ request, env });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      data: await response.json(),
      calls,
    };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
}

test("unauthorized request cannot invoke Siteverify admin diagnostic", async () => {
  const out = await checkProbe({ unauthorized: true });
  assert.equal(out.status, 401);
  assert.equal(out.data.success, false);
  assert.equal(out.calls.length, 0);
});

test("admin probe uses a dummy token and calls only Siteverify, not R2, Resend or Stripe", async () => {
  const out = await checkProbe();
  assert.equal(out.status, 200);
  assert.equal(out.cacheControl, "no-store");
  assert.equal(out.data.diagnostic, "turnstile_siteverify_admin_probe");
  assert.deepEqual(out.data.test_pair, {
    result: "siteverify_reached",
    http_status: 200,
    success: true,
    error_codes: [],
  });
  assert.deepEqual(out.data.production_secret, {
    result: "siteverify_reached",
    http_status: 200,
    success: false,
    error_codes: ["invalid-input-response"],
  });
  assert.deepEqual(out.calls.map(call => call.params.get("secret")), [TEST_SECRET, PROD_SECRET]);
  assert.ok(out.calls.every(call => call.params.get("response") === DUMMY_TOKEN));
  assert.ok(!JSON.stringify(out.data).includes(PROD_SECRET));
  assert.ok(!JSON.stringify(out.data).includes(ADMIN_TOKEN));
  assert.ok(!JSON.stringify(out.data).includes(DUMMY_TOKEN));
});

test("invalid production secret can be diagnosed without revealing the secret", async () => {
  const out = await checkProbe({ badProductionSecret: true });
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.production_secret.error_codes, ["invalid-input-secret"]);
  assert.equal(out.calls.length, 2);
  assert.ok(!JSON.stringify(out.data).includes(PROD_SECRET));
});

test("missing production secret is reported without a production Siteverify request", async () => {
  const out = await checkProbe({ missingSecret: true });
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.production_secret, { result: "secret_not_configured" });
  assert.equal(out.calls.length, 1);
});

test("non-2xx Siteverify upstream responses yield safe diagnostic categories", async () => {
  const out = await checkProbe({ upstreamStatus: 503 });
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.test_pair, { result: "upstream_http_error", http_status: 503, error_codes: [] });
  assert.deepEqual(out.data.production_secret, { result: "upstream_http_error", http_status: 503, error_codes: [] });
  assert.equal(out.calls.length, 2);
});

test("bad JSON Siteverify responses yield safe diagnostic categories", async () => {
  const out = await checkProbe({ invalidJson: true });
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.test_pair, { result: "invalid_json", http_status: 200 });
  assert.deepEqual(out.data.production_secret, { result: "invalid_json", http_status: 200 });
});

test("network exceptions yield safe diagnostic categories and do not throw", async () => {
  const out = await checkProbe({ networkFailure: true });
  assert.equal(out.status, 200);
  assert.equal(out.data.test_pair.result, "fetch_or_runtime_error");
  assert.equal(out.data.production_secret.result, "fetch_or_runtime_error");
});

test("admin dashboard exposes a deliberate one-click probe, not an automatic submission", () => {
  const page = readFileSync(new URL("../src/pages/admin-orders.astro", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../functions/api/admin-orders.js", import.meta.url), "utf8");
  assert.match(page, /id="turnstile-probe-button"/);
  assert.match(page, /id="turnstile-probe-result"/);
  assert.match(page, /turnstileProbeButton\?\.addEventListener\("click"/);
  assert.match(page, /fetch\("\/api\/admin-orders\?turnstile_probe=1"/);
  assert.match(backend, /if \(!isAuthorized\(request, env\)\)/);
  assert.match(backend, /url\.searchParams\.get\("turnstile_probe"\) === "1"/);
  assert.match(backend, /RN_TURNSTILE_DUMMY_TOKEN/);
});

test("HTTP 400 Siteverify body exposes only allowlisted validation codes", async () => {
  const out = await checkProbe({
    upstreamStatus: 400,
    upstreamErrorCodes: ["invalid-input-secret", "unrecognized-unsafe-code"],
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.test_pair, {
    result: "upstream_http_error", http_status: 400, error_codes: ["invalid-input-secret"],
  });
  assert.deepEqual(out.data.production_secret, {
    result: "upstream_http_error", http_status: 400, error_codes: ["invalid-input-secret"],
  });
  assert.ok(!JSON.stringify(out.data).includes("unrecognized-unsafe-code"));
});
