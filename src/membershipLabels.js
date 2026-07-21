/**
 * Internal membership keys (DB / Stripe): free | tier1 | tier2
 * Display names: Free | Estimator | Calculator
 */

export function membershipTierToPlanTag(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  if (t === "tier1") return "Estimator";
  if (t === "tier2") return "Calculator";
  return "Free";
}

export function tierTagToMembershipTier(planTag = "Free") {
  const tag = String(planTag || "Free").trim();
  if (tag === "Estimator" || tag === "Tier 1") return "tier1";
  if (tag === "Calculator" || tag === "Tier 2") return "tier2";
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
