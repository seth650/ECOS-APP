/** Calculator (tier1 / $49) annual PO submission cap. Estimator (tier2 / $149) is unlimited. */
export const MAX_CALCULATOR_POS_PER_YEAR = 50;
/** @deprecated Use MAX_CALCULATOR_POS_PER_YEAR */
export const MAX_ESTIMATOR_POS_PER_YEAR = MAX_CALCULATOR_POS_PER_YEAR;
/** @deprecated Use MAX_CALCULATOR_POS_PER_YEAR */
export const MAX_TIER1_POS_PER_YEAR = MAX_CALCULATOR_POS_PER_YEAR;

export const PO_WARNING_THRESHOLD = 45;

/** Jobs allowed in one PO / cart bundle. */
export const MAX_FREE_JOBS = 2;
export const MAX_CALCULATOR_JOBS = 10;
/** @deprecated Use MAX_CALCULATOR_JOBS */
export const MAX_ESTIMATOR_JOBS = MAX_CALCULATOR_JOBS;
/** @deprecated Use MAX_CALCULATOR_JOBS */
export const MAX_TIER1_JOBS = MAX_CALCULATOR_JOBS;

/** Account-level saved job history for Free. Calculator+ is unlimited. */
export const MAX_FREE_SAVED_JOBS = 10;

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

/** Membership helpers — internal keys stay free / tier1 / tier2. */
export function isCalculatorMembership(tier = "free") {
  return String(tier || "free").toLowerCase() === "tier1";
}

export function isEstimatorMembership(tier = "free") {
  return String(tier || "free").toLowerCase() === "tier2";
}

export function isPaidMembership(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  return t === "tier1" || t === "tier2";
}

export function getTier1PoStatus(profile = {}) {
  const reset = applyPoYearResetIfNeeded(profile);
  const membership = String(profile.membership_tier || "free").toLowerCase();
  const count = reset.annual_po_count;
  const isCalculator = membership === "tier1";
  const isEstimator = membership === "tier2";
  return {
    count,
    limit: MAX_CALCULATOR_POS_PER_YEAR,
    isTier1: isCalculator,
    isTier2: isEstimator,
    isCalculator,
    isEstimator,
    isFree: membership === "free",
    atLimit: isCalculator && count >= MAX_CALCULATOR_POS_PER_YEAR,
    atWarning: isCalculator && count >= PO_WARNING_THRESHOLD && count < MAX_CALCULATOR_POS_PER_YEAR,
    resetDate: reset.windowEnd,
    resetDateLabel: formatPoResetDate(reset.windowEnd),
    po_year_start_date: reset.po_year_start_date,
    annual_po_count: reset.annual_po_count,
    changed: reset.changed,
  };
}

export function getPoCounterLabel(status) {
  if (!status) return "";
  if (status.isEstimator || status.isTier2) return "Unlimited POs";
  if (status.isFree) return "Upgrade to Calculator for PO history + 50 POs/year";
  if (status.isCalculator || status.isTier1) {
    return `${status.count} of ${status.limit} POs used this year (resets ${status.resetDateLabel})`;
  }
  return "";
}

/** Max jobs in the active cart / PO bundle. */
export function getMaxJobsForMembershipTier(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  if (t === "tier1" || t === "tier2") return MAX_CALCULATOR_JOBS;
  return MAX_FREE_JOBS;
}

/** Account-level saved job / order history limit. null = unlimited. */
export function getMaxSavedJobsForMembership(tier = "free") {
  const t = String(tier || "free").toLowerCase();
  if (t === "tier1" || t === "tier2") return null;
  return MAX_FREE_SAVED_JOBS;
}
