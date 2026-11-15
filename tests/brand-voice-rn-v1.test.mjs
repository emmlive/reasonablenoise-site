import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

const pages = [
  "src/pages/index.astro",
  "src/pages/usdot-stickers.astro",
  "src/pages/upload-design.astro",
  "src/pages/dtf-shirts.astro",
  "src/pages/contact.astro",
  "src/pages/faq.astro",
  "src/pages/order-success.astro",
];

test("all seven core customer pages share the clear, grounded service promise", () => {
  const assurance = read("src/components/BrandAssurance.astro");
  for (const page of pages) {
    assert.match(read(page), /import BrandAssurance from/);
    assert.match(read(page), /<BrandAssurance(?: compact)?\s*\/>/);
  }
  assert.match(assurance, /Clear expectations/);
  assert.match(assurance, /Care with every design/);
  assert.match(assurance, /Value without surprises/);
  assert.match(assurance, /Know what you are paying today/);
  assert.match(assurance, /remaining balance is confirmed after order review/);
});
test("homepage and service pages emphasize concrete choices instead of unverified guarantees", () => {
  const home=read("src/pages/index.astro");
  assert.match(home, /Custom printing made clear, from your idea to your order/);
  assert.match(read("src/pages/usdot-stickers.astro"), /review the checkout amount before paying/);
  assert.match(read("src/pages/dtf-shirts.astro"), /confirm pricing before requesting payment/);
  assert.match(read("src/components/QuickQuote.astro"), /confirm custom pricing before asking you to pay/);
});
test("artwork upload retains quote versus checkout separation", () => {
  const page=read("src/pages/upload-design.astro");
  assert.match(page, /Sticker and decal checkout shows the amount before payment/);
  assert.match(page, /For DTF shirts, we review your request and confirm the price/);
  assert.match(page, /id="order-form"/);
  assert.match(page, /create-checkout-session/);
});
test("contact copy is supportive and form submission remains intact", () => {
  const page=read("src/pages/contact.astro");
  assert.match(page, /Tell us about your project/);
  assert.match(page, /Custom pricing is confirmed before payment/);
  assert.match(page, /id="contact-form"/);
  assert.match(page, /api\/contact/);
  assert.match(page, /Request DTF Quote/);
});
test("payment confirmation stays accurate and does not imply production already completed", () => {
  const page=read("src/pages/order-success.astro");
  assert.match(page, /Thank you for trusting us with your order/);
  assert.match(page, /Your Stripe payment has been received/);
  assert.match(page, /before the next production step/);
  assert.doesNotMatch(page, /Your order has shipped/);
});
test("policy substance remains present while introduction language gains clarity", () => {
  const privacy=read("src/pages/privacy.astro");
  const terms=read("src/pages/terms.astro");
  for(const s of ["Information we collect","How we use information","Payments","Uploaded files"]) assert.ok(privacy.includes(s));
  for(const s of ["Custom orders","Artwork and file uploads","USDOT sticker information","Payments"]) assert.ok(terms.includes(s));
  assert.match(privacy, /We want you to understand what happens to the information you share/);
  assert.match(terms, /We want order expectations to be clear before you pay/);
});
test("copy-only branch does not introduce transfer checkout or new fulfillment claims", () => {
  const doc=read("docs/brand-voice-rn-v1.md");
  assert.match(doc, /draft PR #7/);
  assert.match(doc, /draft PR #8/);
  assert.match(doc, /Avoid without independent confirmation/);
  for(const page of pages){
    const s=read(page);
    assert.doesNotMatch(s, /Guaranteed DOT compliant|Perfect quality every time|Best prices anywhere/i);
  }
});

test("homepage avoids cramped desktop layout at tablet widths", () => {
  const home = read("src/pages/index.astro");
  const chat = read("src/components/WhatsAppChat.astro");
  assert.match(home, /lg:grid-cols-2 lg:gap-14/);
  assert.match(home, /sm:text-5xl lg:text-6xl xl:text-7xl/);
  assert.match(home, /hidden items-center gap-8 text-sm text-white\/70 lg:flex/);
  assert.match(home, /flex flex-col flex-wrap gap-4 sm:flex-row/);
  assert.match(chat, /lg:inline/);
  assert.match(chat, /lg:bottom-5 lg:right-5/);
  assert.match(chat, /aria-label="Chat with ReasonableNoise on WhatsApp"/);
});
