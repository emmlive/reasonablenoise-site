import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const catalog=read("src/pages/shirt-designs.astro");
const byd=read("src/pages/bring-your-design.astro");
const dtf=read("src/pages/dtf-shirts.astro");
const contact=read("src/pages/contact.astro");
test("varsity and creative draft catalog page exists",()=>{
 assert.ok(existsSync(new URL("../src/pages/shirt-designs.astro",import.meta.url)));
 assert.match(catalog,/Varsity & school spirit/);
 assert.match(catalog,/Creative \/ 02/);
});
test("catalog contains all four user-approved varsity directions",()=>{
 for(const label of ["Spirit","Legends","Victory","Ambition"])
   assert.ok(catalog.includes('name:"'+label+'"'));
});
test("catalog is design-preview only, no indexed checkout",()=>{
 assert.match(catalog,/noindex, nofollow/);
 assert.match(catalog,/text-only concept/i);
 assert.doesNotMatch(catalog,/checkout\.stripe\.com|\/api\/holiday-checkout|\/api\/checkout|<form/);
});
test("BYD concept page is noindex and quote-first",()=>{
 assert.match(byd,/Bring Your Design/);
 assert.match(byd,/noindex, nofollow/);
 assert.match(byd,/Quote request only/);
 assert.doesNotMatch(byd,/checkout\.stripe\.com|\/api\/checkout|onRequestPost|<form/);
});
test("BYD routes to existing DTF contact and never to sticker artwork checkout",()=>{
 assert.match(byd,/href="\/contact\?topic=dtf"/);
 assert.doesNotMatch(byd,/href="\/upload-design"/);
});
test("DTF page gives actual navigable preview links, preserving existing quote CTA",()=>{
 assert.match(dtf,/href="\/bring-your-design"/);
 assert.match(dtf,/href="\/shirt-designs"/);
 assert.match(dtf,/href="\/contact\?topic=dtf"/);
});
test("existing contact handles DTF topic, with optional protected artwork upload",()=>{
 assert.match(contact,/params\.get\("topic"\)/);
 assert.match(contact,/topic !== "dtf"/);
 assert.match(contact,/name="artwork"/);
 assert.match(contact,/type="file"/);
 assert.match(contact,/disabled=\{!dtfTurnstileSiteKey\}/);
 assert.match(contact,/formData\.get\("artwork"\)/);
});
test("no direct client upload or payment in concept pages",()=>{
 for(const s of [catalog,byd])
   assert.doesNotMatch(s,/fetch\(|FormData\(|R2_BUCKET|STRIPE_SECRET_KEY|RESEND_API_KEY/);
});
test("school/team rights and print proof requirement explicit",()=>{
 assert.match(catalog,/third-party marks require authorization/i);
 assert.match(byd,/permission to reproduce/);
 assert.match(byd,/print proof/);
});
test("no purported use of uploaded images or artificial claims of print readiness",()=>{
 assert.match(catalog,/not final artwork/i);
 assert.match(byd,/review print readiness/i);
});
