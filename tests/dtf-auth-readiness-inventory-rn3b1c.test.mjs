// RN-3B1C Phase23: evidence inventory can NEVER authorize production.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DTF_AUTH_READINESS_GATES,inspectDtfAuthReadinessEvidence,
 listDtfAuthBlockers} from "../functions/lib/dtf-auth-readiness-inventory-rn3b1c.js";
const src=readFileSync(new URL("../functions/lib/dtf-auth-readiness-inventory-rn3b1c.js",import.meta.url),"utf8");
const sha="a".repeat(64);
const report=input=>inspectDtfAuthReadinessEvidence(input);
const noPower=r=>{
 assert.equal(r.status,"BLOCKED");
 for(const field of ["reviewCandidate","liveIntegrationAuthorized","checkoutAuthorized",
  "paymentAuthorized","artworkDeletionAuthorized","productionDeploymentAuthorized"])
  assert.equal(r[field],false,field);
};
const valid=id=>{
 const gate=DTF_AUTH_READINESS_GATES.find(g=>g.id===id);
 return{id,status:"reviewed",evidenceRef:"review/proof-12345678",
 sha256:sha,reviewerRole:gate.owner,reviewerRef:"reviewer/security-12345678"};
};
test("empty evidence remains blocked and enumerates all production gates",()=>{
 const r=report();
 noPower(r);
 assert.equal(r.gates.length,14);
 assert.ok(r.gates.every(g=>g.condition==="MISSING"));
});
test("the gate identifiers and required owners are unique and stable",()=>{
 const ids=DTF_AUTH_READINESS_GATES.map(g=>g.id);
 assert.equal(new Set(ids).size,14);
 assert.ok(DTF_AUTH_READINESS_GATES.every(g=>g.owner&&g.proof));
 assert.equal(Object.isFrozen(DTF_AUTH_READINESS_GATES),true);
});
test("partial evidence can never grant acceptance or payment",()=>{
 const r=report({entries:[valid("issuer-selection")]});
 noPower(r);
 assert.equal(r.gates.find(g=>g.id==="issuer-selection").condition,"CLAIMED_REVIEWED_NOT_TRUSTED");
 assert.equal(r.gates.filter(g=>g.condition==="MISSING").length,13);
});
test("even claimed reviewed proof for all 14 gates never approves integration",()=>{
 const r=report({entries:DTF_AUTH_READINESS_GATES.map(g=>valid(g.id))});
 noPower(r);
 assert.equal(r.gates.filter(g=>g.condition==="CLAIMED_REVIEWED_NOT_TRUSTED").length,14);
});
test("forged productionApproved or checkoutAuthorized manifest fields are ignored",()=>{
 const r=report({productionApproved:true,checkoutAuthorized:true,liveIntegrationAuthorized:true,
  entries:DTF_AUTH_READINESS_GATES.map(g=>valid(g.id))});
 noPower(r);
});
test("duplicate gate IDs fail visibly without replacing the first proof",()=>{
 const r=report({entries:[valid("issuer-signature"),valid("issuer-signature")]});
 noPower(r);
 assert.equal(r.gates.find(g=>g.id==="issuer-signature").condition,"DUPLICATE");
});
test("unverified evidence and blocked evidence are classified distinctly",()=>{
 const r=report({entries:[
  {...valid("owner-binding"),status:"pending"},
  {...valid("quote-pricing"),status:"blocked"}
 ]});
 noPower(r);
 assert.equal(r.gates.find(g=>g.id==="owner-binding").condition,"UNVERIFIED");
 assert.equal(r.gates.find(g=>g.id==="quote-pricing").condition,"BLOCKED");
});
test("missing reviewer, wrong role and synthetic reviewer flags fail metadata check",()=>{
 const r=report({entries:[
  {...valid("csrf-browser"),reviewerRef:""},
  {...valid("owner-binding"),reviewerRole:"customer"},
  {...valid("provider-runtime"),reviewerRef:true}
 ]});
 noPower(r);
 for(const id of ["csrf-browser","owner-binding","provider-runtime"])
  assert.equal(r.gates.find(g=>g.id===id).condition,"INVALID_EVIDENCE_METADATA");
});
test("invalid hashes, evidence paths and malformed evidence metadata never count",()=>{
 const r=report({entries:[
  {...valid("issuer-selection"),sha256:"not-a-sha"},
  {...valid("issuer-signature"),evidenceRef:"?"}
 ]});
 noPower(r);
 assert.equal(r.gates.filter(g=>g.condition==="INVALID_EVIDENCE_METADATA").length,2);
});
test("unknown IDs cannot be smuggled into the gate result",()=>{
 const r=report({entries:[{...valid("issuer-selection"),id:"payment-activation"}]});
 noPower(r);
 assert.equal(r.gates.length,14);
 assert.equal(r.gates.filter(g=>g.condition==="MISSING").length,14);
});
test("malformed input, arrays, null and strings are fail closed",()=>{
 for(const v of [null,undefined,[], "ready", 7, {entries:"reviewed"},{entries:[null,1,"x"]}]){
  const r=report(v);
  noPower(r);
  assert.equal(r.gates.filter(g=>g.condition==="MISSING").length,14);
 }
});
test("readiness blockers list cannot confuse claimed reviews with verified evidence",()=>{
 const r=listDtfAuthBlockers({entries:[valid("session-issuance")]});
 noPower(r);
 assert.equal(r.total,14);
 assert.equal(r.missing.length,13);
 assert.deepEqual(r.disputed,["session-issuance"]);
});
test("no admin cookie, email contact, unsigned Access JWT or client flag proves auth",()=>{
 const r=report({adminToken:"fake",email:"customer@example.invalid",
  accessJwt:{email:"customer@example.invalid"},verified:true});
 noPower(r);
 assert.ok(r.gates.every(g=>g.condition==="MISSING"));
});
test("source is inspection-only without session issuer, routes, Stripe, D1 or R2 mutation",()=>{
 assert.doesNotMatch(src,/onRequestPost|fetch\s*\(|\.prepare\s*\(|STRIPE_SECRET_KEY|ARTWORK_BUCKET|RESEND_API_KEY|checkout\.sessions/);
 assert.match(src,/liveIntegrationAuthorized:false/);
 assert.match(src,/EXTERNAL_INDEPENDENT_APPROVAL_REQUIRED/);
});
