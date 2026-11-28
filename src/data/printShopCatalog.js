// Display-only guides derived from the existing site and catalog seed.
// Never represent these as live availability or a guaranteed final price.
// The server-side checkout route remains authoritative.
export const printShopItems = Object.freeze([
  { id: "usdot-sticker-pair", title: "USDOT sticker pair", price: "$29", pricing: "fixed", category: "USDOT & truck decals", visual: "usdot", description: "A matching pair of USDOT number decals for your vehicle.", href: "/upload-design", cta: "Start sticker order" },
  { id: "usdot-business-name-pair", title: "USDOT + business name", price: "$39", pricing: "fixed", category: "USDOT & truck decals", visual: "lettering", description: "Pair your USDOT number with your business name.", href: "/upload-design", cta: "Start order" },
  { id: "extra-usdot-pair", title: "Extra matching pair", price: "$25", pricing: "fixed", category: "USDOT & truck decals", visual: "duo", description: "An additional matching pair for a second vehicle or backup.", href: "/upload-design", cta: "Start order" },
  { id: "one-side-usdot-replacement", title: "One-side replacement", price: "$18", pricing: "fixed", category: "USDOT & truck decals", visual: "replacement", description: "One replacement decal for one vehicle side or door.", href: "/upload-design", cta: "Start order" },
  { id: "truck-door-lettering", title: "Truck door lettering", price: "From $69", pricing: "starting_at", category: "Custom printing", visual: "lettering", description: "Business names, phone numbers, and service details for vehicle doors.", href: "/upload-design", cta: "Share your details" },
  { id: "custom-business-decals", title: "Custom business decals", price: "From $35", pricing: "starting_at", category: "Custom printing", visual: "decal", description: "Clean logo and branded vinyl decals from your artwork or idea.", href: "/upload-design", cta: "Upload design" },
  { id: "fleet-lettering", title: "Fleet lettering", price: "From $59", pricing: "starting_at", category: "Custom printing", visual: "fleet", description: "Consistent branding for trucks, vans, trailers, and service fleets.", href: "/upload-design", cta: "Request details" },
  { id: "logo-sticker-batch", title: "Logo sticker batch", price: "From $35", pricing: "starting_at", category: "Custom printing", visual: "decal", description: "A starter run of stickers with your logo or custom artwork.", href: "/upload-design", cta: "Upload artwork" },
  { id: "design-cleanup", title: "Design cleanup", price: "From $15", pricing: "starting_at", category: "Design assistance", visual: "design", description: "Basic layout and artwork preparation help before printing.", href: "/upload-design", cta: "Tell us what you need" },
  { id: "dtf-shirts", title: "DTF custom shirts", price: "Quote first", pricing: "quote_only", category: "Apparel", visual: "shirt", description: "Custom shirts for events, teams, and small businesses.", href: "/contact?topic=dtf", cta: "Request shirt quote" },
]);
