import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { getApiBase } from "./stripeClient.js";
import {
  PRODUCTS,
  EPOLY_PIGMENT_RETAIL_32OZ_USD,
  resolveEpolyProductKey,
  resolveLayerProductKey,
} from "./products.js";
import MaterialOrderForm from "./MaterialOrderForm.jsx";
import UpgradeUpsell from "./UpgradeUpsell.jsx";
import MyFloorSystems from "./MyFloorSystems.jsx";
import { openJobCardPrint } from "./jobCardPrint.js";
import {
  MAX_FREE_JOBS,
  applyPoYearResetIfNeeded,
  getMaxJobsForMembershipTier,
  getPoCounterLabel,
  getTier1PoStatus,
  normalizePoProfileFields,
} from "./poLimits.js";
import {
  buildCustomOrderLines,
  groupLinesByVendor,
  isCustomSystemKey,
  toCalculatorSystem,
  ensureDefaultFgpVendor,
} from "./customFloorSystems.js";
import { buildVendorPoText, openVendorPoPrint } from "./vendorPoPrint.js";

const HEADER_LOGO_URL = "/favicon.svg";
/** Must match Supabase Storage bucket name exactly (Dashboard → Storage). */
const SUPABASE_SWATCH_BUCKET = "Color Swatches";
/** Trimmed system cutaway diagrams (no header/footer). Public bucket; filenames = `{SYSTEM-KEY}.jpg`. */
const SUPABASE_SYSTEM_CUTAWAY_BUCKET = "System Cutaways";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");

if (!SUPABASE_URL) {
  console.warn("[cutaway] VITE_SUPABASE_URL is missing — system cutaway images will not load.");
} else {
  console.info("[cutaway] VITE_SUPABASE_URL set:", SUPABASE_URL);
}

/** Public URL for a file in the System Cutaways storage bucket. */
function systemCutawayUrl(fileName) {
  if (!SUPABASE_URL || !fileName) {
    console.warn("[cutaway] cannot build URL — missing SUPABASE_URL or fileName", {
      hasUrl: !!SUPABASE_URL,
      fileName,
    });
    return null;
  }
  const encodedPath = String(fileName)
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  // Bucket name has a space → encodeURIComponent → "System%20Cutaways"
  const url = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_SYSTEM_CUTAWAY_BUCKET)}/${encodedPath}`;
  return url;
}

/**
 * Explicit cutaway files (upload these JPGs to Storage → System Cutaways).
 * Any other system falls back to `{systemKey}.jpg` (slashes → hyphens).
 */
const SYSTEM_CUTAWAY_FILES = {
  "FLK-OD-RES": "FLK-OD-RES.jpg",
  "FLK-ID-RES": "FLK-ID-RES.jpg",
  "FLK-ID-COM": "FLK-ID-COM.jpg",
  "METALLIC-ID": "METALLIC-ID.jpg",
  "QUARTZ-ID-COM": "QUARTZ-ID-COM.jpg",
  "SC-ID-EZ-CLEAN": "SC-ID-EZ-CLEAN.jpg",
  "SC-ID-TEX": "SC-ID-TEX.jpg",
  "GRIND-SEAL": "GRIND-SEAL.jpg",
};

function resolveSystemCutawayImage(systemKey, systemCode) {
  const file =
    SYSTEM_CUTAWAY_FILES[systemKey] ||
    SYSTEM_CUTAWAY_FILES[systemCode] ||
    `${String(systemKey || systemCode || "").replace(/\//g, "-")}.jpg`;
  const url = systemCutawayUrl(file);
  console.info("[cutaway] resolve", { systemKey, systemCode, file, url });
  return url;
}

// ─── PRIVATE LABEL MAP ───────────────────────────────────────────────────────
// SurfKoat MCU 85        = EZ Top 85 (Epoxy Twins PL)
// SurfKoat 1040 BondKoat = HydroPrime 40 (Epoxy Twins PL; tint EpoTint-WB vs mfg Epopac WB)
// Rapid Set 100          = Patch Pro 10X (ET PL)

// Default polyaspartic topcoat used by system logic.
const DEFAULT_POLYASPARTIC_TOPCOAT_KEY = "aspartic85";
const MAX_FREE_STORED_ORDERS = 5;

const FGP_ORDER_EMAIL = "orders@fgpmidwest.com";
const CONTRACTOR_PRICING_APP_URL = "https://contractors.floorguardproductsmidwest.com/epoxy-twins-contractor-pricing-program-page";

function tierTagToMembershipTier(planTag = "Free") {
  if (planTag === "Tier 1") return "tier1";
  if (planTag === "Tier 2") return "tier2";
  return "free";
}

function membershipTierToPlanTag(tier = "free") {
  if (tier === "tier1") return "Tier 1";
  if (tier === "tier2") return "Tier 2";
  return "Free";
}

function haystackIncludes(haystack, query) {
  if (!query) return true;
  return String(haystack || "").toLowerCase().includes(query);
}

function materialOrderSearchText(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const itemBits = items
    .map((line) =>
      [line.productName, line.categoryLabel, line.kitSize, line.productKey]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");
  return [
    order?.po_name,
    order?.poName,
    order?.id,
    order?.status,
    itemBits,
    order?.total_price,
  ]
    .filter((v) => v != null && v !== "")
    .join(" ");
}

function calculatorOrderSearchText(order) {
  const jobs = Array.isArray(order?.jobs) ? order.jobs : [];
  const jobBits = jobs
    .map((j) =>
      [j.jobNamePo, j.address, j.systemCode, j.systemLabel, j.color]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");
  return [
    order?.job_name,
    order?.jobNamePo,
    order?.address,
    order?.system_code,
    order?.systemCode,
    jobBits,
  ]
    .filter((v) => v != null && v !== "")
    .join(" ");
}

function getAnniversaryWindowStart(anniversaryIso) {
  const reset = applyPoYearResetIfNeeded({ po_year_start_date: anniversaryIso, annual_po_count: 0 });
  return new Date(reset.po_year_start_date);
}

// ─── TIER MULTIPLIERS ────────────────────────────────────────────────────────
const TIERS = {
  msrp:      { label: "MSRP Only",         mult: 1.00 },
  small:     { label: "Small Buyer",       mult: 0.95 },
  tier2:     { label: "Tier 2 / Contractor", mult: 0.90 },
  preferred: { label: "Preferred Partner", mult: 0.85 },
};

// Pigments / tools / accessories follow the secondary-sheet structure:
// Small Buyer and Tier 2 stay at MSRP, Preferred receives a lighter break.
const ACCESSORY_TIER_MULTS = {
  msrp: 1.0,
  small: 1.0,
  tier2: 1.0,
  preferred: 0.95,
};

function usesAccessoryPricingModel(productKey = "") {
  const product = PRODUCTS[productKey];
  if (product?.pricingModel === "accessory") return true;
  return (
    productKey.startsWith("epoly_pigment_") ||
    productKey.startsWith("tool_") ||
    productKey.startsWith("accessory_")
  );
}

function getTierMultiplierForProduct(productKey, tierKey) {
  if (usesAccessoryPricingModel(productKey)) {
    return ACCESSORY_TIER_MULTS[tierKey] ?? 1;
  }
  return TIERS[tierKey]?.mult ?? 1;
}

function getKitTierPrice(kit, productKey, tierKey) {
  if (kit?.tierPrices && typeof kit.tierPrices[tierKey] === "number") {
    return +kit.tierPrices[tierKey].toFixed(2);
  }
  const tierMult = getTierMultiplierForProduct(productKey, tierKey);
  return +((kit?.msrp || 0) * tierMult).toFixed(2);
}

/** Higher index = better contractor discount. Used for FGP Midwest “assigned vs active” pricing. */
const CONTRACTOR_PRICING_RANK = { msrp: 0, small: 1, tier2: 2, preferred: 3 };

/** Default pricing admins (cloud profile can also elevate). */
const PRICING_MASTER_EMAILS = ["seth@dynastyepoxy.com", "gary@dynastyepoxy.com"];

/** Logins that skip “Past orders” on Account (master / Epoxy Twins); ordering profiles (e.g. Gary) keep history. */
const ACCOUNT_HIDE_PAST_ORDERS_EMAILS = new Set(["seth@dynastyepoxy.com"]);
/** Reserved legacy UI block on Account (kept for quick re-enable). */
const SHOW_LEGACY_ACCOUNT_PAST_ORDERS = false;

function isPricingMasterEmail(email, profile = null) {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (PRICING_MASTER_EMAILS.includes(e)) return true;
  return !!normalizeUserProfile(profile || {}).ecosPricingAdmin;
}

function normalizeUserProfile(raw) {
  const p = { ...(raw || {}) };
  if (!p.assignedPricingTierKey || !TIERS[p.assignedPricingTierKey]) {
    const bt = typeof p.buyingTier === "string" ? p.buyingTier : "";
    if (bt.includes("MSRP")) p.assignedPricingTierKey = "msrp";
    else if (bt.includes("Preferred")) p.assignedPricingTierKey = "preferred";
    else if (bt.includes("Tier 2") || bt.includes("Contractor")) p.assignedPricingTierKey = "tier2";
    else if (bt.includes("Small")) p.assignedPricingTierKey = "small";
    else p.assignedPricingTierKey = "msrp";
  }
  if (p.isFgpCustomer === undefined) p.isFgpCustomer = false;
  if (p.contractorPricingApplicationReceived === undefined) p.contractorPricingApplicationReceived = false;
  if (p.fgpContractorPricingApproved === undefined) p.fgpContractorPricingApproved = false;
  if (p.needsAdminReview === undefined) p.needsAdminReview = true;
  if (p.ecosPricingAdmin === undefined) p.ecosPricingAdmin = false;
  if (!p.membership_tier) p.membership_tier = tierTagToMembershipTier(p.plan || "Free");
  const poFields = normalizePoProfileFields(p);
  p.po_year_start_date = poFields.po_year_start_date;
  p.annual_po_count = poFields.annual_po_count;
  if (!p.signup_anniversary_date) p.signup_anniversary_date = p.po_year_start_date;
  if (p.pos_submitted_this_year === undefined) p.pos_submitted_this_year = p.annual_po_count;
  if (!p.logo_url) p.logo_url = "";
  if (!p.brand_color_primary) p.brand_color_primary = "#113a72";
  if (!p.brand_color_secondary) p.brand_color_secondary = "#e33433";
  if (p.total_pos_value_this_quarter === undefined) p.total_pos_value_this_quarter = 0;
  if (p.total_pos_value_this_year === undefined) p.total_pos_value_this_year = 0;
  if (!p.billing_last4) p.billing_last4 = "";
  if (!Array.isArray(p.billing_history)) p.billing_history = [];
  if (p.stripe_customer_id === undefined || p.stripe_customer_id === null) p.stripe_customer_id = "";
  if (p.stripe_subscription_id === undefined || p.stripe_subscription_id === null) p.stripe_subscription_id = "";
  if (!p.subscription_status) p.subscription_status = "";
  if (!p.subscription_current_period_end) p.subscription_current_period_end = null;
  if (!p.grace_period_start) p.grace_period_start = null;
  if (p.grace_email_stage === undefined || p.grace_email_stage === null) p.grace_email_stage = 0;
  if (p.contractor_tier === undefined || p.contractor_tier === null) p.contractor_tier = "";
  return p;
}

function getUserDisplayName(email, profile = {}) {
  const first = (profile.firstName || "").trim();
  const last = (profile.lastName || "").trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (profile.businessName && String(profile.businessName).trim()) return String(profile.businessName).trim();
  if (profile.contractorName && String(profile.contractorName).trim()) return String(profile.contractorName).trim();
  const local = String(email || "").split("@")[0] || "User";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Contractor discount tier actually used in quotes today. */
function getEffectiveContractorPricingTierKey(profile) {
  const p = normalizeUserProfile(profile);
  if (!p.isFgpCustomer) return "msrp";
  if (!p.contractorPricingApplicationReceived) return "msrp";
  return p.assignedPricingTierKey || "msrp";
}

// ─── SYSTEM LAYER HELPERS (add-ons) ─────────────────────────────────────────
/** Crack repair add-on — HyperCURE when indoor odors/vapors are a concern. */
function pushCrackRepairAddOn(items, sf, opts, odorSensitive = false) {
  if (!opts.hasCracks) return;
  if (odorSensitive && opts.odorConcern) {
    items.push({
      key: "hypercure",
      gals: 0,
      label: "Crack Repair — HyperCURE",
      qty: sf / 2000,
      unit: "kit",
      notes:
        "Low-odor 100% solids epoxy (fumed silica thickened) · est. ~0.5 kit per 1,000 ft² (whole 0.5 gal kits only — rounds up)",
    });
    return;
  }
  items.push({
    key: "patch_pro_10x",
    gals: 0,
    label: "Crack Repair",
    qty: sf / 2000,
    unit: "kit",
    notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)",
  });
}

/** MVB add-on when moisture is moderate (HyperPrime) or high (MV2112). */
function pushMoistureMvbAddOn(items, sf, opts, sqFtPerGal = 95) {
  if (opts.moisture === "high") {
    items.push({
      key: "mv2112",
      gals: sf / sqFtPerGal,
      label: "MVB add-on — MV2112",
      notes: `${sqFtPerGal} ft²/gal · full MVB when moisture risk is high`,
    });
  } else if (opts.moisture === "moderate") {
    items.push({
      key: "hyperprime_mvb",
      gals: sf / sqFtPerGal,
      label: "MVB add-on — HyperPrime MVB",
      notes: `${sqFtPerGal} ft²/gal · may be pigmented; need not be applied neat`,
    });
  }
}

// ─── SYSTEM DEFINITIONS ──────────────────────────────────────────────────────
const SYSTEMS = {
  "FLK-OD-RES": {
    label: "Flake, Outdoor Residential",
    code: "FLK-OD-RES",
    priceRange: "$6–8/ft²",
    warnings: ["UV stable system — traction required on all steps, wet areas, sloped areas"],
    layers: (sf, opts) => {
      const speed = opts.speed || "slow";
      const baseKey = speed === "fast" ? "polyurea_fast" : speed === "medium" ? "polyurea_med" : "polyurea_slow";
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack/Joint Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² joint fill (PO: whole 2 gal kits only — rounds up)" });
      if (opts.moisture === "high") {
        items.push({
          key: "mv2112",
          gals: sf / 100,
          label: "MVB — MV2112",
          notes: "100 ft²/gal (lower end) · full MVB when moisture risk is high · before polyurea base",
        });
      } else if (opts.moisture === "moderate") {
        items.push({
          key: "hyperprime_mvb",
          gals: sf / 100,
          label: "MVB — HyperPrime MVB",
          notes:
            "100 ft²/gal (lower end) · need not be applied neat — optional E-Poly tint (~+10% mix volume vs neat target) · before polyurea base",
        });
      }
      items.push({ key: baseKey, gals: sf / 190, label: "Basecoat — Polyurea Basecoat", notes: "180–200 ft²/gal · 2A:1B · ribbon/roll" });
      const pigGals = (sf / 190) * 0.10;
      items.push({ key: "epoly_pigment", gals: pigGals, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      const flakeLbs = sf / 10;
      items.push({ key: "flake_14", lbs: flakeLbs, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb · broadcast to rejection" });
      items.push({
        key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY,
        gals: sf / 120,
        label: "Final Clear Topcoat — Aspartic 85 Slow Go (Low Odor)",
        notes: "120–145 ft²/gal · 2A:1B · squeegee/roll (planning uses lower end of range)",
      });
      if (opts.steps > 0) items.push({ key: "silica_sand", lbs: opts.steps * 2, label: "Traction Sand (Steps)", notes: "Required on all stair treads" });
      return items;
    }
  },
  "FLK-ID-RES": {
    label: "Flake, Indoor Residential",
    code: "FLK-ID-RES",
    priceRange: "$6–8/ft²",
    warnings: ["Non-UV stable — not for UV exposure areas", "High moisture on commercial jobs → MVB add-on on FLK-ID-COM"],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts);
      if (opts.moisture === "high") {
        items.push({ key: "hyperprime_mvb", gals: sf / 95, label: "MVB — HyperPrime MVB", notes: "95 ft²/gal · moisture required" });
      }
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1 · squeegee/roll" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "flake_14", lbs: sf / 10, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb · broadcast to rejection" });
      items.push({ key: "dt454_clear", gals: sf / 110, label: "Topcoat — DT-454 Clear", notes: "110–140 ft²/gal · 2:1 · squeegee/roll" });
      return items;
    }
  },
  "FLK-ID-COM": {
    label: "Flake, Indoor Commercial",
    code: "FLK-ID-COM",
    priceRange: "$8–12/ft²",
    warnings: ["Non-UV stable", "Traffic topcoat (E-Z Top 85) included — higher wear protection", "Moderate/high moisture → MVB add-on"],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts);
      pushMoistureMvbAddOn(items, sf, opts, 95);
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "flake_14", lbs: sf / 10, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb" });
      items.push({ key: "dt454_clear", gals: sf / 110, label: "Grout Coat — DT-454 Clear", notes: "110–140 ft²/gal · 2:1" });
      items.push({
        key: "ez_top_85",
        gals: sf / 600,
        label: "Traffic Topcoat — E-Z Top 85",
        notes: "600 ft²/gal min · 1.5 lb/gal COM wear",
      });
      return items;
    }
  },
  "METALLIC-ID": {
    label: "Metallic, Indoor",
    code: "METALLIC-ID",
    priceRange: "$12–20/ft²",
    warnings: ["Artistic system — consult Metallic Recipe Book for pigment", "🚨 Moisture: critical — MVB required if ANY risk present", "\"This is art, not a work floor\""],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts, true);
      if (opts.moisture === "high" || opts.moisture === "moderate") {
        items.push({ key: "mv2112", gals: sf / 95, label: "MVB — MV2112", notes: "95 ft²/gal · 2:1" });
      } else {
        const primerTint = String(opts.metallicPrimerTint || "Gray").trim();
        const tintIsClear = primerTint.toLowerCase() === "clear";
        items.push({
          key: tintIsClear ? "hyperprime_mvb" : "hyperprime_mvb_pig",
          gals: sf / 200,
          label: `Primer — HyperPRIME MVB (${tintIsClear ? "Clear" : `Pigmented ${primerTint}`})`,
          notes: "200 ft²/gal · used as first primer layer unless moisture is moderate/high",
        });
      }
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      const marbleMaxGals = sf / 40;
      items.push({ key: "marblemax", gals: marbleMaxGals, label: "Artistic Layer — MarbleMax", notes: "40 ft²/gal planning rate · 2:1" });
      items.push({
        key: "metallic_mica_4oz",
        gals: 0,
        qty: marbleMaxGals * (4 / 3),
        label: "Metallic Pigment (Mica) — 4oz jars",
        notes: "16 oz mica per 3 gal MarbleMax (4 jars per 3 gal)",
      });
      const topcoatGals = sf / 600;
      items.push({ key: "ez_top_85", gals: topcoatGals, label: "Topcoat — EZ Top 85 (MCU 85 mfg)", notes: "600 ft²/gal min" });
      items.push({
        key: "wearmax_3lb",
        lbs: topcoatGals * 3,
        label: "WearMax Additive",
        notes: "3 lb/gal EZ Top 85 · 500–600 ft²/gal target",
      });
      return items;
    }
  },
  "QUARTZ-ID-COM": {
    label: "Epoxy Quartz, Indoor Commercial",
    code: "QUARTZ-ID-COM",
    priceRange: "$10–12/ft²",
    warnings: [
      "Double broadcast system",
      "Slip resistance required — safety + decorative + durability",
      "Broadcast coat 1 follows moisture: none → pigmented HyperBond · moderate → HyperPrime MVB · high → MV2112",
    ],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts);
      const bc1Rate = 160;
      const bc1Gals = sf / bc1Rate;
      if (opts.moisture === "high") {
        items.push({
          key: "mv2112",
          gals: bc1Gals,
          label: "Broadcast Coat 1 — MV2112",
          notes: "160 ft²/gal · 2:1 · E-Poly +10%",
        });
      } else if (opts.moisture === "moderate") {
        items.push({
          key: "hyperprime_mvb",
          gals: bc1Gals,
          label: "Broadcast Coat 1 — HyperPrime MVB",
          notes: "160 ft²/gal · 2:1 · E-Poly +10%",
        });
      } else {
        items.push({
          key: "hyperbond",
          gals: bc1Gals,
          label: "Broadcast Coat 1 — Pigmented HyperBond",
          notes: "160 ft²/gal · 2:1 · E-Poly +10%",
        });
      }
      items.push({ key: "epoly_pigment", gals: (sf / bc1Rate) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "quartz_agg", lbs: sf * 1.0, label: "Colored Quartz Aggregate (Broadcast 1)", notes: "1.0 lb/ft² conservative for double broadcast" });
      items.push({ key: "dt454_turbo", gals: sf / 90, label: "Broadcast Coat 2 — DT-454 Clear (Turbo)", notes: "90–120 ft²/gal · 2:1" });
      items.push({ key: "quartz_agg", lbs: sf * 1.0, label: "Colored Quartz Aggregate (Broadcast 2)", notes: "second broadcast · 1.0 lb/ft² conservative" });
      items.push({ key: "dt454_turbo", gals: sf / 90, label: "Clear Topcoat — DT-454 Clear (Turbo)", notes: "90–130 ft²/gal · 2:1 · (will need 2nd top coat if customer requires smoother finish)" });
      return items;
    }
  },
  "SC-ID-EZ-CLEAN": {
    label: "Solid Colored, Indoor",
    code: "SC-ID-EZ CLEAN",
    priceRange: "$5–8/ft²",
    warnings: ["Non-UV stable", "Moderate/high moisture → MVB add-on replaces bond primer"],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts, true);
      if (opts.moisture === "high" || opts.moisture === "moderate") {
        pushMoistureMvbAddOn(items, sf, opts, 95);
      } else {
        items.push({
          key: "hydroprime_40",
          gals: sf / 300,
          label: "Primer / Bond Coat — HydroPrime 40",
          notes: "250–350 ft²/gal · squeegee/roll · tint EpoTint-WB (1 pt / 2 gal mixed)",
        });
      }
      items.push({ key: "dt454_turbo", gals: sf / 155, label: "Body Coat — DT-454 Clear (Turbo)", notes: "140–170 ft²/gal · 2:1 · notch squeegee 8–12 mil WFT" });
      items.push({ key: "epoly_pigment", gals: (sf / 155) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume (body coat)" });
      items.push({
        key: "ez_top_85",
        gals: sf / 600,
        label: "Topcoat — EZ Top 85 (Low Odor) — MCU 85 (manufacturer)",
        notes: "600 ft²/gal min · single component · add silica wear per RES/COM spec",
      });
      return items;
    }
  },
  "SC-ID-TEX": {
    label: "Solid Colored, Indoor Textured",
    code: "SC-ID-TEX",
    priceRange: "$5–8/ft²",
    warnings: ["Grip + durability over appearance", "Sand broadcast to refusal — 50 lbs per 100 ft²"],
    layers: (sf, opts) => {
      const items = [];
      pushCrackRepairAddOn(items, sf, opts, true);
      items.push({ key: "dt454_turbo", gals: sf / 160, label: "Base Coat — DT-454 Clear (Turbo)", notes: "160 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 160) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Broadcast Coat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment (Broadcast coat)", notes: "+10% total mix volume" });
      items.push({ key: "silica_sand", lbs: sf * 0.5, label: "20/40 Mesh Silica Sand", notes: "50 lbs per 100 ft² · broadcast to refusal" });
      items.push({ key: "dt454_turbo", gals: sf / 75, label: "Final Topcoat — DT-454 Pigmented (Turbo)", notes: "75–120 ft²/gal · backroll only" });
      items.push({ key: "epoly_pigment", gals: (sf / 75) * 0.10, label: "E-Poly Pigment (Topcoat)", notes: "+10% total mix volume" });
      return items;
    }
  },
  "GRIND-SEAL": {
    label: "Grind & Seal",
    code: "GRIND & SEAL",
    priceRange: "$4–6/ft²",
    warnings: ["Cracks/defects NOT repaired by design", "Function only — not decorative", "\"This is function, not transformation\""],
    layers: (sf, _opts) => {
      const items = [];
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Prime/Base — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1 · squeegee/roll" });
      const topcoatGals = sf / 600;
      items.push({
        key: "ez_top_85",
        gals: topcoatGals,
        label: "Topcoat — E-Z Top 85",
        notes: "600 ft²/gal min · includes WearMax additive per ET standard",
      });
      items.push({
        key: "wearmax_3lb",
        lbs: topcoatGals * 3,
        label: "WearMax Additive",
        notes: "3 lb/gal E-Z Top 85 · wear resistance AO",
      });
      return items;
    }
  },
};

// Wire cutaway diagram URLs (Supabase Storage → "System Cutaways" / `{CODE}.jpg`).
for (const [key, system] of Object.entries(SYSTEMS)) {
  system.cutawayImage = resolveSystemCutawayImage(key, system.code);
}

const LOCATION_OPTIONS = [
  {
    value: "interior",
    label: "Indoor",
    icon: "🏠",
    sub: "Basement - Shop - Commercial space",
  },
  {
    value: "exterior",
    label: "Outdoor",
    icon: "🚗",
    sub: "Garage - Patio (Garage = Outdoor)",
  },
];

const FINISH_OPTIONS = [
  { value: "flake", label: "Flake" },
  { value: "solid", label: "Solid Color" },
  { value: "solid_tex", label: "Solid + Texture/Grip" },
  { value: "metallic", label: "Metallic" },
  { value: "quartz", label: "Quartz" },
  { value: "grind_seal", label: "Grind & Seal" },
];

const STOCKED_COLORS = [
  { value: "Creekbed", hex: "#8B7D6B", recommendedBase: "Dover Beige" },
  { value: "Yorkshire", hex: "#B9B39F", recommendedBase: "Sable Gray" },
  { value: "Gravel", hex: "#7F8790", recommendedBase: "Sable Gray" },
  { value: "Domino", hex: "#2D2F33", recommendedBase: "Sable Gray" },
  { value: "Nightfall", hex: "#1E2530", recommendedBase: "Medium Gray" },
  { value: "Tidal Wave", hex: "#3A5D76", recommendedBase: "Sable Gray" },
  { value: "Shoreline", hex: "#9FA9B2", recommendedBase: "Dover Beige or Tan" },
  { value: "Cabin Fever", hex: "#6B5A48", recommendedBase: "Sable Gray" },
  { value: "Woodland", hex: "#4B5A46", recommendedBase: "Dover Beige or Tan" },
  { value: "Custom Flake Blend", hex: "linear-gradient(135deg, #3b82f6, #a855f7, #22c55e, #eab308)", recommendedBase: "Select per blend target" },
];

const BASE_COAT_COLOR_OPTIONS = [
  { value: "White", hex: "#f5f5eb", textColor: "#111111" },
  { value: "Dover Beige", hex: "#d6cdb7", textColor: "#111111" },
  { value: "Tan", hex: "#c4aa7b", textColor: "#111111" },
  { value: "Mocha", hex: "#ac885e", textColor: "#111111" },
  { value: "Tile Brown", hex: "#562d18", textColor: "#ffffff" },
  { value: "Sable Gray", hex: "#c9cacc", textColor: "#111111" },
  { value: "Medium Gray", hex: "#8d8f8f", textColor: "#111111" },
  { value: "Metal Gray", hex: "#4e555e", textColor: "#ffffff" },
  { value: "Black", hex: "#040606", textColor: "#ffffff" },
  { value: "Safety Yellow", hex: "#e6c228", textColor: "#111111" },
  { value: "Safety Red", hex: "#be4735", textColor: "#ffffff" },
  { value: "Ford Blue", hex: "#335789", textColor: "#ffffff" },
];

const METALLIC_COLOR_OPTIONS = [
  "Americana", "Avocado", "Azure", "Bamboo", "Banana", "Bikini", "Cabana", "Cannon", "Caribbean", "Caviar",
  "Coral", "Curacao", "Daydream", "Dolphin", "Driftwood", "Ginger", "Great White", "Guava", "Hammock", "Kona",
  "Lager", "Manatee", "Mandarin", "Mango", "Margarita", "Maui", "Ocean", "Overcast", "Palapa", "Palm",
  "Papaya", "Pearl", "Pier", "Reef", "Rum", "Sandal", "Sandbar", "Sangria", "Seaweed", "Shipwreck",
  "Starfish", "Sunset", "Tiki", "Whale",
];

const SOLID_COLOR_OPTIONS = [
  "Black",
  "Metal Gray",
  "Medium Gray",
  "Sable Gray",
  "Tile Brown",
  "Mocha",
  "Tan",
  "Dover Beige",
  "Ford Blue",
  "Safety Red",
  "Safety Yellow",
  "White",
];

const METALLIC_BASE_COAT_OPTIONS = ["Black", "White"];
const METALLIC_PRIMER_TINT_OPTIONS = ["Gray", "Tan", "Clear"];

const FREE_UNLOCKED_SYSTEMS = new Set(["FLK-ID-RES", "FLK-OD-RES", "SC-ID-EZ-CLEAN", "METALLIC-ID"]);
const FREE_UNLOCKED_FINISHES = new Set(["flake", "solid", "metallic"]);
const ACTIVE_RELEASE_SYSTEMS = new Set(["FLK-OD-RES", "SC-ID-EZ-CLEAN", "METALLIC-ID"]);

function getFullLocationSystemKeys(location) {
  if (location === "exterior") return ["FLK-OD-RES"];
  if (location === "interior") {
    return [
      "FLK-ID-RES",
      "FLK-ID-COM",
      "METALLIC-ID",
      "QUARTZ-ID-COM",
      "SC-ID-EZ-CLEAN",
      "SC-ID-TEX",
      "GRIND-SEAL",
    ];
  }
  return [];
}

function getRecommendedSystem(answers, _planTag = "Free") {
  const { location, finish, moisture, use } = answers;
  if (!location || !finish) return null;

  if (location === "exterior") {
    return "FLK-OD-RES";
  }

  if (finish === "flake") {
    if (use === "commercial") return "FLK-ID-COM";
    return "FLK-ID-RES";
  }
  if (finish === "solid") return "SC-ID-EZ-CLEAN";
  if (finish === "metallic") return "METALLIC-ID";
  if (finish === "quartz") return "QUARTZ-ID-COM";
  if (finish === "solid_tex") return "SC-ID-TEX";
  if (finish === "grind_seal") return "GRIND-SEAL";
  return null;
}

function formatOrderLineForEmail(l) {
  return `${l.product} | ${l.layer || "—"} | ${l.kitSize} x${l.qty} | needs ${l.totalNeeded} | MSRP $${Number(l.msrpEa || 0).toFixed(2)} ea | line $${Number(l.lineTier || 0).toFixed(2)}`;
}

/**
 * One email for Gary.
 * - Single job: JOB details + materials + totals (no CONSOLIDATED header)
 * - 2+ jobs: JOB context only, then CONSOLIDATED materials block
 * - Color/flake + per-job pays only when 2+ jobs
 */
function buildFgOrderEmailBody({
  jobs = [],
  tierLabel,
  tierMult,
  combinedOrderLines = [],
  totalMsrp,
  totalDiscount,
  totalTier,
  requiredMaterialTierTotal,
  totalSqFt,
}) {
  const discountPct = Math.round((1 - tierMult) * 100);
  const jobCount = jobs.length;
  const multiJob = jobCount > 1;
  const materialsText = combinedOrderLines.map(formatOrderLineForEmail).join("\n") || "(no lines)";

  const jobBlocks = (jobs.length ? jobs : []).map((job, idx) => {
    const jobSf = Number(job.sqFt ?? job.sf ?? 0);
    const systemLine = [`System: ${job.systemCode || "—"}`, job.systemLabel].filter(Boolean).join(" — ");
    const lines = [
      `=== JOB ${idx + 1} of ${jobCount}: ${job.jobNamePo || "Untitled Job / PO"} ===`,
      `Address: ${job.address || "—"}`,
      systemLine,
      `Area: ${jobSf.toLocaleString()} ft²`,
    ];
    if (multiJob) {
      lines.push(`Color / Flake: ${job.color || "—"}`);
      lines.push(`Job contractor pays: $${Number(job.totalTier || 0).toFixed(2)}`);
    } else {
      // Single job: materials sit under JOB (no CONSOLIDATED section)
      const jobLines = (job.orderLines || combinedOrderLines || []).map(formatOrderLineForEmail).join("\n");
      lines.push("Materials:");
      lines.push(jobLines || "(no lines)");
    }
    lines.push("");
    return lines.join("\n");
  });

  const bodyParts = [
    "FGP Midwest — ECOS material order",
    `Jobs in this PO: ${jobCount}`,
    `Buying tier: ${tierLabel} (${discountPct}% off MSRP)`,
    "",
    ...jobBlocks,
  ];

  if (multiJob) {
    bodyParts.push("=== CONSOLIDATED ORDER (what to pull / enter in Square) ===");
    bodyParts.push(materialsText);
    bodyParts.push("");
  }

  bodyParts.push(
    `TOTAL AREA: ${Number(totalSqFt || 0).toLocaleString()} ft²`,
    `SUBTOTAL MSRP: $${Number(totalMsrp || 0).toFixed(2)}`,
    `TOTAL DISCOUNT: -$${Number(totalDiscount || 0).toFixed(2)}`,
    `CONTRACTOR PAYS: $${Number(totalTier || 0).toFixed(2)}`,
    Number(totalSqFt || 0) > 0
      ? `Required material $ / ft²: $${(Number(requiredMaterialTierTotal || 0) / Number(totalSqFt)).toFixed(2)}/ft²`
      : null,
    "",
    "--- PO notes for Gary (internal) ---",
    multiJob
      ? "Square: enter consolidated line items at MSRP, then apply a single discount to the invoice total equal to TOTAL DISCOUNT above if entering invoice using Desktop. If using cart checkout with barcodes, adjust price to buying tier Price. Each JOB section above is for pull / staging; CONSOLIDATED is what to invoice for 2+ jobs."
      : "Square: enter line items at MSRP, then apply a single discount to the invoice total equal to TOTAL DISCOUNT above if entering invoice using Desktop. If using cart checkout with barcodes, adjust price to buying tier Price.",
    "",
    "Sent automatically from ECOS (epoxyquoting.com)."
  );

  return bodyParts.filter((line) => line != null).join("\n");
}

function openFgOrderEmail(body, subject) {
  const maxLen = 7000;
  const safeBody =
    body.length > maxLen ? `${body.slice(0, maxLen - 120)}\n\n[Truncated for email app limits — see ECOS for full line list.]` : body;
  const url = `mailto:${FGP_ORDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(safeBody)}`;
  window.location.href = url;
}

function getRecommendationReason(answers, systemKey) {
  if (!systemKey) return "";
  if (answers.location === "exterior") {
    if (answers.moisture === "high") {
      return "Outdoor flake with high moisture: MV2112 MVB is included ahead of the polyurea base (100 ft²/gal, lower end of range).";
    }
    if (answers.moisture === "moderate") {
      return "Outdoor flake with moderate moisture: HyperPrime MVB is included ahead of the polyurea base (100 ft²/gal, lower end) — may be pigmented; need not be applied neat.";
    }
    return "Outdoor install prioritizes UV stability and fast cure chemistry.";
  }
  if (answers.finish === "flake" && answers.moisture === "high" && answers.use === "commercial")
    return "Commercial flake with high moisture: MV2112 MVB add-on on FLK-ID-COM.";
  if (answers.finish === "flake" && answers.moisture === "moderate" && answers.use === "commercial")
    return "Commercial flake with moderate moisture: HyperPrime MVB add-on on FLK-ID-COM.";
  if (answers.finish === "flake" && answers.use === "commercial") return "Commercial use needs heavier wear package (E-Z Top 85 traffic coat).";
  if (answers.finish === "solid" && answers.moisture === "high")
    return "High moisture adds MV2112 MVB to the solid-color build.";
  if (answers.finish === "solid" && answers.moisture === "moderate")
    return "Moderate moisture adds HyperPrime MVB to the solid-color build.";
  if (answers.finish === "metallic") return "Metallic finish prioritizes artistic flow and clarity.";
  if (answers.finish === "quartz" && answers.moisture === "high")
    return "Quartz broadcast coat 1 uses MV2112 when moisture risk is high.";
  if (answers.finish === "quartz" && answers.moisture === "moderate")
    return "Quartz broadcast coat 1 uses HyperPrime MVB when moisture risk is moderate.";
  if (answers.finish === "quartz") return "Quartz finish uses pigmented HyperBond for broadcast coat 1 when moisture risk is low.";
  return "Best fit based on your current location, finish, and refine answers.";
}

function getSystemCategory(systemKey = "") {
  if (systemKey.startsWith("FLK-")) return "flake";
  if (systemKey.startsWith("SC-")) return "solid";
  if (systemKey.startsWith("METALLIC")) return "metallic";
  if (systemKey.startsWith("QUARTZ")) return "quartz";
  if (systemKey.startsWith("GRIND")) return "grind_seal";
  return "solid";
}

function getSystemFamily(systemKey = "") {
  if (systemKey.startsWith("FLK-")) return "flake";
  if (systemKey === "METALLIC-ID") return "metallic";
  if (systemKey.startsWith("SC-")) return "solid";
  return "other";
}

const CATEGORY_THEME = {
  flake: { accent: "#22c55e", tint: "rgba(34, 197, 94, 0.12)" },
  solid: { accent: "#3b82f6", tint: "rgba(59, 130, 246, 0.12)" },
  metallic: { accent: "#a855f7", tint: "rgba(168, 85, 247, 0.12)" },
  quartz: { accent: "#e33433", tint: "rgba(227, 52, 51, 0.12)" },
  grind_seal: { accent: "#eab308", tint: "rgba(234, 179, 8, 0.12)" },
};

// ─── KIT CALCULATOR ──────────────────────────────────────────────────────────
function calcKits(productKey, galsNeeded, lbsNeeded, qtyNeeded) {
  const prod = PRODUCTS[productKey];
  if (!prod) return [];
  if (lbsNeeded !== undefined) {
    const kit = prod.kits.find(k => k.lbs);
    if (!kit) return [];
    const qty = Math.ceil(lbsNeeded / kit.lbs);
    return [{ ...kit, qty, totalNeeded: lbsNeeded.toFixed(1) + " lbs", unitLabel: "lbs" }];
  }
  if (galsNeeded === 0) {
    const raw = qtyNeeded !== undefined ? Number(qtyNeeded) : 1;
    const need = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const purchaseKits = Math.max(1, Math.ceil(need));
    return [
      {
        ...prod.kits[0],
        qty: purchaseKits,
        totalNeeded: `${need.toFixed(2)} kit job calc → ${purchaseKits} kit(s) to order (whole kits only)`,
        unitLabel: "kit",
      },
    ];
  }
  const buffered = galsNeeded * 1.10;
  const required = galsNeeded;
  const result = [];
  let remaining = buffered;
  const galKits = prod.kits.filter((k) => k.gals && k.gals > 0).sort((a, b) => b.gals - a.gals);
  if (!galKits.length) return [];
  const smallestKit = galKits[galKits.length - 1];

  galKits.slice(0, -1).forEach((kit) => {
    if (remaining >= kit.gals) {
      const qty = Math.floor(remaining / kit.gals);
      if (qty > 0) {
        remaining -= qty * kit.gals;
        result.push({ ...kit, qty, totalNeeded: required.toFixed(2) + " gal", unitLabel: "gal" });
      }
    }
  });

  if (remaining > 0 || result.length === 0) {
    const smallestQty = Math.ceil(remaining / (smallestKit.gals || 1));
    result.push({
      ...smallestKit,
      qty: smallestQty > 0 ? smallestQty : 1,
      totalNeeded: required.toFixed(2) + " gal",
      unitLabel: "gal",
    });
  }
  return result;
}

function buildOrderList(layers, tier, answers = {}) {
  const lines = [];
  layers.forEach(layer => {
    const pk = resolveLayerProductKey(layer, answers);
    const prod = PRODUCTS[pk];
    if (!prod) return;
    const kits = calcKits(pk, layer.gals !== undefined ? layer.gals : 0, layer.lbs, layer.qty);
    kits.forEach(kit => {
      const tierPrice = getKitTierPrice(kit, pk, tier);
      const lineMsrp = +(kit.msrp * kit.qty).toFixed(2);
      const lineTier = +(tierPrice * kit.qty).toFixed(2);
      const totalNeededDisplay =
        layer.key === "epoly_pigment" && layer.gals !== undefined
          ? `${(layer.gals * 128).toFixed(2)} oz`
          : kit.totalNeeded;
      let productLabel = prod.name;
      if (pk === "epoly_pigment_nonstock" && answers?.baseCoatColor) {
        productLabel = `E-Poly Pigment — ${answers.baseCoatColor} (off stocking list — verify MSRP; temp @ Black list)`;
      }
      lines.push({
        product: productLabel,
        layer: layer.label,
        notes: layer.notes || "",
        kitSize: kit.size,
        qty: kit.qty,
        totalNeeded: totalNeededDisplay,
        msrpEa: kit.msrp,
        tierEa: tierPrice,
        lineMsrp,
        lineTier,
      });
    });
  });
  return lines;
}

function getRequiredMaterialTierTotal(layers, tier, answers = {}) {
  let total = 0;

  layers.forEach((layer) => {
    const pk = resolveLayerProductKey(layer, answers);
    const prod = PRODUCTS[pk];
    if (!prod) return;

    if (layer.lbs !== undefined) {
      const lbKit = prod.kits.find((k) => k.lbs);
      if (!lbKit || !lbKit.lbs) return;
      const tierPerLb = getKitTierPrice(lbKit, pk, tier) / lbKit.lbs;
      total += tierPerLb * layer.lbs;
      return;
    }

    if (layer.gals === 0) {
      const raw = layer.qty !== undefined ? Number(layer.qty) : 1;
      const need = Number.isFinite(raw) && raw > 0 ? raw : 1;
      const purchaseKits = Math.max(1, Math.ceil(need));
      total += getKitTierPrice(prod.kits[0], pk, tier) * purchaseKits;
      return;
    }

    const galKits = prod.kits.filter((k) => k.gals && k.gals > 0);
    if (!galKits.length) return;
    const smallestGalKit = galKits.reduce((best, kit) => (kit.gals < best.gals ? kit : best), galKits[0]);
    const tierPerGal = getKitTierPrice(smallestGalKit, pk, tier) / smallestGalKit.gals;
    total += tierPerGal * (layer.gals || 0);
  });

  return +total.toFixed(2);
}

function parseTotalNeeded(value = "") {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(oz|gal|lbs|kit)\b/i);
  if (!match) return null;
  return { amount: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

function aggregateOrderLines(jobLines) {
  const grouped = new Map();
  jobLines.flat().forEach((line) => {
    const key = `${line.product}|${line.kitSize}|${line.msrpEa}|${line.tierEa}`;
    const parsed = parseTotalNeeded(line.totalNeeded);
    if (!grouped.has(key)) {
      grouped.set(key, {
        product: line.product,
        layer: "Multi-job",
        notes: "",
        kitSize: line.kitSize,
        qty: 0,
        totalNeeded: "",
        msrpEa: line.msrpEa,
        tierEa: line.tierEa,
        lineMsrp: 0,
        lineTier: 0,
        _neededAmount: 0,
        _neededUnit: parsed ? parsed.unit : "",
        _needsMixedUnits: false,
      });
    }
    const target = grouped.get(key);
    target.qty += line.qty;
    target.lineMsrp += line.lineMsrp;
    target.lineTier += line.lineTier;

    if (parsed) {
      if (!target._neededUnit) {
        target._neededUnit = parsed.unit;
      } else if (target._neededUnit !== parsed.unit) {
        target._needsMixedUnits = true;
      }
      if (!target._needsMixedUnits) {
        target._neededAmount += parsed.amount;
      }
    }
  });

  return Array.from(grouped.values())
    .map((line) => ({
      ...line,
      qty: +line.qty.toFixed(2),
      lineMsrp: +line.lineMsrp.toFixed(2),
      lineTier: +line.lineTier.toFixed(2),
      totalNeeded: line._needsMixedUnits || !line._neededUnit ? "—" : `${line._neededAmount.toFixed(2)} ${line._neededUnit}`,
    }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

function compactJobLineSummary(orderLines, limit = 4) {
  return orderLines
    .slice(0, limit)
    .map((line) => `${line.qty} x ${line.kitSize} ${line.product}`)
    .join(", ");
}

function getRecommendedBaseCoatLabels(colorValue) {
  const selected = STOCKED_COLORS.find((c) => c.value === colorValue);
  if (!selected?.recommendedBase) return [];
  return selected.recommendedBase
    .split(" or ")
    .map((s) => s.trim())
    .filter((label) => BASE_COAT_COLOR_OPTIONS.some((opt) => opt.value === label));
}

function getAutoBaseCoatFromFlakeColor(colorValue) {
  const labels = getRecommendedBaseCoatLabels(colorValue);
  return labels[0] || null;
}

function baseCoatDeviatesFromFlakeRecommendation(colorValue, baseCoatColor) {
  if (!colorValue || !baseCoatColor) return false;
  const recs = getRecommendedBaseCoatLabels(colorValue);
  if (!recs.length) return false;
  return !recs.includes(baseCoatColor);
}

function isRenderableSwatchUrl(url) {
  if (!url || typeof url !== "string") return false;
  // Local /@fs paths work on localhost only; avoid them on production.
  if (url.startsWith("/@fs/")) return false;
  return true;
}

function makeSwatchKey(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b(swatch|swatches|sample|samples|color|colors|flake|flakes|metallic|metallics|solid)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Filename-only fingerprint without stripping catalog words — helps match sku-prefixed uploads. */
function makeSwatchKeyLoose(name = "") {
  return String(name)
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Remove leading vendor/SKU tokens like FB-903_, FB903-, SKU12_ */
function stripLeadingSkuLooseKey(looseKey = "") {
  return String(looseKey || "").replace(/^[a-z]{1,4}-?[0-9]{2,8}[_-]?/i, "").replace(/^[_-]+/, "");
}

const SYSTEM_BENCHMARK_SQFT = 500;

function getSystemMaterialBenchmarkPerSqFt(systemKey, tierKey, answers = {}, speed = "slow") {
  const system = SYSTEMS[systemKey];
  if (!system) return null;
  const sf = SYSTEM_BENCHMARK_SQFT;
  const opts = {
    moisture: answers.moisture || "none",
    hasCracks: false, // benchmark excludes repair add-ons
    steps: 0,
    speed: systemKey === "FLK-OD-RES" ? (speed || "slow") : speed,
  };
  const layers = system.layers(sf, opts);
  // Benchmark should reflect practical purchasing, not only theoretical required material.
  const orderLines = buildOrderList(layers, tierKey, answers);
  const total = orderLines.reduce((sum, l) => sum + l.lineTier, 0);
  if (!Number.isFinite(total) || sf <= 0) return null;
  return +(total / sf).toFixed(2);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", background: "#000000", color: "#f4f7fb", fontFamily: "'Open Sans', sans-serif", padding: 0, width: "100%", minWidth: 0 },
  header: { background: "#113a72", borderBottom: "8px solid #e33433", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 },
  logo: { width: 36, height: 36, background: "#000000", border: "1px solid #e33433", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 },
  brand: { fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#ffffff", fontFamily: "'Encode Sans Expanded', sans-serif" },
  title: { fontSize: 15, fontWeight: 900, letterSpacing: "0.04em", color: "#ffffff", lineHeight: 1.1, fontFamily: "'Montserrat', sans-serif" },
  body: { maxWidth: 860, margin: "0 auto", padding: "24px 16px", width: "100%", minWidth: 0, boxSizing: "border-box" },
  sectionHead: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#e33433", marginBottom: 10, paddingBottom: 5, borderBottom: "1px solid #113a72", marginTop: 24, fontFamily: "'Encode Sans Expanded', sans-serif" },
  sectionHeadGold: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#eab308", marginBottom: 10, paddingBottom: 5, borderBottom: "1px solid #eab308", marginTop: 24, fontFamily: "'Encode Sans Expanded', sans-serif" },
  sectionSub: { color: "#9bb2d1", fontSize: 12, marginBottom: 12 },
  card: { background: "#0a1830", border: "1px solid #113a72", borderRadius: 8, padding: "14px 16px", marginBottom: 12 },
  cardGold: { background: "rgba(234, 179, 8, 0.08)", border: "1px solid #eab308", borderRadius: 8, padding: "14px 16px", marginBottom: 12 },
  question: { fontSize: 14, color: "#ced8e8", marginBottom: 10, fontFamily: "'Montserrat', sans-serif", fontWeight: 900 },
  optRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  opt: (active) => ({ padding: "8px 14px", borderRadius: 6, border: active ? "1px solid #e33433" : "1px solid #113a72", background: active ? "#113a72" : "#000000", color: active ? "#ffffff" : "#afc1d9", fontSize: 12, cursor: "pointer", transition: "all 0.15s", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }),
  locationOpt: (active) => ({ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, border: active ? "1px solid #e33433" : "1px solid #113a72", background: active ? "#113a72" : "#000000", color: "#ffffff", cursor: "pointer", transition: "all 0.15s" }),
  /** 16px minimum prevents iOS Safari from auto-zooming focused inputs */
  input: { background: "#000000", border: "1px solid #113a72", borderRadius: 6, color: "#f4f7fb", padding: "10px 12px", fontSize: 16, fontFamily: "'Open Sans', sans-serif", outline: "none", width: "100%", boxSizing: "border-box" },
  alert: (type) => ({ background: type === "danger" ? "#2a0b0b" : type === "warning" ? "#1f1810" : "#0a1830", border: `1px solid ${type === "danger" ? "#e33433" : type === "warning" ? "#e33433" : "#113a72"}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: type === "danger" ? "#ffd0d0" : type === "warning" ? "#ffe4c4" : "#d2def1", marginBottom: 6 }),
  badge: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: "#113a72", color: "#ffffff", display: "inline-block", marginBottom: 8, fontFamily: "'Encode Sans Expanded', sans-serif" },
  tableWrap: { width: "100%", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" },
  table: { width: "100%", maxWidth: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" },
  th: { textAlign: "left", padding: "6px 8px", color: "#9bb2d1", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #113a72", fontFamily: "'Encode Sans Expanded', sans-serif", overflowWrap: "anywhere", wordBreak: "break-word" },
  td: { padding: "7px 8px", borderBottom: "1px solid #113a72", color: "#c8d6ea", verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word" },
  tdBold: { padding: "7px 8px", borderBottom: "1px solid #113a72", color: "#ffffff", fontWeight: 700, verticalAlign: "top", overflowWrap: "anywhere", wordBreak: "break-word" },
  /** Order summary / PO tables: wide layout + horizontal scroll on phones (short rows, readable columns) */
  tableOrderWrap: {
    width: "100%",
    maxWidth: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorX: "contain",
    touchAction: "pan-x pan-y pinch-zoom",
    paddingBottom: 6,
  },
  tableOrder: {
    borderCollapse: "collapse",
    fontSize: 12,
    tableLayout: "auto",
    width: "max-content",
  },
  thOrder: {
    textAlign: "left",
    padding: "10px 14px",
    color: "#94a3b8",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderBottom: "1px solid #113a72",
    fontFamily: "'Encode Sans Expanded', sans-serif",
    whiteSpace: "nowrap",
  },
  tdOrder: {
    padding: "10px 14px",
    borderBottom: "1px solid #113a72",
    color: "#e2e8f0",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdOrderBold: {
    padding: "10px 14px",
    borderBottom: "1px solid #113a72",
    color: "#ffffff",
    fontWeight: 700,
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdOrderLayer: {
    padding: "10px 14px",
    borderBottom: "1px solid #113a72",
    color: "#cbd5e1",
    fontSize: 11,
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdOrderMuted: {
    padding: "10px 14px",
    borderBottom: "1px solid #113a72",
    color: "#94a3b8",
    fontSize: 11,
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  tdOrderWrap: {
    padding: "10px 14px",
    borderBottom: "1px solid #113a72",
    color: "#d2def1",
    verticalAlign: "middle",
    whiteSpace: "normal",
    maxWidth: 280,
    lineHeight: 1.35,
  },
  totalRow: { background: "#0a1830" },
  btn: { background: "#e33433", border: "none", borderRadius: 6, color: "#ffffff", padding: "10px 18px", fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginTop: 8 },
  btnSm: { background: "#000000", border: "1px solid #113a72", borderRadius: 5, color: "#d2def1", padding: "6px 12px", fontSize: 11, cursor: "pointer", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 },
  modalCard: { width: "100%", maxWidth: 380, background: "#0a1830", border: "1px solid #113a72", borderRadius: 12, padding: 14 },
  keypadGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 },
  keyBtn: { background: "#000000", color: "#fff", border: "1px solid #113a72", borderRadius: 8, padding: "12px 0", fontSize: 18, fontFamily: "'Montserrat', sans-serif", fontWeight: 900, cursor: "pointer" },
  unitBtn: (active) => ({ padding: "7px 10px", borderRadius: 6, border: `1px solid ${active ? "#e33433" : "#113a72"}`, background: active ? "#113a72" : "#000000", color: "#fff", cursor: "pointer", fontSize: 11 }),
  colorBtn: (active) => ({
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    textAlign: "left",
    borderRadius: 8,
    border: `1px solid ${active ? "#e33433" : "#113a72"}`,
    background: active ? "#113a72" : "#000000",
    color: "#ffffff",
    padding: "8px",
    cursor: "pointer",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  }),
  authWrap: { minHeight: "calc(100vh - 90px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px" },
  authCard: { width: "100%", maxWidth: 460, background: "#0a1830", border: "1px solid #113a72", borderRadius: 12, padding: 18 },
  authTitle: { fontSize: 24, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 6 },
  authSub: { fontSize: 12, color: "#9bb2d1", marginBottom: 14 },
  hookDisabled: { ...{ background: "#1f2937", border: "1px solid #4b5563", color: "#9ca3af", borderRadius: 6, padding: "10px 18px", fontSize: 12, letterSpacing: "0.08em", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }, opacity: 0.7, cursor: "not-allowed" },
  planInfo: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    marginLeft: 4,
    borderRadius: "50%",
    border: "1px solid #9bb2d1",
    color: "#9bb2d1",
    fontSize: 9,
    fontWeight: 900,
    cursor: "help",
    verticalAlign: "middle",
    lineHeight: 1,
  },
  planTable: { width: "100%", borderCollapse: "collapse", fontSize: 11, border: "1px solid #eab308" },
  planTh: (active) => ({
    textAlign: "left",
    padding: "8px 8px",
    color: "#9bb2d1",
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    border: "1px solid #eab308",
    fontFamily: "'Encode Sans Expanded', sans-serif",
    background: active ? "rgba(234, 179, 8, 0.22)" : "rgba(234, 179, 8, 0.06)",
    cursor: "pointer",
    transition: "background 0.12s",
  }),
  planTd: (highlight) => ({
    padding: "8px 8px",
    border: "1px solid #eab308",
    color: "#c8d6ea",
    verticalAlign: "top",
    background: highlight ? "rgba(234, 179, 8, 0.14)" : "transparent",
    transition: "background 0.12s",
  }),
  planTdFeature: { padding: "8px 8px", border: "1px solid #eab308", color: "#ffffff", fontWeight: 700, verticalAlign: "top" },
  planTdPrice: { padding: "8px 8px", border: "1px solid #eab308", color: "#9bb2d1", verticalAlign: "top", fontSize: 9, letterSpacing: "0.08em" },
  planThCorner: {
    textAlign: "left",
    padding: "8px 8px",
    color: "#9bb2d1",
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    border: "1px solid #eab308",
    fontFamily: "'Encode Sans Expanded', sans-serif",
    background: "rgba(234, 179, 8, 0.04)",
  },
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [answers, setAnswers] = useState({});
  const [sqFt, setSqFt] = useState("");
  const [manualSystemKey, setManualSystemKey] = useState(null);
  const [showAreaCalc, setShowAreaCalc] = useState(false);
  const [calcValue, setCalcValue] = useState("");
  const [calcUnit, setCalcUnit] = useState("sqft");
  /** Contractor pricing multiplier key (FGP Midwest) — drives quote math */
  const [contractorPricingTierKey, setContractorPricingTierKey] = useState("msrp");
  const [assignedPricingTierKey, setAssignedPricingTierKey] = useState("msrp");
  const [profileVersion, setProfileVersion] = useState(0);
  const [speed, setSpeed] = useState("");
  const [phase, setPhase] = useState("questions"); // questions | results | submitted | account | userdb | orders | plans | floor-systems | customer-quotes
  const [contractorName, setContractorName] = useState("");
  const [jobName, setJobName] = useState("");
  const [submittedDraft, setSubmittedDraft] = useState(null);
  const [customFloorSystems, setCustomFloorSystems] = useState([]);
  const [contractorVendors, setContractorVendors] = useState([]);
  const [vendorPoStatus, setVendorPoStatus] = useState(""); // confirmation after email
  const [vendorPoSending, setVendorPoSending] = useState(false);
  const [viewingOrder, setViewingOrder] = useState(null);
  const [orderJobs, setOrderJobs] = useState([]);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [allProfilesByEmail, setAllProfilesByEmail] = useState({});
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login"); // login | create | reset
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authShowPassword, setAuthShowPassword] = useState(false);
  const [authShowConfirmPassword, setAuthShowConfirmPassword] = useState(false);
  const [authFirstName, setAuthFirstName] = useState("");
  const [authLastName, setAuthLastName] = useState("");
  const [authCompanyName, setAuthCompanyName] = useState("");
  const [authAgreedLegal, setAuthAgreedLegal] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [orderSubmitMessage, setOrderSubmitMessage] = useState("");
  /** App-level toast — survives MaterialOrderForm remounts / auth re-hydration. */
  const [appSuccessToast, setAppSuccessToast] = useState("");
  const appSuccessToastTimerRef = useRef(null);
  const userProfileRef = useRef(null);
  const [stripeBanner, setStripeBanner] = useState("");
  const [checkoutOverlay, setCheckoutOverlay] = useState(null); // null | { status: "loading"|"error", message?: string }
  const [savedOrders, setSavedOrders] = useState([]);
  const [currentPlan, setCurrentPlan] = useState("Free");
  const [poCountThisYear, setPoCountThisYear] = useState(0);
  const [poHistory, setPoHistory] = useState([]);
  const [materialOrderHistory, setMaterialOrderHistory] = useState([]);
  const [ordersSearchQuery, setOrdersSearchQuery] = useState("");
  const [finishTypeError, setFinishTypeError] = useState("");
  /** Screen to return to when leaving Plan Comparison */
  const [plansReturnPhase, setPlansReturnPhase] = useState("questions");
  const [selectedContractorEmail, setSelectedContractorEmail] = useState(null);
  const [contractorSearchQuery, setContractorSearchQuery] = useState("");
  const [pricingConsoleTab, setPricingConsoleTab] = useState("tier");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [showBillingHistory, setShowBillingHistory] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ first_name: "", last_name: "", company_name: "" });
  const [flakeSwatchUrls, setFlakeSwatchUrls] = useState({});
  const [metallicSwatchUrls, setMetallicSwatchUrls] = useState({});
  const [solidSwatchUrls, setSolidSwatchUrls] = useState({});
  const [systemCutawayModal, setSystemCutawayModal] = useState(null); // { url, code, label } | null
  const [cutawayImgFailed, setCutawayImgFailed] = useState({}); // systemKey → true when 404 / load error
  const [adminSelfTierDraft, setAdminSelfTierDraft] = useState("msrp");
  const [adminSelfPlanDraft, setAdminSelfPlanDraft] = useState("Free");
  const [adminSelfSaveNotice, setAdminSelfSaveNotice] = useState("");
  const [settingsToast, setSettingsToast] = useState("");
  const settingsToastTimerRef = useRef(null);
  const [contractorAdminDraft, setContractorAdminDraft] = useState(null);
  const [contractorAdminSaveNotice, setContractorAdminSaveNotice] = useState("");
  const [isNarrowScreen, setIsNarrowScreen] = useState(
    typeof window !== "undefined" ? window.innerWidth < 760 : false
  );
  const recommendedSectionRef = useRef(null);
  const prevSystemFamilyRef = useRef(null);

  function goToPlans(fromPhase) {
    setPlansReturnPhase(fromPhase || phase || "questions");
    setPhase("plans");
  }

  function goToJobCalculator() {
    setHeaderMenuOpen(false);
    setPhase("questions");
  }

  function plansBackLabel() {
    switch (plansReturnPhase) {
      case "results":
        return "← Back to order summary";
      case "submitted":
        return "← Back to thank you";
      case "account":
        return "← Back to account";
      case "orders":
        return "← Back to My Orders";
      case "floor-systems":
        return "← Back to My Floor Systems";
      case "customer-quotes":
        return "← Back to Customer Quotes";
      case "questions":
        return "← Back to job calculator";
      default:
        return "← Back to job calculator";
    }
  }

  async function loadCustomFloorData(activeSession = null) {
    const authSession = activeSession || session;
    const uid = authSession?.user?.id;
    if (!uid) {
      setCustomFloorSystems([]);
      setContractorVendors([]);
      return;
    }
    const tier = String(userProfileRef.current?.membership_tier || "free").toLowerCase();
    if (tier !== "tier2") {
      setCustomFloorSystems([]);
      setContractorVendors([]);
      return;
    }
    try {
      await ensureDefaultFgpVendor(supabase, uid);
      const [sysRes, vendRes] = await Promise.all([
        supabase.from("custom_floor_systems").select("*").eq("user_id", uid).order("updated_at", { ascending: false }),
        supabase.from("contractor_vendors").select("*").eq("user_id", uid).order("name"),
      ]);
      if (!sysRes.error) setCustomFloorSystems(sysRes.data || []);
      if (!vendRes.error) setContractorVendors(vendRes.data || []);
    } catch (e) {
      console.warn("[ECOS] loadCustomFloorData", e);
    }
  }

  async function loadAdminProfiles(activeSession = null) {
    const authSession = activeSession || session;
    if (!authSession?.user?.id) return;
    const { data, error } = await supabase.from("profiles").select("*").order("email", { ascending: true });
    if (error) {
      // If policy blocks full read, keep working with current user profile.
      return;
    }
    const map = {};
    for (const row of data || []) {
      const email = String(row.email || "").trim().toLowerCase();
      if (!email) continue;
      map[email] = normalizeUserProfile(row);
    }
    setAllProfilesByEmail(map);
  }

  async function updateProfileByEmail(targetEmail, updates) {
    const email = String(targetEmail || "").trim().toLowerCase();
    if (!email) return false;
    const current = normalizeUserProfile(allProfilesByEmail[email] || {});
    const next = {
      ...current,
      ...updates,
      needsAdminReview: updates.needsAdminReview ?? false,
    };
    const {
      billing_history: _billingHistory,
      stripe_customer_id: _sc,
      stripe_subscription_id: _ss,
      subscription_status: _ssu,
      subscription_current_period_end: _spe,
      grace_period_start: _gps,
      grace_email_stage: _ges,
      ...nextForSave
    } = next;
    const { error } = await supabase.from("profiles").update(nextForSave).eq("email", email);
    if (error) {
      window.alert(error.message || "Profile update failed.");
      return false;
    }
    setAllProfilesByEmail((prev) => ({ ...prev, [email]: normalizeUserProfile(next) }));
    if (email === currentUser) {
      setUserProfile(normalizeUserProfile(next));
    }
    setProfileVersion((v) => v + 1);
    return true;
  }

  function setEcosPricingAdminForUser(targetEmail, isAdmin) {
    return updateProfileByEmail(targetEmail, { ecosPricingAdmin: !!isAdmin });
  }

  function showSettingsSavedToast(message = "Settings saved") {
    if (settingsToastTimerRef.current) clearTimeout(settingsToastTimerRef.current);
    setSettingsToast(message);
    setAdminSelfSaveNotice(message);
    settingsToastTimerRef.current = setTimeout(() => {
      setSettingsToast("");
      setAdminSelfSaveNotice("");
      settingsToastTimerRef.current = null;
    }, 2500);
  }

  function showAppSuccessToast(
    message = "✅ Order submitted! We'll send you an invoice to pay shortly. Questions? Call 502-640-2394"
  ) {
    if (appSuccessToastTimerRef.current) clearTimeout(appSuccessToastTimerRef.current);
    setAppSuccessToast(message);
    console.info("[ECOS toast] show", message.slice(0, 48));
    appSuccessToastTimerRef.current = setTimeout(() => {
      setAppSuccessToast("");
      appSuccessToastTimerRef.current = null;
    }, 8000);
  }

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  useEffect(() => {
    if (!session?.user?.id) {
      setCustomFloorSystems([]);
      setContractorVendors([]);
      return;
    }
    void loadCustomFloorData(session);
  }, [session?.user?.id, userProfile?.membership_tier, profileVersion]);

  useEffect(() => {
    return () => {
      if (appSuccessToastTimerRef.current) clearTimeout(appSuccessToastTimerRef.current);
    };
  }, []);

  function goNewJobQuote() {
    setHeaderMenuOpen(false);
    reset();
  }

  /**
   * Testing mode save — write tier fields by user id, unlock FGP rate-card gates so
   * assigned buying tier actually applies in quotes, then sync session state.
   */
  async function saveAdminSelfTesting() {
    if (!currentUser || !isPricingMasterEmail(currentUser, userProfile)) return;
    if (!session?.user?.id) {
      window.alert("Session expired — log out and log back in, then try again.");
      return;
    }
    const assigned = adminSelfTierDraft;
    const membership = tierTagToMembershipTier(adminSelfPlanDraft);
    // Non-MSRP assigned tiers need FGP gates on so getEffectiveContractorPricingTierKey applies them.
    const enableRateCard = assigned !== "msrp";
    const fields = {
      assignedPricingTierKey: assigned,
      membership_tier: membership,
      contractor_tier: assigned === "msrp" ? "" : assigned,
      isFgpCustomer: enableRateCard,
      contractorPricingApplicationReceived: enableRateCard,
      needsAdminReview: false,
    };
    const { data, error } = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) {
      window.alert(error.message || "Could not save testing settings.");
      return;
    }
    const merged = normalizeUserProfile({ ...(userProfile || {}), ...(data || fields) });
    setUserProfile(merged);
    setAllProfilesByEmail((prev) => ({ ...prev, [currentUser.trim().toLowerCase()]: merged }));
    setProfileVersion((v) => v + 1);
    setCurrentPlan(membershipTierToPlanTag(merged.membership_tier || "free"));
    setAssignedPricingTierKey(merged.assignedPricingTierKey || "msrp");
    setContractorPricingTierKey(getEffectiveContractorPricingTierKey(merged));
    showSettingsSavedToast("Settings saved");
  }

  async function saveContractorAdminPanel() {
    if (!selectedContractorEmail || !contractorAdminDraft) return;
    const ok = await updateProfileByEmail(selectedContractorEmail, {
      isFgpCustomer: contractorAdminDraft.isFgpCustomer,
      contractorPricingApplicationReceived: contractorAdminDraft.contractorPricingApplicationReceived,
      assignedPricingTierKey: contractorAdminDraft.assignedPricingTierKey,
      membership_tier: tierTagToMembershipTier(contractorAdminDraft.planTag),
      needsAdminReview: false,
    });
    if (ok) {
      setContractorAdminSaveNotice("Saved — customer settings are in effect.");
      setTimeout(() => setContractorAdminSaveNotice(""), 4000);
    }
  }

  async function saveContractorAndReturnToOrdering() {
    if (!selectedContractorEmail || !contractorAdminDraft) return;
    const ok = await updateProfileByEmail(selectedContractorEmail, {
      isFgpCustomer: contractorAdminDraft.isFgpCustomer,
      contractorPricingApplicationReceived: contractorAdminDraft.contractorPricingApplicationReceived,
      assignedPricingTierKey: contractorAdminDraft.assignedPricingTierKey,
      membership_tier: tierTagToMembershipTier(contractorAdminDraft.planTag),
      needsAdminReview: false,
    });
    if (ok) {
      setPhase("questions");
      setContractorAdminSaveNotice("");
    }
  }

  function refreshUserDatabaseCard() {
    loadAdminProfiles();
  }

  async function ensureProfileForSession(activeSession, extraProfile = {}) {
    if (!activeSession?.user?.id) return null;
    const email = activeSession.user.email?.toLowerCase() || "";
    const existing = normalizeUserProfile(userProfileRef.current || {});
    const seed = {
      id: activeSession.user.id,
      email,
      first_name: extraProfile.first_name || existing.first_name || "",
      last_name: extraProfile.last_name || existing.last_name || "",
      company_name: extraProfile.company_name || existing.company_name || "",
      membership_tier: extraProfile.membership_tier || existing.membership_tier || "free",
      assignedPricingTierKey: existing.assignedPricingTierKey || "msrp",
      isFgpCustomer: existing.isFgpCustomer ?? false,
      contractorPricingApplicationReceived: existing.contractorPricingApplicationReceived ?? false,
      ecosPricingAdmin: existing.ecosPricingAdmin ?? false,
      needsAdminReview: existing.needsAdminReview ?? true,
      signup_anniversary_date: existing.signup_anniversary_date || new Date().toISOString(),
      po_year_start_date: existing.po_year_start_date || existing.signup_anniversary_date || new Date().toISOString(),
      annual_po_count: existing.annual_po_count ?? existing.pos_submitted_this_year ?? 0,
      pos_submitted_this_year: existing.pos_submitted_this_year ?? existing.annual_po_count ?? 0,
      logo_url: existing.logo_url || "",
      brand_color_primary: existing.brand_color_primary || "#113a72",
      brand_color_secondary: existing.brand_color_secondary || "#e33433",
      total_pos_value_this_quarter: existing.total_pos_value_this_quarter || 0,
      total_pos_value_this_year: existing.total_pos_value_this_year || 0,
    };
    const { data, error } = await supabase.from("profiles").upsert(seed, { onConflict: "id" }).select().single();
    if (error) {
      throw error;
    }
    setUserProfile(normalizeUserProfile(data || seed));
    try {
      await ensureDefaultFgpVendor(supabase, activeSession.user.id);
    } catch (e) {
      console.warn("[ECOS] FGP vendor seed skipped", e);
    }
    return data;
  }

  async function loadMaterialOrderHistory(activeSession) {
    if (!activeSession?.user?.id) return;
    const { data, error } = await supabase
      .from("material_orders")
      .select("*")
      .eq("user_id", activeSession.user.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (error.code === "42P01" || /material_orders/i.test(error.message || "")) return;
      throw error;
    }
    setMaterialOrderHistory(data || []);
  }

  async function syncPoYearOnLogin(activeSession, profileForWindow = null) {
    if (!activeSession?.user?.id) return 0;
    const profile = normalizeUserProfile(profileForWindow || userProfile || {});
    const reset = applyPoYearResetIfNeeded(profile);
    const windowStart = reset.po_year_start_date;
    const patch = {};

    if (reset.changed) {
      patch.po_year_start_date = reset.po_year_start_date;
      patch.annual_po_count = reset.annual_po_count;
      patch.pos_submitted_this_year = reset.annual_po_count;
    }

    const [ordersRes, materialRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", activeSession.user.id)
        .gte("created_at", windowStart),
      supabase
        .from("material_orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", activeSession.user.id)
        .gte("created_at", windowStart),
    ]);

    const reconciled =
      (ordersRes.count ?? 0) +
      (materialRes.count ?? 0);
    const currentCount = reset.annual_po_count ?? 0;
    if (reconciled > currentCount) {
      patch.annual_po_count = reconciled;
      patch.pos_submitted_this_year = reconciled;
    }

    if (Object.keys(patch).length) {
      try {
        await updateProfileFields(patch);
      } catch (err) {
        console.error("[ECOS po] syncPoYearOnLogin profile update failed", err);
      }
    }

    const nextCount = patch.annual_po_count ?? currentCount;
    setPoCountThisYear(nextCount);
    return nextCount;
  }

  async function loadPoHistory(activeSession, profileForWindow = null) {
    if (!activeSession?.user?.id) return;
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", activeSession.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data || [];
    setPoHistory(rows);
    setSavedOrders(
      rows.map((o) => ({
        submittedAt: o.created_at,
        jobNamePo: o.jobNamePo || o.job_name || "Untitled Job / PO",
        address: o.address || "—",
        totalTier: Number(o.totalTier || o.total_cost || 0),
        sqFt: Number(o.sqFt || o.sq_footage || 0),
        costPerSqFt: Number(o.costPerSqFt || o.cost_per_sqft || 0),
        jobs: o.jobs || [],
      }))
    );
    await syncPoYearOnLogin(activeSession, profileForWindow || userProfile);
  }

  async function updateProfileFields(fields) {
    if (!session?.user?.id) return;
    const safeFields = { ...(fields || {}) };
    delete safeFields.billing_history;
    delete safeFields.stripe_customer_id;
    delete safeFields.stripe_subscription_id;
    delete safeFields.subscription_status;
    delete safeFields.subscription_current_period_end;
    delete safeFields.grace_period_start;
    delete safeFields.grace_email_stage;
    if (!Object.keys(safeFields).length) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(safeFields)
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) {
      window.alert(error.message || "Unable to update profile.");
      return;
    }
    const merged = normalizeUserProfile({ ...(userProfile || {}), ...(data || safeFields) });
    setUserProfile(merged);
    if (currentUser) {
      setAllProfilesByEmail((prev) => ({ ...prev, [currentUser]: merged }));
    }
  }

  async function uploadBrandLogo(file) {
    if (!session?.user?.id || !file) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${session.user.id}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("brand-assets").upload(path, file, { upsert: true });
    if (uploadError) {
      window.alert(uploadError.message || "Logo upload failed.");
      return;
    }
    const { data } = supabase.storage.from("brand-assets").getPublicUrl(path);
    const publicUrl = data?.publicUrl || "";
    if (publicUrl) {
      await updateProfileFields({ logo_url: publicUrl });
    }
  }

  async function startTier1Checkout() {
    if (!session?.user?.id) {
      window.alert("Please sign in to subscribe.");
      return;
    }
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) {
      window.alert("Please sign in again.");
      return;
    }
    const base = getApiBase();
    setCheckoutOverlay({
      status: "loading",
      message: "Opening secure Stripe checkout for ECOS Tier 1 — The Calculator…",
    });
    try {
      const res = await fetch(`${base}/api/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.url) throw new Error("No checkout URL returned.");
      window.location.assign(data.url);
    } catch (e) {
      setCheckoutOverlay({
        status: "error",
        message: e?.message || "Could not start checkout. Is the API deployed (Vercel) and env vars set?",
      });
    }
  }

  async function openStripeCustomerPortal() {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) {
      window.alert("Please sign in again.");
      return;
    }
    const cid = String(normalizeUserProfile(userProfile || {}).stripe_customer_id || "").trim();
    if (!cid) {
      window.alert("No Stripe billing profile yet. Complete a Tier 1 subscription checkout first.");
      return;
    }
    const base = getApiBase();
    try {
      const res = await fetch(`${base}/api/create-portal-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (!data.url) throw new Error("No portal URL returned.");
      window.location.assign(data.url);
    } catch (e) {
      window.alert(e?.message || "Could not open billing portal.");
    }
  }

  async function chooseMembershipPlan(planId) {
    console.log("[ECOS chooseMembershipPlan:start]", {
      planId,
      sessionUserId: session?.user?.id,
      currentUser,
      membershipTier,
    });
    if (!session?.user?.id) {
      setPhase("questions");
      return;
    }
    if (planId === "tier1") {
      await startTier1Checkout();
      return;
    }
    const tier = planId === "tier2" ? "tier2" : "free";
    try {
      await updateProfileFields({ membership_tier: tier });
    } catch {
      // Keep navigation responsive even if profile write is blocked.
    }
    setCurrentPlan(membershipTierToPlanTag(tier));
    setPhase("questions");
  }

  const autoSystemKey = getRecommendedSystem(answers, currentPlan);
  const activeSystemKey = manualSystemKey || autoSystemKey;
  const isFreePlan = currentPlan === "Free";
  const isCustomActive = isCustomSystemKey(activeSystemKey);
  const customSystemMap = useMemo(() => {
    const map = {};
    for (const s of customFloorSystems) {
      const adapted = toCalculatorSystem(s);
      if (adapted) map[adapted.code] = adapted;
    }
    return map;
  }, [customFloorSystems]);
  const isRecommendedSystemLocked =
    Boolean(activeSystemKey) &&
    !isCustomActive &&
    isFreePlan &&
    !FREE_UNLOCKED_SYSTEMS.has(activeSystemKey);
  const activeSystemFamily = isCustomActive ? "custom" : getSystemFamily(activeSystemKey || "");
  const activeCategory = isCustomActive ? "grind_seal" : getSystemCategory(activeSystemKey || "");
  const activeTheme = CATEGORY_THEME[activeCategory] || CATEGORY_THEME.flake;
  const recommendedSystem = activeSystemKey
    ? isCustomActive
      ? customSystemMap[activeSystemKey] || null
      : SYSTEMS[activeSystemKey]
    : null;
  const locationSystems = getFullLocationSystemKeys(answers.location);
  const otherLocationSystems = locationSystems.filter((key) => key !== activeSystemKey);
  const finishOptionsForPlan = FINISH_OPTIONS;
  const benchmarkDisclaimer = `Material benchmark @ ${SYSTEM_BENCHMARK_SQFT} ft² using purchasable kits (no crack repair / no steps).`;
  const activeSystemBenchmarkPerSqFt =
    activeSystemKey && !isCustomActive
      ? getSystemMaterialBenchmarkPerSqFt(activeSystemKey, contractorPricingTierKey, answers, speed)
      : null;
  const speedIsRequired = answers.location === "exterior" && activeSystemKey === "FLK-OD-RES";
  const shouldAskUseType = !isFreePlan;
  const shouldAskOdorConcern = ["metallic", "solid", "solid_tex"].includes(answers.finish);
  const hasRequiredRefineAnswers = Boolean(
    (!shouldAskUseType || answers.use) &&
      answers.moisture &&
      answers.cracks &&
      (!shouldAskOdorConcern || answers.odorConcern)
  );
  const metallicSelectedColors = Array.isArray(answers.metallicColors) ? answers.metallicColors : [];
  const hasColorSelection = activeSystemFamily === "metallic" ? metallicSelectedColors.length > 0 : Boolean(answers.color);
  const hasMetallicInputs =
    activeSystemFamily === "metallic"
      ? Boolean(answers.baseCoatColor) && Boolean(answers.metallicPrimerTint) && metallicSelectedColors.length > 0 && metallicSelectedColors.length <= 4
      : true;
  const hasSpeedSelection = speedIsRequired ? Boolean(speed) : true;
  const visibleColorOptions =
    activeSystemFamily === "metallic"
      ? METALLIC_COLOR_OPTIONS.map((value) => ({
          value,
          hex: "#1f2937",
          recommendedBase: null,
          swatchUrl: metallicSwatchUrls[makeSwatchKey(value)] || null,
        }))
      : activeSystemFamily === "solid"
        ? SOLID_COLOR_OPTIONS.map((value) => {
            const match = BASE_COAT_COLOR_OPTIONS.find((c) => c.value === value);
            return {
              value,
              hex: match?.hex || "#374151",
              recommendedBase: null,
              /** Always white on solid swatch cards (dark UI); base coat row keeps its own contrast. */
              textColor: "#ffffff",
              swatchUrl: solidSwatchUrls[makeSwatchKey(value)] || null,
            };
          })
        : STOCKED_COLORS.map((color) => ({
            ...color,
            swatchUrl: flakeSwatchUrls[makeSwatchKey(color.value)] || null,
          }));
  const readyForQuote = isCustomActive
    ? Boolean(recommendedSystem) && sqFt !== ""
    : Boolean(activeSystemKey) &&
      !isRecommendedSystemLocked &&
      sqFt !== "" &&
      hasRequiredRefineAnswers &&
      hasColorSelection &&
      hasMetallicInputs &&
      hasSpeedSelection;
  const swatchGridColumns = isNarrowScreen
    ? activeSystemFamily === "flake"
      ? "repeat(3, minmax(0, 1fr))"
      : "repeat(2, minmax(0, 1fr))"
    : "repeat(4, minmax(0, 1fr))";

  function appendCalcValue(next) {
    setCalcValue((prev) => (prev === "0" ? next : `${prev}${next}`));
  }

  function backspaceCalcValue() {
    setCalcValue((prev) => prev.slice(0, -1));
  }

  function clearCalcValue() {
    setCalcValue("");
  }

  function areaToSqFt(value, unit) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return "";
    if (unit === "sqm") return (parsed * 10.7639).toFixed(2);
    if (unit === "yd2") return (parsed * 9).toFixed(2);
    return parsed.toString();
  }

  function applyAreaCalc() {
    const nextSqFt = areaToSqFt(calcValue, calcUnit);
    setSqFt(nextSqFt);
    setShowAreaCalc(false);
  }

  function answer(qid, val) {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: val };
      if (qid === "location" && val === "exterior" && next.finish && next.finish !== "flake") {
        next.finish = "";
      }
      if (qid === "finish" && val !== "metallic") {
        delete next.metallicColors;
        delete next.metallicPrimerTint;
      }
      if (qid === "finish" && !["metallic", "solid", "solid_tex"].includes(val)) {
        delete next.odorConcern;
      }
      if (qid === "finish" && val === "metallic") {
        if (!next.baseCoatColor) next.baseCoatColor = "Black";
        if (!next.metallicPrimerTint) next.metallicPrimerTint = "Gray";
        if (!Array.isArray(next.metallicColors)) next.metallicColors = [];
      }
      if (qid === "color" && (next.finish === "flake" || activeSystemFamily === "flake")) {
        const autoBaseCoat = getAutoBaseCoatFromFlakeColor(val);
        if (autoBaseCoat) {
          next.baseCoatColor = autoBaseCoat;
        }
      }
      return next;
    });
    if (["location", "finish", "use", "moisture", "cracks", "odorConcern"].includes(qid)) {
      setManualSystemKey(null);
    }
    if (qid === "location" && val !== "exterior") {
      setFinishTypeError("");
    }
  }

  function toggleMetallicColor(colorValue) {
    setAnswers((prev) => {
      const current = Array.isArray(prev.metallicColors) ? prev.metallicColors : [];
      const exists = current.includes(colorValue);
      let nextList = current;
      if (exists) {
        nextList = current.filter((c) => c !== colorValue);
      } else if (current.length < 4) {
        nextList = [...current, colorValue];
      } else {
        window.alert("You can select up to 4 metallic pigments.");
        return prev;
      }
      return {
        ...prev,
        metallicColors: nextList,
        color: nextList.join(", "),
      };
    });
  }

  function handleFinishTypeSelect(value) {
    if (answers.location === "exterior" && value !== "flake") {
      setFinishTypeError("Outdoor floors currently support Flake only. Select Flake to continue.");
      return;
    }
    setFinishTypeError("");
    answer("finish", value);
  }

  function reset() {
    setAnswers({});
    setSqFt("");
    setManualSystemKey(null);
    setPhase("questions");
    setSpeed("");
    setSubmittedDraft(null);
    setOrderSubmitMessage("");
    setOrderJobs([]);
    setContractorName("");
    setJobName("");
  }

  function startNextJobInOrder() {
    setAnswers({});
    setSqFt("");
    setManualSystemKey(null);
    setSpeed("");
    setContractorName("");
    setJobName("");
    setPhase("questions");
  }

  function buildResults() {
    if (!recommendedSystem) return null;
    const sf = parseFloat(sqFt) || 0;
    const steps = 0;
    const opts = {
      moisture: answers.moisture || "none",
      hasCracks: answers.cracks === "yes",
      odorConcern: answers.odorConcern === "yes",
      steps,
      speed,
      metallicPrimerTint: answers.metallicPrimerTint || "Gray",
    };
    const layers = recommendedSystem.layers(sf, opts);
    const orderLines = recommendedSystem.isCustom
      ? buildCustomOrderLines(layers, TIERS[contractorPricingTierKey]?.mult ?? 1)
      : buildOrderList(layers, contractorPricingTierKey, answers);
    const requiredMaterialTierTotal = recommendedSystem.isCustom
      ? orderLines.reduce((s, l) => s + l.lineTier, 0)
      : getRequiredMaterialTierTotal(layers, contractorPricingTierKey, answers);
    const totalMsrp = orderLines.reduce((s, l) => s + l.lineMsrp, 0);
    const totalTier = orderLines.reduce((s, l) => s + l.lineTier, 0);
    const totalDiscount = totalMsrp - totalTier;
    const requiredMaterialCostPerSqFt = sf > 0 ? +(requiredMaterialTierTotal / sf).toFixed(2) : 0;
    return {
      sf,
      steps,
      layers,
      orderLines,
      totalMsrp,
      totalTier,
      totalDiscount,
      requiredMaterialTierTotal,
      requiredMaterialCostPerSqFt,
    };
  }

  const results = phase === "results" ? buildResults() : null;
  const currentJobSnapshot =
    results && recommendedSystem
      ? {
          ...results,
          jobNamePo: contractorName || "Untitled Job / PO",
          address: jobName || "—",
          systemCode: recommendedSystem.code,
          systemLabel: recommendedSystem.label,
          color: answers.color || "—",
        }
      : null;
  const cartJobsForDisplay = [...orderJobs];
  const totalJobsInOrder = orderJobs.length + (currentJobSnapshot ? 1 : 0);
  const membershipTier = userProfile?.membership_tier || "free";
  const maxActiveJobs = getMaxJobsForMembershipTier(membershipTier);
  const poUsage = getTier1PoStatus({ ...(userProfile || {}), annual_po_count: poCountThisYear });
  const poCounterLabel = getPoCounterLabel(poUsage);
  const ordersSearchNormalized = ordersSearchQuery.trim().toLowerCase();
  const filteredMaterialOrderHistory = useMemo(() => {
    const profileBits = [
      userProfile?.first_name,
      userProfile?.last_name,
      userProfile?.company_name,
      userProfile?.email,
    ]
      .filter(Boolean)
      .join(" ");
    return materialOrderHistory.filter((o) =>
      haystackIncludes(`${materialOrderSearchText(o)} ${profileBits}`, ordersSearchNormalized)
    );
  }, [materialOrderHistory, ordersSearchNormalized, userProfile]);
  const filteredPoHistory = useMemo(() => {
    const profileBits = [
      userProfile?.first_name,
      userProfile?.last_name,
      userProfile?.company_name,
      userProfile?.email,
    ]
      .filter(Boolean)
      .join(" ");
    return poHistory.filter((o) =>
      haystackIncludes(`${calculatorOrderSearchText(o)} ${profileBits}`, ordersSearchNormalized)
    );
  }, [poHistory, ordersSearchNormalized, userProfile]);
  const combinedOrderLines = results
    ? aggregateOrderLines([...orderJobs.map((j) => j.orderLines), results.orderLines])
    : [];
  const combinedTotals = results
    ? {
        totalMsrp: [...orderJobs, results].reduce((sum, j) => sum + j.totalMsrp, 0),
        totalTier: [...orderJobs, results].reduce((sum, j) => sum + j.totalTier, 0),
        totalDiscount: [...orderJobs, results].reduce((sum, j) => sum + j.totalDiscount, 0),
        requiredMaterialTierTotal: [...orderJobs, results].reduce((sum, j) => sum + j.requiredMaterialTierTotal, 0),
        totalSqFt: [...orderJobs, results].reduce((sum, j) => sum + j.sf, 0),
      }
    : null;

  const usersSnapshot = allProfilesByEmail;
  const activeUserProfile = userProfile ? normalizeUserProfile(userProfile) : currentUser ? normalizeUserProfile(usersSnapshot[currentUser] || {}) : null;
  const isCurrentUserPricingMaster = isPricingMasterEmail(currentUser, activeUserProfile);
  const contractorUsers = Object.keys(usersSnapshot)
    .sort()
    .map((email) => {
      const profile = normalizeUserProfile(usersSnapshot[email] || {});
      return {
        email,
        profile,
        displayName: getUserDisplayName(email, profile),
      };
    });
  const normalizedContractorSearch = contractorSearchQuery.trim().toLowerCase();
  const filteredContractorUsers = !normalizedContractorSearch
    ? contractorUsers
    : contractorUsers.filter(({ email, displayName }) => {
        const haystack = `${displayName} ${email}`.toLowerCase();
        return haystack.includes(normalizedContractorSearch);
      });
  const pendingPricingReviews = Object.entries(usersSnapshot)
    .map(([email, user]) => ({ email, profile: normalizeUserProfile(user) }))
    .filter(({ profile }) => profile.needsAdminReview);
  const pricingElevatedPending = assignedPricingTierKey !== contractorPricingTierKey;
  const shouldShowContractorPricingReminder =
    Boolean(currentUser) &&
    Boolean(activeUserProfile) &&
    !activeUserProfile.contractorPricingApplicationReceived &&
    !isCurrentUserPricingMaster;

  useEffect(() => {
    if (phase === "results" || phase === "submitted" || phase === "plans") {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [phase]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: bootstrap once per profileVersion
  useEffect(() => {
    let cancelled = false;
    let hydrateSeq = 0;

    function clearLoggedOutState() {
      setUserProfile(null);
      setAllProfilesByEmail({});
      setCurrentPlan("Free");
      setContractorPricingTierKey("msrp");
      setAssignedPricingTierKey("msrp");
      setPoHistory([]);
      setMaterialOrderHistory([]);
      setPoCountThisYear(0);
    }

    async function hydrateFromSession(activeSession, source) {
      const seq = ++hydrateSeq;
      console.info("[ECOS auth] hydrate start", {
        source,
        userId: activeSession?.user?.id || null,
        seq,
      });
      if (!activeSession?.user?.id) {
        if (!cancelled) clearLoggedOutState();
        return null;
      }
      try {
        const p = await ensureProfileForSession(activeSession);
        if (cancelled || seq !== hydrateSeq) {
          console.info("[ECOS auth] hydrate stale — skip apply", { source, seq, hydrateSeq });
          return p;
        }
        setCurrentPlan(membershipTierToPlanTag(p?.membership_tier || "free"));
        setContractorPricingTierKey(getEffectiveContractorPricingTierKey(p || {}));
        setAssignedPricingTierKey(normalizeUserProfile(p || {}).assignedPricingTierKey || "msrp");
        await loadPoHistory(activeSession, p);
        await loadMaterialOrderHistory(activeSession);
        await loadAdminProfiles(activeSession);
        console.info("[ECOS auth] hydrate done", {
          source,
          membership: p?.membership_tier,
          company: p?.company_name,
        });
        return p;
      } catch (err) {
        if (!cancelled) {
          setAuthError(err?.message || "Unable to load your account profile.");
          console.error("[ECOS auth] hydrate failed", source, err);
        }
        return null;
      }
    }

    async function bootstrapAuth() {
      setIsAuthLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const activeSession = data.session || null;
        setSession(activeSession);
        setCurrentUser(activeSession?.user?.email?.toLowerCase() || null);
        if (activeSession) {
          await hydrateFromSession(activeSession, "bootstrap");
        } else {
          clearLoggedOutState();
        }
      } finally {
        if (!cancelled) setIsAuthLoading(false);
      }
    }

    bootstrapAuth();

    /**
     * IMPORTANT: never `await` inside onAuthStateChange.
     * Async work there deadlocks Supabase auth (getSession / storage.list stall),
     * which matches intermittent empty swatches + sticky session weirdness fixed by logout reload.
     */
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.info("[ECOS auth] onAuthStateChange", {
        event,
        userId: nextSession?.user?.id || null,
      });
      setSession(nextSession || null);
      const nextEmail = nextSession?.user?.email?.toLowerCase() || null;
      setCurrentUser(nextEmail);

      if (!nextSession) {
        clearLoggedOutState();
        setIsAuthLoading(false);
        return;
      }

      // Token refresh: keep session in state only — do not re-upsert profile / reload history.
      if (event === "TOKEN_REFRESHED") {
        return;
      }

      setTimeout(() => {
        if (cancelled) return;
        void (async () => {
          // Skip duplicate INITIAL_SESSION hydrate when bootstrap already covered it.
          if (event === "INITIAL_SESSION" && userProfileRef.current?.id === nextSession.user.id) {
            console.info("[ECOS auth] skip duplicate INITIAL_SESSION hydrate");
            setIsAuthLoading(false);
            return;
          }
          try {
            await hydrateFromSession(nextSession, event || "auth-change");
          } finally {
            if (!cancelled) setIsAuthLoading(false);
          }
        })();
      }, 0);
    });

    return () => {
      cancelled = true;
      authSubscription?.subscription?.unsubscribe?.();
    };
  }, [profileVersion]);

  useEffect(() => {
    const hash = window.location.hash || "";
    if (/(^|&)type=recovery(&|$)/.test(hash.replace(/^#/, ""))) {
      setAuthMode("reset");
      setAuthNotice("Set your new password below.");
      setAuthError("");
    }
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const portal = params.get("portal");
    if (!checkout && !portal) return;

    const sessionId = params.get("session_id");
    const u = new URL(window.location.href);
    u.searchParams.delete("checkout");
    u.searchParams.delete("session_id");
    u.searchParams.delete("portal");
    window.history.replaceState({}, "", u.pathname + u.search);

    if (checkout === "cancelled") {
      setStripeBanner("Payment cancelled — you remain on the Free plan.");
      return;
    }
    if (portal === "return") {
      setStripeBanner("Returned from Stripe billing. Refreshing your profile…");
      (async () => {
        const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        if (data) {
          setUserProfile(normalizeUserProfile(data));
          setCurrentPlan(membershipTierToPlanTag(data.membership_tier || "free"));
        }
        setStripeBanner("Billing portal closed. Subscription details below should update within a minute.");
      })();
      return;
    }
    if (checkout === "success") {
      (async () => {
        try {
          const { data: authData } = await supabase.auth.getSession();
          const token = authData?.session?.access_token;
          const base = getApiBase();
          if (sessionId && token) {
            const r = await fetch(`${base}/api/sync-checkout-session`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ sessionId }),
            });
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              console.warn("[sync-checkout-session]", j?.error || r.status);
            }
          }
          const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
          if (data) {
            setUserProfile(normalizeUserProfile(data));
            setCurrentPlan(membershipTierToPlanTag(data.membership_tier || "free"));
          }
        } catch (e) {
          console.error(e);
        }
        setStripeBanner(
          "Checkout complete. Tier 1 should unlock automatically; if your plan still shows Free after ~1 minute, refresh this page (Stripe webhooks finalize your profile)."
        );
      })();
    }
  }, [session?.user?.id]);

  // Load color swatches after auth settles (storage.list can stall if called during auth deadlock).
  // Retry when empty so a first-login race doesn't leave the picker blank until logout reload.
  useEffect(() => {
    if (isAuthLoading) {
      console.info("[ECOS swatches] waiting for auth before load");
      return;
    }
    let cancelled = false;
    const flakeKeys = new Set(STOCKED_COLORS.map((c) => makeSwatchKey(c.value)));
    const metallicKeys = new Set(METALLIC_COLOR_OPTIONS.map((c) => makeSwatchKey(c)));
    const solidKeys = new Set(SOLID_COLOR_OPTIONS.map((c) => makeSwatchKey(c)));
    function resolveCatalogKey(fileKey, keySet) {
      if (!fileKey) return null;
      if (keySet.has(fileKey)) return fileKey;
      let best = null;
      for (const key of keySet) {
        if (!key) continue;
        if (fileKey.includes(key) || key.includes(fileKey)) {
          if (!best || key.length > best.length) best = key;
        }
      }
      if (best) return best;
      const trimmed = stripLeadingSkuLooseKey(fileKey);
      if (trimmed && trimmed !== fileKey && trimmed.length < fileKey.length) return resolveCatalogKey(trimmed, keySet);
      return null;
    }
    function resolveCatalogKeyFromFilename(filename, keySet) {
      const normalized = makeSwatchKey(filename);
      const loose = makeSwatchKeyLoose(filename);
      return (
        resolveCatalogKey(normalized, keySet) ||
        resolveCatalogKey(loose, keySet) ||
        resolveCatalogKey(stripLeadingSkuLooseKey(loose), keySet)
      );
    }
    const isRenderableImage = (name = "") => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name);
    async function listFolder(path) {
      const all = [];
      let offset = 0;
      const limit = 1000;
      while (!cancelled) {
        const { data, error } = await supabase.storage.from(SUPABASE_SWATCH_BUCKET).list(path, {
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) {
          if (!cancelled) console.warn("[ECOS swatches] list failed:", path || "/", error.message);
          return { entries: [], error: error.message };
        }
        const chunk = data || [];
        all.push(...chunk);
        if (chunk.length < limit) break;
        offset += limit;
      }
      return { entries: all, error: null };
    }
    function hasFilenameExtension(name = "") {
      return /\.[a-z0-9]{2,8}$/i.test(name);
    }
    function familyFromRelativePath(relPath = "") {
      const p = relPath.toLowerCase();
      if (p.includes("metallic")) return "metallic";
      if (p.includes("solid")) return "solid";
      if (p.includes("flake")) return "flake";
      return null;
    }
    function familyFromPath(pathKey, fileKey) {
      const pl = String(pathKey || "").toLowerCase();
      if (pl.includes("flake")) return "flake";
      if (pl.includes("metallic")) return "metallic";
      if (pl.includes("solid")) return "solid";
      if (flakeKeys.has(fileKey)) return "flake";
      if (metallicKeys.has(fileKey)) return "metallic";
      if (solidKeys.has(fileKey)) return "solid";
      return null;
    }
    function inferFamilyFromCatalogKeys(filename) {
      const mf = resolveCatalogKeyFromFilename(filename, flakeKeys);
      const mm = resolveCatalogKeyFromFilename(filename, metallicKeys);
      const ms = resolveCatalogKeyFromFilename(filename, solidKeys);
      const hits = [
        mf ? ["flake", mf] : null,
        mm ? ["metallic", mm] : null,
        ms ? ["solid", ms] : null,
      ].filter(Boolean);
      if (hits.length === 1) return { family: hits[0][0], mappedKey: hits[0][1] };
      return null;
    }
    async function loadAllSwatches(attempt) {
      const flakeNext = {};
      const metallicNext = {};
      const solidNext = {};
      const queue = [""];
      const visited = new Set();
      let depth = 0;
      let listErrors = 0;

      while (queue.length && depth < 8 && !cancelled) {
        const currentBatch = [...queue];
        queue.length = 0;
        for (const folder of currentBatch) {
          if (visited.has(folder)) continue;
          visited.add(folder);
          const { entries, error } = await listFolder(folder);
          if (error) listErrors += 1;
          for (const entry of entries) {
            if (!entry?.name) continue;
            const path = folder ? `${folder}/${entry.name}` : entry.name;
            const isImageFile = isRenderableImage(entry.name);
            const looksLikeSubfolder = !hasFilenameExtension(entry.name);

            if (!isImageFile && looksLikeSubfolder) {
              queue.push(path);
              continue;
            }
            if (!isImageFile) continue;

            const pathKey = makeSwatchKey(path);
            const fileKey = makeSwatchKey(entry.name);
            let family = familyFromRelativePath(path) || familyFromPath(pathKey, fileKey);
            let mappedFlakeKey = resolveCatalogKeyFromFilename(entry.name, flakeKeys);
            let mappedMetallicKey = resolveCatalogKeyFromFilename(entry.name, metallicKeys);
            let mappedSolidKey = resolveCatalogKeyFromFilename(entry.name, solidKeys);

            if (!family) {
              const inferred = inferFamilyFromCatalogKeys(entry.name);
              if (inferred) {
                family = inferred.family;
                if (family === "flake") mappedFlakeKey = inferred.mappedKey;
                if (family === "metallic") mappedMetallicKey = inferred.mappedKey;
                if (family === "solid") mappedSolidKey = inferred.mappedKey;
              }
            }
            if (!family) continue;

            const { data } = supabase.storage.from(SUPABASE_SWATCH_BUCKET).getPublicUrl(path);
            const encodedPath = path
              .split("/")
              .filter(Boolean)
              .map((s) => encodeURIComponent(s))
              .join("/");
            const url =
              data?.publicUrl ||
              (SUPABASE_URL && encodedPath
                ? `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_SWATCH_BUCKET)}/${encodedPath}`
                : "");
            if (!url) continue;
            if (family === "flake" && mappedFlakeKey) {
              flakeNext[mappedFlakeKey] = url;
              if (fileKey && fileKey !== mappedFlakeKey) flakeNext[fileKey] = url;
            }
            if (family === "metallic" && mappedMetallicKey) {
              metallicNext[mappedMetallicKey] = url;
              if (fileKey && fileKey !== mappedMetallicKey) metallicNext[fileKey] = url;
            }
            if (family === "solid" && mappedSolidKey) {
              solidNext[mappedSolidKey] = url;
              if (fileKey && fileKey !== mappedSolidKey) solidNext[fileKey] = url;
            }
          }
        }
        depth += 1;
      }
      if (cancelled) return null;
      const countHits = (map, set) => [...set].filter((k) => map[k]).length;
      const summary = {
        attempt,
        listErrors,
        hasSession: !!session?.user?.id,
        flakeColors: countHits(flakeNext, flakeKeys),
        metallicColors: countHits(metallicNext, metallicKeys),
        solidColors: countHits(solidNext, solidKeys),
        urls: {
          flake: Object.keys(flakeNext).length,
          metallic: Object.keys(metallicNext).length,
          solid: Object.keys(solidNext).length,
        },
      };
      console.info("[ECOS swatches] mapped", summary);
      setFlakeSwatchUrls(flakeNext);
      setMetallicSwatchUrls(metallicNext);
      setSolidSwatchUrls(solidNext);
      return summary;
    }

    (async () => {
      for (let attempt = 1; attempt <= 3 && !cancelled; attempt += 1) {
        const summary = await loadAllSwatches(attempt);
        if (!summary) return;
        const totalUrls = summary.urls.flake + summary.urls.metallic + summary.urls.solid;
        if (totalUrls > 0 && summary.listErrors === 0) return;
        console.warn("[ECOS swatches] empty or errored — retrying", summary);
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    })();

    return () => {
      cancelled = true;
    };
    // session?.user?.id: re-run after login so authenticated storage policies apply
  }, [isAuthLoading, session?.user?.id]);

  useEffect(() => {
    const state = { ecosApp: true, phase };
    if (window.history.state?.ecosApp) {
      window.history.pushState(state, "");
    } else {
      window.history.replaceState(state, "");
    }
  }, [phase]);

  useEffect(() => {
    const onPopState = (event) => {
      const next = event.state;
      if (next?.ecosApp) {
        if (next.phase && next.phase !== phase) setPhase(next.phase);
        return;
      }
      window.history.pushState({ ecosApp: true, phase }, "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [phase]);

  useEffect(() => {
    if (!userProfile) return;
    const normalized = normalizeUserProfile(userProfile);
    setCurrentPlan(membershipTierToPlanTag(normalized.membership_tier || "free"));
    setContractorPricingTierKey(getEffectiveContractorPricingTierKey(normalized));
    setAssignedPricingTierKey(normalized.assignedPricingTierKey || "msrp");
    setProfileDraft({
      first_name: normalized.first_name || "",
      last_name: normalized.last_name || "",
      company_name: normalized.company_name || "",
    });
  }, [userProfile]);

  useEffect(() => {
    if (phase !== "account" && phase !== "userdb") {
      setSelectedContractorEmail(null);
      setContractorSearchQuery("");
    }
  }, [phase]);

  useEffect(() => {
    if (
      manualSystemKey &&
      answers.location &&
      !isCustomSystemKey(manualSystemKey) &&
      !locationSystems.includes(manualSystemKey)
    ) {
      setManualSystemKey(null);
    }
  }, [manualSystemKey, answers.location, locationSystems]);

  useEffect(() => {
    if (phase === "questions" && answers.finish && recommendedSystem && recommendedSectionRef.current) {
      recommendedSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [answers.finish, phase, recommendedSystem]);

  useEffect(() => {
    if (!activeSystemFamily) return;
    const prevFamily = prevSystemFamilyRef.current;
    if (prevFamily && prevFamily !== activeSystemFamily) {
      setAnswers((prev) => ({
        ...prev,
        color: "",
        ...(activeSystemFamily === "flake" ? {} : { baseCoatColor: activeSystemFamily === "metallic" ? "Black" : "" }),
        ...(activeSystemFamily === "metallic" ? { metallicColors: [], metallicPrimerTint: "Gray" } : { metallicColors: [], metallicPrimerTint: "" }),
      }));
    }
    prevSystemFamilyRef.current = activeSystemFamily;
  }, [activeSystemFamily]);

  useEffect(() => {
    const onResize = () => setIsNarrowScreen(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (phase !== "account" || !currentUser || !isPricingMasterEmail(currentUser, userProfile)) return;
    const me = normalizeUserProfile(allProfilesByEmail[currentUser] || userProfile || {});
    setAdminSelfTierDraft(me.assignedPricingTierKey || "msrp");
    setAdminSelfPlanDraft(membershipTierToPlanTag(me.membership_tier || "free"));
  }, [phase, currentUser, allProfilesByEmail, userProfile]);

  useEffect(() => {
    if (phase !== "userdb" || !selectedContractorEmail) {
      setContractorAdminDraft(null);
      return;
    }
    const prof = normalizeUserProfile(allProfilesByEmail[selectedContractorEmail] || {});
    setContractorAdminDraft({
      isFgpCustomer: !!prof.isFgpCustomer,
      contractorPricingApplicationReceived: !!prof.contractorPricingApplicationReceived,
      assignedPricingTierKey: prof.assignedPricingTierKey || "msrp",
      planTag: membershipTierToPlanTag(prof.membership_tier || "free"),
    });
  }, [phase, selectedContractorEmail, allProfilesByEmail]);

  async function handleSubmitOrder() {
    if (!results || !recommendedSystem || !combinedTotals) return;
    if (poUsage.atLimit) return;
    if (activeSystemFamily === "flake" && baseCoatDeviatesFromFlakeRecommendation(answers.color, answers.baseCoatColor)) {
      const pick = answers.baseCoatColor || "this base coat color";
      const recs = getRecommendedBaseCoatLabels(answers.color);
      const recHint = recs.length ? ` Recommended for this flake: ${recs.join(" or ")}.` : "";
      const ok = window.confirm(
        `Are you sure you want "${pick}" as the base coat color?${recHint}`
      );
      if (!ok) return;
    }
    console.info("[ECOS submit] start", {
      hasSession: !!session?.user?.id,
      hasProfile: !!userProfile?.id,
      membershipTier,
      jobs: orderJobs.length + 1,
    });
    const jobsForPo = [...orderJobs, currentJobSnapshot].filter(Boolean).map((j) => ({
      jobNamePo: j.jobNamePo || contractorName || "Untitled Job / PO",
      address: j.address || jobName || "—",
      systemCode: j.systemCode || recommendedSystem.code,
      systemLabel: j.systemLabel || recommendedSystem.label,
      sqFt: j.sf,
      totalTier: j.totalTier,
      totalMsrp: j.totalMsrp,
      totalDiscount: j.totalDiscount,
      color: j.color,
      costPerSqFt: j.requiredMaterialCostPerSqFt,
      orderLines: j.orderLines || [],
    }));
    const body = buildFgOrderEmailBody({
      jobs: jobsForPo,
      tierLabel: TIERS[contractorPricingTierKey].label,
      tierMult: TIERS[contractorPricingTierKey].mult,
      combinedOrderLines,
      totalMsrp: combinedTotals.totalMsrp,
      totalDiscount: combinedTotals.totalDiscount,
      totalTier: combinedTotals.totalTier,
      requiredMaterialTierTotal: combinedTotals.requiredMaterialTierTotal,
      totalSqFt: combinedTotals.totalSqFt,
    });
    const subject = `ECOS order — ${jobsForPo.length} job(s) — $${Number(combinedTotals.totalTier || 0).toFixed(2)}`;
    setSubmittedDraft({
      subject,
      body,
      jobNamePo: jobsForPo.map((j) => j.jobNamePo).join(" + ") || "Untitled Job / PO",
      address: jobsForPo.map((j) => j.address).join(" | ") || "—",
      systemCode: recommendedSystem.code,
      systemLabel: recommendedSystem.label,
      totalTier: combinedTotals.totalTier,
      sqFt: combinedTotals.totalSqFt,
      costPerSqFt:
        combinedTotals.totalSqFt > 0
          ? +(combinedTotals.requiredMaterialTierTotal / combinedTotals.totalSqFt).toFixed(2)
          : 0,
      jobs: jobsForPo,
      combinedOrderLines,
      totalMsrp: combinedTotals.totalMsrp,
      totalDiscount: combinedTotals.totalDiscount,
      isCustom: !!recommendedSystem.isCustom,
      orderId: null,
      vendorPoSentAt: null,
    });
    setVendorPoStatus("");
    const isCustomQuote = !!recommendedSystem.isCustom;
    setOrderSubmitMessage(isCustomQuote ? "Saving custom system order…" : "Sending PO to FGP Midwest...");
    try {
      if (!isCustomQuote) {
        try {
          const sendRes = await fetch("/api/send-po", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, body }),
          });
          if (!sendRes.ok) {
            const sendErr = await sendRes.json().catch(() => ({}));
            throw new Error(sendErr?.error || "PO email send failed.");
          }
          setOrderSubmitMessage("PO sent to orders@fgpmidwest.com.");
        } catch (sendErr) {
          setOrderSubmitMessage("Could not send PO automatically. Opening email app fallback.");
          openFgOrderEmail(body, subject);
          console.error("[ECOS submit] email error", sendErr);
        }
      } else {
        setOrderSubmitMessage("Custom system order saved — generate vendor POs below.");
      }
      if (session?.user?.id) {
        const jobs = jobsForPo;
        const orderRecord = {
          user_id: session.user.id,
          created_at: new Date().toISOString(),
          job_name: jobs.map((j) => j.jobNamePo).join(" + ") || "Untitled Job / PO",
          address: jobs.map((j) => j.address).filter(Boolean).join(" | ") || "—",
          system_code: recommendedSystem.code,
          total_cost: combinedTotals.totalTier,
          sq_footage: combinedTotals.totalSqFt,
          cost_per_sqft:
            combinedTotals.totalSqFt > 0
              ? +(combinedTotals.requiredMaterialTierTotal / combinedTotals.totalSqFt).toFixed(2)
              : 0,
          order_lines: combinedOrderLines,
          jobs,
          is_custom_system: isCustomQuote,
        };
        const { data: inserted, error } = await supabase.from("orders").insert(orderRecord).select().single();
        if (error) {
          console.error("[ECOS submit] orders insert failed", error);
          window.alert(error.message || "Unable to save order to cloud history.");
        } else {
          setSubmittedDraft((prev) => (prev ? { ...prev, orderId: inserted.id } : prev));
          const nextHistory = [inserted, ...poHistory];
          setPoHistory(nextHistory);
          const nextCount = (poUsage.count || 0) + 1;
          setPoCountThisYear(nextCount);
          const start = getAnniversaryWindowStart(userProfile?.po_year_start_date || userProfile?.signup_anniversary_date).toISOString();
          const now = new Date();
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1).toISOString();
          const totalQuarter = nextHistory
            .filter((o) => (o.created_at || "") >= quarterStart)
            .reduce((sum, o) => sum + Number(o.total_cost || o.totalTier || 0), 0);
          const totalYear = nextHistory
            .filter((o) => (o.created_at || "") >= start)
            .reduce((sum, o) => sum + Number(o.total_cost || o.totalTier || 0), 0);
          try {
            await updateProfileFields({
              annual_po_count: nextCount,
              pos_submitted_this_year: nextCount,
              total_pos_value_this_quarter: totalQuarter,
              total_pos_value_this_year: totalYear,
            });
          } catch (profileErr) {
            console.error("[ECOS submit] profile counters update failed", profileErr);
          }
        }
      } else {
        console.warn("[ECOS submit] no session user — skipped orders insert");
      }
      setOrderJobs([]);
    } finally {
      // Always show confirmation even if history/profile updates fail after Gary was emailed.
      showAppSuccessToast();
      setPhase("submitted");
      console.info("[ECOS submit] done → submitted phase");
    }
  }

  function getVendorGroupsForDraft(draft = submittedDraft) {
    if (!draft?.isCustom) return [];
    return groupLinesByVendor(draft.combinedOrderLines || [], contractorVendors);
  }

  function downloadVendorPoForGroup(group) {
    const draft = submittedDraft;
    if (!draft || !group) return;
    const contractorDisplay =
      [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(" ") ||
      userProfile?.company_name ||
      currentUser ||
      "Contractor";
    openVendorPoPrint({
      contractorName: contractorDisplay,
      companyName: userProfile?.company_name || contractorDisplay,
      vendorName: group.vendorName,
      vendorEmail: group.vendorEmail,
      jobName: draft.jobNamePo,
      address: draft.address,
      systemName: draft.systemLabel || draft.systemCode,
      sqFt: draft.sqFt,
      lines: group.lines,
      sentAt: draft.vendorPoSentAt,
    });
  }

  async function emailVendorPoForGroup(group) {
    const draft = submittedDraft;
    if (!draft || !group?.vendorEmail) {
      window.alert("This vendor group has no email. Add a vendor email in My Floor Systems → Vendors.");
      return;
    }
    const contractorDisplay =
      [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(" ") ||
      userProfile?.company_name ||
      currentUser ||
      "Contractor";
    const subject = `PO — ${userProfile?.company_name || contractorDisplay}`;
    const body = buildVendorPoText({
      contractorName: contractorDisplay,
      companyName: userProfile?.company_name || contractorDisplay,
      vendorName: group.vendorName,
      vendorEmail: group.vendorEmail,
      jobName: draft.jobNamePo,
      address: draft.address,
      systemName: draft.systemLabel || draft.systemCode,
      sqFt: draft.sqFt,
      lines: group.lines,
    });
    setVendorPoSending(true);
    setVendorPoStatus("");
    try {
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Session expired — log in again.");
      const res = await fetch("/api/send-vendor-po", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          orderId: draft.orderId || null,
          subject,
          body,
          vendorName: group.vendorName,
          vendorEmail: group.vendorEmail,
          contractorName: userProfile?.company_name || contractorDisplay,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not email vendor PO.");
      const sentAt = json.vendor_po_sent_at || new Date().toISOString();
      setSubmittedDraft((prev) =>
        prev
          ? {
              ...prev,
              vendorPoSentAt: sentAt,
              vendorName: group.vendorName,
              vendorEmail: group.vendorEmail,
            }
          : prev
      );
      setVendorPoStatus(json.message || `Order sent to ${group.vendorName} on ${new Date(sentAt).toLocaleString()}`);
    } catch (e) {
      setVendorPoStatus(e?.message || "Vendor email failed.");
    } finally {
      setVendorPoSending(false);
    }
  }

  async function handleForgotPassword() {
    setAuthError("");
    setAuthNotice("");
    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthError("Enter your email first, then click Forgot password.");
      return;
    }
    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      setAuthError(error.message);
      return;
    }
    setAuthNotice("Password reset email sent. Open it and follow the link to set a new password.");
  }

  function handleDuplicateSavedOrder(orderRecord) {
    if (currentPlan === "Free") {
      const shouldUpgrade = window.confirm(
        "Duplicate order is a paid feature. Pick a plan to unlock it?"
      );
      if (shouldUpgrade) goToPlans("account");
      return;
    }
    setContractorName(orderRecord.jobNamePo || "");
    setJobName(orderRecord.address || "");
    setSqFt(orderRecord.sqFt ? String(orderRecord.sqFt) : "");
    setPhase("questions");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleArchiveCartJob(index) {
    setOrderJobs((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddAnotherJobToOrder() {
    if (!results || !recommendedSystem) return;
    if (orderJobs.length + 1 >= maxActiveJobs) {
      if (membershipTier === "free") {
        const wantsUpgrade = window.confirm("Upgrade to Tier 1 to save up to 10 jobs.");
        if (wantsUpgrade) setPhase("plans");
      }
      return;
    }
    setOrderJobs((prev) => [
      ...prev,
      {
        ...results,
        jobNamePo: contractorName || "Untitled Job / PO",
        address: jobName || "—",
        systemCode: recommendedSystem.code,
        systemLabel: recommendedSystem.label,
        color: answers.color || "—",
      },
    ]);
    startNextJobInOrder();
  }

  async function handleAuthSubmit() {
    setAuthError("");
    setAuthNotice("");
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;
    if (authMode !== "reset" && (!email || !password)) {
      setAuthError("Enter email and password.");
      return;
    }
    if (authMode === "reset") {
      if (!password) {
        setAuthError("Enter a new password.");
        return;
      }
      if (password !== authConfirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setAuthNotice("Password updated. You can now log in.");
      setAuthMode("login");
      setAuthPassword("");
      setAuthConfirmPassword("");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (authMode === "create") {
      if (!authFirstName.trim() || !authLastName.trim() || !authCompanyName.trim()) {
        setAuthError("Enter first name, last name, and company name.");
        return;
      }
      if (password !== authConfirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
      if (!authAgreedLegal) {
        setAuthError("You must agree to the Terms and Privacy Policy.");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            first_name: authFirstName.trim(),
            last_name: authLastName.trim(),
            company_name: authCompanyName.trim(),
          },
        },
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      if (data.session) {
        await ensureProfileForSession(data.session, {
          first_name: authFirstName.trim(),
          last_name: authLastName.trim(),
          company_name: authCompanyName.trim(),
          membership_tier: "free",
        });
        setPhase("plans");
      } else {
        setAuthNotice("Check your email to confirm your account before logging in.");
        setAuthMode("login");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        return;
      }
    }
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthFirstName("");
    setAuthLastName("");
    setAuthCompanyName("");
    setAuthAgreedLegal(false);
  }

  async function handleLogout() {
    setHeaderMenuOpen(false);
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } finally {
      // Clear any persisted supabase auth cache to prevent sticky sessions.
      try {
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
          .forEach((k) => window.localStorage.removeItem(k));
      } catch {
        // ignore
      }
      setSession(null);
      setCurrentUser(null);
      setUserProfile(null);
      setAllProfilesByEmail({});
      setPhase("questions");
      reset();
      window.location.assign("/");
    }
  }

  async function handleFallbackLogout() {
    await handleLogout();
  }

  async function handleSaveProfileBasics() {
    await updateProfileFields({
      first_name: profileDraft.first_name.trim(),
      last_name: profileDraft.last_name.trim(),
      company_name: profileDraft.company_name.trim(),
    });
    setIsEditingProfile(false);
  }

  /** Tier 1+ Job Card: checklist, landscape, 2 cards/page (kit sizes from quote / PRODUCTS). */
  function printJobCard(orderRecord) {
    if (membershipTier === "free") {
      const upgrade = window.confirm("Job Card printing is a Tier 1 feature. View plans?");
      if (upgrade) setPhase("plans");
      return;
    }
    const company =
      userProfile?.company_name ||
      [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(" ") ||
      "";
    openJobCardPrint({
      ...orderRecord,
      company_name: orderRecord.company_name || company,
      first_name: orderRecord.first_name || userProfile?.first_name,
      last_name: orderRecord.last_name || userProfile?.last_name,
      customer_name: orderRecord.customer_name || company || undefined,
      submittedAt: orderRecord.submittedAt || orderRecord.created_at || new Date().toISOString(),
    });
  }

  /** Print Job Card from the live results quote (before or after submit). */
  function printJobCardFromQuote() {
    if (!results || !recommendedSystem || !combinedTotals) return;
    const jobs = [...orderJobs, currentJobSnapshot].filter(Boolean).map((j) => ({
      jobNamePo: j.jobNamePo || contractorName || "Untitled Job / PO",
      address: j.address || jobName || "—",
      systemCode: j.systemCode || recommendedSystem.code,
      sqFt: j.sf,
      orderLines: j.orderLines || [],
    }));
    printJobCard({
      job_name: jobs.map((j) => j.jobNamePo).join(" + ") || "Untitled Job / PO",
      address: jobs.map((j) => j.address).filter(Boolean).join(" | ") || "—",
      system_code: recommendedSystem.code,
      sq_footage: combinedTotals.totalSqFt,
      order_lines: combinedOrderLines || results.orderLines || [],
      jobs,
      created_at: new Date().toISOString(),
    });
  }

  /** Condensed one-page Print/Save PO for the results screen (fits letter). */
  function printConsolidatedPo() {
    if (!results || !recommendedSystem || !combinedTotals) return;
    const jobs = [...orderJobs, currentJobSnapshot].filter(Boolean);
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return;
    const jobRows = jobs
      .map(
        (j, i) =>
          `<tr>
            <td>${i + 1}</td>
            <td>${j.jobNamePo || "—"}</td>
            <td>${j.systemCode || "—"}</td>
            <td class="num">${Number(j.sf || 0).toLocaleString()}</td>
            <td class="num">$${Number(j.totalTier || 0).toFixed(2)}</td>
          </tr>`
      )
      .join("");
    const materialRows = (combinedOrderLines || [])
      .map(
        (l) =>
          `<tr>
            <td>${l.product}</td>
            <td>${l.kitSize}</td>
            <td class="num">${l.qty}</td>
            <td>${l.totalNeeded}</td>
            <td class="num">$${Number(l.lineTier || 0).toFixed(2)}</td>
          </tr>`
      )
      .join("");
    win.document.write(`
      <html>
        <head>
          <title>ECOS PO — ${jobs.length} job(s)</title>
          <style>
            @page { size: letter; margin: 0.4in; }
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; font-size: 10px; }
            h1 { margin: 0 0 2px; font-size: 15px; }
            .meta { margin: 0 0 8px; color: #333; font-size: 10px; }
            h2 { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #222; padding-bottom: 2px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            th, td { border: 1px solid #ccc; padding: 2px 4px; vertical-align: top; }
            th { background: #f0f0f0; text-align: left; font-size: 9px; text-transform: uppercase; }
            .num { text-align: right; white-space: nowrap; }
            .totals { width: auto; margin-left: auto; }
            .totals td { border: none; padding: 1px 0 1px 16px; font-size: 11px; }
            .totals .pay { font-weight: 700; font-size: 12px; }
            .note { font-size: 9px; color: #444; margin-top: 6px; }
          </style>
        </head>
        <body>
          <h1>ECOS Material PO — ${jobs.length} job(s)</h1>
          <div class="meta">
            ${new Date().toLocaleString()} · Tier: ${TIERS[contractorPricingTierKey].label}
            · Total area: ${Number(combinedTotals.totalSqFt || 0).toLocaleString()} ft²
          </div>
          <h2>Jobs</h2>
          <table>
            <thead><tr><th>#</th><th>Job / PO</th><th>System</th><th>Sq Ft</th><th>Pays</th></tr></thead>
            <tbody>${jobRows}</tbody>
          </table>
          <h2>Consolidated materials (order these)</h2>
          <table>
            <thead><tr><th>Product</th><th>Kit</th><th>Qty</th><th>Needs</th><th>Line</th></tr></thead>
            <tbody>${materialRows || "<tr><td colspan='5'>No lines</td></tr>"}</tbody>
          </table>
          <table class="totals">
            <tr><td>Total MSRP</td><td class="num">$${Number(combinedTotals.totalMsrp || 0).toFixed(2)}</td></tr>
            <tr><td>Total discount</td><td class="num">−$${Number(combinedTotals.totalDiscount || 0).toFixed(2)}</td></tr>
            <tr class="pay"><td>Contractor pays</td><td class="num">$${Number(combinedTotals.totalTier || 0).toFixed(2)}</td></tr>
          </table>
          <div class="note">Enter consolidated lines at MSRP in Square, then apply a single discount equal to Total discount.</div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <div style={{ ...S.app, background: `linear-gradient(180deg, ${activeTheme.tint} 0%, #000000 42%)` }}>
      {settingsToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            background: "#e33433",
            color: "#ffffff",
            padding: "12px 22px",
            borderRadius: 8,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 900,
            fontSize: 13,
            letterSpacing: "0.04em",
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          {settingsToast}
        </div>
      )}
      {appSuccessToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: settingsToast ? 70 : 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10050,
            maxWidth: "min(520px, calc(100vw - 24px))",
            background: "#166534",
            color: "#ffffff",
            padding: "14px 18px",
            borderRadius: 8,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            lineHeight: 1.4,
            textAlign: "center",
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
            border: "1px solid #86efac",
          }}
        >
          {appSuccessToast}
        </div>
      )}
      {systemCutawayModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${systemCutawayModal.code} system cutaway`}
          style={{ ...S.modalOverlay, zIndex: 10060, background: "rgba(0,0,0,0.9)", padding: 12 }}
          onClick={() => setSystemCutawayModal(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSystemCutawayModal(null);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 960,
              background: "#0a1830",
              border: "1px solid #113a72",
              borderRadius: 12,
              padding: 12,
              boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", fontFamily: "'Montserrat', sans-serif" }}>
                  {systemCutawayModal.code}
                </div>
                <div style={{ fontSize: 11, color: "#9bb2d1" }}>{systemCutawayModal.label}</div>
              </div>
              <button type="button" style={S.btnSm} onClick={() => setSystemCutawayModal(null)}>
                Close
              </button>
            </div>
            <img
              src={systemCutawayModal.url}
              alt={`${systemCutawayModal.code} full system cutaway`}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: "min(80vh, 900px)",
                objectFit: "contain",
                background: "#000",
                borderRadius: 8,
              }}
            />
          </div>
        </div>
      )}

      {checkoutOverlay && (
        <div style={{ ...S.modalOverlay, zIndex: 10001, background: "rgba(0,0,0,0.88)" }}>
          <div
            style={{
              ...S.modalCard,
              maxWidth: 420,
              border: "1px solid #e33433",
              background: "linear-gradient(180deg, #0a1830 0%, #000000 100%)",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9bb2d1", fontFamily: "'Encode Sans Expanded', sans-serif", marginBottom: 8 }}>
              Epoxy Twins · ECOS
            </div>
            <div style={{ fontSize: 18, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 8 }}>
              Tier 1 — The Calculator
            </div>
            <div style={{ fontSize: 12, color: "#d2def1", lineHeight: 1.5, marginBottom: 14, fontFamily: "'Open Sans', sans-serif" }}>
              {checkoutOverlay.message || "Preparing secure checkout…"}
            </div>
            {checkoutOverlay.status === "loading" ? (
              <div style={{ ...S.btn, width: "100%", marginTop: 0, opacity: 0.85, cursor: "wait", textAlign: "center" }}>
                Redirecting to Stripe…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ color: "#fca5a5", fontSize: 11, marginBottom: 4 }}>{checkoutOverlay.message}</div>
                <button type="button" style={{ ...S.btn, width: "100%", marginTop: 0 }} onClick={() => startTier1Checkout()}>
                  Try again
                </button>
                <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setCheckoutOverlay(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <div style={S.header}>
        <button
          type="button"
          style={{ ...S.logo, border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
          onClick={() => {
            setHeaderMenuOpen(false);
            reset();
          }}
          title="Home"
        >
          <img
            src={HEADER_LOGO_URL}
            alt="Epoxy Twins"
            style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 6 }}
          />
        </button>
        <div>
          <div style={S.brand}>Epoxy Flooring Material Calculator</div>
          <div style={S.title}>Project Materials Planner + 1-step Ordering</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 9, color: "#d2def1", textAlign: "right", fontFamily: "'Encode Sans Expanded', sans-serif" }}>
          <div style={{ color: "#ffffff", fontWeight: 900 }}>An Epoxy Twins Product</div>
          {session?.user && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 700 }}>
                  {userProfile?.first_name || "User"} · {userProfile?.company_name || "No Company"}
                </div>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 9,
                    fontWeight: 900,
                    color: "#fff",
                    background:
                      (userProfile?.membership_tier || "free") === "tier2"
                        ? "#eab308"
                        : (userProfile?.membership_tier || "free") === "tier1"
                          ? "#2563eb"
                          : "#6b7280",
                  }}
                >
                  {membershipTierToPlanTag(userProfile?.membership_tier || "free")}
                </span>
                <button
                  type="button"
                  style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 10, padding: "3px 6px", cursor: "pointer" }}
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  title="Menu"
                >
                  ☰ Menu
                </button>
              </div>
              {headerMenuOpen && (
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{ background: "transparent", border: "1px solid #e33433", color: "#fff", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer", fontWeight: 900 }}
                    onClick={goNewJobQuote}
                  >
                    NEW JOB QUOTE
                  </button>
                  <button
                    type="button"
                    style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      goToPlans(phase);
                    }}
                  >
                    Plans
                  </button>
                  {(membershipTier === "tier1" || membershipTier === "tier2") && (
                    <button
                      type="button"
                      style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setPhase("orders");
                      }}
                    >
                      My Orders
                    </button>
                  )}
                  {membershipTier === "tier2" && (
                    <button
                      type="button"
                      style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setPhase("floor-systems");
                        void loadCustomFloorData(session);
                      }}
                    >
                      My Floor Systems
                    </button>
                  )}
                  {membershipTier === "tier2" && (
                    <button
                      type="button"
                      style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setPhase("customer-quotes");
                      }}
                    >
                      Customer Quotes
                    </button>
                  )}
                  <button
                    type="button"
                    style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setPhase("account");
                    }}
                  >
                    My Account
                  </button>
                  <button
                    type="button"
                    style={{ background: "transparent", border: "1px solid #9bb2d1", color: "#d2def1", borderRadius: 4, fontSize: 9, padding: "3px 6px", cursor: "pointer" }}
                    onClick={handleLogout}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={S.body}>
        {stripeBanner && (
          <div
            style={{
              ...S.alert("warning"),
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <span>{stripeBanner}</span>
            <button type="button" style={{ ...S.btnSm, flexShrink: 0 }} onClick={() => setStripeBanner("")}>
              Dismiss
            </button>
          </div>
        )}
        {isAuthLoading && (
          <div style={S.authWrap}>
            <div style={S.authCard}>
              <div style={S.authTitle}>Loading account...</div>
            </div>
          </div>
        )}
        {!isAuthLoading && !currentUser && (
          <div style={S.authWrap}>
            <div style={S.authCard}>
              <div style={S.authTitle}>Welcome to ECOS</div>
              <div style={S.authSub}>
                {authMode === "reset" ? "Set your new password." : "Create an account or login to continue."}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" style={S.opt(authMode === "login")} onClick={() => setAuthMode("login")}>Login</button>
                <button type="button" style={S.opt(authMode === "create")} onClick={() => setAuthMode("create")}>Create Account</button>
                <button type="button" style={S.opt(authMode === "reset")} onClick={() => setAuthMode("reset")}>Reset Password</button>
              </div>
              <form
                style={{ display: "grid", gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAuthSubmit();
                }}
              >
                {authMode !== "reset" && (
                  <input style={S.input} placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} autoComplete="email" />
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    style={{ ...S.input, flex: 1 }}
                    type={authShowPassword ? "text" : "password"}
                    placeholder={authMode === "reset" ? "New password" : "Password"}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  />
                  <button
                    type="button"
                    style={S.btnSm}
                    onClick={() => setAuthShowPassword((v) => !v)}
                    title={authShowPassword ? "Hide password" : "Show password"}
                  >
                    {authShowPassword ? "🙈" : "👁"}
                  </button>
                </div>
                {authMode === "create" && (
                  <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        style={{ ...S.input, flex: 1 }}
                        type={authShowConfirmPassword ? "text" : "password"}
                        placeholder="Confirm password"
                        value={authConfirmPassword}
                        onChange={(e) => setAuthConfirmPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        style={S.btnSm}
                        onClick={() => setAuthShowConfirmPassword((v) => !v)}
                        title={authShowConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      >
                        {authShowConfirmPassword ? "🙈" : "👁"}
                      </button>
                    </div>
                    <input style={S.input} placeholder="First name" value={authFirstName} onChange={(e) => setAuthFirstName(e.target.value)} />
                    <input style={S.input} placeholder="Last name" value={authLastName} onChange={(e) => setAuthLastName(e.target.value)} />
                    <input style={S.input} placeholder="Company name" value={authCompanyName} onChange={(e) => setAuthCompanyName(e.target.value)} />
                    <label style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.45, display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" checked={authAgreedLegal} onChange={(e) => setAuthAgreedLegal(e.target.checked)} style={{ marginTop: 2 }} />
                      <span>
                        I agree to the{" "}
                        <a href="https://contractors.floorguardproductsmidwest.com/terms-of-service-7261" target="_blank" rel="noreferrer" style={{ color: "#f5d676" }}>
                          Terms of Service
                        </a>{" "}
                        and{" "}
                        <a href="https://contractors.floorguardproductsmidwest.com/privacy-policy-fgpmidwest" target="_blank" rel="noreferrer" style={{ color: "#f5d676" }}>
                          Privacy Policy
                        </a>
                        .
                      </span>
                    </label>
                  </>
                )}
                {authMode === "reset" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      style={{ ...S.input, flex: 1 }}
                      type={authShowConfirmPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={authConfirmPassword}
                      onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      style={S.btnSm}
                      onClick={() => setAuthShowConfirmPassword((v) => !v)}
                      title={authShowConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      {authShowConfirmPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                )}
                {authNotice && (
                  <div
                    style={{
                      color: "#f5d676",
                      background: "rgba(234, 179, 8, 0.12)",
                      border: "1px solid #eab308",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {authNotice}
                  </div>
                )}
                {authError && <div style={{ color: "#fca5a5", fontSize: 11 }}>{authError}</div>}
                <button type="submit" style={S.btn}>
                  {authMode === "login" ? "Login" : authMode === "create" ? "Create Account" : "Set New Password"}
                </button>
                {authMode === "login" && (
                  <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={handleForgotPassword}>
                    Forgot password?
                  </button>
                )}
              </form>
            </div>
          </div>
        )}

        {shouldShowContractorPricingReminder && (
          <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.12)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 5 }}>
              Unlock contractor pricing
            </div>
            <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5, marginBottom: 8 }}>
              You're currently on MSRP pricing. Apply for contractor pricing to unlock discounted material tiers once approved by FGP Midwest.
            </div>
            <a
              href={CONTRACTOR_PRICING_APP_URL}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#f5d676", fontSize: 11, fontFamily: "'Montserrat', sans-serif", fontWeight: 900, textDecoration: "underline" }}
            >
              Apply for contractor pricing →
            </a>
          </div>
        )}

        {currentUser && phase === "questions" && (
          <>
            {(membershipTier === "free" || membershipTier === "tier1") && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(227, 52, 51, 0.35)",
                  background: "rgba(17, 58, 114, 0.45)",
                  fontSize: 11,
                  color: "#d2def1",
                  lineHeight: 1.45,
                }}
              >
                Don&apos;t like our systems? Build your own in{" "}
                <button
                  type="button"
                  onClick={() => goToPlans("questions")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    color: "#f5d676",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "inherit",
                    fontWeight: 700,
                  }}
                >
                  Tier 2
                </button>
              </div>
            )}
            <div
              style={{
                marginBottom: 14,
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid rgba(155, 178, 209, 0.28)",
                background: "rgba(10, 24, 48, 0.55)",
                fontSize: 11,
                color: "#9bb2d1",
                lineHeight: 1.45,
              }}
            >
              Know what you need? Head to{" "}
              <button
                type="button"
                onClick={() => setPhase("orders")}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  color: "#f5d676",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "inherit",
                  fontWeight: 700,
                }}
              >
                My Orders
              </button>{" "}
              in the Menu
            </div>

            {/* Tier + Job Info */}
            <div style={S.sectionHead}>Job Setup</div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: isNarrowScreen ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Job Name / PO #</div>
                  <input style={S.input} value={contractorName} onChange={e => setContractorName(e.target.value)} placeholder="e.g. Smith Flooring Co." />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Address</div>
                  <input style={S.input} value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. 123 Main St Garage" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isNarrowScreen ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Contractor pricing (FGP Midwest)</div>
                  <div style={{ ...S.input, display: "flex", alignItems: "center", minHeight: 38 }}>
                    <span style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>{TIERS[contractorPricingTierKey].label}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: "#9bb2d1" }}>
                    New accounts default to <strong>MSRP</strong> pricing. Higher discount tiers are unlocked by FGP Midwest based on your purchasing volume.
                  </div>
                  {pricingElevatedPending && (
                    <div style={{ marginTop: 6, fontSize: 10, color: "#fbbf24", lineHeight: 1.45 }}>
                      Assigned rate card: {TIERS[assignedPricingTierKey].label} · awaiting FGP Midwest activation — quotes use {TIERS[contractorPricingTierKey].label} until then.
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Square Footage</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      style={{ ...S.input, flex: 1 }}
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="done"
                      autoComplete="off"
                      value={sqFt}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.]/g, "");
                        const parts = raw.split(".");
                        const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
                        setSqFt(cleaned);
                      }}
                      placeholder="e.g. 800"
                    />
                    <button
                      type="button"
                      style={S.btnSm}
                      title="Area calculator (sq/ft, m², yd²)"
                      onClick={() => {
                        setCalcValue(sqFt);
                        setCalcUnit("sqft");
                        setShowAreaCalc(true);
                      }}
                    >
                      Calc
                    </button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, color: "#9bb2d1" }}>
                    Type square feet directly, or tap Calc for m² / yd² conversion.
                  </div>
                </div>
              </div>
            </div>

            {/* Decision Questions */}
            <div style={S.sectionHead}>Where is the Floor?</div>
            <div style={S.sectionSub}>
              This determines coating chemistry - polyurea vs epoxy base, UV stability, and cure specs.
            </div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {LOCATION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    style={S.locationOpt(answers.location === option.value)}
                    onClick={() => answer("location", option.value)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 20 }}>{option.icon}</span>
                      <span style={{ fontSize: 15, fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>{option.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#d2def1" }}>{option.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={S.sectionHead}>Finish Type</div>
            <div style={S.sectionSub}>
              Select the look/performance target first, then ECOS recommends the best-fit system.
            </div>
            <div style={S.card}>
              <div style={S.optRow}>
                {finishOptionsForPlan.map((option) => {
                  const isLockedFinish = isFreePlan && !FREE_UNLOCKED_FINISHES.has(option.value);
                  return (
                    <button
                      key={option.value}
                      style={{
                        ...S.opt(answers.finish === option.value),
                        opacity: isLockedFinish ? 0.45 : 1,
                        position: "relative",
                      }}
                      onClick={() => {
                        if (isLockedFinish) {
                          setPhase("plans");
                          return;
                        }
                        handleFinishTypeSelect(option.value);
                      }}
                    >
                      {option.label}
                      {isLockedFinish ? " 🔒 Unlock Tier 1" : ""}
                    </button>
                  );
                })}
              </div>
              {finishTypeError && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#fca5a5" }}>{finishTypeError}</div>
              )}
            </div>

            {recommendedSystem && (
              <>
                <div ref={recommendedSectionRef} style={S.sectionHead}>Recommended System</div>
                {isRecommendedSystemLocked ? (
                  <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(15, 36, 64, 0.88)" }}>
                    <div style={S.badge}>System Locked</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4, fontFamily: "'Montserrat', sans-serif" }}>
                      {recommendedSystem.code}
                    </div>
                    <div style={{ fontSize: 13, color: "#d2def1", marginBottom: 10 }}>{recommendedSystem.label}</div>
                    <div style={{ fontSize: 12, color: "#f5d676", marginBottom: 10 }}>
                      This system requires Tier 1 — The Calculator. Upgrade to unlock all 8 ET flooring systems.
                    </div>
                    <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("plans")}>
                      Upgrade to unlock
                    </button>
                  </div>
                ) : (
                  <div style={{ ...S.card, border: `1px solid ${activeTheme.accent}`, background: "rgba(15, 36, 64, 0.88)" }}>
                    <div style={S.badge}>Recommended System</div>
                    {(() => {
                      const cutawayUrl = recommendedSystem.cutawayImage;
                      const showCutaway =
                        !!cutawayUrl &&
                        !cutawayImgFailed[activeSystemKey] &&
                        isRenderableSwatchUrl(cutawayUrl);
                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: isNarrowScreen ? "column" : "row",
                            gap: 12,
                            alignItems: "stretch",
                          }}
                        >
                          <div style={{ flex: showCutaway ? "1 1 60%" : "1 1 100%", minWidth: 0 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4, fontFamily: "'Montserrat', sans-serif" }}>
                              {recommendedSystem.isCustom ? recommendedSystem.label : recommendedSystem.code}
                              {recommendedSystem.isCustom && (
                                <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 8 }}>
                                  CUSTOM
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 13, color: "#d2def1", marginBottom: 6 }}>
                              {recommendedSystem.isCustom ? "Your custom floor system" : recommendedSystem.label}
                            </div>
                            {!recommendedSystem.isCustom && (
                              <div style={{ fontSize: 12, color: "#ffffff", marginBottom: 10 }}>
                                {getRecommendationReason(answers, activeSystemKey)}
                              </div>
                            )}
                            {activeSystemBenchmarkPerSqFt !== null && (
                              <div style={{ marginBottom: 8, maxWidth: showCutaway ? "100%" : 420 }}>
                                <div style={{ fontSize: 12, color: "#eab308", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
                                  Avg materials @ {SYSTEM_BENCHMARK_SQFT} ft²: ${activeSystemBenchmarkPerSqFt.toFixed(2)}/ft²
                                </div>
                                <div style={{ fontSize: 10, color: "#eab308" }}>
                                  {benchmarkDisclaimer}
                                </div>
                              </div>
                            )}
                            <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                              <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9bb2d1", marginBottom: 6, fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                                System notes
                              </div>
                              {recommendedSystem.warnings.map((w, i) => (
                                <div key={i} style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.45, marginBottom: 6 }}>{w}</div>
                              ))}
                            </div>
                          </div>
                          {showCutaway && (
                            <button
                              type="button"
                              onClick={() =>
                                setSystemCutawayModal({
                                  url: cutawayUrl,
                                  code: recommendedSystem.code,
                                  label: recommendedSystem.label,
                                })
                              }
                              title="View full system cutaway"
                              style={{
                                flex: isNarrowScreen ? "0 0 auto" : "0 0 40%",
                                maxWidth: isNarrowScreen ? "100%" : "40%",
                                alignSelf: isNarrowScreen ? "stretch" : "center",
                                padding: 0,
                                margin: 0,
                                border: "1px solid rgba(255,255,255,0.2)",
                                borderRadius: 8,
                                overflow: "hidden",
                                background: "#0a1830",
                                cursor: "zoom-in",
                                display: "block",
                              }}
                            >
                              <img
                                src={cutawayUrl}
                                alt={`${recommendedSystem.code} system cutaway`}
                                loading="lazy"
                                decoding="async"
                                onLoad={() => {
                                  console.info("[cutaway] load success", {
                                    systemKey: activeSystemKey,
                                    url: cutawayUrl,
                                  });
                                }}
                                onError={() => {
                                  console.error("[cutaway] load error / fetch failed", {
                                    systemKey: activeSystemKey,
                                    url: cutawayUrl,
                                  });
                                  setCutawayImgFailed((prev) => ({ ...prev, [activeSystemKey]: true }));
                                }}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  height: "auto",
                                  maxHeight: isNarrowScreen ? 180 : 220,
                                  objectFit: "contain",
                                  objectPosition: "center",
                                  background: "#0a1830",
                                }}
                              />
                              <div
                                style={{
                                  fontSize: 9,
                                  letterSpacing: "0.1em",
                                  textTransform: "uppercase",
                                  color: "#9bb2d1",
                                  padding: "4px 6px 6px",
                                  textAlign: "center",
                                  fontFamily: "'Encode Sans Expanded', sans-serif",
                                }}
                              >
                                Tap to enlarge
                              </div>
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div style={S.sectionHead}>Refine Recommendation</div>
                <div style={S.sectionSub}>Answer the below to improve floor system recommendation</div>
                <div style={S.card}>
                  {shouldAskUseType && (
                    <>
                      <div style={{ fontSize: 11, color: "#d2def1", marginBottom: 6 }}>Use Type</div>
                      <div style={S.optRow}>
                        {["residential", "commercial"].map((type) => (
                          <button key={type} style={S.opt(answers.use === type)} onClick={() => answer("use", type)}>
                            {type === "residential" ? "Residential" : "Commercial"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div style={{ fontSize: 11, color: "#d2def1", marginBottom: 6, marginTop: shouldAskUseType ? 14 : 0 }}>Moisture Risk</div>
                  <div style={S.optRow}>
                    {[
                      { value: "none", label: "None" },
                      { value: "moderate", label: "Moderate" },
                      { value: "high", label: "High" },
                    ].map((m) => (
                      <button key={m.value} style={S.opt(answers.moisture === m.value)} onClick={() => answer("moisture", m.value)}>
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ fontSize: 11, color: "#d2def1", marginBottom: 6, marginTop: 14 }}>Visible Cracks / Defects</div>
                  <div style={S.optRow}>
                    {[
                      { value: "no", label: "No" },
                      { value: "yes", label: "Yes" },
                    ].map((c) => (
                      <button key={c.value} style={S.opt(answers.cracks === c.value)} onClick={() => answer("cracks", c.value)}>
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {shouldAskOdorConcern && (
                    <>
                      <div style={{ fontSize: 11, color: "#d2def1", marginBottom: 6, marginTop: 14 }}>
                        Indoor odors / vapors a concern?
                      </div>
                      <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 6, lineHeight: 1.4 }}>
                        If yes and cracks need repair, quote uses HyperCURE (low-odor) instead of Patch Pro 10X.
                      </div>
                      <div style={S.optRow}>
                        {[
                          { value: "no", label: "No" },
                          { value: "yes", label: "Yes" },
                        ].map((o) => (
                          <button key={o.value} style={S.opt(answers.odorConcern === o.value)} onClick={() => answer("odorConcern", o.value)}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div style={S.sectionHead}>Other Available {answers.location === "interior" ? "Indoor" : "Outdoor"} Systems</div>
                {otherLocationSystems.length > 0 && (
                  <div style={S.card}>
                    {otherLocationSystems.map((key) => {
                      const isReleaseSystem = ACTIVE_RELEASE_SYSTEMS.has(key);
                      const isLocked = isFreePlan && !FREE_UNLOCKED_SYSTEMS.has(key);
                      const benchmarkPerSqFt = getSystemMaterialBenchmarkPerSqFt(
                        key,
                        contractorPricingTierKey,
                        answers,
                        speed
                      );
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            if (isLocked) {
                              goToPlans("questions");
                              return;
                            }
                            setManualSystemKey(key);
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: `1px solid ${manualSystemKey === key ? CATEGORY_THEME[getSystemCategory(key)].accent : "#113a72"}`,
                            borderLeft: `6px solid ${CATEGORY_THEME[getSystemCategory(key)].accent}`,
                            background: CATEGORY_THEME[getSystemCategory(key)].tint,
                            borderRadius: 8,
                            padding: "10px 10px",
                            marginBottom: 8,
                            cursor: isLocked ? "not-allowed" : "pointer",
                            opacity: isLocked ? 0.5 : 1,
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 3 }}>
                            {SYSTEMS[key].code} - {SYSTEMS[key].label}
                          </div>
                          {isReleaseSystem && benchmarkPerSqFt !== null && (
                            <div style={{ fontSize: 10, color: "#eab308", marginBottom: 2 }}>
                              Avg materials @ {SYSTEM_BENCHMARK_SQFT} ft²: ${benchmarkPerSqFt.toFixed(2)}/ft²
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: isLocked ? "#f5d676" : "#d2def1" }}>
                            {isLocked ? "🔒 Unlock Tier 1" : "Tap to use this system instead"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {membershipTier !== "tier2" && (() => {
                  const isTier1 = membershipTier === "tier1";
                  const canUpgrade = membershipTier === "free";
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (canUpgrade) goToPlans("questions");
                      }}
                      disabled={isTier1}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        marginTop: otherLocationSystems.length > 0 ? 8 : 0,
                        border: "1px solid #4b5563",
                        borderLeft: "6px solid #6b7280",
                        background: "rgba(55, 65, 81, 0.35)",
                        borderRadius: 8,
                        padding: "12px 12px",
                        cursor: isTier1 ? "not-allowed" : "pointer",
                        opacity: isTier1 ? 0.45 : 0.9,
                        filter: isTier1 ? "grayscale(0.35)" : "none",
                      }}
                    >
                      <div style={{ fontSize: 12, color: isTier1 ? "#9ca3af" : "#d1d5db", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, lineHeight: 1.4 }}>
                        Don't like our systems? Build your own in Tier 2 — Upgrade to unlock custom system builder
                      </div>
                      <div style={{ fontSize: 10, color: canUpgrade ? "#f5d676" : "#9ca3af", marginTop: 4 }}>
                        {isTier1
                          ? "🔒 Locked on Tier 1 — upgrade to Tier 2 to unlock"
                          : "Tap to view Tier 2 upgrade options →"}
                      </div>
                    </button>
                  );
                })()}
                {membershipTier === "tier2" && customFloorSystems.length > 0 && (
                  <>
                    <div style={{ ...S.sectionHead, marginTop: 16 }}>My Custom Systems</div>
                    <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 8 }}>
                      Select a saved system to use in this quote.
                    </div>
                    {customFloorSystems.map((sys) => {
                      const key = `CUSTOM-${sys.id}`;
                      const selected = activeSystemKey === key;
                      return (
                        <button
                          key={sys.id}
                          type="button"
                          onClick={() => setManualSystemKey(key)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: `1px solid ${selected ? "#eab308" : "#113a72"}`,
                            borderLeft: "6px solid #eab308",
                            background: selected ? "rgba(234, 179, 8, 0.12)" : "rgba(15, 36, 64, 0.88)",
                            borderRadius: 8,
                            padding: "10px 10px",
                            marginBottom: 8,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 3 }}>
                            {sys.name}{" "}
                            <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>
                              CUSTOM
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: "#d2def1" }}>
                            {(sys.layers || []).length} layer(s) · Tap to use
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
              </>
            )}

            {/* Outdoor speed selector */}
            {answers.location === "exterior" && activeSystemKey === "FLK-OD-RES" && (
              <div style={S.card}>
                <div style={S.question}>Polyurea basecoat speed?</div>
                <div style={S.optRow}>
                  {["slow", "medium", "fast"].map(s => (
                    <button key={s} style={S.opt(speed === s)} onClick={() => setSpeed(s)}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#9bb2d1", marginTop: 6 }}>Slow = hot days · Medium = standard · Fast = cold days</div>
              </div>
            )}

            {recommendedSystem && !isCustomActive && (
              <>
                <div style={S.sectionHead}>Color Selection</div>
                <div style={S.sectionSub}>
                  {activeSystemFamily === "metallic"
                    ? "Mica / Metallic color options"
                    : activeSystemFamily === "solid"
                      ? "Solid color options"
                      : "Below are our Stocked Colors"}
                </div>
                {activeSystemFamily === "metallic" && (
                  <div style={{ fontSize: 11, color: "#d2def1", marginBottom: 10 }}>
                    Select up to 4 metallic pigments. You currently have {metallicSelectedColors.length} selected.
                  </div>
                )}
                <div style={S.card}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: swatchGridColumns,
                      gap: 8,
                    }}
                  >
                    {visibleColorOptions.map((color) => (
                      <button
                        key={color.value}
                        style={S.colorBtn(activeSystemFamily === "metallic" ? metallicSelectedColors.includes(color.value) : answers.color === color.value)}
                        onClick={() => (activeSystemFamily === "metallic" ? toggleMetallicColor(color.value) : answer("color", color.value))}
                      >
                        <div>
                          {isRenderableSwatchUrl(color.swatchUrl) ? (
                            <div
                              style={{
                                width: "100%",
                                height: 84,
                                borderRadius: 6,
                                border: "1px solid rgba(255,255,255,0.35)",
                                overflow: "hidden",
                                marginBottom: 8,
                                background: "#0a1830",
                              }}
                            >
                              <img
                                alt=""
                                src={color.swatchUrl}
                                draggable={false}
                                decoding="async"
                                loading="eager"
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  objectPosition: "center",
                                  /** Many flake PNGs have extra transparent margin — zoom clips so product fills tile. */
                                  transform: activeSystemFamily === "flake" ? "scale(1.28)" : "scale(1)",
                                  transformOrigin: "center center",
                                  display: "block",
                                  WebkitUserSelect: "none",
                                  userSelect: "none",
                                }}
                              />
                            </div>
                          ) : (
                            <span
                              style={{
                                width: "100%",
                                height: 84,
                                borderRadius: 6,
                                background: color.hex || "#374151",
                                border: "1px solid rgba(255,255,255,0.35)",
                                display: "block",
                                marginBottom: 8,
                              }}
                            />
                          )}
                          <div style={{ fontSize: 12, fontFamily: "'Montserrat', sans-serif", fontWeight: 900, color: color.textColor || "#ffffff", overflowWrap: "anywhere" }}>
                            {color.value}
                          </div>
                          {activeSystemFamily === "flake" && (
                            <div style={{ fontSize: 10, color: "#d2def1", marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                              {isNarrowScreen ? "Rec. base coat:" : "Recommended Base Coat Color:"}{" "}
                              {color.recommendedBase}
                            </div>
                          )}
                          {activeSystemFamily === "metallic" && (
                            <div style={{ fontSize: 10, color: "#d2def1", marginTop: 2, lineHeight: 1.35 }}>
                              {metallicSelectedColors.includes(color.value) ? "Selected" : "Tap to select"}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {activeSystemFamily === "metallic" && (
                  <>
                    <div style={S.sectionSub}>Base Color Options</div>
                    <div style={S.card}>
                      <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 6 }}>HyperPRIME MVB primer tint</div>
                      <div style={{ fontSize: 10, color: "#d2def1", marginBottom: 8 }}>
                        Our standard primer (will be covered by base coat - we prefer Gray)
                      </div>
                      <div style={{ ...S.optRow, marginBottom: 10 }}>
                        {METALLIC_PRIMER_TINT_OPTIONS.map((tint) => (
                          <button key={tint} type="button" style={S.opt(answers.metallicPrimerTint === tint)} onClick={() => answer("metallicPrimerTint", tint)}>
                            {tint}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 6 }}>
                        Base coat color (recommended: Black, use White for light floor designs)
                      </div>
                      <div style={{ ...S.optRow, marginBottom: 2 }}>
                        {METALLIC_BASE_COAT_OPTIONS.map((baseColor) => {
                          const match = BASE_COAT_COLOR_OPTIONS.find((c) => c.value === baseColor);
                          return (
                            <button
                              key={baseColor}
                              type="button"
                              style={{
                                ...S.opt(answers.baseCoatColor === baseColor),
                                background: match?.hex || "#111827",
                                color: match?.textColor || "#ffffff",
                                border: answers.baseCoatColor === baseColor ? "2px solid #e33433" : "1px solid rgba(255,255,255,0.2)",
                              }}
                              onClick={() => answer("baseCoatColor", baseColor)}
                            >
                              {baseColor}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                {activeSystemFamily === "flake" && (
                  <>
                    <div style={S.sectionSub}>Base Coat Color Options</div>
                    <div style={S.card}>
                      <div style={S.optRow}>
                        {BASE_COAT_COLOR_OPTIONS.map((baseColor) => (
                          <button
                            key={baseColor.value}
                            style={{
                              ...S.opt(answers.baseCoatColor === baseColor.value),
                              background: baseColor.hex,
                              color: baseColor.textColor,
                              border: answers.baseCoatColor === baseColor.value ? "2px solid #e33433" : "1px solid rgba(255,255,255,0.2)",
                            }}
                            onClick={() => answer("baseCoatColor", baseColor.value)}
                          >
                            {baseColor.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {readyForQuote && (
              <button style={{ ...S.btn, background: activeTheme.accent }} onClick={() => setPhase("results")}>
                Generate Material List + PO →
              </button>
            )}
            {!readyForQuote && recommendedSystem && (
              <div style={{ fontSize: 11, color: "#9bb2d1", marginTop: 10 }}>
                {isCustomActive
                  ? "Enter square footage to generate a material list for this custom system."
                  : isRecommendedSystemLocked
                    ? "This recommendation is locked on Free. Upgrade to Tier 1 to continue with this system."
                    : "Complete refine answers, basecoat speed (outdoor), and color selection to continue."}
              </div>
            )}
          </>
        )}

        {currentUser && phase === "results" && results && recommendedSystem && (
          <>
            <div style={{ fontSize: 22, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 10 }}>
              ORDER SUMMARY
            </div>
            {cartJobsForDisplay.length > 0 && (
              <>
                <div style={S.sectionHead}>Order Cart</div>
                {cartJobsForDisplay.map((job, idx) => {
                  const theme = CATEGORY_THEME[getSystemCategory(job.systemCode)];
                  return (
                    <div
                      key={`${job.jobNamePo}-${idx}`}
                      style={{
                        ...S.card,
                        border: `1px solid ${theme.accent}`,
                        borderLeft: `6px solid ${theme.accent}`,
                        background: theme.tint,
                      }}
                    >
                      <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                        Job {idx + 1}
                      </div>
                      <div style={{ fontSize: 15, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
                        {job.jobNamePo}
                      </div>
                      <div style={{ fontSize: 11, color: "#d2def1", marginTop: 2 }}>
                        {job.systemCode}, {job.sf.toLocaleString()} sq/ft
                      </div>
                      <div style={{ fontSize: 11, color: "#d2def1", marginTop: 2 }}>
                        Color: {job.color || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "#d2def1", marginTop: 6, lineHeight: 1.45 }}>
                        {compactJobLineSummary(job.orderLines)}
                        {job.orderLines.length > 4 ? ", ..." : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#ffffff", marginTop: 6 }}>
                        Order Total: <span style={{ fontWeight: 900 }}>${job.totalTier.toFixed(2)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#eab308", marginTop: 4 }}>
                        ${job.requiredMaterialCostPerSqFt.toFixed(2)}/ft²
                      </div>
                      <button
                        type="button"
                        style={{ ...S.btnSm, marginTop: 8, borderColor: "#9bb2d1", color: "#d2def1" }}
                        onClick={() => handleArchiveCartJob(idx)}
                      >
                        Archive job
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            {/* Summary header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
              <div />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={S.btnSm} onClick={() => setPhase("questions")}>← Go Back</button>
                <button style={S.btnSm} onClick={reset}>Start Over</button>
              </div>
            </div>

            <div
              style={{
                border: `1px solid ${activeTheme.accent}`,
                borderLeft: `6px solid ${activeTheme.accent}`,
                background: activeTheme.tint,
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                Job {orderJobs.length + 1}
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", marginBottom: 2 }}>
                {contractorName || "Untitled Job / PO"}
              </div>
              <div style={{ fontSize: 12, color: "#d2def1" }}>
                {recommendedSystem.code} - {recommendedSystem.label}
              </div>
              <div style={{ fontSize: 11, color: "#d2def1", marginTop: 2 }}>
                Color: {answers.color || "—"}
              </div>
              <div style={{ fontSize: 11, color: "#9bb2d1", marginTop: 5 }}>
                {results.sf.toLocaleString()} ft² · {TIERS[contractorPricingTierKey].label}
              </div>
              <div style={{ fontSize: 11, color: "#eab308", marginTop: 4 }}>
                ${results.requiredMaterialCostPerSqFt.toFixed(2)}/ft²
              </div>
              {activeSystemBenchmarkPerSqFt !== null && (
                <div style={{ fontSize: 10, color: "#eab308", marginTop: 4, lineHeight: 1.4 }}>
                  Avg materials @ {SYSTEM_BENCHMARK_SQFT} ft²: ${activeSystemBenchmarkPerSqFt.toFixed(2)}/ft²
                  <br />
                  {benchmarkDisclaimer}
                </div>
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9bb2d1", marginBottom: 6, fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                  System notes
                </div>
                {recommendedSystem.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.45, marginBottom: 6 }}>{w}</div>
                ))}
              </div>
            </div>

            {/* Material Order Table */}
            <div style={S.sectionHead}>{contractorName || "Untitled Job / PO"}</div>
            <div style={{ ...S.card, padding: 0 }}>
              {isNarrowScreen && (
                <div style={{ fontSize: 10, color: "#64748b", padding: "10px 14px 0", lineHeight: 1.4 }}>
                  Swipe sideways to see all columns — rows stay one line tall for easier scanning.
                </div>
              )}
              <div style={S.tableOrderWrap}>
                <table style={S.tableOrder}>
                  <thead>
                    <tr>
                      <th style={S.thOrder}>Product</th>
                      <th style={S.thOrder}>Layer</th>
                      <th style={S.thOrder}>Kit Size</th>
                      <th style={S.thOrder}>Qty</th>
                      <th style={S.thOrder}>Job Needs</th>
                      <th style={S.thOrder}>MSRP ea</th>
                      <th style={S.thOrder}>Your Price</th>
                      <th style={S.thOrder}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.orderLines.map((line, i) => (
                      <tr key={i}>
                        <td style={S.tdOrderBold}>{line.product}</td>
                        <td style={S.tdOrderLayer}>{line.layer}</td>
                        <td style={S.tdOrder}>{line.kitSize}</td>
                        <td style={S.tdOrderBold}>{line.qty}</td>
                        <td style={S.tdOrderMuted}>{line.totalNeeded}</td>
                        <td style={S.tdOrder}>${line.msrpEa.toFixed(2)}</td>
                        <td style={{ ...S.tdOrder, color: "#e33433" }}>${line.tierEa.toFixed(2)}</td>
                        <td style={S.tdOrderBold}>${line.lineTier.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={S.totalRow}>
                      <td colSpan={5} style={{ ...S.tdOrder, color: "#d2def1", fontSize: 11 }}>SUBTOTAL AT MSRP</td>
                      <td colSpan={3} style={S.tdOrderBold}>${results.totalMsrp.toFixed(2)}</td>
                    </tr>
                    <tr style={S.totalRow}>
                      <td colSpan={5} style={{ ...S.tdOrder, color: "#e33433", fontSize: 11 }}>TOTAL DISCOUNT ({TIERS[contractorPricingTierKey].label})</td>
                      <td colSpan={3} style={{ ...S.tdOrderBold, color: "#e33433" }}>-${results.totalDiscount.toFixed(2)}</td>
                    </tr>
                    <tr style={{ ...S.totalRow, background: "#0a1f38" }}>
                      <td colSpan={5} style={{ ...S.tdOrderBold, color: "#ffffff", fontSize: 13 }}>CONTRACTOR PAYS</td>
                      <td colSpan={3} style={{ ...S.tdOrderBold, color: "#ffffff", fontSize: 15 }}>${results.totalTier.toFixed(2)}</td>
                    </tr>
                    <tr style={{ ...S.totalRow, background: "#0a1830" }}>
                      <td colSpan={5} style={{ ...S.tdOrderWrap, color: "#eab308", fontSize: 11 }}>
                        Job Materials Cost Breakdown. $/ft² on {results.sf.toLocaleString()} Based on Job Requirements, not total order volume
                      </td>
                      <td colSpan={3} style={{ ...S.tdOrderBold, color: "#eab308", fontSize: 14 }}>
                        {results.sf > 0 ? `$${results.requiredMaterialCostPerSqFt.toFixed(2)}/ft²` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {totalJobsInOrder > 1 && combinedTotals && (
              <>
                <div style={S.sectionHeadGold}>CONSOLIDATED PO - WHAT TO ORDER</div>
                <div style={{ ...S.sectionSub, color: "#f5d676" }}>
                  Kit sizes optimized across all ({totalJobsInOrder} total jobs entered) jobs
                </div>
                <div style={{ ...S.cardGold, padding: 0 }}>
                  {isNarrowScreen && (
                    <div style={{ fontSize: 10, color: "#78716c", padding: "10px 14px 0", lineHeight: 1.4 }}>
                      Swipe sideways to see all columns.
                    </div>
                  )}
                  <div style={S.tableOrderWrap}>
                    <table style={S.tableOrder}>
                      <thead>
                        <tr>
                          <th style={S.thOrder}>Product</th>
                          <th style={S.thOrder}>Kit Size</th>
                          <th style={S.thOrder}>Qty</th>
                          <th style={S.thOrder}>Combined Job Needs</th>
                          <th style={S.thOrder}>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedOrderLines.map((line, i) => (
                          <tr key={i}>
                            <td style={S.tdOrderBold}>{line.product}</td>
                            <td style={S.tdOrder}>{line.kitSize}</td>
                            <td style={S.tdOrderBold}>{line.qty}</td>
                            <td style={S.tdOrderMuted}>{line.totalNeeded}</td>
                            <td style={S.tdOrderBold}>${line.lineTier.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr style={{ ...S.totalRow, background: "rgba(234, 179, 8, 0.15)" }}>
                          <td colSpan={4} style={{ ...S.tdOrderBold, color: "#f5d676" }}>CONSOLIDATED CONTRACTOR PAYS</td>
                          <td style={{ ...S.tdOrderBold, color: "#f5d676" }}>${combinedTotals.totalTier.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                disabled={totalJobsInOrder >= maxActiveJobs}
                style={{
                  ...S.btnSm,
                  width: "100%",
                  background: "#113a72",
                  color: "#ffffff",
                  border: "1px solid #113a72",
                  opacity: totalJobsInOrder >= maxActiveJobs ? 0.65 : 1,
                  cursor: totalJobsInOrder >= maxActiveJobs ? "not-allowed" : "pointer",
                }}
                onClick={handleAddAnotherJobToOrder}
              >
                Add Another Job to Order
              </button>
              {totalJobsInOrder >= maxActiveJobs && (
                <>
                  <div style={{ fontSize: 11, color: "#9bb2d1", textAlign: "center" }}>
                    {membershipTier === "tier1"
                      ? "Tier 1 limit: 10 active jobs. Archive or submit to add more."
                      : `Free plan limit reached (${MAX_FREE_JOBS} jobs max).`}
                  </div>
                  {membershipTier === "free" && (
                    <button
                      type="button"
                      style={{ ...S.btnSm, width: "100%", border: "1px solid #eab308", color: "#f5d676", background: "rgba(234, 179, 8, 0.1)" }}
                      onClick={() => setPhase("plans")}
                    >
                      Upgrade plan to add more jobs
                    </button>
                  )}
                </>
              )}
              <button type="button" style={{ ...S.btn, background: activeTheme.accent, marginTop: 0 }} onClick={printConsolidatedPo}>
                Print / Save PO
              </button>
              {membershipTier === "free" ? (
                <button type="button" style={{ ...S.hookDisabled, width: "100%" }} disabled>
                  Print Job Card (Upgrade to Tier 1, The Calculator)
                </button>
              ) : (
                <button type="button" style={{ ...S.btnSm, width: "100%", borderColor: "#9bb2d1" }} onClick={printJobCardFromQuote}>
                  Print Job Card
                </button>
              )}
              {/*
                ROADMAP — Tier 2 "The Estimator": CFO-backed profit tool. Inputs: material line list + tier $ from this
                screen (results.orderLines, combinedOrderLines, requiredMaterialTierTotal / costPer ft²), sell price &
                labor assumptions from Estimator. Output: margin $, margin %, profit per job / consolidated PO.
                Implement calculateJobProfit(...) and enable when currentPlan / subscription includes Estimator.
              */}
              <button type="button" style={{ ...S.hookDisabled, width: "100%" }} disabled>
                Calculate profit (Upgrade to Tier 2 — The Estimator)
              </button>
              {membershipTier === "tier1" && poCounterLabel && (
                <div style={{ fontSize: 11, color: poUsage.atLimit ? "#fca5a5" : poUsage.atWarning ? "#f5d676" : "#9bb2d1", textAlign: "center" }}>
                  {poCounterLabel}
                </div>
              )}
              {membershipTier === "tier1" && poUsage.atLimit && (
                <div style={{ ...S.card, border: "1px solid #e33433", background: "rgba(227, 52, 51, 0.12)", padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#fca5a5", fontWeight: 900, marginBottom: 6 }}>PO limit reached</div>
                  <button type="button" style={{ ...S.btnSm, width: "100%", borderColor: "#e33433", color: "#fff" }} onClick={() => setPhase("plans")}>
                    Upgrade to Tier 2 for unlimited
                  </button>
                </div>
              )}
              <button
                type="button"
                style={{ ...S.btn, background: "#e33433", marginTop: 0, opacity: poUsage.atLimit ? 0.55 : 1, cursor: poUsage.atLimit ? "not-allowed" : "pointer" }}
                onClick={handleSubmitOrder}
                disabled={poUsage.atLimit}
              >
                {recommendedSystem?.isCustom ? "Submit Custom System Order" : "Submit Order to FGP Midwest"}
              </button>
            </div>
          </>
        )}

        {currentUser && phase === "submitted" && submittedDraft && (
          <>
            <div style={S.sectionHead}>Order Submitted</div>
            <div style={{ ...S.card, border: "1px solid #22c55e", background: "rgba(34, 197, 94, 0.12)" }}>
              <div style={{ fontSize: 18, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 6 }}>
                THANK YOU
              </div>
              <div style={{ fontSize: 14, color: "#d2def1", lineHeight: 1.6, marginBottom: 10 }}>
                ✅ Order submitted! We'll send you an invoice to pay shortly. Questions? Call 502-640-2394
              </div>
              {orderSubmitMessage && (
                <div style={{ fontSize: 12, color: "#f5d676", marginBottom: 10 }}>{orderSubmitMessage}</div>
              )}
              <div style={{ fontSize: 12, color: "#d2def1", lineHeight: 1.6 }}>
                <div><span style={{ color: "#9bb2d1" }}>Job / PO #:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.jobNamePo}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Address:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.address}</span></div>
                <div>
                  <span style={{ color: "#9bb2d1" }}>System:</span>{" "}
                  <span style={{ color: "#ffffff" }}>{submittedDraft.systemLabel || submittedDraft.systemCode}</span>
                  {submittedDraft.isCustom && (
                    <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 6 }}>
                      CUSTOM
                    </span>
                  )}
                </div>
                <div><span style={{ color: "#9bb2d1" }}>Sq Ft:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.sqFt.toLocaleString()} ft²</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Total:</span> <span style={{ color: "#ffffff" }}>${submittedDraft.totalTier.toFixed(2)}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Cost / ft²:</span> <span style={{ color: "#eab308" }}>${submittedDraft.costPerSqFt.toFixed(2)}/ft²</span></div>
              </div>
            </div>

            {submittedDraft.isCustom && (
              <div style={{ ...S.card, border: "1px solid #113a72", marginTop: 4 }}>
                <div style={{ fontSize: 13, color: "#fff", fontWeight: 900, marginBottom: 6 }}>Vendor POs</div>
                <div style={{ fontSize: 11, color: "#9bb2d1", marginBottom: 10, lineHeight: 1.45 }}>
                  Download a printable PDF or email the PO directly to each vendor. Contractor name is front & center; ECOS branding is in the footer.
                </div>
                {getVendorGroupsForDraft(submittedDraft).map((group) => (
                  <div key={group.vendorId || "none"} style={{ borderTop: "1px solid #113a72", padding: "10px 0" }}>
                    <div style={{ fontSize: 12, color: "#fff", fontWeight: 900 }}>{group.vendorName}</div>
                    <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 8 }}>
                      {group.vendorEmail || "No email on file"} · {group.lines.length} line(s)
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" style={S.btnSm} onClick={() => downloadVendorPoForGroup(group)}>
                        Download PDF
                      </button>
                      <button
                        type="button"
                        style={{ ...S.btnSm, borderColor: "#e33433", color: "#fff" }}
                        disabled={vendorPoSending || !group.vendorEmail}
                        onClick={() => void emailVendorPoForGroup(group)}
                      >
                        {vendorPoSending ? "Sending…" : "Email to vendor"}
                      </button>
                    </div>
                  </div>
                ))}
                {vendorPoStatus && (
                  <div style={{ marginTop: 10, fontSize: 11, color: /sent/i.test(vendorPoStatus) ? "#86efac" : "#fca5a5" }}>
                    {vendorPoStatus}
                  </div>
                )}
                {submittedDraft.vendorPoSentAt && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#86efac" }}>
                    PO sent to vendor on {new Date(submittedDraft.vendorPoSentAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {membershipTier !== "tier2" && (
              <UpgradeUpsell
                variant="calculator-submit"
                btnSmStyle={S.btnSm}
                onUpgrade={() => goToPlans("submitted")}
              />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                style={{ ...S.btnSm, width: "100%", borderColor: "#9bb2d1" }}
                onClick={() =>
                  setViewingOrder({
                    id: submittedDraft.orderId,
                    job_name: submittedDraft.jobNamePo,
                    address: submittedDraft.address,
                    system_code: submittedDraft.systemCode,
                    system_label: submittedDraft.systemLabel,
                    sq_footage: submittedDraft.sqFt,
                    total_cost: submittedDraft.totalTier,
                    order_lines: submittedDraft.combinedOrderLines,
                    is_custom_system: submittedDraft.isCustom,
                    vendor_po_sent_at: submittedDraft.vendorPoSentAt,
                    vendor_name: submittedDraft.vendorName,
                    created_at: new Date().toISOString(),
                  })
                }
              >
                View Order
              </button>
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("orders")}>
                My Orders
              </button>
              <button type="button" style={{ ...S.btn, background: "#e33433", marginTop: 0 }} onClick={reset}>
                Start a New Order
              </button>
              {membershipTier === "free" ? (
                <button
                  type="button"
                  style={S.hookDisabled}
                  disabled
                >
                  Print Job Card (Upgrade to Tier 1, The Calculator)
                </button>
              ) : (
                <button
                  type="button"
                  style={{ ...S.btnSm, width: "100%", borderColor: "#9bb2d1" }}
                  onClick={() =>
                    printJobCard({
                      ...submittedDraft,
                      job_name: submittedDraft.jobNamePo,
                      system_code: submittedDraft.systemCode,
                      sq_footage: submittedDraft.sqFt,
                      order_lines: submittedDraft.combinedOrderLines || [],
                      jobs: submittedDraft.jobs || [],
                      created_at: new Date().toISOString(),
                    })
                  }
                >
                  Print Job Card
                </button>
              )}
              <button
                type="button"
                style={S.hookDisabled}
                disabled
              >
                Customer-Ready Estimate PDF (Upgrade to Tier 2, The Estimator)
              </button>
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => goToPlans("submitted")}>
                Upgrade Plans
              </button>
            </div>
          </>
        )}

        {currentUser && (phase === "account" || phase === "userdb") && (
          <>
            {phase === "userdb" && (
              <div style={{ marginBottom: 12 }}>
                <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("account")}>
                  ← Back to account
                </button>
              </div>
            )}
            {isCurrentUserPricingMaster && (
              <div
                style={{
                  background: "rgba(234, 179, 8, 0.15)",
                  border: "2px solid #eab308",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 4 }}>
                  You are logged in as an ECOS pricing admin
                </div>
                <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5 }}>
                  Approval flow: all new users start MSRP-only. Tag FGP customers, mark pricing application received, then assign the right contractor tier.
                </div>
              </div>
            )}
            {!isCurrentUserPricingMaster && pricingElevatedPending && (
              <div style={{ ...S.card, border: "1px solid #fbbf24", marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "#fbbf24", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 4 }}>
                  Contractor pricing not active yet
                </div>
                <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5 }}>
                  Quotes remain MSRP until your account is tagged as FGP Midwest and your pricing application is marked received.
                </div>
              </div>
            )}
            <div style={S.sectionHead}>My Account</div>
            <div style={S.card}>
              <div style={{ fontSize: 16, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 6 }}>
                {userProfile?.first_name || "User"} {userProfile?.last_name || ""} · {currentUser}
              </div>
              <div style={{ fontSize: 12, color: "#d2def1", lineHeight: 1.6 }}>
                <div><span style={{ color: "#9bb2d1" }}>ECOS app plan:</span> <span style={{ color: "#ffffff" }}>{currentPlan}</span></div>
                {membershipTier === "tier1" && activeUserProfile?.grace_period_start && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#fca5a5", lineHeight: 1.45 }}>
                    Payment issue: your subscription is past due. Check your email for reminders, then use <strong>Manage Billing</strong> below to update your card.
                  </div>
                )}
                {membershipTier === "tier1" && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                    <div style={{ fontSize: 10, color: "#9bb2d1", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                      Stripe subscription
                    </div>
                    <div>
                      <span style={{ color: "#9bb2d1" }}>Status:</span>{" "}
                      <span style={{ color: "#ffffff" }}>{activeUserProfile?.subscription_status || "—"}</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: "#9bb2d1" }}>Next billing:</span>{" "}
                      <span style={{ color: "#ffffff" }}>
                        {activeUserProfile?.subscription_current_period_end
                          ? new Date(activeUserProfile.subscription_current_period_end).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => openStripeCustomerPortal()}>
                        Manage Billing
                      </button>
                    </div>
                  </div>
                )}
                <div><span style={{ color: "#9bb2d1" }}>POs used this year:</span> <span style={{ color: "#ffffff" }}>{poCounterLabel || `${poCountThisYear}`}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>PO year started:</span> <span style={{ color: "#ffffff" }}>{new Date((userProfile?.po_year_start_date || userProfile?.signup_anniversary_date || Date.now())).toLocaleDateString()}</span></div>
                {!isCurrentUserPricingMaster && !activeUserProfile?.contractorPricingApplicationReceived && (
                  <div style={{ marginTop: 4, fontSize: 10, color: "#f5d676", lineHeight: 1.45 }}>
                    Apply for contractor pricing to get the most out of your account and material pricing.{" "}
                    <a
                      href={CONTRACTOR_PRICING_APP_URL}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#f5d676", textDecoration: "underline", fontWeight: 700 }}
                    >
                      Apply now
                    </a>
                  </div>
                )}
                <div>
                  <span style={{ color: "#9bb2d1" }}>Contractor pricing tier (FGP Midwest):</span>{" "}
                  <span style={{ color: "#ffffff" }}>{TIERS[contractorPricingTierKey].label}</span>
                  {pricingElevatedPending && (
                    <span style={{ color: "#fbbf24" }}>
                      {" "}
                      (assigned {TIERS[assignedPricingTierKey].label} — pricing gate incomplete, quotes stay MSRP)
                    </span>
                  )}
                </div>
                {isCurrentUserPricingMaster && (
                  <div style={{ fontSize: 10, color: "#9bb2d1", marginTop: 3, lineHeight: 1.45 }}>
                    Admin: tag contractors as FGP Midwest / pricing-app received under <strong>User database</strong> (not here). Use <strong>Testing mode</strong> below only to simulate <em>your</em> app plan and assigned buying tier.
                  </div>
                )}
                <div style={{ fontSize: 10, color: "#9bb2d1", marginTop: 6 }}>
                  ECOS subscription and contractor material pricing are separate: app plans can be upgraded anytime; FGP contractor pricing appears only after manual contractor approval from FGP Midwest.
                </div>
                <div><span style={{ color: "#9bb2d1" }}>Billing:</span> <span style={{ color: "#ffffff" }}>Card on file ending in {activeUserProfile?.billing_last4 || "— — — —"}</span></div>
                <div>
                  <button type="button" style={S.btnSm} onClick={() => setShowBillingHistory((v) => !v)}>
                    {showBillingHistory ? "Hide billing history" : "View billing history"}
                  </button>
                </div>
                {showBillingHistory && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "#9bb2d1", lineHeight: 1.5 }}>
                    {activeUserProfile?.billing_history?.length
                      ? activeUserProfile.billing_history.map((b, i) => (
                          <div key={i}>• {b.date || "—"} · {b.description || "Subscription"} · ${Number(b.amount || 0).toFixed(2)}</div>
                        ))
                      : "No previous billing records yet."}
                  </div>
                )}
              </div>
              {!isEditingProfile ? (
                <div style={{ marginTop: 10 }}>
                  <button type="button" style={S.btnSm} onClick={() => setIsEditingProfile(true)}>
                    Edit profile
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <input
                    style={S.input}
                    value={profileDraft.first_name}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, first_name: e.target.value }))}
                    placeholder="First name"
                  />
                  <input
                    style={S.input}
                    value={profileDraft.last_name}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, last_name: e.target.value }))}
                    placeholder="Last name"
                  />
                  <input
                    style={S.input}
                    value={profileDraft.company_name}
                    onChange={(e) => setProfileDraft((p) => ({ ...p, company_name: e.target.value }))}
                    placeholder="Company name"
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={S.btnSm} onClick={() => setIsEditingProfile(false)}>
                      Cancel
                    </button>
                    <button type="button" style={S.btn} onClick={handleSaveProfileBasics}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div style={S.sectionHead}>Brand Settings</div>
            <div style={S.card}>
              {(membershipTier === "free" || membershipTier === "tier1") && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ color: "#eab308" }}>🔒</span>
                  <span style={{ fontSize: 10, color: "#f5d676", fontWeight: 700 }}>Unlock in Tier 2</span>
                </div>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 10, color: "#d2def1" }}>
                  Logo upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => uploadBrandLogo(e.target.files?.[0])}
                    disabled={membershipTier !== "tier2"}
                    style={{ width: "100%", marginTop: 4 }}
                  />
                </label>
                {userProfile?.logo_url && (
                  <div style={{ fontSize: 10, color: "#9bb2d1", wordBreak: "break-all" }}>{userProfile.logo_url}</div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ fontSize: 10, color: "#d2def1" }}>
                    Brand primary
                    <input
                      type="color"
                      value={userProfile?.brand_color_primary || "#113a72"}
                      onChange={(e) => {
                        setUserProfile((p) => ({ ...(p || {}), brand_color_primary: e.target.value }));
                        updateProfileFields({ brand_color_primary: e.target.value });
                      }}
                      disabled={membershipTier !== "tier2"}
                      style={{ width: "100%", marginTop: 4, height: 34 }}
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#d2def1" }}>
                    Brand secondary
                    <input
                      type="color"
                      value={userProfile?.brand_color_secondary || "#e33433"}
                      onChange={(e) => {
                        setUserProfile((p) => ({ ...(p || {}), brand_color_secondary: e.target.value }));
                        updateProfileFields({ brand_color_secondary: e.target.value });
                      }}
                      disabled={membershipTier !== "tier2"}
                      style={{ width: "100%", marginTop: 4, height: 34 }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {isCurrentUserPricingMaster && phase === "account" && (
              <>
                <div style={S.sectionHead}>Testing mode</div>
                <div style={{ ...S.cardGold, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5, marginBottom: 10 }}>
                    <strong>Your account only</strong> — adjust your ECOS app plan and assigned buying tier, then <strong>Save</strong>. FGP customer + pricing-app toggles are managed under <strong>User database</strong> after you select a contractor.
                  </div>
                  {(() => {
                    const meKey = currentUser.trim().toLowerCase();
                    const me = normalizeUserProfile(usersSnapshot[meKey] || {});
                    return (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4 }}>Assigned buying tier</div>
                          <select
                            style={S.input}
                            value={adminSelfTierDraft}
                            onChange={(e) => setAdminSelfTierDraft(e.target.value)}
                          >
                            {Object.keys(TIERS).map((k) => (
                              <option key={k} value={k}>
                                {TIERS[k].label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4 }}>User access level</div>
                          <select
                            style={S.input}
                            value={adminSelfPlanDraft}
                            onChange={(e) => setAdminSelfPlanDraft(e.target.value)}
                          >
                            <option value="Free">Free</option>
                            <option value="Tier 1">Tier 1 — The Calculator ($49/mo)</option>
                            <option value="Tier 2">Tier 2 — The Estimator (coming soon)</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <button type="button" style={S.btn} onClick={saveAdminSelfTesting}>
                            Save testing settings
                          </button>
                          <button type="button" style={S.btnSm} onClick={goNewJobQuote}>
                            NEW JOB QUOTE
                          </button>
                        </div>
                        {adminSelfSaveNotice && (
                          <div style={{ fontSize: 11, color: "#fca5a5", fontWeight: 700 }}>{adminSelfSaveNotice}</div>
                        )}
                        <div style={{ fontSize: 10, color: "#9bb2d1", lineHeight: 1.45 }}>
                          Effective pricing preview (after save):{" "}
                          <span style={{ color: "#ffffff", fontWeight: 700 }}>
                            {
                              TIERS[
                                getEffectiveContractorPricingTierKey({
                                  ...me,
                                  assignedPricingTierKey: adminSelfTierDraft,
                                  membership_tier: tierTagToMembershipTier(adminSelfPlanDraft),
                                  isFgpCustomer: adminSelfTierDraft !== "msrp",
                                  contractorPricingApplicationReceived: adminSelfTierDraft !== "msrp",
                                  contractor_tier: adminSelfTierDraft === "msrp" ? "" : adminSelfTierDraft,
                                })
                              ].label
                            }
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div style={S.sectionHead}>User database</div>
                <div style={S.card}>
                  <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5, marginBottom: 10 }}>
                    Manage user access, pricing-application gate, contractor buying tier, and admin permissions.
                  </div>
                  <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("userdb")}>
                    Open user database
                  </button>
                </div>
              </>
            )}

            {isCurrentUserPricingMaster && phase === "userdb" && (
              <>
                <div style={S.sectionHead}>Admin notifications</div>
                <div style={{ ...S.card, border: "1px solid #fbbf24" }}>
                  <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 6 }}>
                    New users needing pricing review: {pendingPricingReviews.length}
                  </div>
                  {pendingPricingReviews.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#9bb2d1" }}>No pending user reviews.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {pendingPricingReviews.map(({ email, profile }) => (
                        <button
                          key={email}
                          type="button"
                          onClick={() => {
                            setSelectedContractorEmail(email);
                            setPricingConsoleTab("tier");
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            borderRadius: 6,
                            border: "1px solid #fbbf24",
                            background: "rgba(234, 179, 8, 0.08)",
                            color: "#ffffff",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ fontWeight: 900 }}>{email}</span>
                          <span style={{ marginLeft: 8, fontSize: 10, color: "#f5d676" }}>
                            {profile.isFgpCustomer ? "FGP tagged" : "Not FGP tagged"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={S.sectionHead}>User database</div>
                <div style={{ ...S.card, border: "1px solid #e33433" }}>
                  <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5, marginBottom: 10 }}>
                    Every registered user appears below. Pick one, then use <strong>Adjust buying tier</strong> or <strong>Assign as admin</strong>.
                  </div>
                  <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 10 }}>
                    Built-in admins: <code style={{ color: "#f5d676" }}>seth@dynastyepoxy.com</code>,{" "}
                    <code style={{ color: "#f5d676" }}>gary@dynastyepoxy.com</code>. More logins: assign <strong>ECOS pricing admin</strong> here, or set{" "}
                    <code style={{ color: "#f5d676" }}>localStorage.ecos_pricing_masters</code> JSON array.
                  </div>
                  <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      style={{ ...S.btnSm, width: "100%" }}
                      onClick={refreshUserDatabaseCard}
                    >
                      Refresh user database card
                    </button>
                    <input
                      style={S.input}
                      value={contractorSearchQuery}
                      onChange={(e) => setContractorSearchQuery(e.target.value)}
                      placeholder="Search contractors by name or email"
                    />
                    <select
                      style={S.input}
                      value={selectedContractorEmail || ""}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setSelectedContractorEmail(next);
                        if (next) setPricingConsoleTab("tier");
                      }}
                    >
                      <option value="">Select contractor</option>
                      {contractorUsers.map(({ email, displayName }) => (
                        <option key={email} value={email}>
                          {displayName} ({email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {filteredContractorUsers.map(({ email, profile: prof, displayName }) => {
                      const sel = selectedContractorEmail === email;
                        return (
                          <button
                            key={email}
                            type="button"
                            onClick={() => {
                              setSelectedContractorEmail(email);
                              setPricingConsoleTab("tier");
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 12px",
                              borderRadius: 6,
                              border: sel ? "2px solid #eab308" : "1px solid #113a72",
                              background: sel ? "rgba(234, 179, 8, 0.12)" : "#000000",
                              color: "#ffffff",
                              cursor: "pointer",
                            }}
                          >
                            <span style={{ fontWeight: 900 }}>{displayName}</span>
                            <span style={{ marginLeft: 8, fontSize: 10, color: "#9bb2d1" }}>{email}</span>
                            {prof.ecosPricingAdmin && (
                              <span style={{ marginLeft: 8, fontSize: 9, color: "#f5d676", letterSpacing: "0.08em" }}>PRICING ADMIN</span>
                            )}
                            {prof.needsAdminReview && (
                              <span style={{ marginLeft: 8, fontSize: 9, color: "#fbbf24", letterSpacing: "0.08em" }}>NEEDS REVIEW</span>
                            )}
                          </button>
                        );
                      })}
                    {filteredContractorUsers.length === 0 && (
                      <div style={{ fontSize: 11, color: "#9bb2d1" }}>No users match your search.</div>
                    )}
                  </div>

                  {selectedContractorEmail && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #113a72" }}>
                      <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 8 }}>
                        Selected: {selectedContractorEmail}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <button type="button" style={S.opt(pricingConsoleTab === "tier")} onClick={() => setPricingConsoleTab("tier")}>
                          Adjust buying tier
                        </button>
                        <button type="button" style={S.opt(pricingConsoleTab === "admin")} onClick={() => setPricingConsoleTab("admin")}>
                          Assign as admin
                        </button>
                      </div>
                      {pricingConsoleTab === "tier" &&
                        contractorAdminDraft &&
                        (() => {
                          const previewProf = normalizeUserProfile({
                            ...usersSnapshot[selectedContractorEmail],
                            ...contractorAdminDraft,
                            membership_tier: tierTagToMembershipTier(contractorAdminDraft.planTag),
                          });
                          return (
                            <div style={{ display: "grid", gap: 12 }}>
                              <div style={{ fontSize: 10, color: "#eab308", lineHeight: 1.45 }}>
                                Internal-only: contractor never sees these gates — only you (pricing admin) while managing accounts.
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 6 }}>FGP Midwest customer</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    type="button"
                                    style={S.opt(contractorAdminDraft.isFgpCustomer)}
                                    onClick={() =>
                                      setContractorAdminDraft((d) => (d ? { ...d, isFgpCustomer: true } : d))
                                    }
                                  >
                                    ON
                                  </button>
                                  <button
                                    type="button"
                                    style={S.opt(!contractorAdminDraft.isFgpCustomer)}
                                    onClick={() =>
                                      setContractorAdminDraft((d) => (d ? { ...d, isFgpCustomer: false } : d))
                                    }
                                  >
                                    OFF
                                  </button>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 6 }}>Pricing application received</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    type="button"
                                    style={S.opt(contractorAdminDraft.contractorPricingApplicationReceived)}
                                    onClick={() =>
                                      setContractorAdminDraft((d) =>
                                        d ? { ...d, contractorPricingApplicationReceived: true } : d
                                      )
                                    }
                                  >
                                    YES
                                  </button>
                                  <button
                                    type="button"
                                    style={S.opt(!contractorAdminDraft.contractorPricingApplicationReceived)}
                                    onClick={() =>
                                      setContractorAdminDraft((d) =>
                                        d ? { ...d, contractorPricingApplicationReceived: false } : d
                                      )
                                    }
                                  >
                                    NO
                                  </button>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4 }}>Assigned buying tier</div>
                                <select
                                  style={S.input}
                                  value={contractorAdminDraft.assignedPricingTierKey}
                                  onChange={(e) =>
                                    setContractorAdminDraft((d) =>
                                      d ? { ...d, assignedPricingTierKey: e.target.value } : d
                                    )
                                  }
                                >
                                  {Object.keys(TIERS).map((k) => (
                                    <option key={k} value={k}>
                                      {TIERS[k].label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 4 }}>User access level</div>
                                <select
                                  style={S.input}
                                  value={contractorAdminDraft.planTag}
                                  onChange={(e) =>
                                    setContractorAdminDraft((d) => (d ? { ...d, planTag: e.target.value } : d))
                                  }
                                >
                                  <option value="Free">Free</option>
                                  <option value="Tier 1">Tier 1 — The Calculator ($49/mo)</option>
                                  <option value="Tier 2">Tier 2 — The Estimator (coming soon)</option>
                                </select>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <button type="button" style={S.btn} onClick={saveContractorAdminPanel}>
                                  Save changes
                                </button>
                                <button type="button" style={S.btnSm} onClick={saveContractorAndReturnToOrdering}>
                                  Save & return to job setup
                                </button>
                              </div>
                              {contractorAdminSaveNotice && (
                                <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>{contractorAdminSaveNotice}</div>
                              )}
                              <div style={{ fontSize: 10, color: "#9bb2d1", lineHeight: 1.45 }}>
                                Effective pricing (if saved as shown):{" "}
                                <span style={{ color: "#ffffff", fontWeight: 700 }}>{TIERS[getEffectiveContractorPricingTierKey(previewProf)].label}</span>
                              </div>
                            </div>
                          );
                        })()}
                      {pricingConsoleTab === "admin" &&
                        (() => {
                          const prof = normalizeUserProfile(usersSnapshot[selectedContractorEmail] || {});
                          return (
                            <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.55 }}>
                              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={!!prof.ecosPricingAdmin}
                                  onChange={(e) =>
                                    setEcosPricingAdminForUser(selectedContractorEmail, e.target.checked)
                                  }
                                />
                                <span>
                                  <strong>ECOS pricing admin</strong> — can open this contractor-pricing console and manage all users on this device.
                                </span>
                              </label>
                            </div>
                          );
                        })()}
                    </div>
                  )}
                </div>
              </>
            )}

            {SHOW_LEGACY_ACCOUNT_PAST_ORDERS && !ACCOUNT_HIDE_PAST_ORDERS_EMAILS.has(currentUser.trim().toLowerCase()) && (
              <>
                <div style={S.sectionHead}>Past Orders Submitted</div>
                <div style={S.card}>
                  {savedOrders.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#9bb2d1" }}>No submitted orders yet.</div>
                  ) : (
                    savedOrders.map((o, i) => (
                      <div key={`${o.submittedAt}-${i}`} style={{ borderBottom: "1px solid #113a72", padding: "8px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <div style={{ fontSize: 10, color: "#9bb2d1", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                            Order {savedOrders.length - i}
                          </div>
                          <button
                            type="button"
                            title="Duplicate"
                            onClick={() => handleDuplicateSavedOrder(o)}
                            style={{ background: "transparent", border: "1px solid #113a72", color: "#d2def1", borderRadius: 4, fontSize: 11, padding: "2px 6px", cursor: "pointer" }}
                          >
                            ⧉
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>{o.jobNamePo}</div>
                        <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                          {new Date(o.submittedAt).toLocaleDateString()} · {o.sqFt.toLocaleString()} ft² · ${o.totalTier.toFixed(2)} · ${o.costPerSqFt.toFixed(2)}/ft²
                        </div>
                      </div>
                    ))
                  )}
                  <div style={{ marginTop: 10, fontSize: 10, color: "#9bb2d1" }}>
                    Free users get up to {MAX_FREE_STORED_ORDERS} stored orders.
                  </div>
                </div>
              </>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" style={{ ...S.btn, background: "#e33433", marginTop: 0 }} onClick={() => goToPlans("account")}>
                Upgrade Plan
              </button>
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
            </div>
          </>
        )}

        {currentUser && phase === "orders" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 4, marginTop: 8 }}>
              <button type="button" style={{ ...S.btnSm, borderColor: "#e33433", color: "#fff" }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
              <button type="button" style={S.btnSm} onClick={() => goToPlans("orders")}>
                Plans
              </button>
            </div>
            <div style={S.sectionHead}>My Orders</div>
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#9bb2d1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, fontFamily: "'Encode Sans Expanded', sans-serif" }}>
                Search orders
              </div>
              <input
                style={S.input}
                value={ordersSearchQuery}
                onChange={(e) => setOrdersSearchQuery(e.target.value)}
                placeholder="PO name/number, customer, system, address, color…"
              />
            </div>
            {membershipTier === "free" ? (
              <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.08)" }}>
                <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 8 }}>
                  Upgrade to Tier 1 for order history, Job Card printing, and unlimited POs in Tier 1.
                </div>
                <div style={{ filter: "blur(3px)", opacity: 0.7, pointerEvents: "none" }}>
                  {(poHistory.slice(0, 3).length ? poHistory.slice(0, 3) : [{ id: "locked1" }, { id: "locked2" }]).map((o, idx) => (
                    <div key={o.id || idx} style={{ borderBottom: "1px solid #113a72", padding: "10px 0" }}>
                      <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
                        {o.job_name || o.jobNamePo || "Locked Order"}
                      </div>
                      <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                        {(o.created_at && new Date(o.created_at).toLocaleDateString()) || "—"} · {Number(o.sq_footage || o.sqFt || 0).toLocaleString()} ft² · ${Number(o.total_cost || o.totalTier || 0).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" style={{ ...S.btn, marginTop: 12 }} onClick={() => startTier1Checkout()}>
                  Upgrade to Tier 1 — $49/mo
                </button>
              </div>
            ) : (
              <>
                {poCounterLabel && (
                  <div
                    style={{
                      ...S.card,
                      marginBottom: poUsage.atWarning || poUsage.atLimit ? 0 : 12,
                      border: poUsage.atLimit ? "1px solid #e33433" : poUsage.atWarning ? "1px solid #eab308" : "1px solid #113a72",
                      background: poUsage.atLimit
                        ? "rgba(227, 52, 51, 0.12)"
                        : poUsage.atWarning
                          ? "rgba(234, 179, 8, 0.12)"
                          : "rgba(15, 36, 64, 0.88)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: poUsage.atLimit ? "#fca5a5" : poUsage.atWarning ? "#f5d676" : "#d2def1", fontWeight: 900 }}>
                      {poCounterLabel}
                    </div>
                  </div>
                )}
                {membershipTier === "tier1" && (poUsage.atWarning || poUsage.atLimit) && (
                  <UpgradeUpsell
                    variant="po-warning"
                    btnSmStyle={S.btnSm}
                    onUpgrade={() => goToPlans("orders")}
                  />
                )}
                <MaterialOrderForm
                  key={`material-order-${session?.user?.id || "anon"}`}
                  styles={S}
                  userProfile={userProfile}
                  session={session}
                  poUsage={poUsage}
                  customFloorSystems={customFloorSystems}
                  onUpgrade={() => setPhase("plans")}
                  onSubmitSuccess={showAppSuccessToast}
                  onOrderSaved={async (row, meta) => {
                    if (typeof meta?.annual_po_count === "number") {
                      setPoCountThisYear(meta.annual_po_count);
                      setUserProfile((prev) =>
                        normalizeUserProfile({
                          ...(prev || {}),
                          annual_po_count: meta.annual_po_count,
                          pos_submitted_this_year: meta.annual_po_count,
                        })
                      );
                    }
                    setMaterialOrderHistory((prev) => [row, ...prev]);
                    if (session?.user?.id) await loadMaterialOrderHistory(session);
                  }}
                />
                <div style={{ ...S.sectionHead, marginTop: 20 }}>MANUAL PO HISTORY</div>
                <div style={S.card}>
                  {filteredMaterialOrderHistory.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#9bb2d1" }}>
                      {ordersSearchNormalized ? "No manual POs match your search." : "No manual POs yet."}
                    </div>
                  ) : (
                    filteredMaterialOrderHistory.map((o, i) => (
                      <div key={`mat-${o.id || i}`} style={{ borderBottom: "1px solid #113a72", padding: "8px 0" }}>
                        <div style={{ fontSize: 12, color: "#fff", fontWeight: 900 }}>
                          {o.po_name || o.poName || "Manual PO"} · ${Number(o.total_with_tax ?? o.total_price ?? 0).toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                          {new Date(o.created_at).toLocaleString()} · {Array.isArray(o.items) ? o.items.length : 0} line(s) · saved ${Number(o.total_discount || 0).toFixed(2)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ ...S.sectionHead, marginTop: 20 }}>Past Calculator PO Submissions (Orders)</div>
                <div style={S.card}>
                  {filteredPoHistory.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#9bb2d1" }}>
                      {ordersSearchNormalized ? "No calculator POs match your search." : "No submitted calculator POs yet."}
                    </div>
                  ) : (
                    filteredPoHistory.map((o, i) => (
                      <div key={`${o.id || o.created_at}-${i}`} style={{ borderBottom: "1px solid #113a72", padding: "10px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
                              {o.job_name || o.jobNamePo || "Untitled Job / PO"}
                              {o.is_custom_system && (
                                <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 6 }}>
                                  CUSTOM
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                              {new Date(o.created_at).toLocaleDateString()} · {o.system_code || o.systemCode || "—"} · {Number(o.sq_footage || o.sqFt || 0).toLocaleString()} ft² · ${Number(o.total_cost || o.totalTier || 0).toFixed(2)}
                            </div>
                            {o.vendor_po_sent_at && (
                              <div style={{ fontSize: 10, color: "#86efac", marginTop: 3 }}>
                                PO sent to {o.vendor_name || "vendor"} on {new Date(o.vendor_po_sent_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button type="button" style={S.btnSm} onClick={() => setViewingOrder(o)}>
                              View Order
                            </button>
                            <button type="button" style={S.btnSm} onClick={() => printJobCard(o)}>
                              Print Job Card
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...S.btn, width: "100%", marginTop: 0 }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
            </div>
          </>
        )}

        {currentUser && phase === "floor-systems" && (
          <>
            {membershipTier !== "tier2" ? (
              <div style={{ ...S.card, border: "1px solid #eab308" }}>
                <div style={{ fontSize: 13, color: "#f5d676", fontWeight: 900, marginBottom: 8 }}>
                  My Floor Systems is a Tier 2 feature
                </div>
                <button type="button" style={S.btn} onClick={() => goToPlans("floor-systems")}>
                  Upgrade to Tier 2
                </button>
              </div>
            ) : (
              <MyFloorSystems
                styles={S}
                session={session}
                userProfile={userProfile}
                onSystemsChanged={(list) => setCustomFloorSystems(list || [])}
              />
            )}
            <div style={{ marginTop: 14 }}>
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
            </div>
          </>
        )}

        {viewingOrder && (
          <div style={S.modalOverlay} onClick={() => setViewingOrder(null)}>
            <div style={{ ...S.modalCard, maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 14, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 8 }}>
                Order details
                {viewingOrder.is_custom_system && (
                  <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 8 }}>
                    CUSTOM
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#d2def1", lineHeight: 1.6, marginBottom: 12 }}>
                <div><span style={{ color: "#9bb2d1" }}>Job / PO #:</span> {viewingOrder.job_name || "—"}</div>
                <div><span style={{ color: "#9bb2d1" }}>Address:</span> {viewingOrder.address || "—"}</div>
                <div><span style={{ color: "#9bb2d1" }}>System:</span> {viewingOrder.system_label || viewingOrder.system_code || "—"}</div>
                <div><span style={{ color: "#9bb2d1" }}>Sq Ft:</span> {Number(viewingOrder.sq_footage || 0).toLocaleString()} ft²</div>
                <div><span style={{ color: "#9bb2d1" }}>Total:</span> ${Number(viewingOrder.total_cost || 0).toFixed(2)}</div>
                {viewingOrder.vendor_po_sent_at && (
                  <div style={{ color: "#86efac", marginTop: 6 }}>
                    PO sent to {viewingOrder.vendor_name || "vendor"} on {new Date(viewingOrder.vendor_po_sent_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#e33433", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Layers / materials</div>
              <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5 }}>
                {(viewingOrder.order_lines || []).length === 0 ? (
                  <div style={{ color: "#9bb2d1" }}>No line items stored.</div>
                ) : (
                  (viewingOrder.order_lines || []).map((line, idx) => (
                    <div key={idx} style={{ borderBottom: "1px solid #113a72", padding: "6px 0" }}>
                      <div style={{ color: "#fff", fontWeight: 700 }}>{line.layer || line.product}</div>
                      <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                        {line.kitSize} ×{line.qty} · needs {line.totalNeeded || "—"} · ${Number(line.lineTier || line.lineTotal || 0).toFixed(2)}
                        {line.notes ? ` · ${line.notes}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button type="button" style={{ ...S.btnSm, width: "100%", marginTop: 14 }} onClick={() => setViewingOrder(null)}>
                Close
              </button>
            </div>
          </div>
        )}

        {currentUser && phase === "customer-quotes" && (
          <>
            <div style={S.sectionHeadGold}>Customer Quotes</div>
            <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.08)" }}>
              <div style={{ fontSize: 13, color: "#f5d676", fontWeight: 900, marginBottom: 6 }}>Coming soon</div>
              <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.55 }}>
                Send customized client estimates with your branding. This Tier 2 Estimator feature is next on the roadmap.
              </div>
              <button type="button" style={{ ...S.btnSm, marginTop: 12 }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
            </div>
          </>
        )}

        {currentUser && phase === "plans" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                style={{ ...S.btnSm, width: "100%" }}
                onClick={() => setPhase(plansReturnPhase === "plans" ? "questions" : plansReturnPhase || "questions")}
              >
                {plansBackLabel()}
              </button>
              <button type="button" style={{ ...S.btnSm, width: "100%", borderColor: "#e33433", color: "#fff" }} onClick={goNewJobQuote}>
                NEW JOB QUOTE
              </button>
            </div>
            <div style={S.sectionHeadGold}>Choose Your Membership</div>
            <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.08)", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#f5d676", lineHeight: 1.5 }}>
                ECOS pricing is based on FGP Midwest product pricing. Material discount tiers are assigned based on purchasing volume and require approval from FGP Midwest. Anyone can use ECOS — discount tiers are separate from your app membership.
              </div>
            </div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div style={{ ...S.card, border: "1px solid #6b7280" }}>
                <div style={{ fontSize: 16, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>Free</div>
                <ul style={{ margin: "8px 0 12px 16px", color: "#d2def1", fontSize: 11, lineHeight: 1.5 }}>
                  <li>Access to material calculator</li>
                  <li>4 ET flooring systems (FLK-ID-RES, FLK-OD-RES, SC-ID-EZ CLEAN, METALLIC-ID)</li>
                  <li>2 active jobs in cart</li>
                  <li>Submit PO to FGP MIDWEST - 4 per mo. / 1 per week.</li>
                  <li>No job history</li>
                  <li>No job card printing</li>
                  <li>No customer estimates</li>
                </ul>
                <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => chooseMembershipPlan("free")}>
                  Continue with Free Account
                </button>
              </div>
              <div style={{ ...S.cardGold, border: "2px solid #eab308" }}>
                <div style={{ fontSize: 10, color: "#f5d676", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6 }}>Recommended</div>
                <div style={{ fontSize: 16, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>Tier 1 ($49/mo)</div>
                <ul style={{ margin: "8px 0 12px 16px", color: "#d2def1", fontSize: 11, lineHeight: 1.5 }}>
                  <li>Everything in Free</li>
                  <li>Unlock all 8 ET flooring systems</li>
                  <li>10 active jobs in cart</li>
                  <li>Submit PO to FGP Midwest - UNLIMITED</li>
                  <li>50 POs saved per year</li>
                  <li>PO history in My Orders</li>
                  <li>Job Card printing (2 per page)</li>
                </ul>
                <button
                  type="button"
                  style={{ ...S.btn, width: "100%", marginTop: 0 }}
                  onClick={() => {
                    console.log("BUTTON CLICKED");
                    chooseMembershipPlan("tier1");
                  }}
                >
                  Upgrade to Tier 1 — $49/mo
                </button>
              </div>
              <div style={{ ...S.card, border: "1px solid #113a72" }}>
                <div style={{ fontSize: 16, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>Tier 2 ($149/mo)</div>
                <ul style={{ margin: "8px 0 12px 16px", color: "#d2def1", fontSize: 11, lineHeight: 1.5 }}>
                  <li>Everything in Tier 1</li>
                  <li>My Floor Systems — build &amp; reuse custom systems</li>
                  <li>Vendor POs to any supplier</li>
                  <li>Customer-facing branded estimates (coming soon)</li>
                  <li>Logo upload + brand colors</li>
                  <li>Unlimited POs / year</li>
                </ul>
                <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => chooseMembershipPlan("tier2")}>
                  Upgrade to Tier 2 — $149/mo
                </button>
              </div>
            </div>
          </>
        )}

        {showAreaCalc && (
          <div style={S.modalOverlay}>
            <div style={S.modalCard}>
              <div style={{ fontSize: 14, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>Area Calculator</div>
              <div style={{ fontSize: 10, color: "#9bb2d1", marginTop: 3 }}>Enter area, then apply to square footage.</div>
              <div style={{ ...S.input, marginTop: 10, fontSize: 20, textAlign: "right" }}>{calcValue || "0"}</div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {[
                  { key: "sqft", label: "sq/ft" },
                  { key: "sqm", label: "m2 (ms2)" },
                  { key: "yd2", label: "yd2" },
                ].map((u) => (
                  <button key={u.key} style={S.unitBtn(calcUnit === u.key)} onClick={() => setCalcUnit(u.key)}>
                    {u.label}
                  </button>
                ))}
              </div>

              <div style={S.keypadGrid}>
                {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0"].map((digit) => (
                  <button key={digit} style={S.keyBtn} onClick={() => appendCalcValue(digit)}>
                    {digit}
                  </button>
                ))}
                <button style={S.keyBtn} onClick={backspaceCalcValue}>⌫</button>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button style={{ ...S.btnSm, flex: 1 }} onClick={clearCalcValue}>Clear</button>
                <button style={{ ...S.btnSm, flex: 1 }} onClick={() => setShowAreaCalc(false)}>Cancel</button>
                <button style={{ ...S.btn, flex: 1, background: activeTheme.accent, marginTop: 0 }} onClick={applyAreaCalc}>Apply</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            type="button"
            onClick={handleFallbackLogout}
            style={{ background: "transparent", border: "none", color: "#9bb2d1", textDecoration: "underline", cursor: "pointer", fontSize: 11 }}
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
