// RN Holiday 2C — review-only disposable D1-compatible plan.
// Not a Cloudflare Pages route. No production binding, Stripe network,
// customer email, payment, fulfillment, or artwork deletion.
const REFERENCE=/^RNH-[A-F0-9]{16}$/;
const SESSION=/^cs_test_[A-Za-z0-9_]{6,}$/;
const EVENT=/^evt_[A-Za-z0-9]{6,}$/;
const PRODUCT=new Set(["reindeer","bear","owl","gingerbread"]);
const SIZE=new Set(["S","M","L","XL","2XL"]);
const COLOR=new Set(["white","cream","heather-gray"]);
const deny=reason=>({status:"blocked",reason,paymentAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false});
const hold=reason=>({status:"hold",reason,paymentAuthorized:false,
  fulfillmentAuthorized:false,emailAuthorized:false,deletionAuthorized:false});
function normalize(candidate) {
  if(candidate?.status!=="hold" ||
    candidate?.reason!=="durable_order_idempotency_and_refund_reconciliation_required" ||
    candidate?.paymentAuthorized!==false || candidate?.fulfillmentAuthorized!==false ||
    candidate?.emailAuthorized!==false || candidate?.deletionAuthorized!==false ||
    !REFERENCE.test(String(candidate.orderReference||"")) ||
    !SESSION.test(String(candidate.checkoutSessionId||"")) ||
    !EVENT.test(String(candidate.eventId||"")) ||
    !Array.isArray(candidate.variants) ||
    candidate.variants.length<1 || candidate.variants.length>12 ||
    !Number.isSafeInteger(candidate.units) || candidate.units<1 || candidate.units>12 ||
    candidate.shippingCents!==999 || candidate.subtotalCents!==candidate.units*2400 ||
    candidate.totalCents!==candidate.subtotalCents+999) return null;
  let units=0;
  const variants=[];
  for(const v of candidate.variants) {
    if(!v || !PRODUCT.has(v.id) || !SIZE.has(v.size) ||
       !COLOR.has(v.color) || !Number.isSafeInteger(v.quantity) ||
       v.quantity<1 || v.quantity>12) return null;
    units+=v.quantity;
    variants.push({id:v.id,size:v.size,color:v.color,quantity:v.quantity});
  }
  if(units!==candidate.units) return null;
  const snapshot={
    orderReference:candidate.orderReference, checkoutSessionId:candidate.checkoutSessionId,
    units,subtotalCents:candidate.subtotalCents,
    shippingCents:999,totalCents:candidate.totalCents,variants
  };
  return {snapshot,eventId:candidate.eventId};
}
async function fingerprint(snapshot) {
  const hash=await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(snapshot)));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export const INSERT_ORDER=[
  "INSERT INTO rn_holiday_review_orders",
  "(order_reference,checkout_session_id,payload_sha256,units,subtotal_cents,shipping_cents,total_cents,status)",
  "SELECT ?,?,?,?,?,?,?,'review_only'",
  "WHERE NOT EXISTS (SELECT 1 FROM rn_holiday_review_events WHERE event_id=?)",
  "ON CONFLICT DO NOTHING"
].join(" ");
export const INSERT_EVENT=[
  "INSERT INTO rn_holiday_review_events",
  "(event_id,order_reference,checkout_session_id,payload_sha256,status)",
  "SELECT ?,o.order_reference,o.checkout_session_id,o.payload_sha256,'seen_only'",
  "FROM rn_holiday_review_orders o",
  "WHERE o.order_reference=? AND o.checkout_session_id=? AND o.payload_sha256=?",
  "ON CONFLICT DO NOTHING"
].join(" ");
function d1Compatible(db) {
  return db && typeof db.prepare==="function" && typeof db.batch==="function";
}
function same(row,s,digest) {
  return row?.order_reference===s.orderReference &&
    row?.checkout_session_id===s.checkoutSessionId &&
    row?.payload_sha256===digest;
}
export async function recordHolidayReviewCandidate({
  candidate,disposableDb,allowDisposableWrite=false
}) {
  if(!allowDisposableWrite || !d1Compatible(disposableDb)) return deny("ledger_disabled");
  const entry=normalize(candidate);
  if(!entry) return deny("invalid_review_candidate");
  const s=entry.snapshot;
  const digest=await fingerprint(s);
  let batchResult;
  try {
    batchResult=await disposableDb.batch([
      disposableDb.prepare(INSERT_ORDER).bind(s.orderReference,s.checkoutSessionId,
        digest,s.units,s.subtotalCents,s.shippingCents,s.totalCents,entry.eventId),
      disposableDb.prepare(INSERT_EVENT).bind(entry.eventId,s.orderReference,
        s.checkoutSessionId,digest)
    ]);
  } catch {
    return deny("atomic_write_failed");
  }
  if(!Array.isArray(batchResult)||batchResult.length!==2 ||
      batchResult.some(r=>r?.success!==true)) return deny("atomic_write_unconfirmed");
  let order,event;
  try {
    order=await disposableDb.prepare(
      "SELECT order_reference,checkout_session_id,payload_sha256,status FROM rn_holiday_review_orders WHERE order_reference=?"
    ).bind(s.orderReference).first();
    event=await disposableDb.prepare(
      "SELECT event_id,order_reference,checkout_session_id,payload_sha256,status FROM rn_holiday_review_events WHERE event_id=?"
    ).bind(entry.eventId).first();
  } catch {
    return deny("readback_failed");
  }
  if(!same(order,s,digest) || order.status!=="review_only" ||
     !same(event,s,digest) || event.event_id!==entry.eventId ||
     event.status!=="seen_only") return deny("identity_collision_or_unconfirmed_write");
  const changes=Number(batchResult[0]?.meta?.changes??-1)+
    Number(batchResult[1]?.meta?.changes??-1);
  if(!Number.isInteger(changes) || changes<0 || changes>2)
    return deny("unconfirmed_write_metadata");
  return hold(changes===0?"duplicate_review_event_ignored":
    "review_only_recorded_no_fulfillment");
}
export const __holiday2c={normalize,fingerprint};
