import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";

function getUserClient(accessToken) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

/**
 * Email a vendor PO (custom system) and stamp vendor_po_sent_at on the order.
 * Body: POST { orderId?, subject, body, vendorName, vendorEmail, contractorName }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const userClient = getUserClient(token);
  if (!userClient) return res.status(500).json({ error: "Supabase not configured." });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ error: "Invalid session." });
  }
  const userId = userData.user.id;

  const {
    orderId,
    subject,
    body,
    vendorName,
    vendorEmail,
    contractorName,
  } = req.body || {};

  if (!subject || !body || !vendorEmail) {
    return res.status(400).json({ error: "Missing subject, body, or vendorEmail." });
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(vendorEmail).trim());
  if (!emailOk) return res.status(400).json({ error: "Invalid vendor email." });

  const fromName = String(contractorName || "ECOS Contractor").slice(0, 80);
  const to = String(vendorEmail).trim();

  try {
    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} via ECOS <Rufus@epoxyquoting.com>`,
        to: [to],
        subject: String(subject).slice(0, 200),
        text: body,
      }),
    });

    const json = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: json?.message || "Email provider rejected request." });
    }

    const sentAt = new Date().toISOString();
    let order = null;

    if (orderId) {
      try {
        const admin = getSupabaseAdmin();
        const { data, error } = await admin
          .from("orders")
          .update({
            vendor_po_sent_at: sentAt,
            vendor_name: vendorName || null,
            vendor_email: to,
            is_custom_system: true,
          })
          .eq("id", orderId)
          .eq("user_id", userId)
          .select("*")
          .maybeSingle();
        if (error) console.error("[send-vendor-po] order update failed", error);
        else order = data;
      } catch (e) {
        console.error("[send-vendor-po] admin update error", e);
      }
    }

    return res.status(200).json({
      ok: true,
      id: json?.id || null,
      vendor_po_sent_at: sentAt,
      order,
      message: `Order sent to ${vendorName || to} on ${new Date(sentAt).toLocaleString()}`,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected email send error." });
  }
}
