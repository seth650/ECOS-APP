import {
  applyPoYearResetIfNeeded,
  MAX_TIER1_POS_PER_YEAR,
  normalizePoProfileFields,
} from "../../src/poLimits.js";

/**
 * Apply anniversary reset if needed and return the profile fields to persist.
 */
export async function ensurePoYearCurrent(admin, userId, profile) {
  const normalized = normalizePoProfileFields(profile);
  const reset = applyPoYearResetIfNeeded(normalized);
  if (!reset.changed) {
    return { ...normalized, ...reset, annual_po_count: reset.annual_po_count };
  }
  const patch = {
    po_year_start_date: reset.po_year_start_date,
    annual_po_count: reset.annual_po_count,
    pos_submitted_this_year: reset.annual_po_count,
  };
  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
  return { ...normalized, ...reset, ...patch };
}

export function isTier1PoLimitReached(profile) {
  const membership = String(profile?.membership_tier || "free").toLowerCase();
  if (membership !== "tier1") return false;
  const count = Number(profile?.annual_po_count) || 0;
  return count >= MAX_TIER1_POS_PER_YEAR;
}

export async function incrementAnnualPoCount(admin, userId, profile) {
  const current = await ensurePoYearCurrent(admin, userId, profile);
  const next = (Number(current.annual_po_count) || 0) + 1;
  const patch = {
    annual_po_count: next,
    pos_submitted_this_year: next,
  };
  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
  return next;
}
