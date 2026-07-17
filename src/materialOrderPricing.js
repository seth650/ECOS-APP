import { isAncillaryCategory, getMergedProducts } from "./materialOrderCatalog.js";

export const INDIANA_SALES_TAX_RATE = 0.07;

export function applyIndianaSalesTax(subtotalAfterDiscount) {
  const subtotal = +Number(subtotalAfterDiscount || 0).toFixed(2);
  const salesTax = +(subtotal * INDIANA_SALES_TAX_RATE).toFixed(2);
  const totalWithTax = +(subtotal + salesTax).toFixed(2);
  return { subtotalAfterDiscount: subtotal, salesTax, totalWithTax };
}

export const MATERIAL_PRICING_TIERS = {
  small: { label: "Tier 1 — Small Buyer", mainMult: 0.95, ancillaryMult: 1.0 },
  tier2: { label: "Tier 2 — Contractor", mainMult: 0.9, ancillaryMult: 1.0 },
  preferred: { label: "Preferred Partner", mainMult: 0.85, ancillaryMult: 0.95 },
  msrp: { label: "MSRP", mainMult: 1.0, ancillaryMult: 1.0 },
};

const CONTRACTOR_RANK = { msrp: 0, small: 1, tier2: 2, preferred: 3 };

/**
 * Material-order pricing tier from profile.
 * Tier 1 membership → Small Buyer (5%); Tier 2 → 10%/15%; Testing Mode FGP unlock honors assigned buying tier.
 */
export function getMaterialOrderPricingTierKey(profile = {}) {
  const mem = String(profile.membership_tier || "free").toLowerCase();
  const assignedRaw = profile.contractor_tier || profile.assignedPricingTierKey || "msrp";
  const assigned = MATERIAL_PRICING_TIERS[assignedRaw] ? assignedRaw : "msrp";
  const fgpUnlocked = !!(profile.isFgpCustomer && profile.contractorPricingApplicationReceived);

  if (mem === "tier2") {
    if (assigned === "preferred") return "preferred";
    if (assigned === "small") return "small";
    return "tier2";
  }
  if (mem === "tier1") {
    if (fgpUnlocked && (assigned === "tier2" || assigned === "preferred" || assigned === "small")) {
      return assigned === "msrp" ? "small" : assigned;
    }
    return "small";
  }
  if (fgpUnlocked && CONTRACTOR_RANK[assigned] > CONTRACTOR_RANK.msrp) {
    return assigned;
  }
  return "msrp";
}

export function getMaterialOrderTierLabel(tierKey) {
  return MATERIAL_PRICING_TIERS[tierKey]?.label || tierKey;
}

export function unitMsrpForKit(productKey, kitIndex = 0, customSystems = []) {
  const catalog = getMergedProducts(customSystems);
  const kit = catalog[productKey]?.kits?.[kitIndex];
  return Number(kit?.msrp || 0);
}

export function unitPriceForLine({ productKey, kitIndex, categoryId, tierKey, customSystems = [] }) {
  const catalog = getMergedProducts(customSystems);
  const msrp = unitMsrpForKit(productKey, kitIndex, customSystems);
  const kit = catalog[productKey]?.kits?.[kitIndex] || catalog[productKey]?.kits?.[0];
  if (kit?.tierPrices && typeof kit.tierPrices[tierKey] === "number") {
    return { msrp, unitPrice: +Number(kit.tierPrices[tierKey]).toFixed(2), mult: null };
  }
  const tier = MATERIAL_PRICING_TIERS[tierKey] || MATERIAL_PRICING_TIERS.msrp;
  const mult = isAncillaryCategory(categoryId) ? tier.ancillaryMult : tier.mainMult;
  return { msrp, unitPrice: +(msrp * mult).toFixed(2), mult };
}

export function buildMaterialLine({ productKey, kitIndex, categoryId, categoryLabel, qty, tierKey, customSystems = [] }) {
  const catalog = getMergedProducts(customSystems);
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  const product = catalog[productKey];
  const kit = product?.kits?.[kitIndex] || product?.kits?.[0];
  const { msrp, unitPrice } = unitPriceForLine({ productKey, kitIndex, categoryId, tierKey, customSystems });
  const lineMsrp = +(msrp * q).toFixed(2);
  const lineTotal = +(unitPrice * q).toFixed(2);
  const savings = +(lineMsrp - lineTotal).toFixed(2);
  return {
    productKey,
    productName: product?.name || productKey,
    kitSize: kit?.size || "—",
    kitIndex,
    categoryId,
    categoryLabel,
    qty: q,
    unitMsrp: msrp,
    unitPrice,
    lineMsrp,
    lineTotal,
    savings,
  };
}

export function summarizeMaterialLines(lines) {
  const totalMsrp = +lines.reduce((s, l) => s + Number(l.lineMsrp || 0), 0).toFixed(2);
  const subtotalAfterDiscount = +lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0).toFixed(2);
  const totalDiscount = +(totalMsrp - subtotalAfterDiscount).toFixed(2);
  const { salesTax, totalWithTax } = applyIndianaSalesTax(subtotalAfterDiscount);
  return {
    totalMsrp,
    totalDiscount,
    subtotalAfterDiscount,
    totalPrice: subtotalAfterDiscount,
    salesTax,
    totalWithTax,
  };
}
