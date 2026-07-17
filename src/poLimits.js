/** Tier 1 annual PO submission cap (calculator + material orders). */
export const MAX_TIER1_POS_PER_YEAR = 50;
export const PO_WARNING_THRESHOLD = 45;
export const MAX_TIER1_JOBS = 10;
export const MAX_FREE_JOBS = 2;

export function normalizePoProfileFields(profile = {}) {
  const p = { ...profile };
  if (!p.po_year_start_date) {
    p.po_year_start_date = p.signup_anniversary_date || p.created_at || new Date().toISOString();
  }
  if (p.annual_po_count === undefined || p.annual_po_count === null) {
    p.annual_po_count = Number(p.pos_submitted_this_year) || 0;
  } else {
    p.annual_po_count = Number(p.annual_po_count) || 0;
  }
  if (!p.signup_anniversary_date) {
    p.signup_anniversary_date = p.po_year_start_date;
  }
  return p;
}

/**
 * If the PO year has elapsed, roll the window forward and reset the counter.
 * Returns the active window start, current count, and whether profile needs updating.
 */
export function applyPoYearResetIfNeeded(profile = {}) {
  const normalized = normalizePoProfileFields(profile);
  let windowStart = new Date(normalized.po_year_start_date);
  let count = normalized.annual_po_count;
  const now = new Date();
  let changed = false;

  while (true) {
    const windowEnd = new Date(windowStart);
    windowEnd.setFullYear(windowEnd.getFullYear() + 1);
    if (now < windowEnd) {
      return {
        po_year_start_date: windowStart.toISOString(),
        annual_po_count: count,
        changed,
        windowEnd: windowEnd.toISOString(),
      };
    }
    windowStart = windowEnd;
    count = 0;
    changed = true;
  }
}

export function formatPoResetDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function getTier1PoStatus(profile = {}) {
  const reset = applyPoYearResetIfNeeded(profile);
  const membership = String(profile.membership_tier || "free").toLowerCase();
  const count = reset.annual_po_count;
  const isTier1 = membership === "tier1";
  const isTier2 = membership === "tier2";
  return {
    count,
    limit: MAX_TIER1_POS_PER_YEAR,
    isTier1,
    isTier2,
    isFree: membership === "free",
    atLimit: isTier1 && count >= MAX_TIER1_POS_PER_YEAR,
    atWarning: isTier1 && count >= PO_WARNING_THRESHOLD && count < MAX_TIER1_POS_PER_YEAR,
    resetDate: reset.windowEnd,
    resetDateLabel: formatPoResetDate(reset.windowEnd),
    po_year_start_date: reset.po_year_start_date,
    annual_po_count: reset.annual_po_count,
    changed: reset.changed,
  };
}

export function getPoCounterLabel(status) {
  if (!status) return "";
  if (status.isTier2) return "Unlimited POs (Tier 2)";
  if (status.isFree) return "Unlimited POs in Tier 1";
  if (status.isTier1) {
    return `${status.count} of ${status.limit} POs used (resets ${status.resetDateLabel})`;
  }
  return "";
}

export function getMaxJobsForMembershipTier(tier = "free") {
  if (tier === "tier2") return MAX_TIER1_JOBS;
  return tier === "tier1" ? MAX_TIER1_JOBS : MAX_FREE_JOBS;
}
