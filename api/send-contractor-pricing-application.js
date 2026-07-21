import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";

/**
 * Submit "Apply for Contractor Pricing" form → email Seth + stamp profile pending.
 * Body: { companyName, annualVolume, contactName, contactEmail, contactPhone, notes? }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header." });
  }
  const jwt = authHeader.slice(7);

  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return res.status(500).json({ error: "Supabase not configured." });
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(jwt);
  if (userErr || !user?.id) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  const {
    companyName,
    annualVolume,
    contactName,
    contactEmail,
    contactPhone,
    notes,
  } = req.body || {};

  if (!companyName?.trim() || !contactName?.trim() || !contactEmail?.trim()) {
    return res.status(400).json({ error: "Company name, contact name, and email are required." });
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("membership_tier, email, first_name, last_name, company_name")
    .eq("id", user.id)
    .maybeSingle();

  const membership = String(profile?.membership_tier || "free").toLowerCase();
  if (membership === "free") {
    return res.status(403).json({
      error: "Upgrade to Estimator to apply for contractor pricing.",
      code: "UPGRADE_REQUIRED",
    });
  }

  const to = process.env.CONTRACTOR_PRICING_NOTIFY_TO || "seth@dynastyepoxy.com";
  const from = process.env.MATERIAL_PO_EMAIL_FROM || "ECOS Orders <Rufus@epoxyquoting.com>";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY not configured." });
  }

  const bodyText = `ECOS Contractor Pricing Application

User ID: ${user.id}
Account email: ${profile?.email || user.email || "—"}
Membership: ${membership}

Company: ${String(companyName).trim()}
Annual order volume estimate: ${String(annualVolume || "—").trim()}
Contact name: ${String(contactName).trim()}
Contact email: ${String(contactEmail).trim()}
Contact phone: ${String(contactPhone || "—").trim()}
Notes: ${String(notes || "—").trim()}

Approve in ECOS Testing Mode / User DB: set FGP customer + pricing application received + buying tier.
`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `ECOS Contractor Pricing Application — ${String(companyName).trim()}`,
      text: bodyText,
    }),
  });
  const emailJson = await emailRes.json().catch(() => ({}));
  if (!emailRes.ok) {
    console.error("[contractor-pricing-app] resend", emailJson);
    return res.status(502).json({ error: emailJson?.message || "Could not send application email." });
  }

  const submittedAt = new Date().toISOString();
  await admin
    .from("profiles")
    .update({
      contractorPricingApplicationReceived: true,
      contractor_pricing_application_pending: true,
      contractor_pricing_applied_at: submittedAt,
      needsAdminReview: true,
    })
    .eq("id", user.id);

  return res.status(200).json({
    ok: true,
    message: "Application submitted. We'll review within 48 hours.",
    submittedAt,
  });
}
