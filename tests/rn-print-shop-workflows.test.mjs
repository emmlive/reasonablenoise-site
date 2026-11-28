import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const home = read("src/pages/index.astro");
const shop = read("src/pages/shop.astro");
const transfers = read("src/pages/dtf-transfers.astro");
const shirts = read("src/pages/dtf-shirts.astro");
const middleware = read("functions/api/_middleware.js");
const sitemap = read("public/sitemap.xml");

test("light homepage, shop and DTF shirts restore original transfer quote route", () => {
  assert.match(home, /href="\/dtf-transfers\/#transfer-quote"/);
  assert.match(shop, /href="\/dtf-transfers\/#transfer-quote"/);
  assert.match(shirts, /href="\/dtf-transfers\/"/);
  assert.match(sitemap, /https:\/\/reasonablenoise.com\/dtf-transfers\//);
  assert.match(shop, /Gang Sheet requests/);
  assert.match(shop, /visual gang sheet builder is planned/);
});

test("original DTF transfer form and artwork preview restored and kept quote-first", () => {
  assert.match(transfers, /id="rn-transfer-form"/);
  assert.match(transfers, /name="transferWidth"/);
  assert.match(transfers, /name="transferHeight"/);
  assert.match(transfers, /name="quantity"/);
  assert.match(transfers, /id="rn-transfer-artwork"/);
  assert.match(transfers, /id="rn-transfer-preview-image"/);
  assert.match(transfers, /fetch\("\/api\/contact", \{ method: "POST", body: data \}\)/);
  assert.match(transfers, /name="contactType" value="DTF transfer quote"/);
  assert.doesNotMatch(transfers, /fetch\("\/api\/create-checkout-session"/);
  assert.match(transfers, /No payment required/);
});

test("preview host cannot submit artwork or quote and hosted API boundary stays isolated", () => {
  assert.match(transfers, /window\.location\.hostname === "reasonablenoise-catalog-isolated\.pages\.dev"/);
  assert.match(transfers, /hostname\.endsWith\("\.reasonablenoise-catalog-isolated\.pages\.dev"\)/);
  assert.match(transfers, /if \(isolatedPreview\) \{/);
  assert.match(transfers, /Quote submissions are unavailable in this isolated preview/);
  assert.match(middleware, /if \(target\.pathname !== "\/api\/admin-products"\) return "deny"/);
  assert.match(middleware, /if \(!legacyPreviewHost && !isolatedCatalogHost\) return "deny"/);
});

test("transfer page uses light branding without claiming gang-sheet builder exists", () => {
  assert.match(transfers, /bg-\[#F9FAF8\] text-\[#162234\]/);
  assert.match(transfers, /bg-\[#EEF3F9\]/);
  assert.match(transfers, /Gang sheets next/);
  assert.match(transfers, /visual drag-and-drop editor is on the roadmap, not available at launch/);
});

test("DTF contrast and preview action follow light-theme accessibility", () => {
  assert.match(transfers, /bg-\[#101b25\] text-white p-5/);
  assert.match(transfers, /id="rn-transfer-summary-size"/);
  assert.match(transfers, /id="rn-transfer-summary-quantity"/);
  assert.match(transfers, /id="rn-transfer-summary-visual"/);
  assert.match(transfers, /if \(submit\) \{ submit\.disabled = true; submit\.textContent = "Quote submissions disabled in preview"; \}/);
  assert.match(transfers, /On the live shop, you can request a quote without attaching a file/);
  assert.doesNotMatch(transfers, /class="rounded-3xl border border-white\/10 bg-white\/\[0\.04\] p-6"/);
});
