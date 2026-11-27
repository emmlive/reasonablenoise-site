// RN Holiday 2B: test-only, read-only Stripe session + line item reconciliation.
// No routed endpoint. No customer entitlement, durable order, fulfillment or emails.
const CATALOG = Object.freeze({
  reindeer: "Season's Greetings Tee",
  bear: "Holiday Cheer Tee",
  owl: "Holiday Hoots Tee",
  gingerbread: "Ginger Snap Tee",
});
const SIZES = new Set(["S","M","L","XL","2XL"]);
const COLORS = new Set(["white","cream","heather-gray"]);
const PRICE_CENTS = 2400;
const SHIPPING_CENTS = 999;
const SESSION = /^cs_test_[A-Za-z0-9_]{6,}$/;
const REFERENCE = /^RNH-[A-F0-9]{16}$/;

const hold = (reason, extras={}) => ({
  status: "hold", reason,
  paymentAuthorized: false,
  fulfillmentAuthorized: false,
  emailAuthorized: false,
  deletionAuthorized: false,
  ...extras,
});
const blocked = reason => ({ status: "blocked", reason,
  paymentAuthorized: false, fulfillmentAuthorized: false,
  emailAuthorized: false, deletionAuthorized: false });

function parseVariant(description) {
  if (typeof description !== "string" || description.length > 150) return null;
  for (const [id, name] of Object.entries(CATALOG)) {
    const prefix = name + " — ";
    if (!description.startsWith(prefix)) continue;
    const detail = description.slice(prefix.length).split(" / ");
    if (detail.length !== 2 || !SIZES.has(detail[0]) || !COLORS.has(detail[1])) return null;
    return { id, size: detail[0], color: detail[1] };
  }
  return null;
}

function normalizeLineItems(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 12) return null;
  const items=[];
  let quantity=0;
  for (const line of lines) {
    if (line?.object !== "item") return null;
    const variant = parseVariant(line.description);
    if (!variant || line.currency !== "usd" ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 12 ||
        line.price?.currency !== "usd" || line.price?.unit_amount !== PRICE_CENTS ||
        line.price?.type !== "one_time" ||
        line.amount_subtotal !== line.quantity*PRICE_CENTS ||
        line.amount_total !== line.amount_subtotal) return null;
    quantity+=line.quantity;
    if(quantity>12) return null;
    items.push({ ...variant, quantity:line.quantity });
  }
  return { items, quantity, subtotal:quantity*PRICE_CENTS };
}

function validEmail(value) {
  return typeof value==="string" && value.length<=254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validShipTo(session) {
  const address = session.collected_information?.shipping_details?.address ??
    session.shipping_details?.address ?? null;
  const email=session.customer_details?.email ?? session.customer_email;
  return validEmail(email) &&
    address?.country==="US" &&
    typeof address.postal_code==="string" &&
    /^[0-9]{5}(?:-[0-9]{4})?$/.test(address.postal_code) &&
    typeof address.line1==="string" && address.line1.trim().length>2 &&
    typeof address.city==="string" && address.city.trim().length>1 &&
    typeof address.state==="string" && /^[A-Z]{2}$/.test(address.state);
}

export function verifyRetrievedHolidayOrder({ candidate, session, lineItems }) {
  // Candidate MUST originate from Phase 2A signature verification. Even then it
  // conveys a read-only reference, not authorization to fulfill or email.
  if (candidate?.status!=="hold" ||
      candidate.reason!=="retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe" ||
      candidate.paymentAuthorized!==false || candidate.fulfillmentAuthorized!==false ||
      !SESSION.test(String(candidate.checkoutSessionId||"")) ||
      !REFERENCE.test(String(candidate.orderReference||""))) return blocked("invalid_candidate");
  const m=session?.metadata;
  if (session?.object!=="checkout.session" ||
      session.id!==candidate.checkoutSessionId ||
      session.livemode!==false || session.mode!=="payment" ||
      session.payment_status!=="paid" || session.status!=="complete" ||
      session.currency!=="usd" ||
      m?.source!=="reasonablenoise" ||
      m?.order_type!=="holiday_shirt_test" ||
      m?.fulfillment_status!=="manual_review_only" ||
      m?.order_reference!==candidate.orderReference ||
      session.client_reference_id!==candidate.orderReference) {
    return blocked("retrieved_session_mismatch");
  }
  if (!validShipTo(session)) return blocked("missing_verified_shipping_contact");
  const normalized=normalizeLineItems(lineItems);
  if (!normalized) return blocked("invalid_line_items");
  if (session.amount_subtotal!==normalized.subtotal ||
      session.shipping_cost?.amount_total!==SHIPPING_CENTS ||
      session.amount_total!==normalized.subtotal+SHIPPING_CENTS ||
      (session.total_details?.amount_tax??0)!==0 ||
      (session.total_details?.amount_discount??0)!==0 ||
      session.payment_method_types?.includes("paypal")) return blocked("amount_mismatch");
  return hold("durable_order_idempotency_and_refund_reconciliation_required",{
    orderReference:candidate.orderReference,
    checkoutSessionId:candidate.checkoutSessionId,
    eventId:candidate.eventId,
    units:normalized.quantity,
    subtotalCents:normalized.subtotal,
    shippingCents:SHIPPING_CENTS,
    totalCents:normalized.subtotal+SHIPPING_CENTS,
    // Deliberately no name, email, phone or street address in output.
    variants:normalized.items,
  });
}

async function readStripeJson(fetcher, url, key) {
  let response;
  try {
    response=await fetcher(url,{method:"GET",headers:{
      authorization:"Bearer "+key, accept:"application/json"
    }});
  } catch { return null; }
  if (!response?.ok) return null;
  try { return await response.json(); } catch { return null; }
}

// Network access can only be supplied by a caller in a disposable test context.
// This module has no independent Pages route or production event handler.
export async function reconcileHolidayTestCandidate({
  candidate, stripeTestKey, fetcher, allowIsolatedRead=false
}) {
  if (!allowIsolatedRead ||
      !/^sk_test_[A-Za-z0-9_-]{6,}$/.test(String(stripeTestKey||"")) ||
      typeof fetcher!=="function" ||
      !SESSION.test(String(candidate?.checkoutSessionId||"")) ||
      candidate?.status!=="hold" ||
      candidate?.reason!=="retrieve_stripe_session_line_items_and_provenance_then_durable_dedupe" ||
      candidate.paymentAuthorized!==false || candidate.fulfillmentAuthorized!==false ||
      !REFERENCE.test(String(candidate.orderReference||""))) return blocked("retrieval_disabled");
  const id=encodeURIComponent(candidate.checkoutSessionId);
  const root="https://api.stripe.com/v1/checkout/sessions/"+id;
  const session=await readStripeJson(fetcher,root,stripeTestKey);
  if (!session || session.id!==candidate.checkoutSessionId || session.livemode!==false) {
    return blocked("session_lookup_failed");
  }
  // Limit=100 to cover all supported 12 shirts; reject any truncated list.
  // Never trust line_items embedded in the webhook event or browser request.
  const lines=await readStripeJson(fetcher,root+"/line_items?limit=100",stripeTestKey);
  if (!lines || lines.object!=="list" || lines.has_more!==false ||
      !Array.isArray(lines.data)) return blocked("line_items_lookup_failed");
  return verifyRetrievedHolidayOrder({candidate,session,lineItems:lines.data});
}
export const __holiday2b = { parseVariant, normalizeLineItems, PRICE_CENTS, SHIPPING_CENTS };
