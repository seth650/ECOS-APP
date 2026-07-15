import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { ensurePoYearCurrent, incrementAnnualPoCount, isTier1PoLimitReached } from "./_lib/poTracking.js";
import { MAX_TIER1_POS_PER_YEAR } from "../src/poLimits.js";
import { PRODUCTS } from "../src/products.js";
import { isAncillaryCategory } from "../src/materialOrderCatalog.js";
import { getMaterialOrderPricingTierKey, MATERIAL_PRICING_TIERS } from "../src/materialOrderPricing.js";

const GARY_EMAIL = "gary@dynastyepoxy.com";

/** Short tags for Gary's PO email lines. */
const EMAIL_TIER_TAG = {
  small: "SMALL BUYER",
  tier2: "TIER 2",
  preferred: "PREFERRED PARTNER",
  msrp: "MSRP",
};

const TIER_RANK = { msrp: 0, small: 1, tier2: 2, preferred: 3 };

const DISCOUNT_PCT = {
  small: 5,
  tier2: 10,
  preferred: 15,
  msrp: 0,
};

function usd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

/** Normalize any tier-ish string to a catalog key. */
function normalizeTierKey(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "small" || s.includes("small buyer") || s === "tier1" || s === "tier 1") return "small";
  if (s === "preferred" || s.includes("preferred")) return "preferred";
  if (s === "tier2" || s === "tier 2" || s.includes("contractor")) return "tier2";
  if (s === "msrp" || s.includes("msrp")) return "msrp";
  if (MATERIAL_PRICING_TIERS[s]) return s;
  return null;
}

/**
 * Resolve buying tier for material PO pricing.
 * Prefer explicit order/client tier over a weaker DB-derived tier so Testing Mode discounts stick.
 */
function resolveMaterialTierKey(profile, orderPricingTierKey) {
  const fromProfile = normalizeTierKey(getMaterialOrderPricingTierKey(profile)) || "msrp";
  const fromOrder = normalizeTierKey(orderPricingTierKey);
  const assigned = normalizeTierKey(profile?.contractor_tier || profile?.assignedPricingTierKey);
  const fgpUnlocked = !!(profile?.isFgpCustomer && profile?.contractorPricingApplicationReceived);

  const candidates = [fromProfile];
  if (fromOrder) candidates.push(fromOrder);
  // Testing Mode / FGP: honor assigned buying tier when unlocked.
  if (fgpUnlocked && assigned && assigned !== "msrp") candidates.push(assigned);
  // Tier 1 membership always at least Small Buyer for materials.
  const mem = String(profile?.membership_tier || "").toLowerCase();
  if (mem === "tier1" || mem === "tier 1") candidates.push("small");

  let best = "msrp";
  for (const key of candidates) {
    if ((TIER_RANK[key] || 0) > (TIER_RANK[best] || 0)) best = key;
  }
  // Prefer exact assigned/order when equal rank intent is small vs msrp already handled
  if (best === "msrp" && (fromOrder === "small" || assigned === "small" || fromProfile === "small")) {
    best = "small";
  }
  return best;
}

function tierDisplayLabel(tierKey) {
  const pct = DISCOUNT_PCT[tierKey] ?? 0;
  if (tierKey === "small") return `Small Buyer (${pct}% off MSRP)`;
  if (tierKey === "tier2") return `Tier 2 / Contractor (${pct}% off MSRP)`;
  if (tierKey === "preferred") return `Preferred Partner (${pct}% off MSRP)`;
  return "MSRP (0% off)";
}

/**
 * Tier-discounted unit price for a kit.
 * Main products: Small 5% / Tier2 10% / Preferred 15%.
 * Ancillaries: Preferred 5%, else MSRP.
 */
function discountedUnitPrice(productKey, kitIndex, categoryId, tierKey) {
  const product = PRODUCTS[productKey];
  const kit = product?.kits?.[kitIndex] || product?.kits?.[0];
  const msrp = Number(kit?.msrp || 0);

  // Prefer explicit kit tier table when present (e.g. HyperPrime / EZ Top).
  if (kit?.tierPrices && typeof kit.tierPrices[tierKey] === "number") {
    return { msrp, unitPrice: +Number(kit.tierPrices[tierKey]).toFixed(2), kit, product };
  }

  const tier = MATERIAL_PRICING_TIERS[tierKey] || MATERIAL_PRICING_TIERS.msrp;
  const ancillary = isAncillaryCategory(categoryId);
  const mult = ancillary ? tier.ancillaryMult : tier.mainMult;
  const unitPrice = +(msrp * mult).toFixed(2);
  return { msrp, unitPrice, kit, product, mult, ancillary };
}

/**
 * Recalculate every line — never trust client unitPrice / lineTotal.
 */
function recalculateOrderLines(rawItems, tierKey) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((raw) => {
      if (!raw?.productKey) return null;
      const kitIndex = Number(raw.kitIndex || 0);
      const categoryId = raw.categoryId || "";
      const qty = Math.max(1, Math.floor(Number(raw.qty) || 1));
      const { msrp, unitPrice, kit, product } = discountedUnitPrice(
        raw.productKey,
        kitIndex,
        categoryId,
        tierKey
      );
      const lineMsrp = +(msrp * qty).toFixed(2);
      const lineTotal = +(unitPrice * qty).toFixed(2);
      const savings = +(lineMsrp - lineTotal).toFixed(2);
      return {
        productKey: raw.productKey,
        productName: product?.name || raw.productName || raw.productKey,
        kitSize: kit?.size || raw.kitSize || "—",
        kitIndex,
        categoryId,
        categoryLabel: raw.categoryLabel || "",
        qty,
        unitMsrp: msrp,
        unitPrice, // discounted
        lineMsrp,
        lineTotal, // discounted
        savings,
      };
    })
    .filter(Boolean);
}

function summarizeLines(lines) {
  const totalMsrp = +lines.reduce((s, l) => s + Number(l.lineMsrp || 0), 0).toFixed(2);
  const totalPrice = +lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0).toFixed(2);
  const totalDiscount = +(totalMsrp - totalPrice).toFixed(2);
  return { totalMsrp, totalDiscount, totalPrice };
}

function formatMaterialOrderEmail({ order, profile, tierKey, pricedLines, totals }) {
  const email = profile?.email || order?.user_email || "—";
  const company = profile?.company_name || profile?.businessName || "—";
  const first = profile?.first_name || profile?.firstName || "";
  const last = profile?.last_name || profile?.lastName || "";
  const name = `${first} ${last}`.trim() || profile?.contractorName || email;
  const membership = profile?.membership_tier || "—";
  const contractorTier = profile?.contractor_tier || profile?.assignedPricingTierKey || "—";
  const tierTag = EMAIL_TIER_TAG[tierKey] || "MSRP";
  const tierLabel = tierDisplayLabel(tierKey);

  // Example: Aspartic 85 Slow Go (Low Odor) | 3 gal x1 | SMALL BUYER $285.00 ea | line $285.00 | saves $15.00
  const lines = pricedLines
    .map((line) => {
      const discountedEa = Number(line.unitPrice);
      const msrpEa = Number(line.unitMsrp);
      return `${line.productName} | ${line.kitSize} x${line.qty} | ${tierTag} ${usd(discountedEa)} ea | line ${usd(line.lineTotal)} | saves ${usd(line.savings)} (MSRP ${usd(msrpEa)} ea)`;
    })
    .join("\n");

  const body = `ECOS Material Order — submitted ${order?.created_at ? new Date(order.created_at).toLocaleString() : "—"}

Customer
  Name: ${name}
  Email: ${email}
  Company: ${company}
  Membership tier: ${membership}
  Contractor / FGP tier: ${contractorTier}
  Material pricing applied: ${tierLabel}

Line items
${lines || "(none)"}

Totals
  Total MSRP: ${usd(totals.totalMsrp)}
  TOTAL DISCOUNT FROM MSRP: ${usd(totals.totalDiscount)}
  CONTRACTOR PAYS: ${usd(totals.totalPrice)}

Order ID: ${order?.id || "—"}
Status: ${order?.status || "submitted"}

— Sent automatically from ECOS (epoxyquoting.com)`;

  const subject = `ECOS Material PO — ${name} — ${usd(totals.totalPrice)}`;
  return { subject, body };
}

async function sendGaryEmail(emailArgs) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const { subject, body } = formatMaterialOrderEmail(emailArgs);
  const from = process.env.MATERIAL_PO_EMAIL_FROM || "ECOS Orders <orders@dynastyepoxy.com>";

  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [GARY_EMAIL],
      subject,
      text: body,
    }),
  });

  const json = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const err = new Error(json?.message || "Email provider rejected request.");
    err.status = upstream.status;
    throw err;
  }
  return json;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header." });
    }
    const jwt = authHeader.slice(7);

    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return res.status(500).json({ error: "Supabase URL/anon key not configured on server." });
    }

    const supabaseAuth = createClient(url, anon, { auth: { persistSession: false } });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser(jwt);
    if (userErr || !user?.id) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    const { order, profile: clientProfile, requestId } = req.body || {};
    const rawItems = Array.isArray(order?.items) ? order.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: "Missing order with line items." });
    }
    if (!requestId || typeof requestId !== "string") {
      return res.status(400).json({ error: "Missing requestId (required to prevent duplicate emails)." });
    }

    const admin = getSupabaseAdmin();

    // Merge profile: DB wins for identity, but keep client pricing fields when DB is empty/null.
    const { data: dbProfile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const profile = {
      ...(clientProfile || {}),
      ...(dbProfile || {}),
      email: dbProfile?.email || user.email || clientProfile?.email || "",
      id: user.id,
      membership_tier: dbProfile?.membership_tier || clientProfile?.membership_tier || "free",
      assignedPricingTierKey:
        dbProfile?.assignedPricingTierKey ||
        clientProfile?.assignedPricingTierKey ||
        "msrp",
      contractor_tier: dbProfile?.contractor_tier || clientProfile?.contractor_tier || "",
      isFgpCustomer: dbProfile?.isFgpCustomer ?? clientProfile?.isFgpCustomer ?? false,
      contractorPricingApplicationReceived:
        dbProfile?.contractorPricingApplicationReceived ??
        clientProfile?.contractorPricingApplicationReceived ??
        false,
    };

    let poProfile = await ensurePoYearCurrent(admin, user.id, profile);
    profile.annual_po_count = poProfile.annual_po_count;
    profile.po_year_start_date = poProfile.po_year_start_date;

    if (isTier1PoLimitReached(poProfile)) {
      return res.status(403).json({
        error: `PO limit reached (${MAX_TIER1_POS_PER_YEAR} per year). Upgrade to Tier 2 for unlimited submissions.`,
        code: "PO_LIMIT_REACHED",
        annual_po_count: poProfile.annual_po_count,
        limit: MAX_TIER1_POS_PER_YEAR,
      });
    }

    const tierKey = resolveMaterialTierKey(profile, order?.pricing_tier_key);
    const pricedLines = recalculateOrderLines(rawItems, tierKey);
    if (!pricedLines.length) {
      return res.status(400).json({ error: "No valid line items to price (missing productKey)." });
    }
    const totals = summarizeLines(pricedLines);

    console.log("[send-po-email] PRICE CHECK", {
      tierKey,
      tierLabel: tierDisplayLabel(tierKey),
      sample: pricedLines.slice(0, 3).map((l) => ({
        product: l.productName,
        unitMsrp: l.unitMsrp,
        unitPrice: l.unitPrice,
        savings: l.savings,
      })),
      totals,
      membership: profile.membership_tier,
      assigned: profile.assignedPricingTierKey,
      orderPricingTierKey: order?.pricing_tier_key,
    });

    // Idempotency: same client request never emails twice.
    const { data: existing, error: existingErr } = await admin
      .from("material_orders")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle();
    if (existingErr && !/request_id|column/i.test(existingErr.message || "")) {
      console.error("[send-po-email] existing lookup failed", existingErr);
      return res.status(500).json({ error: existingErr.message || "Could not check for duplicate order." });
    }
    if (existing) {
      console.log("[send-po-email] duplicate requestId — skip email", { requestId, orderId: existing.id });
      return res.status(200).json({ ok: true, order: existing, duplicate: true, emailed: false });
    }

    const record = {
      user_id: user.id,
      items: pricedLines,
      total_msrp: totals.totalMsrp,
      total_discount: totals.totalDiscount,
      total_price: totals.totalPrice,
      pricing_tier_key: tierKey,
      status: "submitted",
      request_id: requestId,
    };

    console.log("[send-po-email] BEFORE material_orders insert", {
      userId: user.id,
      requestId,
      tierKey,
      itemCount: pricedLines.length,
      total_price: record.total_price,
      total_discount: record.total_discount,
      customerEmail: profile.email,
    });

    const { data: inserted, error: insertError } = await admin
      .from("material_orders")
      .insert(record)
      .select("*")
      .single();

    console.log("[send-po-email] INSERT RESPONSE", { data: inserted, error: insertError });

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raced } = await admin.from("material_orders").select("*").eq("request_id", requestId).maybeSingle();
        if (raced) {
          return res.status(200).json({ ok: true, order: raced, duplicate: true, emailed: false });
        }
      }
      const hint = /request_id|column/i.test(insertError.message || "")
        ? " Re-run supabase/material_orders.sql (adds request_id)."
        : "";
      return res.status(500).json({
        error: `${insertError.message || "Failed to save material_orders."}${hint}`,
        details: insertError.details || null,
        hint: insertError.hint || null,
      });
    }

    if (!inserted?.id) {
      return res.status(500).json({ error: "Insert returned no row — refusing to email Gary." });
    }

    let annualPoCount = poProfile.annual_po_count;
    try {
      annualPoCount = await incrementAnnualPoCount(admin, user.id, poProfile);
    } catch (counterErr) {
      console.error("[send-po-email] annual_po_count increment failed", counterErr);
    }

    console.log("[send-po-email] BEFORE email to Gary", { orderId: inserted.id, tierKey, annualPoCount });
    try {
      const emailJson = await sendGaryEmail({
        order: inserted,
        profile,
        tierKey,
        pricedLines,
        totals,
      });
      console.log("[send-po-email] EMAIL RESPONSE", { id: emailJson?.id || null });
      return res.status(200).json({
        ok: true,
        order: inserted,
        duplicate: false,
        emailed: true,
        emailId: emailJson?.id || null,
        tierKey,
        totals,
        annual_po_count: annualPoCount,
      });
    } catch (emailErr) {
      console.error("[send-po-email] email failed after insert", emailErr);
      return res.status(502).json({
        error: `Order saved (id ${inserted.id}) but email to FGP failed: ${emailErr.message || "email error"}`,
        order: inserted,
        emailed: false,
      });
    }
  } catch (error) {
    console.error("[send-po-email] unexpected", error);
    return res.status(500).json({ error: error?.message || "Unexpected submit error." });
  }
}
