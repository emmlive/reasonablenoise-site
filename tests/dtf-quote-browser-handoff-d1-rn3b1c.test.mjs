// Phase 17 D1: regression contract for exact observed handoff mismatch.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quoteToContactUrl,configureDtfQuote} from "../src/lib/dtf-quote-config-rn3b1c.js";
const runner=readFileSync(new URL("../scripts/browser/rn-3b1c-phase17-dtf-journey.mjs",import.meta.url),"utf8");
const handoff=quoteToContactUrl(configureDtfQuote({
 quantity:12,shirtSource:"ReasonableNoise supplies shirts",placement:"Front"
}));
test("Phase 16 actual handoff is /contact without trailing slash",()=>{
 assert.equal(new URL(handoff,"http://127.0.0.1:4327").pathname,"/contact");
});
test("Phase 17 D1 browser path predicate accepts both Astro route spellings",()=>{
 assert.match(runner,/pathname==="\u002fcontact" \|\| pathname==="\u002fcontact\u002f"/);
 const match=p=>p==="/contact"||p==="/contact/";
 assert.equal(match("/contact"),true);
 assert.equal(match("/contact/"),true);
 for(const invalid of ["/contact/fake","/admin-orders","/api/contact"])assert.equal(match(invalid),false);
});
test("browser still verifies localhost origin and DTF topic after navigation",()=>{
 assert.match(runner,/url\.origin===origin\.origin && contactPath\(url\.pathname\)/);
 assert.match(runner,/url\.searchParams\.get\("topic"\)==="dtf"/);
 assert.match(runner,/landedContact\.origin===origin\.origin/);
});
test("navigation diagnostic reports only route categories, not query-string identity",()=>{
 assert.match(runner,/PHASE17_CONTACT_HANDOFF_DIAGNOSTIC/);
 assert.match(runner,/path:observed\.pathname/);
 assert.doesNotMatch(runner,/console\.(log|error)\([^)]*observed\.href/);
 assert.doesNotMatch(runner,/checkout\.sessions|stripe\.com|bucket\.put|bucket\.delete/);
});
