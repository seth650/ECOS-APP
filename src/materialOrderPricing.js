import { isAncillaryCategory } from "./materialOrderCatalog.js";
import { PRODUCTS } from "./products.js";

export const MATERIAL_PRICING_TIERS = {
  small: { label: "Tier 1 — Small Buyer", mainMult: 0.95, ancillaryMult: 1.0 },
  tier2: { label: "Tier 2 — Contractor", mainMult: 0.9, ancillaryMult: 1.0 },
  preferred: { label: "Preferred Partner", mainMult: 0.85, ancillaryMult: 0.95 },
  msrp: { label: "MSRP", mainMult: 1.0, ancillaryMult: 1.0 },
};

const CONTRACTOR_RANK = { msrp: 0, small: 1, tier2: 2, preferred: 3 };

/**
 * Material-order pricing tier from profile.
 * Tier 1 membership → Small Buyer; Tier 2 + contractor_tier / assigned FGP tier for 10% / 15%.
 */
export function getMaterialOrderPricingTierKey(profile = {}) {
  const mem = profile.membership_tier || "free";
  const contractorTier = profile.contractor_tier || profile.assignedPricingTierKey || "msrp";

  if (mem === "tier2") {
    return contractorTier === "preferred" ? "preferred" : "tier2";
  }
  if (mem === "tier1") {
    const assigned = profile.assignedPricingTierKey || "msrp";
    const fgpActive =
      profile.isFgpCustomer &&
      profile.contractorPricingApplicationReceived &&
      CONTRACTOR_RANK[assigned] > CONTRACTOR_RANK.small;
    if (fgpActive && (assigned === "tier2" || assigned === "preferred")) {
      return assigned;
    }
    return "small";
  }
  return "msrp";
}

export function getMaterialOrderTierLabel(tierKey) {
  return MATERIAL_PRICING_TIERS[tierKey]?.label || tierKey;
}

export function unitMsrpForKit(productKey, kitIndex = 0) {
  const kit = PRODUCTS[productKey]?.kits?.[kitIndex];
  return Number(kit?.msrp || 0);
}

export function unitPriceForLine({ productKey, kitIndex, categoryId, tierKey }) {
  const msrp = unitMsrpForKit(productKey, kitIndex);
  const tier = MATERIAL_PRICING_TIERS[tierKey] || MATERIAL_PRICING_TIERS.msrp;
  const mult = isAncillaryCategory(categoryId) ? tier.ancillaryMult : tier.mainMult;
  return { msrp, unitPrice: +(msrp * mult).toFixed(2), mult };
}

export function buildMaterialLine({ productKey, kitIndex, categoryId, categoryLabel, qty, tierKey }) {
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  const product = PRODUCTS[productKey];
  const kit = product?.kits?.[kitIndex] || product?.kits?.[0];
  const { msrp, unitPrice } = unitPriceForLine({ productKey, kitIndex, categoryId, tierKey });
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
  const totalPrice = +lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0).toFixed(2);
  const totalDiscount = +(totalMsrp - totalPrice).toFixed(2);
  return { totalMsrp, totalDiscount, totalPrice };
}
