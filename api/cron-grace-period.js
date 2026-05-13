import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sendGraceEmail } from "./_lib/sendGraceEmail.js";

function verifyCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron-grace-period] CRON_SECRET not set — refusing to run.");
    return false;
  }
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!verifyCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: rows, error } = await admin
      .from("profiles")
      .select("id, email, grace_period_start, grace_email_stage, membership_tier")
      .eq("membership_tier", "tier1")
      .not("grace_period_start", "is", null);

    if (error) {
      console.error("[cron-grace-period] select", error);
      return res.status(500).json({ error: error.message });
    }

    const now = Date.now();
    let processed = 0;

    for (const row of rows || []) {
      const start = row.grace_period_start ? new Date(row.grace_period_start).getTime() : 0;
      if (!start) continue;
      const hours = (now - start) / (1000 * 60 * 60);
      const stage = Number(row.grace_email_stage) || 0;

      if (hours >= 24 && stage === 1) {
        await sendGraceEmail(row.email, 2);
        await admin.from("profiles").update({ grace_email_stage: 2 }).eq("id", row.id);
        processed += 1;
      } else if (hours >= 48 && stage === 2) {
        await sendGraceEmail(row.email, 3);
        await admin.from("profiles").update({ grace_email_stage: 3 }).eq("id", row.id);
        processed += 1;
      } else if (hours >= 96 && stage === 3) {
        await admin
          .from("profiles")
          .update({
            membership_tier: "free",
            subscription_status: "canceled",
            stripe_subscription_id: null,
            grace_period_start: null,
            grace_email_stage: 0,
          })
          .eq("id", row.id);
        processed += 1;
      }
    }

    return res.status(200).json({ ok: true, checked: (rows || []).length, transitions: processed });
  } catch (e) {
    console.error("[cron-grace-period]", e);
    return res.status(500).json({ error: e?.message || "Cron error." });
  }
}
