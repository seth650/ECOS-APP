import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

const HEADER_LOGO_URL = "/favicon.svg";
/** Must match Supabase Storage bucket name exactly (Dashboard → Storage). */
const SUPABASE_SWATCH_BUCKET = "Color Swatches";
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");

// ─── PRIVATE LABEL MAP ───────────────────────────────────────────────────────
// SurfKoat MCU 85       = EZ Top 85 (ET PL)
// SurfKoat 1040 BondKoat = HydroPrime (ET PL)
// Rapid Set 100          = Patch Pro 10X (ET PL)

// ─── PRODUCT CATALOG ─────────────────────────────────────────────────────────
// MSRP kit pricing aligned to FGP Midwest master list (Apr 2026 export).

/** E-Poly 32oz stocking colors — retail MSRP each (secondary-sheet accessory model). */
const EPOLY_PIGMENT_RETAIL_32OZ_USD = {
  Black: 39.8,
  "Metal Gray": 40.2,
  "Medium Gray": 40.9,
  "Sable Gray": 44.3,
  White: 52.6,
  "Dover Beige": 44.5,
  Tan: 43.2,
};

function buildEpolyPigmentProductMap() {
  const m = {};
  for (const [color, msrp] of Object.entries(EPOLY_PIGMENT_RETAIL_32OZ_USD)) {
    const slug = color.toLowerCase().replace(/\s+/g, "_");
    m[`epoly_pigment_${slug}`] = {
      name: `E-Poly Pigment — ${color}`,
      pricingModel: "accessory",
      kits: [{ size: "32oz", gals: 0.25, msrp }],
    };
  }
  m.epoly_pigment_nonstock = {
    name: "E-Poly Pigment (specialty tint)",
    pricingModel: "accessory",
    kits: [{ size: "32oz", gals: 0.25, msrp: 39.8 }],
  };
  return m;
}

function resolveEpolyProductKey(baseCoatColor) {
  const c = baseCoatColor || "Black";
  if (EPOLY_PIGMENT_RETAIL_32OZ_USD[c] != null) {
    return `epoly_pigment_${c.toLowerCase().replace(/\s+/g, "_")}`;
  }
  return "epoly_pigment_nonstock";
}

function resolveLayerProductKey(layer, answers) {
  if (layer.key !== "epoly_pigment") return layer.key;
  return resolveEpolyProductKey(answers?.baseCoatColor);
}

// MSRP kit pricing aligned to FGP Midwest master list (Apr 2026 export). E-Poly = per-color variants.
const PRODUCTS = {
  dt454_clear:    { name: "DT-454 Clear",        kits: [{ size: "3 gal", gals: 3, msrp: 210 }, { size: "15 gal", gals: 15, msrp: 975 }] },
  dt454_turbo:    { name: "DT-454 Clear (Turbo)", kits: [{ size: "3 gal", gals: 3, msrp: 210 }, { size: "15 gal", gals: 15, msrp: 975 }] },
  hyperbond:      { name: "HyperBond (Clear)",    kits: [{ size: "3 gal", gals: 3, msrp: 195 }, { size: "15 gal", gals: 15, msrp: 870 }] },
  mv2112:         { name: "MV 2112 (MVB)",        kits: [{ size: "3 gal", gals: 3, msrp: 360 }, { size: "15 gal", gals: 15, msrp: 1575 }] },
  hyperprime_mvb: { name: "HyperPrime MVB",       kits: [{ size: "3 gal", gals: 3, msrp: 177 }, { size: "15 gal", gals: 15, msrp: 855 }] },
  polyurea_slow:  { name: "Polyurea Basecoat (Slow)",   kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  polyurea_med:   { name: "Polyurea Basecoat (Medium)", kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  polyurea_fast:  { name: "Polyurea Basecoat (Fast)",   kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  aspartic85:     { name: "Aspartic 85 Slow Go (Low Odor)", kits: [{ size: "3 gal", gals: 3, msrp: 300 }, { size: "15 gal", gals: 15, msrp: 1475 }] },
  ez_top_85:      { name: "EZ Top 85 (ET)",       kits: [{ size: "3 gal", gals: 3, msrp: 295 }, { size: "15 gal", gals: 15, msrp: 1425 }] },
  hydroprime:     { name: "HydroPrime (ET)",       kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  hydroprime_40:  { name: "HydroPrime 40 (ET PL 1040 BondKoat)", kits: [{ size: "2 gal", gals: 2, msrp: 165 }, { size: "10 gal", gals: 10, msrp: 924.68 }] },
  maxx_flow:      { name: "Maxx Flow (Metallic)",  kits: [{ size: "3 gal", gals: 3, msrp: 360 }, { size: "15 gal", gals: 15, msrp: 1550 }] },
  ...buildEpolyPigmentProductMap(),
  patch_pro_10x:  { name: "Patch Pro 10X (ET)",    kits: [{ size: "2 gal", gals: 2, msrp: 146.07 }] },
  hypercure:      { name: "HyperCURE",             kits: [{ size: "0.5 gal", gals: 0.5, msrp: 100.1 }] },
  flake_14:       { name: "Decorative Flake 1/4\"", kits: [{ size: "40lb box", gals: 0, lbs: 40, msrp: 95 }] },
  quartz_agg:     { name: "Colored Quartz Aggregate", pricingModel: "accessory", kits: [{ size: "50lb bag", gals: 0, lbs: 50, msrp: 25 }] },
  silica_sand:    { name: "20/40 Mesh Silica Sand", kits: [{ size: "50lb bag", gals: 0, lbs: 50, msrp: 18 }] },
};

// Default polyaspartic topcoat used by system logic.
const DEFAULT_POLYASPARTIC_TOPCOAT_KEY = "aspartic85";
const MAX_FREE_JOBS = 2;
const MAX_TIER1_JOBS = 10;
const MAX_FREE_STORED_ORDERS = 5;
const MAX_TIER1_POS_PER_YEAR = 50;

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

function getMaxJobsForMembershipTier(tier = "free") {
  return tier === "tier1" ? MAX_TIER1_JOBS : MAX_FREE_JOBS;
}

function getAnniversaryWindowStart(anniversaryIso) {
  const now = new Date();
  const base = anniversaryIso ? new Date(anniversaryIso) : now;
  const anniversaryThisYear = new Date(now.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  if (anniversaryThisYear > now) {
    return new Date(now.getFullYear() - 1, base.getMonth(), base.getDate(), 0, 0, 0, 0);
  }
  return anniversaryThisYear;
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

/** Higher index = better contractor discount. Used for FGP Midwest “assigned vs active” pricing. */
const CONTRACTOR_PRICING_RANK = { msrp: 0, small: 1, tier2: 2, preferred: 3 };

/** Default pricing admins (cloud profile can also elevate). */
const PRICING_MASTER_EMAILS = ["seth@dynastyepoxy.com", "gary@dynastyepoxy.com"];

/** Logins that skip “Past orders” on Account (master / Epoxy Twins); ordering profiles (e.g. Gary) keep history. */
const ACCOUNT_HIDE_PAST_ORDERS_EMAILS = new Set(["seth@dynastyepoxy.com"]);

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
  if (!p.signup_anniversary_date) p.signup_anniversary_date = p.createdAt || new Date().toISOString();
  if (p.pos_submitted_this_year === undefined) p.pos_submitted_this_year = 0;
  if (!p.logo_url) p.logo_url = "";
  if (!p.brand_color_primary) p.brand_color_primary = "#113a72";
  if (!p.brand_color_secondary) p.brand_color_secondary = "#e33433";
  if (p.total_pos_value_this_quarter === undefined) p.total_pos_value_this_quarter = 0;
  if (p.total_pos_value_this_year === undefined) p.total_pos_value_this_year = 0;
  if (!p.billing_last4) p.billing_last4 = "";
  if (!Array.isArray(p.billing_history)) p.billing_history = [];
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
      items.push({ key: baseKey, gals: sf / 250, label: "Basecoat — Polyurea Basecoat", notes: "250 ft²/gal · ribbon/roll" });
      const pigGals = (sf / 250) * 0.10;
      items.push({ key: "epoly_pigment", gals: pigGals, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      const flakeLbs = sf / 10;
      items.push({ key: "flake_14", lbs: flakeLbs, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb · broadcast to rejection" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 120, label: "Final Clear Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "120–145 ft²/gal · squeegee/roll" });
      if (opts.steps > 0) items.push({ key: "silica_sand", lbs: opts.steps * 2, label: "Traction Sand (Steps)", notes: "Required on all stair treads" });
      return items;
    }
  },
  "FLK-ID-RES": {
    label: "Flake, Indoor Residential",
    code: "FLK-ID-RES",
    priceRange: "$6–8/ft²",
    warnings: ["Non-UV stable — not for UV exposure areas", "If moisture confirmed → upgrade to FLK-ID-COM/MV"],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
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
    warnings: ["Non-UV stable", "Traffic topcoat (EZ Top 85) included — higher wear protection"],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "flake_14", lbs: sf / 10, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb" });
      items.push({ key: "dt454_clear", gals: sf / 110, label: "Grout Coat — DT-454 Clear", notes: "110–140 ft²/gal · 2:1" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Traffic Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal min · 1.5 lb/gal COM wear" });
      return items;
    }
  },
  "FLK-ID-COM/MV": {
    label: "Flake, Indoor Commercial + MVB",
    code: "FLK-ID-COM/MV",
    priceRange: "$10–14/ft²",
    warnings: ["🚨 MVB required — moisture confirmed or high risk", "\"We're building this system from the ground up correctly\""],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      items.push({ key: "mv2112", gals: sf / 95, label: "MVB — MV2112", notes: "95 ft²/gal · 2:1 · 3/16\" notch squeegee" });
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "flake_14", lbs: sf / 10, label: "Decorative Flake 1/4\"", notes: "10–13 ft²/lb" });
      items.push({ key: "dt454_clear", gals: sf / 110, label: "Grout Coat — DT-454 Clear", notes: "110–140 ft²/gal" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Traffic Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal min · RES: 0.75 lb/gal · COM: 1.5 lb/gal" });
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
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      if (opts.moisture === "high" || opts.moisture === "moderate") {
        items.push({ key: "mv2112", gals: sf / 95, label: "MVB — MV2112", notes: "95 ft²/gal · 2:1" });
      } else {
        items.push({ key: "dt454_turbo", gals: sf / 250, label: "Primer — DT-454 Clear (Turbo)", notes: "250 ft²/gal conservative · 2:1 · pan roll" });
      }
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Basecoat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 170) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "maxx_flow", gals: sf / 30, label: "Artistic Layer — Maxx Flow", notes: "30–50 ft²/gal · 2:1 · consult Recipe Book" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal min · 0.75 lb/gal RES" });
      return items;
    }
  },
  "QUARTZ-ID-COM": {
    label: "Epoxy Quartz, Indoor Commercial",
    code: "QUARTZ-ID-COM",
    priceRange: "$10–12/ft²",
    warnings: ["Double broadcast system", "Slip resistance required — safety + decorative + durability"],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      items.push({ key: "mv2112", gals: sf / 160, label: "Broadcast Coat 1 — MV2112 Pigmented", notes: "160 ft²/gal · 2:1 · E-Poly +10%" });
      items.push({ key: "epoly_pigment", gals: (sf / 160) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
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
    warnings: ["Non-UV stable", "Not for known moisture, below-grade, or pre-2000 slabs → use MV version"],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      items.push({ key: "dt454_turbo", gals: sf / 250, label: "Primer — DT-454 Clear (Turbo)", notes: "250–350 ft²/gal · 2:1 · squeegee/roll" });
      items.push({ key: "dt454_turbo", gals: sf / 140, label: "Basecoat — DT-454 Clear (Turbo)", notes: "140–170 ft²/gal · 2:1 · notch squeegee 8-12 mil WFT" });
      items.push({ key: "epoly_pigment", gals: (sf / 140) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Seal Coat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · conservative lock coat before final top" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal planning rate" });
      return items;
    }
  },
  "SC-ID-EZ-CLEAN-MV": {
    label: "Solid Colored, Indoor + MVB",
    code: "SC-ID-EZ CLEAN-MV",
    priceRange: "$7–10/ft²",
    warnings: ["🚨 MVB included — moisture-prone slabs, below-grade, pre-2000"],
    layers: (sf, opts) => {
      const items = [];
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
      items.push({ key: "mv2112", gals: sf / 95, label: "MVB — MV2112", notes: "95 ft²/gal · 1:1 · 3/16\" notch squeegee" });
      items.push({ key: "dt454_turbo", gals: sf / 140, label: "Basecoat — DT-454 Clear (Turbo)", notes: "140–170 ft²/gal · 2:1" });
      items.push({ key: "epoly_pigment", gals: (sf / 140) * 0.10, label: "E-Poly Pigment", notes: "+10% total mix volume" });
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Seal Coat — DT-454 Clear (Turbo)", notes: "170 ft²/gal · conservative lock coat before final top" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal planning rate" });
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
      if (opts.hasCracks) items.push({ key: "patch_pro_10x", gals: 0, label: "Crack Repair", qty: sf / 2000, unit: "kit", notes: "Est. ~0.5 kit per 1,000 ft² (PO: whole 2 gal kits only — rounds up)" });
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
    layers: (sf, opts) => {
      const items = [];
      items.push({ key: "dt454_turbo", gals: sf / 170, label: "Prime/Base — DT-454 Clear (Turbo)", notes: "170 ft²/gal · 2:1 · squeegee/roll" });
      items.push({ key: DEFAULT_POLYASPARTIC_TOPCOAT_KEY, gals: sf / 600, label: "Topcoat — Aspartic 85 Slow Go (Low Odor)", notes: "600 ft²/gal min · 0.75 lb/gal RES" });
      return items;
    }
  },
};

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
  { value: "Gravel", hex: "#7F8790", recommendedBase: "Medium Gray" },
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

const FREE_UNLOCKED_SYSTEMS = new Set(["FLK-ID-RES", "FLK-OD-RES", "SC-ID-EZ-CLEAN", "METALLIC-ID"]);
const FREE_UNLOCKED_FINISHES = new Set(["flake", "solid", "metallic"]);

function getFullLocationSystemKeys(location) {
  if (location === "exterior") return ["FLK-OD-RES"];
  if (location === "interior") {
    return [
      "FLK-ID-RES",
      "FLK-ID-COM",
      "FLK-ID-COM/MV",
      "METALLIC-ID",
      "QUARTZ-ID-COM",
      "SC-ID-EZ-CLEAN",
      "SC-ID-EZ-CLEAN-MV",
      "SC-ID-TEX",
      "GRIND-SEAL",
    ];
  }
  return [];
}

function getLocationSystemKeysForPlan(location, planTag = "Free") {
  if (planTag === "Free") {
    const keys = getFullLocationSystemKeys(location);
    return keys.filter((k) => FREE_UNLOCKED_SYSTEMS.has(k));
  }
  return getFullLocationSystemKeys(location);
}

function getRecommendedSystem(answers, planTag = "Free") {
  const { location, finish, moisture, use } = answers;
  if (!location || !finish) return null;

  if (location === "exterior") {
    return "FLK-OD-RES";
  }

  if (finish === "flake") {
    if (moisture === "high") return "FLK-ID-COM/MV";
    if (use === "commercial") return "FLK-ID-COM";
    return "FLK-ID-RES";
  }
  if (finish === "solid") return moisture === "high" ? "SC-ID-EZ-CLEAN-MV" : "SC-ID-EZ-CLEAN";
  if (finish === "metallic") return "METALLIC-ID";
  if (finish === "quartz") return "QUARTZ-ID-COM";
  if (finish === "solid_tex") return "SC-ID-TEX";
  if (finish === "grind_seal") return "GRIND-SEAL";
  return null;
}

function buildFgOrderEmailBody({
  jobNamePo,
  address,
  systemCode,
  systemLabel,
  sqFt,
  tierLabel,
  tierMult,
  orderLines,
  totalMsrp,
  totalDiscount,
  totalTier,
  requiredMaterialTierTotal,
}) {
  const discountPct = Math.round((1 - tierMult) * 100);
  const lineText = orderLines
    .map(
      (l) =>
        `${l.product} | ${l.layer} | ${l.kitSize} x${l.qty} | needs ${l.totalNeeded} | MSRP $${l.msrpEa.toFixed(2)} ea | line $${l.lineTier.toFixed(2)}`
    )
    .join("\n");

  return [
    "FGP Midwest — ECOS material order (V1)",
    "",
    `Job / PO #: ${jobNamePo || "—"}`,
    `Address: ${address || "—"}`,
    `System: ${systemCode} — ${systemLabel}`,
    `Area: ${Number(sqFt).toLocaleString()} ft²`,
    `Buying tier: ${tierLabel} (${discountPct}% off MSRP)`,
    "",
    "--- Materials ---",
    lineText || "(no lines)",
    "",
    `SUBTOTAL MSRP: $${totalMsrp.toFixed(2)}`,
    `TOTAL DISCOUNT: -$${totalDiscount.toFixed(2)}`,
    `CONTRACTOR PAYS: $${totalTier.toFixed(2)}`,
    sqFt > 0
      ? `Required material $ / ft² (${Number(sqFt).toLocaleString()} ft²): $${(requiredMaterialTierTotal / sqFt).toFixed(2)}/ft²`
      : "",
    "",
    "--- PO notes for Gary (internal) ---",
    "Square: enter all line items at MSRP, then apply a single discount to the invoice total equal to TOTAL DISCOUNT above.",
    "",
    "Sent from ECOS (client mailto — replace with server send when wired).",
  ].join("\n");
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
  if (answers.finish === "flake" && answers.moisture === "high") return "Moisture risk triggers MVB-backed flake build.";
  if (answers.finish === "flake" && answers.use === "commercial") return "Commercial use needs heavier wear package.";
  if (answers.finish === "solid" && answers.moisture === "high") return "Moisture-prone slab shifts to MV solid system.";
  if (answers.finish === "metallic") return "Metallic finish prioritizes artistic flow and clarity.";
  if (answers.finish === "quartz") return "Quartz finish targets safety, broadcast texture, and durability.";
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
    const tierMult = getTierMultiplierForProduct(pk, tier);
    const kits = calcKits(pk, layer.gals !== undefined ? layer.gals : 0, layer.lbs, layer.qty);
    kits.forEach(kit => {
      const tierPrice = +(kit.msrp * tierMult).toFixed(2);
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
    const tierMult = getTierMultiplierForProduct(pk, tier);

    if (layer.lbs !== undefined) {
      const lbKit = prod.kits.find((k) => k.lbs);
      if (!lbKit || !lbKit.lbs) return;
      const tierPerLb = (lbKit.msrp * tierMult) / lbKit.lbs;
      total += tierPerLb * layer.lbs;
      return;
    }

    if (layer.gals === 0) {
      const raw = layer.qty !== undefined ? Number(layer.qty) : 1;
      const need = Number.isFinite(raw) && raw > 0 ? raw : 1;
      const purchaseKits = Math.max(1, Math.ceil(need));
      total += prod.kits[0].msrp * tierMult * purchaseKits;
      return;
    }

    const galKits = prod.kits.filter((k) => k.gals && k.gals > 0);
    if (!galKits.length) return;
    const smallestGalKit = galKits.reduce((best, kit) => (kit.gals < best.gals ? kit : best), galKits[0]);
    const tierPerGal = (smallestGalKit.msrp * tierMult) / smallestGalKit.gals;
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
  app: { minHeight: "100vh", background: "#000000", color: "#f4f7fb", fontFamily: "'Open Sans', sans-serif", padding: 0 },
  header: { background: "#113a72", borderBottom: "8px solid #e33433", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 },
  logo: { width: 36, height: 36, background: "#000000", border: "1px solid #e33433", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 },
  brand: { fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#ffffff", fontFamily: "'Encode Sans Expanded', sans-serif" },
  title: { fontSize: 15, fontWeight: 900, letterSpacing: "0.04em", color: "#ffffff", lineHeight: 1.1, fontFamily: "'Montserrat', sans-serif" },
  body: { maxWidth: 860, margin: "0 auto", padding: "24px 16px" },
  sectionHead: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#e33433", marginBottom: 10, paddingBottom: 5, borderBottom: "1px solid #113a72", marginTop: 24, fontFamily: "'Encode Sans Expanded', sans-serif" },
  sectionHeadGold: { fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#eab308", marginBottom: 10, paddingBottom: 5, borderBottom: "1px solid #eab308", marginTop: 24, fontFamily: "'Encode Sans Expanded', sans-serif" },
  sectionSub: { color: "#9bb2d1", fontSize: 12, marginBottom: 12 },
  card: { background: "#0a1830", border: "1px solid #113a72", borderRadius: 8, padding: "14px 16px", marginBottom: 12 },
  cardGold: { background: "rgba(234, 179, 8, 0.08)", border: "1px solid #eab308", borderRadius: 8, padding: "14px 16px", marginBottom: 12 },
  question: { fontSize: 14, color: "#ced8e8", marginBottom: 10, fontFamily: "'Montserrat', sans-serif", fontWeight: 900 },
  optRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  opt: (active) => ({ padding: "8px 14px", borderRadius: 6, border: active ? "1px solid #e33433" : "1px solid #113a72", background: active ? "#113a72" : "#000000", color: active ? "#ffffff" : "#afc1d9", fontSize: 12, cursor: "pointer", transition: "all 0.15s", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }),
  locationOpt: (active) => ({ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, border: active ? "1px solid #e33433" : "1px solid #113a72", background: active ? "#113a72" : "#000000", color: "#ffffff", cursor: "pointer", transition: "all 0.15s" }),
  input: { background: "#000000", border: "1px solid #113a72", borderRadius: 6, color: "#f4f7fb", padding: "8px 12px", fontSize: 14, fontFamily: "'Open Sans', sans-serif", outline: "none", width: "100%", boxSizing: "border-box" },
  alert: (type) => ({ background: type === "danger" ? "#2a0b0b" : type === "warning" ? "#1f1810" : "#0a1830", border: `1px solid ${type === "danger" ? "#e33433" : type === "warning" ? "#e33433" : "#113a72"}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, color: type === "danger" ? "#ffd0d0" : type === "warning" ? "#ffe4c4" : "#d2def1", marginBottom: 6 }),
  badge: { fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: "#113a72", color: "#ffffff", display: "inline-block", marginBottom: 8, fontFamily: "'Encode Sans Expanded', sans-serif" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
  th: { textAlign: "left", padding: "6px 8px", color: "#9bb2d1", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #113a72", fontFamily: "'Encode Sans Expanded', sans-serif" },
  td: { padding: "7px 8px", borderBottom: "1px solid #113a72", color: "#c8d6ea", verticalAlign: "top" },
  tdBold: { padding: "7px 8px", borderBottom: "1px solid #113a72", color: "#ffffff", fontWeight: 700, verticalAlign: "top" },
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
    textAlign: "left",
    borderRadius: 8,
    border: `1px solid ${active ? "#e33433" : "#113a72"}`,
    background: active ? "#113a72" : "#000000",
    color: "#ffffff",
    padding: "8px",
    cursor: "pointer",
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
  const [phase, setPhase] = useState("questions"); // questions | results | submitted | account | userdb | orders | plans
  const [contractorName, setContractorName] = useState("");
  const [jobName, setJobName] = useState("");
  const [submittedDraft, setSubmittedDraft] = useState(null);
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
  const [savedOrders, setSavedOrders] = useState([]);
  const [currentPlan, setCurrentPlan] = useState("Free");
  const [poCountThisYear, setPoCountThisYear] = useState(0);
  const [poHistory, setPoHistory] = useState([]);
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
  const [adminSelfTierDraft, setAdminSelfTierDraft] = useState("msrp");
  const [adminSelfPlanDraft, setAdminSelfPlanDraft] = useState("Free");
  const [adminSelfSaveNotice, setAdminSelfSaveNotice] = useState("");
  const [contractorAdminDraft, setContractorAdminDraft] = useState(null);
  const [contractorAdminSaveNotice, setContractorAdminSaveNotice] = useState("");
  const recommendedSectionRef = useRef(null);
  const prevSystemFamilyRef = useRef(null);

  function goToPlans(fromPhase) {
    setPlansReturnPhase(fromPhase);
    setPhase("plans");
  }

  function plansBackLabel() {
    switch (plansReturnPhase) {
      case "results":
        return "← Back to order summary";
      case "submitted":
        return "← Back to thank you";
      case "account":
        return "← Back to account";
      default:
        return "← Back to app";
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
    const { error } = await supabase.from("profiles").update(next).eq("email", email);
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

  function saveContractorPricingForUser(targetEmail, assignedKey) {
    return updateProfileByEmail(targetEmail, { assignedPricingTierKey: assignedKey, needsAdminReview: false });
  }

  function updateContractorPricingFlags(targetEmail, updates) {
    return updateProfileByEmail(targetEmail, updates);
  }

  function updateUserPlanForUser(targetEmail, planTag) {
    const membership_tier = tierTagToMembershipTier(planTag);
    return updateProfileByEmail(targetEmail, { membership_tier });
  }

  function setEcosPricingAdminForUser(targetEmail, isAdmin) {
    return updateProfileByEmail(targetEmail, { ecosPricingAdmin: !!isAdmin });
  }

  async function saveAdminSelfTesting() {
    if (!currentUser || !isPricingMasterEmail(currentUser, userProfile)) return;
    const email = currentUser.trim().toLowerCase();
    const ok = await updateProfileByEmail(email, {
      assignedPricingTierKey: adminSelfTierDraft,
      membership_tier: tierTagToMembershipTier(adminSelfPlanDraft),
      needsAdminReview: false,
    });
    if (ok) {
      setAdminSelfSaveNotice("Saved — your test settings are in effect.");
      setTimeout(() => setAdminSelfSaveNotice(""), 4000);
    }
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
    const existing = normalizeUserProfile(userProfile || {});
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
      pos_submitted_this_year: existing.pos_submitted_this_year || 0,
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
    return data;
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
    const profile = normalizeUserProfile(profileForWindow || userProfile || {});
    const start = getAnniversaryWindowStart(profile.signup_anniversary_date).toISOString();
    setPoCountThisYear(rows.filter((o) => (o.created_at || "") >= start).length);
  }

  async function updateProfileFields(fields) {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", session.user.id)
      .select()
      .single();
    if (error) {
      window.alert(error.message || "Unable to update profile.");
      return;
    }
    const merged = normalizeUserProfile({ ...(userProfile || {}), ...(data || fields) });
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

  async function chooseMembershipPlan(planId) {
    if (!session?.user?.id) {
      setPhase("questions");
      return;
    }
    if (planId === "tier1") {
      window.alert("Stripe integration coming soon.");
      return;
    }
    const tier = planId === "tier2" ? "tier2" : "free";
    try {
      await updateProfileFields({ membership_tier: tier });
    } catch (_) {
      // Keep navigation responsive even if profile write is blocked.
    }
    setCurrentPlan(membershipTierToPlanTag(tier));
    setPhase("questions");
  }

  const autoSystemKey = getRecommendedSystem(answers, currentPlan);
  const activeSystemKey = manualSystemKey || autoSystemKey;
  const isFreePlan = currentPlan === "Free";
  const isRecommendedSystemLocked = Boolean(activeSystemKey) && isFreePlan && !FREE_UNLOCKED_SYSTEMS.has(activeSystemKey);
  const activeSystemFamily = getSystemFamily(activeSystemKey || "");
  const activeCategory = getSystemCategory(activeSystemKey || "");
  const activeTheme = CATEGORY_THEME[activeCategory];
  const recommendedSystem = activeSystemKey ? SYSTEMS[activeSystemKey] : null;
  const locationSystems = getFullLocationSystemKeys(answers.location);
  const otherLocationSystems = locationSystems.filter((key) => key !== activeSystemKey);
  const finishOptionsForPlan = FINISH_OPTIONS;
  const benchmarkDisclaimer = `Material benchmark @ ${SYSTEM_BENCHMARK_SQFT} ft² using purchasable kits (no crack repair / no steps).`;
  const activeSystemBenchmarkPerSqFt = activeSystemKey
    ? getSystemMaterialBenchmarkPerSqFt(activeSystemKey, contractorPricingTierKey, answers, speed)
    : null;
  const speedIsRequired = answers.location === "exterior" && activeSystemKey === "FLK-OD-RES";
  const shouldAskUseType = !isFreePlan;
  const hasRequiredRefineAnswers = Boolean((!shouldAskUseType || answers.use) && answers.moisture && answers.cracks);
  const hasColorSelection = Boolean(answers.color);
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
              textColor: match?.textColor || "#ffffff",
              swatchUrl: solidSwatchUrls[makeSwatchKey(value)] || null,
            };
          })
        : STOCKED_COLORS.map((color) => ({
            ...color,
            swatchUrl: flakeSwatchUrls[makeSwatchKey(color.value)] || null,
          }));
  const readyForQuote =
    Boolean(activeSystemKey) &&
    !isRecommendedSystemLocked &&
    sqFt !== "" &&
    hasRequiredRefineAnswers &&
    hasColorSelection &&
    hasSpeedSelection;

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
      if (qid === "color") {
        const autoBaseCoat = getAutoBaseCoatFromFlakeColor(val);
        if (autoBaseCoat) {
          next.baseCoatColor = autoBaseCoat;
        }
      }
      return next;
    });
    if (["location", "finish", "use", "moisture", "cracks"].includes(qid)) {
      setManualSystemKey(null);
    }
    if (qid === "location" && val !== "exterior") {
      setFinishTypeError("");
    }
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
      steps,
      speed,
    };
    const layers = recommendedSystem.layers(sf, opts);
    const orderLines = buildOrderList(layers, contractorPricingTierKey, answers);
    const requiredMaterialTierTotal = getRequiredMaterialTierTotal(layers, contractorPricingTierKey, answers);
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

  useEffect(() => {
    let mounted = true;
    async function bootstrapAuth() {
      setIsAuthLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        const activeSession = data.session || null;
        setSession(activeSession);
        setCurrentUser(activeSession?.user?.email?.toLowerCase() || null);
        if (activeSession) {
          try {
            const p = await ensureProfileForSession(activeSession);
            setCurrentPlan(membershipTierToPlanTag(p?.membership_tier || "free"));
            setContractorPricingTierKey(getEffectiveContractorPricingTierKey(p || {}));
            setAssignedPricingTierKey(normalizeUserProfile(p || {}).assignedPricingTierKey || "msrp");
            await loadPoHistory(activeSession, p);
            await loadAdminProfiles(activeSession);
          } catch (err) {
            setAuthError(err?.message || "Unable to load your account profile.");
          }
        } else {
          setUserProfile(null);
          setAllProfilesByEmail({});
          setCurrentPlan("Free");
          setContractorPricingTierKey("msrp");
          setAssignedPricingTierKey("msrp");
          setPoHistory([]);
          setPoCountThisYear(0);
        }
      } finally {
        if (mounted) setIsAuthLoading(false);
      }
    }
    bootstrapAuth();
    const { data: authSubscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setIsAuthLoading(false);
      setSession(nextSession || null);
      const nextEmail = nextSession?.user?.email?.toLowerCase() || null;
      setCurrentUser(nextEmail);
      if (!nextSession) {
        setUserProfile(null);
        setCurrentPlan("Free");
        setContractorPricingTierKey("msrp");
        setAssignedPricingTierKey("msrp");
        setPoHistory([]);
        setPoCountThisYear(0);
        return;
      }
      try {
        const p = await ensureProfileForSession(nextSession);
        setCurrentPlan(membershipTierToPlanTag(p?.membership_tier || "free"));
        setContractorPricingTierKey(getEffectiveContractorPricingTierKey(p || {}));
        setAssignedPricingTierKey(normalizeUserProfile(p || {}).assignedPricingTierKey || "msrp");
        await loadPoHistory(nextSession, p);
        await loadAdminProfiles(nextSession);
      } catch (err) {
        setAuthError(err?.message || "Unable to refresh your session.");
      }
    });
    return () => {
      mounted = false;
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
    let mounted = true;
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
      return best;
    }
    const isRenderableImage = (name = "") => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name);
    async function listFolder(path) {
      const { data, error } = await supabase.storage.from(SUPABASE_SWATCH_BUCKET).list(path, { limit: 300 });
      if (error) {
        if (mounted) console.warn("[ECOS swatches] list failed:", path || "/", error.message);
        return [];
      }
      if (!mounted) return [];
      return data || [];
    }
    /** Folder vs file: Supabase list items often omit `id` on files — do not rely on it. */
    function hasFilenameExtension(name = "") {
      return /\.[a-z0-9]{2,8}$/i.test(name);
    }
    /**
     * Detect flake/metallic/solid from the real Storage path (folder names).
     * Important: makeSwatchKey() strips words like "flake" and "solid", so never rely on pathKey alone for folders like "Flake Swatches/".
     */
    function familyFromRelativePath(relPath = "") {
      const p = relPath.toLowerCase();
      if (p.includes("metallic")) return "metallic";
      if (p.includes("solid")) return "solid";
      if (p.includes("flake")) return "flake";
      return null;
    }
    function familyFromPath(pathKey, fileKey) {
      if (/metallic/.test(pathKey) || metallicKeys.has(fileKey)) return "metallic";
      if (/solid/.test(pathKey) || solidKeys.has(fileKey)) return "solid";
      if (/flake/.test(pathKey) || flakeKeys.has(fileKey)) return "flake";
      return null;
    }
    /** When folder names omit flake/solid/metallic, infer family from which catalog key matches the filename. */
    function inferFamilyFromCatalogKeys(fileKey) {
      const mf = resolveCatalogKey(fileKey, flakeKeys);
      const mm = resolveCatalogKey(fileKey, metallicKeys);
      const ms = resolveCatalogKey(fileKey, solidKeys);
      const hits = [
        mf ? ["flake", mf] : null,
        mm ? ["metallic", mm] : null,
        ms ? ["solid", ms] : null,
      ].filter(Boolean);
      if (hits.length === 1) return { family: hits[0][0], mappedKey: hits[0][1] };
      return null;
    }
    async function loadAllSwatches() {
      const flakeNext = {};
      const metallicNext = {};
      const solidNext = {};
      const queue = [""];
      const visited = new Set();
      let depth = 0;

      while (queue.length && depth < 8) {
        const currentBatch = [...queue];
        queue.length = 0;
        for (const folder of currentBatch) {
          if (visited.has(folder)) continue;
          visited.add(folder);
          const entries = await listFolder(folder);
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
            let mappedFlakeKey = resolveCatalogKey(fileKey, flakeKeys);
            let mappedMetallicKey = resolveCatalogKey(fileKey, metallicKeys);
            let mappedSolidKey = resolveCatalogKey(fileKey, solidKeys);

            if (!family) {
              const inferred = inferFamilyFromCatalogKeys(fileKey);
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
            if (family === "flake" && mappedFlakeKey) flakeNext[mappedFlakeKey] = url;
            if (family === "metallic" && mappedMetallicKey) metallicNext[mappedMetallicKey] = url;
            if (family === "solid" && mappedSolidKey) solidNext[mappedSolidKey] = url;
          }
        }
        depth += 1;
      }
      if (!mounted) return;
      setFlakeSwatchUrls(flakeNext);
      setMetallicSwatchUrls(metallicNext);
      setSolidSwatchUrls(solidNext);
    }
    loadAllSwatches();
    return () => {
      mounted = false;
    };
  }, []);

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
    if (manualSystemKey && answers.location && !locationSystems.includes(manualSystemKey)) {
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
        ...(activeSystemFamily === "flake" ? {} : { baseCoatColor: "" }),
      }));
    }
    prevSystemFamilyRef.current = activeSystemFamily;
  }, [activeSystemFamily]);

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
    if (membershipTier === "tier1" && poCountThisYear >= MAX_TIER1_POS_PER_YEAR) {
      const wantsUpgrade = window.confirm("You have reached 50 PO submissions this year. Upgrade to Tier 2?");
      if (wantsUpgrade) setPhase("plans");
      return;
    }
    if (activeSystemFamily === "flake" && baseCoatDeviatesFromFlakeRecommendation(answers.color, answers.baseCoatColor)) {
      const pick = answers.baseCoatColor || "this base coat color";
      const recs = getRecommendedBaseCoatLabels(answers.color);
      const recHint = recs.length ? ` Recommended for this flake: ${recs.join(" or ")}.` : "";
      const ok = window.confirm(
        `Are you sure you want "${pick}" as the base coat color?${recHint}`
      );
      if (!ok) return;
    }
    const body = buildFgOrderEmailBody({
      jobNamePo: contractorName,
      address: jobName,
      systemCode: recommendedSystem.code,
      systemLabel: recommendedSystem.label,
      sqFt: combinedTotals.totalSqFt,
      tierLabel: TIERS[contractorPricingTierKey].label,
      tierMult: TIERS[contractorPricingTierKey].mult,
      orderLines: combinedOrderLines,
      totalMsrp: combinedTotals.totalMsrp,
      totalDiscount: combinedTotals.totalDiscount,
      totalTier: combinedTotals.totalTier,
      requiredMaterialTierTotal: combinedTotals.requiredMaterialTierTotal,
    });
    const subject = `ECOS order — ${contractorName || "Job"} — ${orderJobs.length + 1} job(s)`;
    setSubmittedDraft({
      subject,
      body,
      jobNamePo: contractorName || "Untitled Job / PO",
      address: jobName || "—",
      systemCode: recommendedSystem.code,
      totalTier: combinedTotals.totalTier,
      sqFt: combinedTotals.totalSqFt,
      costPerSqFt:
        combinedTotals.totalSqFt > 0
          ? +(combinedTotals.requiredMaterialTierTotal / combinedTotals.totalSqFt).toFixed(2)
          : 0,
    });
    setOrderSubmitMessage("Sending PO to FGP Midwest...");
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
      console.error(sendErr);
    }
    if (session?.user?.id) {
      const jobs = [...orderJobs, currentJobSnapshot].filter(Boolean).map((j) => ({
        jobNamePo: j.jobNamePo,
        systemCode: j.systemCode,
        sqFt: j.sf,
        totalTier: j.totalTier,
        color: j.color,
        costPerSqFt: j.requiredMaterialCostPerSqFt,
        orderLines: j.orderLines || [],
      }));
      const orderRecord = {
        user_id: session.user.id,
        created_at: new Date().toISOString(),
        job_name: contractorName || "Untitled Job / PO",
        address: jobName || "—",
        system_code: recommendedSystem.code,
        total_cost: combinedTotals.totalTier,
        sq_footage: combinedTotals.totalSqFt,
        cost_per_sqft:
          combinedTotals.totalSqFt > 0
            ? +(combinedTotals.requiredMaterialTierTotal / combinedTotals.totalSqFt).toFixed(2)
            : 0,
        order_lines: combinedOrderLines,
        jobs,
      };
      const { data: inserted, error } = await supabase.from("orders").insert(orderRecord).select().single();
      if (error) {
        window.alert(error.message || "Unable to save order to cloud history.");
      } else {
        const nextHistory = [inserted, ...poHistory];
        setPoHistory(nextHistory);
        const start = getAnniversaryWindowStart(userProfile?.signup_anniversary_date).toISOString();
        const countInWindow = nextHistory.filter((o) => (o.created_at || "") >= start).length;
        setPoCountThisYear(countInWindow);
        const now = new Date();
        const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
        const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1).toISOString();
        const totalQuarter = nextHistory
          .filter((o) => (o.created_at || "") >= quarterStart)
          .reduce((sum, o) => sum + Number(o.total_cost || o.totalTier || 0), 0);
        const totalYear = nextHistory
          .filter((o) => (o.created_at || "") >= start)
          .reduce((sum, o) => sum + Number(o.total_cost || o.totalTier || 0), 0);
        updateProfileFields({
          pos_submitted_this_year: countInWindow,
          total_pos_value_this_quarter: totalQuarter,
          total_pos_value_this_year: totalYear,
        });
      }
    }
    setPhase("submitted");
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
      } catch (_) {
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

  function printJobCard(orderRecord) {
    const win = window.open("", "_blank", "width=980,height=720");
    if (!win) return;
    const jobs = Array.isArray(orderRecord.jobs) && orderRecord.jobs.length ? orderRecord.jobs : [{
      jobNamePo: orderRecord.job_name || orderRecord.jobNamePo,
      systemCode: orderRecord.system_code || orderRecord.systemCode,
      sqFt: orderRecord.sq_footage || orderRecord.sqFt,
      orderLines: orderRecord.order_lines || [],
    }];
    const cards = jobs
      .map((job) => {
        const lines = (job.orderLines || orderRecord.order_lines || [])
          .map((l) => `<li>${l.product} — ${l.qty} x ${l.kitSize} (usage: ${l.totalNeeded})</li>`)
          .join("");
        return `
          <div class="card">
            <h2>${job.jobNamePo || orderRecord.jobNamePo || "Job Card"}</h2>
            <p><strong>Date:</strong> ${new Date(orderRecord.created_at || orderRecord.submittedAt || Date.now()).toLocaleDateString()}</p>
            <p><strong>System:</strong> ${job.systemCode || orderRecord.systemCode || "—"}</p>
            <p><strong>Sq Ft:</strong> ${Number(job.sqFt || orderRecord.sqFt || 0).toLocaleString()}</p>
            <p><strong>Materials:</strong></p>
            <ul>${lines || "<li>No line items captured.</li>"}</ul>
          </div>
        `;
      })
      .join("");
    win.document.write(`
      <html>
        <head>
          <title>Job Card</title>
          <style>
            @media print { .grid { page-break-inside: avoid; } }
            body { font-family: Arial, sans-serif; margin: 18px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .card { border: 1px solid #222; padding: 12px; min-height: 350px; }
            h2 { margin: 0 0 8px; font-size: 18px; }
            p { margin: 4px 0; font-size: 13px; }
            ul { margin: 6px 0 0 16px; font-size: 12px; line-height: 1.45; }
          </style>
        </head>
        <body>
          <div class="grid">${cards}</div>
          <script>window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <div style={{ ...S.app, background: `linear-gradient(180deg, ${activeTheme.tint} 0%, #000000 42%)` }}>
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
                  title="Account menu"
                >
                  ☰ Account
                </button>
              </div>
              {headerMenuOpen && (
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
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
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setPhase("orders");
                    }}
                  >
                    My Orders
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
              <div style={{ display: "grid", gap: 10 }}>
                {authMode !== "reset" && (
                  <input style={S.input} placeholder="Email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    style={{ ...S.input, flex: 1 }}
                    type={authShowPassword ? "text" : "password"}
                    placeholder={authMode === "reset" ? "New password" : "Password"}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
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
                <button type="button" style={S.btn} onClick={handleAuthSubmit}>
                  {authMode === "login" ? "Login" : authMode === "create" ? "Create Account" : "Set New Password"}
                </button>
                {authMode === "login" && (
                  <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={handleForgotPassword}>
                    Forgot password?
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {currentUser && membershipTier === "tier1" && poCountThisYear >= 45 && poCountThisYear < MAX_TIER1_POS_PER_YEAR && (
          <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.14)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
              You have {MAX_TIER1_POS_PER_YEAR - poCountThisYear} PO submissions remaining this year.
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
            {/* Tier + Job Info */}
            <div style={S.sectionHead}>Job Setup</div>
            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Job Name / PO #</div>
                  <input style={S.input} value={contractorName} onChange={e => setContractorName(e.target.value)} placeholder="e.g. Smith Flooring Co." />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#d2def1", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5, fontFamily: "'Encode Sans Expanded', sans-serif" }}>Address</div>
                  <input style={S.input} value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. 123 Main St Garage" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
                  <input
                    style={S.input}
                    value={sqFt}
                    onClick={() => {
                      setCalcValue(sqFt);
                      setCalcUnit("sqft");
                      setShowAreaCalc(true);
                    }}
                    placeholder="Tap to enter area"
                    readOnly
                  />
                  <div style={{ marginTop: 6, fontSize: 10, color: "#9bb2d1" }}>Mobile calculator supports sq/ft, m2 (ms2), and yd2.</div>
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
                      This system requires Tier 1 — The Calculator. Upgrade to unlock all 9 ET flooring systems.
                    </div>
                    <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("plans")}>
                      Upgrade to unlock
                    </button>
                  </div>
                ) : (
                  <div style={{ ...S.card, border: `1px solid ${activeTheme.accent}`, background: "rgba(15, 36, 64, 0.88)" }}>
                    <div style={S.badge}>Recommended System</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4, fontFamily: "'Montserrat', sans-serif" }}>
                      {recommendedSystem.code}
                    </div>
                    <div style={{ fontSize: 13, color: "#d2def1", marginBottom: 6 }}>{recommendedSystem.label}</div>
                    <div style={{ fontSize: 12, color: "#ffffff", marginBottom: 10 }}>
                      {getRecommendationReason(answers, activeSystemKey)}
                    </div>
                    {activeSystemBenchmarkPerSqFt !== null && (
                      <div style={{ marginBottom: 8 }}>
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
                </div>

                <div style={S.sectionHead}>Other Available {answers.location === "interior" ? "Indoor" : "Outdoor"} Systems</div>
                <div style={S.card}>
                  {otherLocationSystems.map((key) => {
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
                            setPhase("plans");
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
                          cursor: "pointer",
                          opacity: isLocked ? 0.75 : 1,
                        }}
                      >
                        <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 3 }}>
                          {SYSTEMS[key].code} - {SYSTEMS[key].label}
                        </div>
                        {benchmarkPerSqFt !== null && (
                          <div style={{ fontSize: 10, color: "#eab308", marginBottom: 2 }}>
                            Avg materials @ {SYSTEM_BENCHMARK_SQFT} ft²: ${benchmarkPerSqFt.toFixed(2)}/ft²
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: isLocked ? "#f5d676" : "#d2def1" }}>
                          {isLocked
                            ? "Locked on Free — upgrade to Tier 1 to unlock"
                            : "Tap to use this system instead"}
                        </div>
                      </button>
                    );
                  })}
                </div>
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

            {recommendedSystem && (
              <>
                <div style={S.sectionHead}>Color Selection</div>
                <div style={S.sectionSub}>
                  {activeSystemFamily === "metallic"
                    ? "Mica / Metallic color options"
                    : activeSystemFamily === "solid"
                      ? "Solid color options"
                      : "Below are our Stocked Colors"}
                </div>
                <div style={S.card}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {visibleColorOptions.map((color) => (
                      <button
                        key={color.value}
                        style={S.colorBtn(answers.color === color.value)}
                        onClick={() => answer("color", color.value)}
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
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  objectPosition: "center",
                                  /** Many flake PNGs have extra transparent margin — zoom clips so product fills tile. */
                                  transform: activeSystemFamily === "flake" ? "scale(1.28)" : "scale(1)",
                                  transformOrigin: "center center",
                                  display: "block",
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
                          <div style={{ fontSize: 12, fontFamily: "'Montserrat', sans-serif", fontWeight: 900, color: color.textColor || "#ffffff" }}>
                            {color.value}
                          </div>
                          {activeSystemFamily === "flake" && (
                            <div style={{ fontSize: 10, color: "#d2def1", marginTop: 2, lineHeight: 1.35 }}>
                              Recommended Base Coat Color: {color.recommendedBase}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

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
                {isRecommendedSystemLocked
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
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Product</th>
                      <th style={S.th}>Layer</th>
                      <th style={S.th}>Kit Size</th>
                      <th style={S.th}>Qty</th>
                      <th style={S.th}>Job Needs</th>
                      <th style={S.th}>MSRP ea</th>
                      <th style={S.th}>Your Price</th>
                      <th style={S.th}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.orderLines.map((line, i) => (
                      <tr key={i}>
                        <td style={S.tdBold}>{line.product}</td>
                        <td style={{ ...S.td, fontSize: 10, color: "#334155" }}>{line.layer}</td>
                        <td style={S.td}>{line.kitSize}</td>
                        <td style={S.tdBold}>{line.qty}</td>
                        <td style={{ ...S.td, fontSize: 10, color: "#475569" }}>{line.totalNeeded}</td>
                        <td style={S.td}>${line.msrpEa.toFixed(2)}</td>
                        <td style={{ ...S.td, color: "#e33433" }}>${line.tierEa.toFixed(2)}</td>
                        <td style={S.tdBold}>${line.lineTier.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr style={S.totalRow}>
                      <td colSpan={5} style={{ ...S.td, color: "#d2def1", fontSize: 10 }}>SUBTOTAL AT MSRP</td>
                      <td colSpan={3} style={S.tdBold}>${results.totalMsrp.toFixed(2)}</td>
                    </tr>
                    <tr style={S.totalRow}>
                      <td colSpan={5} style={{ ...S.td, color: "#e33433", fontSize: 10 }}>TOTAL DISCOUNT ({TIERS[contractorPricingTierKey].label})</td>
                      <td colSpan={3} style={{ ...S.tdBold, color: "#e33433" }}>-${results.totalDiscount.toFixed(2)}</td>
                    </tr>
                    <tr style={{ ...S.totalRow, background: "#0a1f38" }}>
                      <td colSpan={5} style={{ ...S.tdBold, color: "#ffffff", fontSize: 13 }}>CONTRACTOR PAYS</td>
                      <td colSpan={3} style={{ ...S.tdBold, color: "#ffffff", fontSize: 15 }}>${results.totalTier.toFixed(2)}</td>
                    </tr>
                    <tr style={{ ...S.totalRow, background: "#0a1830" }}>
                      <td colSpan={5} style={{ ...S.td, color: "#eab308", fontSize: 11 }}>
                        Job Materials Cost Breakdown. $/ft² on {results.sf.toLocaleString()} Based on Job Requirements, not total order volume
                      </td>
                      <td colSpan={3} style={{ ...S.tdBold, color: "#eab308", fontSize: 14 }}>
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
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Product</th>
                          <th style={S.th}>Kit Size</th>
                          <th style={S.th}>Qty</th>
                          <th style={S.th}>Combined Job Needs</th>
                          <th style={S.th}>Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedOrderLines.map((line, i) => (
                          <tr key={i}>
                            <td style={S.tdBold}>{line.product}</td>
                            <td style={S.td}>{line.kitSize}</td>
                            <td style={S.tdBold}>{line.qty}</td>
                            <td style={S.td}>{line.totalNeeded}</td>
                            <td style={S.tdBold}>${line.lineTier.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr style={{ ...S.totalRow, background: "rgba(234, 179, 8, 0.15)" }}>
                          <td colSpan={4} style={{ ...S.tdBold, color: "#f5d676" }}>CONSOLIDATED CONTRACTOR PAYS</td>
                          <td style={{ ...S.tdBold, color: "#f5d676" }}>${combinedTotals.totalTier.toFixed(2)}</td>
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
                style={{
                  ...S.btnSm,
                  width: "100%",
                  background: "#113a72",
                  color: "#ffffff",
                  border: "1px solid #113a72",
                  opacity: totalJobsInOrder >= maxActiveJobs ? 0.65 : 1,
                }}
                onClick={handleAddAnotherJobToOrder}
              >
                Add Another Job to Order
              </button>
              {totalJobsInOrder >= maxActiveJobs && (
                <>
                  <div style={{ fontSize: 11, color: "#9bb2d1", textAlign: "center" }}>
                    {membershipTier === "tier1"
                      ? `Tier 1 active-job limit reached (${MAX_TIER1_JOBS} jobs max).`
                      : `Free plan limit reached (${MAX_FREE_JOBS} jobs max).`}
                  </div>
                  <button
                    type="button"
                    style={{ ...S.btnSm, width: "100%", border: "1px solid #eab308", color: "#f5d676", background: "rgba(234, 179, 8, 0.1)" }}
                    onClick={() => setPhase("plans")}
                  >
                    Upgrade plan to add more jobs
                  </button>
                </>
              )}
              <button type="button" style={{ ...S.btn, background: activeTheme.accent, marginTop: 0 }} onClick={() => window.print()}>
                Print / Save PO
              </button>
              {/*
                ROADMAP — Tier 2 "The Estimator": CFO-backed profit tool. Inputs: material line list + tier $ from this
                screen (results.orderLines, combinedOrderLines, requiredMaterialTierTotal / costPer ft²), sell price &
                labor assumptions from Estimator. Output: margin $, margin %, profit per job / consolidated PO.
                Implement calculateJobProfit(...) and enable when currentPlan / subscription includes Estimator.
              */}
              <button type="button" style={{ ...S.hookDisabled, width: "100%" }} disabled>
                Calculate profit (Upgrade to Tier 2 — The Estimator)
              </button>
              <button
                type="button"
                style={{ ...S.btn, background: "#e33433", marginTop: 0 }}
                onClick={handleSubmitOrder}
              >
                Submit Order to FGP Midwest
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
                Your Order has been submitted. We will begin staging your order and ordering in anything not in Stock, we will Notify you within 24-48 hrs. of a total ETA on all products in the order.
              </div>
              {orderSubmitMessage && (
                <div style={{ fontSize: 12, color: "#f5d676", marginBottom: 10 }}>{orderSubmitMessage}</div>
              )}
              <div style={{ fontSize: 12, color: "#d2def1", lineHeight: 1.6 }}>
                <div><span style={{ color: "#9bb2d1" }}>Job / PO #:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.jobNamePo}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Address:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.address}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>System:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.systemCode}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Sq Ft:</span> <span style={{ color: "#ffffff" }}>{submittedDraft.sqFt.toLocaleString()} ft²</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Total:</span> <span style={{ color: "#ffffff" }}>${submittedDraft.totalTier.toFixed(2)}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Cost / ft²:</span> <span style={{ color: "#eab308" }}>${submittedDraft.costPerSqFt.toFixed(2)}/ft²</span></div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button type="button" style={{ ...S.btn, background: "#e33433", marginTop: 0 }} onClick={reset}>
                Start a New Order
              </button>
              <button
                type="button"
                style={S.hookDisabled}
                disabled
              >
                Print Job Card (Upgrade to Tier 1, The Calculator)
              </button>
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
                <div><span style={{ color: "#9bb2d1" }}>POs used this year:</span> <span style={{ color: "#ffffff" }}>{poCountThisYear}{membershipTier === "tier1" ? ` / ${MAX_TIER1_POS_PER_YEAR}` : ""}</span></div>
                <div><span style={{ color: "#9bb2d1" }}>Signup anniversary:</span> <span style={{ color: "#ffffff" }}>{new Date((userProfile?.signup_anniversary_date || Date.now())).toLocaleDateString()}</span></div>
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
                          <button type="button" style={S.btnSm} onClick={() => setPhase("questions")}>
                            Back to ECOS
                          </button>
                        </div>
                        {adminSelfSaveNotice && (
                          <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>{adminSelfSaveNotice}</div>
                        )}
                        <div style={{ fontSize: 10, color: "#9bb2d1", lineHeight: 1.45 }}>
                          Effective pricing preview (after save uses cloud profile):{" "}
                          <span style={{ color: "#ffffff", fontWeight: 700 }}>
                            {TIERS[getEffectiveContractorPricingTierKey({ ...me, assignedPricingTierKey: adminSelfTierDraft, membership_tier: tierTagToMembershipTier(adminSelfPlanDraft) })].label}
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

            {false && !ACCOUNT_HIDE_PAST_ORDERS_EMAILS.has(currentUser.trim().toLowerCase()) && (
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
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("questions")}>
                Back to App
              </button>
            </div>
          </>
        )}

        {currentUser && phase === "orders" && (
          <>
            <div style={S.sectionHead}>My Orders</div>
            {membershipTier === "free" ? (
              <div style={{ ...S.card, border: "1px solid #eab308", background: "rgba(234, 179, 8, 0.08)" }}>
                <div style={{ fontSize: 12, color: "#f5d676", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 8 }}>
                  Upgrade to Tier 1 to unlock Unlimited PO submission, more order history, and Job Card printing.
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
                <button type="button" style={{ ...S.btn, marginTop: 12 }} onClick={() => setPhase("plans")}>
                  Upgrade to Tier 1 — $49/mo
                </button>
              </div>
            ) : (
              <div style={S.card}>
                {poHistory.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#9bb2d1" }}>No submitted orders yet.</div>
                ) : (
                  poHistory.map((o, i) => (
                    <div key={`${o.id || o.created_at}-${i}`} style={{ borderBottom: "1px solid #113a72", padding: "10px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#ffffff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>
                            {o.job_name || o.jobNamePo || "Untitled Job / PO"}
                          </div>
                          <div style={{ fontSize: 10, color: "#9bb2d1" }}>
                            {new Date(o.created_at).toLocaleDateString()} · {o.system_code || o.systemCode || "—"} · {Number(o.sq_footage || o.sqFt || 0).toLocaleString()} ft² · ${Number(o.total_cost || o.totalTier || 0).toFixed(2)}
                          </div>
                        </div>
                        <button type="button" style={S.btnSm} onClick={() => printJobCard(o)}>
                          Print Job Card
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase("questions")}>
              Back to App
            </button>
          </>
        )}

        {currentUser && phase === "plans" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => setPhase(plansReturnPhase)}>
                {plansBackLabel()}
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
                  <li>Unlock all 9 ET flooring systems</li>
                  <li>10 active jobs in cart</li>
                  <li>Submit PO to FGP Midwest - UNLIMITED</li>
                  <li>50 POs saved per year</li>
                  <li>PO history in My Orders</li>
                  <li>Job Card printing (2 per page)</li>
                  <li>Upgrade prompts at 45 POs</li>
                </ul>
                <button type="button" style={{ ...S.btn, width: "100%", marginTop: 0 }} onClick={() => chooseMembershipPlan("tier1")}>
                  Upgrade to Tier 1 — $49/mo
                </button>
              </div>
              <div style={{ ...S.card, border: "1px solid #113a72", opacity: 0.6 }}>
                <div style={{ fontSize: 16, color: "#9bb2d1", fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}>Tier 2 (Coming Soon)</div>
                <ul style={{ margin: "8px 0 12px 16px", color: "#9bb2d1", fontSize: 11, lineHeight: 1.5 }}>
                  <li>Everything in Tier 1</li>
                  <li>Customer-facing branded estimates</li>
                  <li>Logo upload + brand colors</li>
                  <li>White label app experience</li>
                  <li>Custom system builder (up to 6 components)</li>
                  <li>Full job lifecycle management</li>
                </ul>
                <button type="button" style={{ ...S.btnSm, width: "100%" }} onClick={() => window.alert("Stripe integration coming soon.")}>
                  Upgrade to Tier 2 — Coming Soon
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
