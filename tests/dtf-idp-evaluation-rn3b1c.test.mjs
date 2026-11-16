// Phase24: only an accountable external review may select an IdP, never client claims.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DTF_IDP_CANDIDATES,DTF_IDP_CRITERIA,assessDtfIdentityProviderProposal} from "../functions/lib/dtf-idp-evaluation-rn3b1c.js";
const source=readFileSync(new URL("../functions/lib/dtf-idp-evaluation-rn3b1c.js",import.meta.url),"utf8");
const assertBlocked=r=>{
 assert.equal(r.status,"NO_SELECTION");
 assert.equal(r.chosenProvider,null);
 for(const field of ["productionApproved","authActivationAuthorized","quoteAcceptanceAuthorized",
  "checkoutEligible","paymentAuthorized","deletionAuthorized"])
  assert.equal(r[field],false,field);
};
const evidence=()=>DTF_IDP_CRITERIA.map(c=>({
 criterion:c.id,result:"met",evidenceRef:"review/isolated-test-"+c.id
}));
test("no proposal is a no-selection hard stop",()=>assertBlocked(assessDtfIdentityProviderProposal()));
test("candidate IDs are unique, fixed, and independently reviewable",()=>{
 assert.equal(DTF_IDP_CANDIDATES.length,3);
 assert.equal(new Set(DTF_IDP_CANDIDATES.map(x=>x.id)).size,3);
 assert.ok(DTF_IDP_CANDIDATES.every(x=>x.source.startsWith("https://")&&x.openQuestion));
});
test("weighted criteria total 100 and carry unique IDs",()=>{
 assert.equal(DTF_IDP_CRITERIA.reduce((sum,x)=>sum+x.weight,0),100);
 assert.equal(new Set(DTF_IDP_CRITERIA.map(x=>x.id)).size,7);
});
test("even a perfect self-declared provider cannot activate login",()=>{
 const r=assessDtfIdentityProviderProposal({providerId:"clerk",evidence:evidence(),
  approved:true,liveIntegrationAuthorized:true});
 assertBlocked(r);
 assert.equal(r.evaluated,true);
 assert.equal(r.proposedScore,100);
});
test("each candidate's self-asserted 100 cannot become selected",()=>{
 for(const provider of DTF_IDP_CANDIDATES){
  const r=assessDtfIdentityProviderProposal({providerId:provider.id,evidence:evidence()});
  assertBlocked(r);assert.equal(r.proposedScore,100);
 }
});
test("unknown provider names and spoofed custom issuer never select",()=>{
 for(const providerId of ["made-up-idp","cloudflare-admin-access","stripe-email",""]){
  const r=assessDtfIdentityProviderProposal({providerId,evidence:evidence()});
  assertBlocked(r);assert.equal(r.reason,"UNKNOWN_PROVIDER");
 }
});
test("partial evidence is rejected, not scored as complete",()=>{
 const r=assessDtfIdentityProviderProposal({providerId:"clerk",evidence:evidence().slice(1)});
 assertBlocked(r);assert.equal(r.reason,"INCOMPLETE_EVIDENCE");
});
test("duplicate criterion is rejected, not double counted",()=>{
 const items=evidence();items.push(items[0]);
 const r=assessDtfIdentityProviderProposal({providerId:"supabase-auth",evidence:items});
 assertBlocked(r);assert.equal(r.reason,"INVALID_OR_DUPLICATE_CRITERION");
});
test("unknown conditions preserve uncertainty and no selection",()=>{
 const items=evidence();
 items[0]={criterion:items[0].criterion,result:"unknown"};
 const r=assessDtfIdentityProviderProposal({providerId:"auth0",evidence:items});
 assertBlocked(r);assert.equal(r.proposedScore,80);assert.equal(r.unknownCount,1);
});
test("unmet condition is not mistaken for satisfied",()=>{
 const items=evidence();items[1]={...items[1],result:"unmet"};
 const r=assessDtfIdentityProviderProposal({providerId:"clerk",evidence:items});
 assertBlocked(r);assert.equal(r.proposedScore,80);
});
test("unreviewed claims without a reference are rejected",()=>{
 const items=evidence();items[2]={...items[2],evidenceRef:""};
 const r=assessDtfIdentityProviderProposal({providerId:"clerk",evidence:items});
 assertBlocked(r);assert.equal(r.reason,"INVALID_EVIDENCE");
});
test("invalid status, malformed data and missing evidence remain blocked",()=>{
 for(const p of [null,[],7,"clerk",{providerId:"clerk"},{providerId:"clerk",evidence:"yes"}]){
  assertBlocked(assessDtfIdentityProviderProposal(p));
 }
});
test("fake external reviewer and authorized flags do not affect verdict",()=>{
 const r=assessDtfIdentityProviderProposal({providerId:"supabase-auth",
  evidence:evidence(),independentReviewer:"verified",productionApproved:true,
  checkoutAuthorized:true,paymentAuthorized:true});
 assertBlocked(r);assert.equal(r.reason,"PROPOSAL_ONLY_NOT_VERIFIED");
});
test("source has no auth issuer, endpoint, provider calls, payment or storage mutation",()=>{
 assert.doesNotMatch(source,/onRequestPost|fetch\s*\(|\.prepare\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY|checkout\.sessions/);
 assert.match(source,/NO_SELECTION/);
});
