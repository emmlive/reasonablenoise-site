import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateDtfSyntheticPrice } from "../functions/lib/dtf-pricing-rn3b2.js";

const cfg = () => ({
  mode: "synthetic_test", testOnly: true, pricePerSquareInchCents: 12,
  pickupCents: 0, shippingCents: 999, allowCustomSizes: false,
  quantityDiscounts: [{ minQuantity: 6, discountBps: 500 }, { minQuantity: 12, discountBps: 1000 }],
});
const req = () => ({ widthInches: 10.5, heightInches: 11, quantity: 1, fulfillment: "pickup" });
const expectNoAuthorization = (x) => {
  assert.equal(x.checkoutEligible, false);
  assert.equal(x.productionApproved, false);
};
test("synthetic 10.5 by 11 inch pickup computes integer cents, never payment approval", () => {
  const p = calculateDtfSyntheticPrice(req(), cfg());
  assert.equal(p.ok, true);
  assert.equal(p.unitCents, 1386);
  assert.equal(p.totalCents, 1386);
  assert.equal(p.currency, "usd");
  assert.equal(p.testOnly, true);
  assert.equal(p.quoteType, "NON_BINDING_SYNTHETIC_PREVIEW");
  expectNoAuthorization(p);
});
test("shipping is a separate server-owned line item", () => {
  const p = calculateDtfSyntheticPrice({ ...req(), fulfillment: "shipping" }, cfg());
  assert.equal(p.shippingCents, 999);
  assert.equal(p.totalCents, 2385);
  expectNoAuthorization(p);
});
test("quantity discounts are integer cents and tiered", () => {
  const p = calculateDtfSyntheticPrice({ ...req(), quantity: 12 }, cfg());
  assert.equal(p.subtotalCents, 16632);
  assert.equal(p.discountBps, 1000);
  assert.equal(p.discountCents, 1663);
  assert.equal(p.totalCents, 14969);
  expectNoAuthorization(p);
});
test("every standard preset is supported without custom sizing enabled", () => {
  for (const [w,h] of [[3,3],[8,10],[10.5,11],[11,14]]) {
    assert.equal(calculateDtfSyntheticPrice({ ...req(), widthInches:w, heightInches:h }, cfg()).ok, true);
  }
});
test("custom sizes need a deliberate configuration and never authorize checkout", () => {
  const request={ ...req(), widthInches:7.5, heightInches:9 };
  assert.equal(calculateDtfSyntheticPrice(request,cfg()).reason,"CUSTOM_SIZE_REQUIRES_REVIEW");
  const p=calculateDtfSyntheticPrice(request,{...cfg(),allowCustomSizes:true});
  assert.equal(p.ok,true);
  expectNoAuthorization(p);
});
test("invalid and missing pricing configurations fail closed", () => {
  for (const c of [null,{}, {...cfg(),mode:"production"}, {...cfg(),testOnly:false},
    {...cfg(),pricePerSquareInchCents:0}, {...cfg(),pricePerSquareInchCents:NaN},
    {...cfg(),shippingCents:-1}, {...cfg(),quantityDiscounts:[{minQuantity:6,discountBps:8000}]},
    {...cfg(),quantityDiscounts:[{minQuantity:12,discountBps:100},{minQuantity:6,discountBps:200}]}]) {
      const p=calculateDtfSyntheticPrice(req(),c);
      assert.equal(p.ok,false);
      expectNoAuthorization(p);
  }
});
test("invalid quantity, dimensions and shipping requests fail closed", () => {
  for (const r of [null,{}, {...req(),quantity:0},{...req(),quantity:1.5},
    {...req(),quantity:"2"}, {...req(),quantity:10001},
    {...req(),widthInches:0},{...req(),widthInches:"10.5"},
    {...req(),widthInches:10.125},{...req(),heightInches:Infinity},
    {...req(),heightInches:101},{...req(),fulfillment:"free_shipping"}]) {
      const p=calculateDtfSyntheticPrice(r,cfg());
      assert.equal(p.ok,false);
      expectNoAuthorization(p);
  }
});
test("arithmetic limits prevent unsafe amount and excessive order totals", () => {
  const p=calculateDtfSyntheticPrice({ ...req(),quantity:10000,widthInches:100,heightInches:100 },
    { ...cfg(),pricePerSquareInchCents:10000,allowCustomSizes:true });
  assert.equal(p.reason,"PRICE_LIMIT_EXCEEDED");
  expectNoAuthorization(p);
});
test("DTF pricing source is independent of Stripe and existing sticker checkout", () => {
  const module=readFileSync(new URL("../functions/lib/dtf-pricing-rn3b2.js", import.meta.url),"utf8");
  assert.doesNotMatch(module,/stripe\.com|stripe\.checkout|create-checkout|payment_intent|R2_BUCKET|RESEND_API/);
  const checkout=readFileSync(new URL("../functions/api/create-checkout-session.js", import.meta.url),"utf8");
  assert.doesNotMatch(checkout,/dtf-pricing-rn3b2|calculateDtfSyntheticPrice/);
});
