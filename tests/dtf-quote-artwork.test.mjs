import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost as submitContact } from "../functions/api/contact.js";
import { onRequestGet as downloadArtwork } from "../functions/api/download-artwork.js";

function fakeBucket() {
  const objects = new Map();
  const writes = [];
  const deletes = [];
  return {
    objects,
    writes,
    deletes,
    async put(key, value, options) {
      writes.push({ key, options });
      objects.set(key, { value, options });
    },
    async get(key) {
      if (!objects.has(key)) return null;
      return {
        body: new Blob(["synthetic test content"]).stream(),
        writeHttpMetadata(headers) {
          headers.set("content-type", "application/octet-stream");
        },
      };
    },
    async delete(key) {
      deletes.push(key);
      objects.delete(key);
    },
  };
}

function newFile(name = "artwork.png", bytes = new Uint8Array([137, 80, 78, 71])) {
  return new File([bytes], name, { type: "image/png" });
}

function baseFields(contactType = "DTF T-shirt order quote") {
  return {
    name: "Synthetic Test Buyer",
    email: "testbuyer@example.test",
    phone: "5550000000",
    contactType,
    message: "Please quote 12 custom shirts. Shirt source: customer brings shirts. Placement: front.",
  };
}

async function runContact(fields, options = {}) {
  const bucket = options.bucket || fakeBucket();
  const emails = [];
  const outgoingUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    outgoingUrls.push(String(url));
    if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      if (options.challengeThrows) throw new Error("Synthetic Turnstile network error");
      if (options.challengeUnavailable) {
        return new Response(JSON.stringify({ success: false }), { status: 503 });
      }
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("secret"), "synthetic-turnstile-secret");
      assert.equal(params.get("response"), "synthetic-valid-challenge-token");
      return new Response(JSON.stringify({
        success: !options.challengeRejected,
        action: options.challengeWrongAction ? "different_action" : "dtf_artwork",
        hostname: options.challengeWrongHostname ? "unrelated.example" : "reasonablenoise.test",
      }), { status: 200 });
    }
    if (String(url) !== "https://api.resend.com/emails") {
      throw new Error("Unexpected provider request: " + String(url));
    }
    if (options.emailThrows) throw new Error("synthetic network failure");
    emails.push(JSON.parse(init.body));
    if (options.emailFails) {
      return new Response(JSON.stringify({ message: "Synthetic Resend failure" }), { status: 503 });
    }
    return new Response(JSON.stringify({ id: "email_test_001" }), { status: 200 });
  };

  try {
    let request;
    if (options.json) {
      request = new Request("https://reasonablenoise.test/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      });
    } else {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.append(key, value);
      if (fields.artwork && !options.noToken) {
        body.set("cf-turnstile-response", "synthetic-valid-challenge-token");
      }
      request = new Request("https://reasonablenoise.test/api/contact", { method: "POST", body });
    }
    const env = {
      ARTWORK_BUCKET: options.noBucket ? undefined : bucket,
      ADMIN_DOWNLOAD_TOKEN: options.noDownloadToken ? "" : "test-only-admin-token",
      DTF_TURNSTILE_SECRET: options.noChallengeSecret ? "" : "synthetic-turnstile-secret",
      RESEND_API_KEY: "re_test_not_real",
      CONTACT_NOTIFY_EMAIL: "internal@example.test",
      ORDER_FROM_EMAIL: "ReasonableNoise <orders@example.test>",
      SITE_URL: "https://reasonablenoise.test",
    };
    const response = await submitContact({ request, env });
    return {
      status: response.status,
      result: await response.json(),
      bucket,
      emails,
      outgoingUrls,
      env,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertNoEmailsOrStorage(outcome) {
  assert.equal(outcome.emails.length, 0);
  assert.equal(outcome.bucket.writes.length, 0);
}

test("ordinary JSON contact requests remain unchanged and do not upload", async () => {
  const out = await runContact(baseFields("USDOT sticker quote"), { json: true });
  assert.equal(out.status, 200);
  assert.deepEqual(out.result, { success: true });
  assert.equal(out.emails.length, 1);
  assert.match(out.emails[0].text, /USDOT sticker quote/);
  assert.equal(out.bucket.writes.length, 0);
});

test("DTF contact without artwork sends quote without accessing R2", async () => {
  const out = await runContact(baseFields());
  assert.equal(out.status, 200);
  assert.match(out.result.quoteReference, /^DTF-\d{8}-[A-F0-9]{8}$/);
  assert.equal(out.bucket.writes.length, 0);
  assert.equal(out.emails.length, 1);
  assert.match(out.emails[0].text, /Artwork: Not attached/);
});

test("DTF quote with artwork saves one private file and emails a protected download link", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile("design.png") });
  assert.equal(out.status, 200);
  assert.equal(out.result.success, true);
  assert.match(out.result.quoteReference, /^DTF-\d{8}-[A-F0-9]{8}$/);
  assert.equal(out.bucket.writes.length, 1);
  const key = out.bucket.writes[0].key;
  assert.match(key, /^dtf-quotes\/\d{4}\/\d{2}\/\d{2}\/DTF-\d{8}-[A-F0-9]{8}\/design\.png$/);
  assert.equal(out.bucket.writes[0].options.httpMetadata.contentType, "application/octet-stream");
  assert.equal(out.emails.length, 1);
  assert.match(out.emails[0].text, /Secure artwork download:/);
  assert.match(out.emails[0].text, /test-only-admin-token/);
  assert.match(out.emails[0].html, /Download DTF artwork securely/);
  assert.equal(out.result.artworkObjectKey, undefined);
  assert.ok(!JSON.stringify(out.result).includes("test-only-admin-token"));
  assert.deepEqual(out.outgoingUrls, [
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "https://api.resend.com/emails",
  ]);
});

test("DTF filename sanitization keeps downloads accessible", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile("../bad..name.png") });
  assert.equal(out.status, 200);
  assert.equal(out.bucket.writes.length, 1);
  assert.ok(!out.bucket.writes[0].key.includes(".."));
  assert.match(out.bucket.writes[0].key, /bad\.name\.png$/);
});

test("non-DTF contact cannot upload an attachment", async () => {
  const out = await runContact({ ...baseFields("USDOT sticker quote"), artwork: newFile() });
  assert.equal(out.status, 400);
  assertNoEmailsOrStorage(out);
});

test("unsupported artwork format is rejected before storage or email", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile("malware.exe") });
  assert.equal(out.status, 400);
  assertNoEmailsOrStorage(out);
});

test("file larger than 15 MB is rejected without writing to R2", async () => {
  const out = await runContact({
    ...baseFields(),
    artwork: newFile("large.png", new Uint8Array(15 * 1024 * 1024 + 1)),
  });
  assert.equal(out.status, 400);
  assertNoEmailsOrStorage(out);
});

test("missing R2 storage fails closed for attached artwork", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { noBucket: true });
  assert.equal(out.status, 503);
  assertNoEmailsOrStorage(out);
});

test("missing private download token fails closed for attached artwork", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { noDownloadToken: true });
  assert.equal(out.status, 503);
  assertNoEmailsOrStorage(out);
});

test("Resend rejection deletes newly uploaded artwork and does not report success", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { emailFails: true });
  assert.equal(out.status, 400);
  assert.equal(out.result.success, false);
  assert.equal(out.bucket.writes.length, 1);
  assert.deepEqual(out.bucket.deletes, [out.bucket.writes[0].key]);
  assert.equal(out.bucket.objects.size, 0);
});

test("network failure while sending email cleans up private artwork", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { emailThrows: true });
  assert.equal(out.status, 500);
  assert.equal(out.bucket.writes.length, 1);
  assert.deepEqual(out.bucket.deletes, [out.bucket.writes[0].key]);
  assert.equal(out.bucket.objects.size, 0);
});

test("DTF artwork can be downloaded only with admin token, and sticker download still works", async () => {
  const bucket = fakeBucket();
  const path = "dtf-quotes/2026/10/28/DTF-20261028-ABC12345/design.png";
  await bucket.put(path, new Blob(["test"]));
  const env = { ARTWORK_BUCKET: bucket, ADMIN_DOWNLOAD_TOKEN: "test-only-admin-token" };
  const url = (key, token) => new Request(
    `https://reasonablenoise.test/api/download-artwork?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`
  );

  const valid = await downloadArtwork({ request: url(path, "test-only-admin-token"), env });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get("content-disposition"), /attachment/);
  const invalid = await downloadArtwork({ request: url(path, "wrong"), env });
  assert.equal(invalid.status, 401);
  const traversal = await downloadArtwork({
    request: url("dtf-quotes/2026/10/28/DTF-20261028-ABC12345/../secret.png", "test-only-admin-token"),
    env,
  });
  assert.equal(traversal.status, 400);

  const stickerKey = "orders/2026/10/28/example/sticker.png";
  await bucket.put(stickerKey, new Blob(["test"]));
  const oldDownload = await downloadArtwork({ request: url(stickerKey, "test-only-admin-token"), env });
  assert.equal(oldDownload.status, 200);
});

test("source contract keeps DTF artwork in contact form, separate from Stripe checkout", () => {
  const contact = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");
  const upload = readFileSync(new URL("../src/pages/upload-design.astro", import.meta.url), "utf8");
  assert.match(contact, /name="artwork" type="file"/);
  assert.match(contact, /formData\.set\("message", payload\.message\)/);
  assert.match(contact, /body: formData/);
  assert.match(upload, /DTF quote form to send your artwork and shirt details together/);
  assert.match(upload, /This form is for sticker and decal checkout/);
  assert.match(upload, /Request DTF Order Quote/);
});

test("DTF topic updates the contact hero, next-step action and context hints", () => {
  const contact = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");
  assert.match(contact, /id="contact-hero-title"/);
  assert.match(contact, /id="contact-hero-description"/);
  assert.match(contact, /id="contact-next-step-link"/);
  assert.match(contact, /id="contact-fast-tip"/);
  assert.match(contact, /Need custom T-shirts printed\?/);
  assert.match(contact, /No payment is required to request a quote/);
  assert.match(contact, /nextStepLink\.href = dtfSelected \? "#contact-form" : "\/upload-design"/);
  assert.match(contact, /form\?\.elements\.contactType\?\.addEventListener\("change", updateDtfPanel\)/);
  assert.match(contact, /applyContactPrefill\(\);\s*updateDtfPanel\(\)/);
});

test("DTF contact header and submit CTA stay quote-first, while sticker CTA is unchanged", () => {
  const contact = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");
  assert.match(contact, /id="contact-header-cta" href="\/upload-design"/);
  assert.match(contact, /id="contact-form-title"/);
  assert.match(contact, /id="contact-form-intro"/);
  assert.match(contact, /headerCta\.href = dtfSelected \? "#contact-form" : "\/upload-design"/);
  assert.match(contact, /headerCta\.textContent = dtfSelected \? "Request DTF Quote" : "Start Order"/);
  assert.match(contact, /formTitle\.textContent = dtfSelected \? "Request a DTF printing quote\." : "Send a contact request\."/);
  assert.match(contact, /button\.textContent = dtfSelected \? "Request DTF Quote" : "Send Message"/);
  assert.match(contact, /button\.textContent = data\.quoteReference \? "Quote Submitted" : "Message Sent"/);
});

test("missing challenge token blocks DTF artwork before R2 or email", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { noToken: true });
  assert.equal(out.status, 400);
  assertNoEmailsOrStorage(out);
  assert.deepEqual(out.outgoingUrls, []);
});

test("missing Turnstile server secret fails closed for artwork", async () => {
  const out = await runContact({ ...baseFields(), artwork: newFile() }, { noChallengeSecret: true });
  assert.equal(out.status, 503);
  assertNoEmailsOrStorage(out);
  assert.deepEqual(out.outgoingUrls, []);
});

test("a failed, expired, or mismatched Turnstile response cannot store artwork", async () => {
  for (const settings of [
    { challengeRejected: true },
    { challengeWrongAction: true },
    { challengeWrongHostname: true },
  ]) {
    const out = await runContact({ ...baseFields(), artwork: newFile() }, settings);
    assert.equal(out.status, 400);
    assertNoEmailsOrStorage(out);
    assert.deepEqual(out.outgoingUrls, ["https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
  }
});

test("Turnstile outage fails closed and never writes artwork", async () => {
  for (const settings of [
    { challengeUnavailable: true },
    { challengeThrows: true },
  ]) {
    const out = await runContact({ ...baseFields(), artwork: newFile() }, settings);
    assert.equal(out.status, 503);
    assertNoEmailsOrStorage(out);
  }
});

test("DTF widget requires public sitekey, issues matching action and keeps quote-only pathway", () => {
  const contact = readFileSync(new URL("../src/pages/contact.astro", import.meta.url), "utf8");
  assert.match(contact, /PUBLIC_DTF_TURNSTILE_SITE_KEY/);
  assert.match(contact, /rn-dtf-turnstile/);
  assert.match(contact, /action: "dtf_artwork"/);
  assert.match(contact, /disabled=\{!dtfTurnstileSiteKey\}/);
  assert.match(contact, /cf-turnstile-response/);
  assert.match(contact, /window\.turnstile\?\.reset\?\./);
});
