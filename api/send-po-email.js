import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";

const GARY_EMAIL = "gary@dynastyepoxy.com";

function usd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function formatMaterialOrderEmail({ order, profile, tierLabel }) {
  const email = profile?.email || order?.user_email || "—";
  const company = profile?.company_name || profile?.businessName || "—";
  const first = profile?.first_name || profile?.firstName || "";
  const last = profile?.last_name || profile?.lastName || "";
  const name = `${first} ${last}`.trim() || profile?.contractorName || email;
  const mem = profile?.membership_tier || "—";
  const contractorTier = profile?.contractor_tier || profile?.assignedPricingTierKey || "—";
  const items = Array.isArray(order?.items) ? order.items : [];

  const lines = items
    .map(
      (line, i) =>
        `${i + 1}. ${line.productName} (${line.kitSize}) × ${line.qty}
   Category: ${line.categoryLabel}
   MSRP/unit: ${usd(line.unitMsrp)} · Your price/unit: ${usd(line.unitPrice)} · Line savings: ${usd(line.savings)} · Line total: ${usd(line.lineTotal)}`
    )
    .join("\n\n");

  const body = `ECOS Material Order — submitted ${order?.created_at ? new Date(order.created_at).toLocaleString() : "—"}

Customer
  Name: ${name}
  Email: ${email}
  Company: ${company}
  ECOS membership: ${mem}
  Contractor / FGP tier: ${contractorTier}
  Material pricing applied: ${tierLabel || order?.pricing_tier_key || "—"}

Line items
${lines || "(none)"}

Totals
  Total MSRP: ${usd(order?.total_msrp)}
  Total discount: ${usd(order?.total_discount)}
  Final PO total: ${usd(order?.total_price)}

Order ID: ${order?.id || "—"}
Status: ${order?.status || "submitted"}

— Sent automatically from ECOS (epoxyquoting.com)`;

  const subject = `ECOS Material PO — ${name} — ${usd(order?.total_price)}`;
  return { subject, body };
}

async function sendGaryEmail({ order, profile, tierLabel }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const { subject, body } = formatMaterialOrderEmail({ order, profile, tierLabel });
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

    const { order, profile, tierLabel, requestId } = req.body || {};
    const items = Array.isArray(order?.items) ? order.items : [];
    if (!items.length) {
      return res.status(400).json({ error: "Missing order with line items." });
    }
    if (!requestId || typeof requestId !== "string") {
      return res.status(400).json({ error: "Missing requestId (required to prevent duplicate emails)." });
    }

    const admin = getSupabaseAdmin();

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
      items,
      total_msrp: Number(order?.total_msrp || 0),
      total_discount: Number(order?.total_discount || 0),
      total_price: Number(order?.total_price || 0),
      pricing_tier_key: order?.pricing_tier_key || null,
      status: "submitted",
      request_id: requestId,
    };

    console.log("[send-po-email] BEFORE material_orders insert", {
      userId: user.id,
      requestId,
      itemCount: items.length,
      total_price: record.total_price,
    });

    const { data: inserted, error: insertError } = await admin
      .from("material_orders")
      .insert(record)
      .select("*")
      .single();

    console.log("[send-po-email] INSERT RESPONSE", { data: inserted, error: insertError });

    if (insertError) {
      // Race on unique request_id — treat as duplicate, do not email again.
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

    // Email ONLY after a confirmed DB row.
    console.log("[send-po-email] BEFORE email to Gary", { orderId: inserted.id });
    try {
      const emailJson = await sendGaryEmail({
        order: inserted,
        profile: profile || {},
        tierLabel,
      });
      console.log("[send-po-email] EMAIL RESPONSE", { id: emailJson?.id || null });
      return res.status(200).json({
        ok: true,
        order: inserted,
        duplicate: false,
        emailed: true,
        emailId: emailJson?.id || null,
      });
    } catch (emailErr) {
      console.error("[send-po-email] email failed after insert", emailErr);
      // Row is saved — surface that clearly so user does not re-submit blindly.
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
