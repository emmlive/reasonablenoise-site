// RN-3B1C Phase 17 browser harness guard tests (dependency-free).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parse} from "node:path";
const src=readFileSync(new URL("../scripts/browser/rn-3b1c-phase17-dtf-journey.mjs",import.meta.url),"utf8");
const page=readFileSync(new URL("../src/pages/dtf-shirts.astro",import.meta.url),"utf8");
const contact=readFileSync(new URL("../src/pages/contact.astro",import.meta.url),"utf8");
test("real browser harness imports isolated Playwright rather than production dependency",()=>{
 assert.match(src,/RN_PLAYWRIGHT_ROOT_REQUIRED|RN_PLAYWRIGHT_ROOT/);
 assert.match(src,/node_modules","playwright","index.mjs"/);
 assert.match(src,/channel:"chrome",headless:true/);
});
test("browser test origin is explicitly localhost-only",()=>{
 assert.match(src,/LOCALHOST_ONLY_REQUIRED/);
 assert.match(src,/"127\.0\.0\.1","localhost"/);
 assert.match(src,/RN_BROWSER_BASE_URL/);
});
test("browser test aborts external and unexpected API calls",()=>{
 assert.match(src,/route\.abort\("blockedbyclient"\)/);
 assert.match(src,/url\.pathname\.startsWith\("\/api\/"\)/);
 assert.match(src,/url\.pathname==="\u002fapi\u002fcontact"/);
});
test("quote submission is intercepted and never reaches live contact service",()=>{
 assert.match(src,/route\.fulfill\(/);
 assert.match(src,/DTF-TEST-LOCAL/);
 assert.match(src,/PHASE17_REAL_CONTACT_REQUESTS_SENT=0/);
});
test("desktop and mobile viewport tests are both present",()=>{
 assert.match(src,/DESKTOP.*1440/);
 assert.match(src,/MOBILE.*390/);
 assert.match(src,/scrollWidth<=overflow\.clientWidth/);
});
test("browser test validates invalid quantity, starting prices, and custom quotes",()=>{
 assert.match(src,/fill\("0"\)/);
 assert.match(src,/From \$18\/shirt/);
 assert.match(src,/Custom quote required/);
 assert.match(src,/dtf-quote-error/);
});
test("browser verifies the actual DTF contact transfer, prefill and explicit submit",()=>{
 for(const label of ["dtfQuantity","dtfShirtSource","dtfPrintPlacement","dtfShirtColor","contact-button"]){
  assert.ok(src.includes(label),label);
 }
 assert.match(src,/page\.waitForURL/);
 assert.match(src,/Quote Submitted/);
});
test("no production payment, live storage or automatic deletion in browser harness",()=>{
 assert.doesNotMatch(src,/stripe\.com|checkout\.sessions|bucket\.delete|bucket\.put|ARTWORK_BUCKET|STRIPE_SECRET_KEY/);
 assert.match(src,/PHASE17_REAL_STRIPE_CALLS=0/);
});
test("existing quote-first source remains and contact requires real explicit user submission",()=>{
 assert.match(page,/id="dtf-quote-config"/);
 assert.match(contact,/form\?\.addEventListener\("submit"/);
 assert.match(contact,/parseQuotePrefill\(params\)/);
});
