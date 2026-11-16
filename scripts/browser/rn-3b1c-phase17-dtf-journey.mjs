// RN-3B1C Phase 17: isolated real-browser DTF customer journey verification.
// No production navigation, payment, R2 or provider calls. localhost only.
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {existsSync} from "node:fs";

const origin=new URL(process.env.RN_BROWSER_BASE_URL||"http://127.0.0.1:4327");
if(origin.protocol!=="http:"||!["127.0.0.1","localhost"].includes(origin.hostname))
 throw Error("LOCALHOST_ONLY_REQUIRED");
const root=process.env.RN_PLAYWRIGHT_ROOT;
if(!root)throw Error("RN_PLAYWRIGHT_ROOT_REQUIRED");
const playwrightFile=resolve(root,"node_modules","playwright","index.mjs");
if(!existsSync(playwrightFile))throw Error("PLAYWRIGHT_NOT_INSTALLED_IN_ISOLATED_ROOT");
const {chromium}=await import(pathToFileURL(playwrightFile).href);
const browser=await chromium.launch({channel:"chrome",headless:true});
let assertions=0,requests=0,external=0;
const check=(test,...args)=>{if(test==="test")assert.ok(...args);else assert[test](...args);assertions++;};
const waitReady=async page=>{
 await page.goto(new URL("/dtf-shirts/",origin).href,{waitUntil:"domcontentloaded"});
 await page.locator("#dtf-quote-config [name=quantity]").waitFor();
 await page.waitForFunction(()=>document.getElementById("dtf-quote-estimate")?.textContent?.includes("From $24"));
};
async function runViewport(name,viewport,inputs){
 const context=await browser.newContext({viewport,serviceWorkers:"block"});
 const page=await context.newPage();
 const failures=[];
 page.on("request",req=>{
  const url=new URL(req.url());
  if(url.hostname!=="127.0.0.1"&&url.hostname!=="localhost")external++;
 });
 // Allow only local Astro assets and a test-intercepted quote POST.
 await page.route("**/*",async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!["127.0.0.1","localhost"].includes(url.hostname)){
   return route.abort("blockedbyclient");
  }
  if(url.pathname==="/api/contact"){
   requests++;
   if(req.method()!=="POST")failures.push("non-POST contact request");
   const body=req.postData()||"";
   for(const token of ["DTF order details","Quantity: "+inputs.quantity,"Shirt source: "+inputs.source]){
    if(!body.includes(token))failures.push("submitted quote missing "+token);
   }
   return route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({success:true,quoteReference:"DTF-TEST-LOCAL"})});
  }
  if(url.pathname.startsWith("/api/"))return route.abort("blockedbyclient");
  return route.continue();
 });
 try{
  await waitReady(page);
  await page.locator("#dtf-quote-config [name=quantity]").fill("0");
  await page.getByRole("button",{name:"Continue to secure quote request"}).click();
  check("test",await page.locator("#dtf-quote-error").isVisible());
  check("equal",new URL(page.url()).pathname,"/dtf-shirts/");
  await page.locator("#dtf-quote-config [name=quantity]").fill(String(inputs.quantity));
  await page.locator("#dtf-quote-config [name=shirtSource]").selectOption({label:inputs.source});
  await page.locator("#dtf-quote-config [name=placement]").selectOption({label:inputs.placement});
  await page.locator("#dtf-quote-config [name=color]").fill("Navy");
  await page.locator("#dtf-quote-config [name=sizeBreakdown]").fill("M:2, L:4");
  await page.locator("#dtf-quote-config [name=deadline]").fill("Flexible");
  await page.locator("#dtf-quote-config [name=artwork]").selectOption({label:"Will provide later"});
  check("equal",(await page.locator("#dtf-quote-estimate").textContent()).trim(),inputs.estimate);
  check("test",await page.locator("#dtf-quote-error").isHidden());
  await page.getByRole("button",{name:"Continue to secure quote request"}).click();
  // Phase 16 intentionally hands off to /contact?topic=dtf (no trailing slash).
  // Astro may preserve /contact or normalize to /contact/ depending on hosting.
  // Accept both route spellings; do not relax the hostname or topic checks.
  const contactPath = pathname => pathname==="/contact" || pathname==="/contact/";
  const landed = new URL(page.url());
  if (!contactPath(landed.pathname)) {
   try {
    await page.waitForURL(
     url => url.origin===origin.origin && contactPath(url.pathname) && url.searchParams.get("topic")==="dtf",
     {waitUntil:"domcontentloaded",timeout:12000}
    );
   } catch (error) {
    const observed = new URL(page.url());
    console.error("PHASE17_CONTACT_HANDOFF_DIAGNOSTIC",JSON.stringify({
     path:observed.pathname,localhost:observed.origin===origin.origin,
     hasDtfTopic:observed.searchParams.get("topic")==="dtf",
     errorName:error?.name||"unknown"
    }));
    throw error;
   }
  }
  const landedContact = new URL(page.url());
  check("test",landedContact.origin===origin.origin && contactPath(landedContact.pathname));
  check("equal",landedContact.searchParams.get("topic"),"dtf");
  const next=new URL(page.url());
  check("equal",next.searchParams.get("topic"),"dtf");
  check("equal",next.searchParams.has("checkout"),false);
  check("equal",next.searchParams.has("amount"),false);
  await page.locator("[name=contactType]").waitFor();
  await page.waitForFunction(()=>document.querySelector("[name=dtfQuantity]")?.value===String(new URL(location.href).searchParams.get("quantity")));
  check("equal",await page.locator("[name=dtfQuantity]").inputValue(),String(inputs.quantity));
  check("equal",await page.locator("[name=dtfShirtSource]").inputValue(),inputs.source);
  check("equal",await page.locator("[name=dtfPrintPlacement]").inputValue(),inputs.placement);
  check("equal",await page.locator("[name=dtfShirtColor]").inputValue(),"Navy");
  check("test",(await page.locator("[name=message]").inputValue()).includes("Size breakdown: M:2, L:4"));
  check("test",(await page.locator("[name=message]").inputValue()).includes("Artwork status: Will provide later"));
  check("test",await page.locator("[data-rn-dtf-detail-panel-contact]").isVisible());
  const overflow=await page.evaluate(()=>({
   scrollWidth:document.documentElement.scrollWidth,
   clientWidth:document.documentElement.clientWidth
  }));
  check("test",overflow.scrollWidth<=overflow.clientWidth+2,
   name+": horizontal overflow "+JSON.stringify(overflow));
  check("equal",requests,0);
  await page.locator("[name=name]").fill("Local Browser Test");
  await page.locator("[name=email]").fill("local-test@example.invalid");
  await page.locator("[name=message]").fill("Local test only — do not send.");
  await page.getByRole("button",{name:"Request DTF Quote"}).last().click();
  await page.waitForFunction(()=>document.getElementById("contact-button")?.textContent?.includes("Quote Submitted"));
  check("equal",requests,1);
  check("deepEqual",failures,[]);
  check("test",(await page.locator("#contact-message").textContent()).includes("DTF quote"));
  console.log("PHASE17_"+name+"=PASS");
 }finally{
  await context.close();
 }
}
try{
 await runViewport("DESKTOP",{width:1440,height:900},{
  quantity:12,source:"ReasonableNoise supplies shirts",placement:"Front",estimate:"From $18/shirt"
 });
 requests=0;
 await runViewport("MOBILE",{width:390,height:844},{
  quantity:6,source:"Customer brings shirts",placement:"Front + Back",estimate:"Custom quote required"
 });
 console.log("PHASE17_EXTERNAL_PROVIDER_REQUESTS_SENT=0");
 console.log("PHASE17_REAL_CONTACT_REQUESTS_SENT=0");
 console.log("PHASE17_REAL_STRIPE_CALLS=0");
 console.log("PHASE17_BROWSER_ASSERTIONS="+assertions);
 console.log("PHASE17_BROWSER_RESULT=PASS");
}finally{await browser.close();}
