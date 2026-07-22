/**
 * Internal membership keys (DB / Stripe): free | tier1 | tier2
 * Display names: Free | Calculator ($49) | Estimator ($149)
 */

export function membershipTierToPlanTag(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  if (t === "tier1") return "Calculator";
  if (t === "tier2") return "Estimator";
  return "Free";
}

export function tierTagToMembershipTier(planTag = "Free") {
  const tag = String(planTag || "Free").trim();
  // Current names
  if (tag === "Calculator") return "tier1";
  if (tag === "Estimator") return "tier2";
  // Legacy aliases (pre–name flip + old Tier 1/2 tags)
  if (tag === "Tier 1") return "tier1";
  if (tag === "Tier 2") return "tier2";
  return "free";
}

export function membershipDisplayName(tier = "free") {
  return membershipTierToPlanTag(tier);
}

export function membershipPriceLabel(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  if (t === "tier1") return "$49/mo";
  if (t === "tier2") return "$149/mo";
  return "$0";
}
