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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
  }

  const { order, profile, tierLabel } = req.body || {};
  if (!order?.items?.length) {
    return res.status(400).json({ error: "Missing order with line items." });
  }

  const { subject, body } = formatMaterialOrderEmail({ order, profile, tierLabel });
  const from = process.env.MATERIAL_PO_EMAIL_FROM || "ECOS Orders <orders@dynastyepoxy.com>";

  try {
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
      return res.status(upstream.status).json({ error: json?.message || "Email provider rejected request." });
    }

    return res.status(200).json({ ok: true, id: json?.id || null });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected email send error." });
  }
}
