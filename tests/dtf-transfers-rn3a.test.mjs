import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestPost } from "../functions/api/contact.js";

const page = readFileSync(new URL("../src/pages/dtf-transfers.astro", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const shirts = readFileSync(new URL("../src/pages/dtf-shirts.astro", import.meta.url), "utf8");

test("DTF transfers has a dedicated crawlable quote-first product page", () => {
  assert.match(page, /<title>Custom DTF Transfers/);
  assert.match(page, /https:\/\/reasonablenoise\.com\/dtf-transfers\//);
  assert.match(page, /id="rn-transfer-form"/);
  assert.match(page, /name="sizePreset"/);
  assert.match(page, /name="transferWidth"/);
  assert.match(page, /name="transferHeight"/);
  assert.match(page, /name="quantity"/);
  assert.match(page, /id="rn-transfer-preview-image"/);
  assert.match(page, /id="rn-transfer-artwork"/);
  assert.match(page, /name="contactType" value="DTF transfer quote"/);
});

test("quote-first page uses existing protected DTF endpoint and makes no Stripe checkout", () => {
  assert.match(page, /action: "dtf_artwork"/);
  assert.match(page, /cf-turnstile-response/);
  assert.match(page, /data\.set\("contactType", "DTF transfer quote"\)/);
  assert.match(page, /fetch\("\/api\/contact", \{ method: "POST", body: data \}\)/);
  assert.doesNotMatch(page, /fetch\("\/api\/create-checkout-session"/);
  assert.doesNotMatch(page, /data\.set\("source",/);
  assert.match(page, /No payment required/);
  assert.match(page, /confirmed individually before payment/);
});

test("consumer navigation distinguishes transfers from printed shirts", () => {
  assert.match(home, /href="\/dtf-transfers\//);
  assert.match(shirts, /href="\/dtf-transfers\//);
  assert.match(page, /href="\/dtf-shirts\//);
});

test("marketing does not advertise unverified pricing or guaranteed speed", () => {
  assert.doesNotMatch(page, /\$[0-9]+(?:\.[0-9]{2})?/);
  assert.doesNotMatch(page, /same-day production|next-day production|24h production/i);
  assert.match(page, /equipment replacement/);
});

async function runTransferQuote(withArtwork) {
  const outgoing = [];
  const storage = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    outgoing.push(String(url));
    if (String(url).includes("/siteverify")) {
      return Response.json({ success: true, action: "dtf_artwork", hostname: "reasonablenoise.com" });
    }
    if (String(url) === "https://api.resend.com/emails") {
      return Response.json({ id: "synthetic-mail" });
    }
    throw new Error("Unexpected outbound fetch " + String(url));
  };

  try {
    const form = new FormData();
    form.set("name", "Synthetic Quote Test");
    form.set("email", "synthetic@example.test");
    form.set("phone", "555-555-0100");
    form.set("contactType", "DTF transfer quote");
    form.set("message", "DTF TRANSFER QUOTE — ready-to-press transfer only (no shirt)\nSize: 10.5 x 11 inches\nQuantity: 3\nFulfillment: Local pickup\nPricing: Pending review; no payment authorized");
    if (withArtwork) {
      form.set("cf-turnstile-response", "synthetic-fresh-token");
      form.set("artwork", new File([new Uint8Array([137, 80, 78, 71, 13, 10])], "sample.png", { type: "image/png" }));
    }

    const env = {
      RESEND_API_KEY: "synthetic-resend-key",
      ORDER_FROM_EMAIL: "Synthetic ReasonableNoise <orders@example.test>",
      CONTACT_NOTIFY_EMAIL: "internal@example.test",
      DTF_TURNSTILE_SECRET: "synthetic-siteverify-secret",
      ADMIN_DOWNLOAD_TOKEN: "synthetic-download-secret",
      SITE_URL: "https://reasonablenoise.com",
      ARTWORK_BUCKET: {
        async put(key, stream, options) { storage.push({ key, metadata: options.customMetadata }); },
        async delete() { throw new Error("Unexpected delete"); },
      },
    };

    const request = new Request("https://reasonablenoise.com/api/contact", { method: "POST", body: form });
    const response = await onRequestPost({ request, env });
    const body = await response.json();
    return { response, body, outgoing, storage };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("transfer quote with file uses R2 and Siteverify, sends one email, no payment", async () => {
  const { response, body, outgoing, storage } = await runTransferQuote(true);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.quoteReference, /^DTF-/);
  assert.equal(storage.length, 1);
  assert.equal(storage[0].metadata.source, "dtf_quote");
  assert.ok(storage[0].key.includes("sample.png"));
  assert.equal(outgoing.length, 2);
  assert.match(outgoing[0], /siteverify/);
  assert.equal(outgoing[1], "https://api.resend.com/emails");
  assert.ok(!outgoing.some(x => x.includes("stripe")));
});

test("transfer quote without file sends email but never touches R2 or Siteverify", async () => {
  const { response, body, outgoing, storage } = await runTransferQuote(false);
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.match(body.quoteReference, /^DTF-/);
  assert.deepEqual(storage, []);
  assert.deepEqual(outgoing, ["https://api.resend.com/emails"]);
});

test("illustrated shirt size presets use accessible radio controls and reusable vector icons", () => {
  const icon = readFileSync(new URL("../src/components/TransferShirtIcon.astro", import.meta.url), "utf8");
  assert.match(page, /import TransferShirtIcon/);
  assert.match(page, /<TransferShirtIcon placement=/);
  assert.match(icon, /viewBox="0 0 100 100"/);
  assert.match(icon, /aria-hidden="true"/);
  assert.match(page, /name="sizePreset"/);
});

test("placement pictograms and garment swatches provide optional, visual-only quote details", () => {
  assert.match(page, /name="printPlacement"/);
  assert.match(page, /name="garmentColor"/);
  for (const placement of ["left-chest", "full-front", "full-back", "sleeve", "custom"]) {
    assert.ok(page.includes(placement), placement + " placement missing");
  }
  for (const color of ["White", "Black", "Gray", "Navy", "Red", "Royal blue"]) {
    assert.ok(page.includes(color), color + " garment reference missing");
  }
  assert.match(page, /id="rn-transfer-shirt-fill"/);
  assert.match(page, /id="rn-transfer-placement-marker"/);
  assert.match(page, /updateShirtReference\(\)/);
  assert.match(page, /name="garmentColor"/);
  assert.match(page, /Garment color reference \(no shirt included\)/);
  assert.match(page, /Print placement reference:/);
  assert.match(page, /Not to scale\. Transfer sold separately\./);
});

test("color and placement appear in quote summary while transfer-only Stripe isolation stays intact", () => {
  assert.match(page, /summaryVisual\.textContent/);
  assert.match(page, /data\.get\("garmentColor"\)/);
  assert.match(page, /data\.get\("printPlacement"\)/);
  assert.match(page, /updateShirtReference\(\);\s*submitButton\.textContent = "Quote Submitted"/);
  assert.doesNotMatch(page, /create-checkout-session|stripe\.com/);
  assert.match(page, /quote-first/i);
});
