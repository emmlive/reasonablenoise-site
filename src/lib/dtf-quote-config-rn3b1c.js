// RN-3B1C Phase 16: no-payments DTF quote configurator.
// All prices are informal existing site "from" figures, never checkout totals.
const source=["ReasonableNoise supplies shirts","Customer brings shirts","Not sure yet"];
const placements=["Front","Back","Front + Back","Sleeve / custom placement","Not sure yet"];
const clean=(x,max=100)=>String(x??"").trim().slice(0,max);
export function configureDtfQuote(input={}){
 const quantity=Number(input.quantity);
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)
  return {ok:false,code:"INVALID_QUANTITY",checkoutEligible:false};
 const shirtSource=clean(input.shirtSource);
 const placement=clean(input.placement);
 if(!source.includes(shirtSource)||!placements.includes(placement))
  return {ok:false,code:"INVALID_SELECTION",checkoutEligible:false};
 const color=clean(input.color,80);
 const sizeBreakdown=clean(input.sizeBreakdown,160);
 const deadline=clean(input.deadline,80);
 const artwork=clean(input.artwork,80);
 // Only single-sided, provider-supplied shirts have an illustrative site price.
 // No minimum/discount, taxes, setup fees, shipping or final charge is implied.
 const tier=quantity>=12?18:quantity>=6?20:24;
 const estimate=shirtSource===source[0]&&["Front","Back"].includes(placement)?
  {display:"From $"+tier+"/shirt",nonBinding:true}:
  {display:"Custom quote required",nonBinding:true};
 const details=[
  "DTF quote request", "Quantity: "+quantity, "Shirt source: "+shirtSource,
  "Print placement: "+placement,
  color?"Shirt color: "+color:null,
  sizeBreakdown?"Size breakdown: "+sizeBreakdown:null,
  deadline?"Deadline: "+deadline:null,
  artwork?"Artwork status: "+artwork:null,
  "Final price subject to artwork and production review. No payment authorized."
 ].filter(Boolean);
 return {ok:true,quantity,shirtSource,placement,color,sizeBreakdown,deadline,artwork,
  estimate,details,checkoutEligible:false,deletionAuthorized:false,
  productionApproved:false};
}
export function quoteToContactUrl(config){
 if(config?.ok!==true)return null;
 const qs=new URLSearchParams({topic:"dtf",quantity:String(config.quantity),
  shirtSource:config.shirtSource,placement:config.placement});
 for(const [key,value] of [["color",config.color],["sizes",config.sizeBreakdown],
  ["deadline",config.deadline],["artwork",config.artwork]]){
  if(value)qs.set(key,value);
 }
 return "/contact?"+qs.toString();
}
export function parseQuotePrefill(params){
 if(params?.get?.("topic")!=="dtf")return null;
 const result=configureDtfQuote({quantity:params.get("quantity"),
  shirtSource:params.get("shirtSource"),placement:params.get("placement"),
  color:params.get("color"),sizeBreakdown:params.get("sizes"),
  deadline:params.get("deadline"),artwork:params.get("artwork")});
 return result.ok?result:null;
}
