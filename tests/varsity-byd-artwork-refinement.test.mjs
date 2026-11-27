import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const catalog=read("src/pages/shirt-designs.astro");
const byd=read("src/pages/bring-your-design.astro");
const dtf=read("src/pages/dtf-shirts.astro");
const samples=["spirit","legends","victory","ambition","forest-club","sunset-pals"];
test("six separate original vector concept assets are committed",()=>{
 for(const id of samples)assert.ok(existsSync(new URL("../public/shirt-concepts/"+id+".svg",import.meta.url)),id);
});
test("all six assets contain scalable vector markup and concept-only labels",()=>{
 for(const id of samples){
  const s=read("public/shirt-concepts/"+id+".svg");
  assert.match(s,/^<svg /);
  assert.match(s,/<\/svg>$/);
  assert.match(s,/viewBox="0 0 1200 850"/);
  assert.match(s,/CONCEPT STUDY|NOT PRINT PROOF/);
 }
});
test("no sample includes third-party brands or source imagery",()=>{
 for(const id of samples){
  const s=read("public/shirt-concepts/"+id+".svg");
  assert.doesNotMatch(s,/PandaUni|WILDCATS PRIDE|<image|data:image\/|<foreignObject|<script|<!ENTITY/i);
 }
});
test("all preview vectors are locally self-contained without external links",()=>{
 for(const id of samples){
  const s=read("public/shirt-concepts/"+id+".svg");
  assert.doesNotMatch(s,/(?:href|src)="https?:|@import|url\(https?:/i);
 }
});
test("all varsity preview cards load their matching independent SVG",()=>{
 assert.match(catalog,/item.name.toLowerCase\(\)/);
 for(const id of samples.slice(0,4))assert.match(catalog,new RegExp('name:"'+id[0].toUpperCase()+id.slice(1)+'"'));
 assert.match(catalog,/shirt-concepts/);
});
test("creative gallery loads both panda landscape studies by distinct paths",()=>{
 assert.match(catalog,/\/shirt-concepts\/forest-club\.svg/);
 assert.match(catalog,/\/shirt-concepts\/sunset-pals\.svg/);
 assert.match(catalog,/Forest Club/);
 assert.match(catalog,/Sunset Pals/);
});
test("all mockups are explicitly labeled as unapproved print proofs",()=>{
 assert.match(catalog,/Not print ready/);
 assert.match(catalog,/Print proof pending/);
 assert.match(catalog,/not a production print file/);
});
test("BYD includes actual local-only quantity garment color and placement brief fields",()=>{
 for(const id of ["byd-quantity","byd-source","byd-color","byd-placement","byd-rights"])
   assert.match(byd,new RegExp('id="'+id+'"'));
 assert.match(byd,/type="number" min="1" max="500"/);
});
test("BYD brief requires legal rights confirmation and bounded quantity",()=>{
 assert.match(byd,/!Number\.isSafeInteger\(n\)\|\|n<1\|\|n>500/);
 assert.match(byd,/if\(!rights\?\.checked\)/);
 assert.match(byd,/I own the artwork or have permission/);
});
test("BYD brief does not initiate network traffic or store personal data",()=>{
 assert.doesNotMatch(byd,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon/);
 assert.doesNotMatch(byd,/Stripe|\/api\/holiday-checkout|<form/);
});
test("BYD output uses textContent not unsanitized HTML or auto submission",()=>{
 assert.match(byd,/out\.textContent=prepared/);
 assert.doesNotMatch(byd,/innerHTML|document\.write\(|\.submit\(/);
});
test("BYD clipboard is explicit click action with manual fallback",()=>{
 assert.match(byd,/byd-copy-brief/);
 assert.match(byd,/copy\?\.addEventListener\("click"/);
 assert.match(byd,/navigator\.clipboard\.writeText\(prepared\)/);
 assert.match(byd,/copy it manually/);
});
test("BYD still sends customers exclusively to existing protected DTF quote path",()=>{
 assert.match(byd,/href="\/contact\?topic=dtf"/);
 assert.match(dtf,/href="\/bring-your-design"/);
 assert.doesNotMatch(byd,/href="\/upload-design"/);
});
test("BYD clearly warns checkerboard does not establish transparency",()=>{
 assert.match(byd,/checkerboard preview does not prove transparency/i);
 assert.match(byd,/final print proof is required/i);
});
test("nothing in artwork or draft pages enables holiday payments",()=>{
 for(const str of [catalog,byd,...samples.map(x=>read("public/shirt-concepts/"+x+".svg"))])
   assert.doesNotMatch(str,/sk_live_|STRIPE_SECRET_KEY|\/api\/holiday-checkout|checkout\.stripe\.com/);
});
