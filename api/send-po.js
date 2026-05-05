export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
  }

  const { subject, body } = req.body || {};
  if (!subject || !body) {
    return res.status(400).json({ error: "Missing required subject/body." });
  }

  try {
    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Rufus <Rufus@epoxyquoting.com>",
        to: ["orders@fgpmidwest.com"],
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
