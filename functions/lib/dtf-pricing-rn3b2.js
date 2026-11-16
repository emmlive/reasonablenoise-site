// RN-3B2: server-owned, synthetic-only DTF transfer pricing engine.
// This module never creates Stripe sessions, authorizes orders or approves production.
const SIZES = new Set(["3x3", "8x10", "10.5x11", "11x14"]);
const FULFILLMENT = new Set(["pickup", "shipping"]);
const MAX_TOTAL_CENTS = 100000000;

function reject(reason) {
  return { ok: false, reason, checkoutEligible: false, productionApproved: false };
}
function positiveInteger(n, max) {
  return Number.isSafeInteger(n) && n >= 1 && n <= max;
}
function dimensionQuarterInches(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const quarters = value * 4;
  return Number.isSafeInteger(quarters) && quarters >= 2 && quarters <= 400 ? quarters : null;
}
function explicitMoney(value, max = 1000000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function validateConfig(config) {
  if (!config || config.mode !== "synthetic_test" || config.testOnly !== true) return false;
  if (!explicitMoney(config.pricePerSquareInchCents, 100000) || config.pricePerSquareInchCents === 0) return false;
  if (!explicitMoney(config.pickupCents) || !explicitMoney(config.shippingCents)) return false;
  if (!Array.isArray(config.quantityDiscounts) || config.quantityDiscounts.length > 10) return false;
  let previousMin = 1;
  for (const tier of config.quantityDiscounts) {
    if (!tier || !positiveInteger(tier.minQuantity, 10000) || tier.minQuantity <= previousMin ||
        !Number.isSafeInteger(tier.discountBps) || tier.discountBps < 0 || tier.discountBps > 5000) return false;
    previousMin = tier.minQuantity;
  }
  return true;
}
export function calculateDtfSyntheticPrice(request, config) {
  if (!validateConfig(config)) return reject("TEST_PRICING_NOT_CONFIGURED");
  if (!request || typeof request !== "object" || Array.isArray(request)) return reject("INVALID_REQUEST");
  if (!positiveInteger(request.quantity, 10000)) return reject("INVALID_QUANTITY");
  if (!FULFILLMENT.has(request.fulfillment)) return reject("INVALID_FULFILLMENT");
  const w = dimensionQuarterInches(request.widthInches);
  const h = dimensionQuarterInches(request.heightInches);
  if (!w || !h) return reject("INVALID_DIMENSIONS");
  const size = (w / 4) + "x" + (h / 4);
  if (!SIZES.has(size) && config.allowCustomSizes !== true) return reject("CUSTOM_SIZE_REQUIRES_REVIEW");
  // Exact integer arithmetic: square inches represented as quarter-inch units.
  const areaQuarters = w * h;
  const unitCents = Math.ceil(areaQuarters * config.pricePerSquareInchCents / 16);
  const subtotalCents = unitCents * request.quantity;
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents > MAX_TOTAL_CENTS) return reject("PRICE_LIMIT_EXCEEDED");
  let discountBps = 0;
  for (const tier of config.quantityDiscounts) {
    if (request.quantity >= tier.minQuantity) discountBps = tier.discountBps;
  }
  const discountCents = Math.floor(subtotalCents * discountBps / 10000);
  const shippingCents = request.fulfillment === "shipping" ? config.shippingCents : config.pickupCents;
  const totalCents = subtotalCents - discountCents + shippingCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_TOTAL_CENTS) return reject("PRICE_LIMIT_EXCEEDED");
  return {
    ok: true, currency: "usd", testOnly: true, mode: "synthetic_test",
    size, quantity: request.quantity, fulfillment: request.fulfillment,
    unitCents, subtotalCents, discountBps, discountCents, shippingCents, totalCents,
    quoteType: "NON_BINDING_SYNTHETIC_PREVIEW",
    checkoutEligible: false, productionApproved: false,
    disclaimer: "TEST ONLY — not a customer price, production quote, tax calculation or payment authorization.",
  };
}
