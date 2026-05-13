const GRACE_SUBJECTS = {
  1: "ECOS — payment failed (day 1): please update your card",
  2: "ECOS — payment failed (day 2): reminder to update payment method",
  3: "ECOS — payment failed (day 3): final warning — account downgrades in ~48 hours if unpaid",
};

const GRACE_BODIES = {
  1: `Your ECOS Tier 1 subscription payment did not go through.

Please sign in to ECOS → My Account → Manage Billing and update your payment method in Stripe.

If you have questions, reply to this email.`,
  2: `This is your second reminder: your ECOS Tier 1 payment is still failing.

Please update your payment method today to avoid interruption:

My Account → Manage Billing`,
  3: `Final warning: your ECOS Tier 1 subscription is still past due.

If payment is not successful within about 48 hours from this email, your ECOS plan will be downgraded to Free.

Update billing: My Account → Manage Billing`,
};

export async function sendGraceEmail(toEmail, dayStage) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !toEmail) return { ok: false, skipped: true };
  const from = process.env.GRACE_EMAIL_FROM || "Rufus <Rufus@epoxyquoting.com>";
  const subject = GRACE_SUBJECTS[dayStage] || "ECOS billing notice";
  const text = GRACE_BODIES[dayStage] || "Please update your ECOS subscription payment method.";
  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject,
      text,
    }),
  });
  const json = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return { ok: false, error: json?.message || upstream.statusText };
  }
  return { ok: true, id: json?.id };
}
