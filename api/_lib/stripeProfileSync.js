/**
 * Shared Stripe ↔ Supabase profile updates (used by webhooks + post-checkout sync).
 */

/** Stripe unix seconds → ISO string; omit field when missing/invalid (avoids Invalid time value). */
export function stripePeriodEndIso(unixSeconds) {
  if (unixSeconds == null || !Number.isFinite(Number(unixSeconds))) return undefined;
  const d = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function tierFromSubscriptionStatus(status) {
  if (status === "active" || status === "trialing") return "tier1";
  return undefined;
}

export async function applySubscriptionToUserProfile(admin, userId, patch) {
  const row = { ...patch };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  return admin.from("profiles").update(row).eq("id", userId);
}

export async function syncProfileFromCheckoutSession(stripe, admin, sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer"],
  });
  if (session.status !== "complete") {
    return { ok: false, reason: "session_not_complete" };
  }
  const userId = session.metadata?.supabase_user_id || session.client_reference_id;
  if (!userId) {
    return { ok: false, reason: "missing_user_id" };
  }
  let sub = session.subscription;
  if (!sub) {
    return { ok: false, reason: "missing_subscription" };
  }
  const subId = typeof sub === "string" ? sub : sub.id;
  if (!subId) {
    return { ok: false, reason: "missing_subscription" };
  }
  sub = await stripe.subscriptions.retrieve(subId);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    return { ok: false, reason: "missing_customer" };
  }
  const tier = tierFromSubscriptionStatus(sub.status);
  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    subscription_current_period_end: stripePeriodEndIso(sub.current_period_end),
  };
  if (tier) {
    patch.membership_tier = tier;
    patch.grace_period_start = null;
    patch.grace_email_stage = 0;
  }
  const { error } = await applySubscriptionToUserProfile(admin, userId, patch);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function updateProfileByStripeCustomer(admin, customerId, patch) {
  const row = { ...patch };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  return admin.from("profiles").update(row).eq("stripe_customer_id", customerId);
}

export async function updateProfileByStripeSubscription(admin, subscriptionId, patch) {
  const row = { ...patch };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  return admin.from("profiles").update(row).eq("stripe_subscription_id", subscriptionId);
}
