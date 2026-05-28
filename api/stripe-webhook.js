import Stripe from "stripe";
import getRawBody from "raw-body";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import {
  syncProfileFromCheckoutSession,
  applySubscriptionToUserProfile,
  updateProfileByStripeSubscription,
  stripePeriodEndIso,
} from "./_lib/stripeProfileSync.js";
import { sendGraceEmail } from "./_lib/sendGraceEmail.js";

/** Next.js-style config; ignored by plain Vercel Node bundler but harmless if supported. */
export const config = {
  api: {
    bodyParser: false,
  },
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET missing");
    return res.status(500).send("Webhook secret not configured.");
  }
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing stripe-signature header.");
  }
  let buf;
  try {
    buf = await getRawBody(req, {
      length: req.headers["content-length"],
      limit: "2mb",
    });
  } catch (e) {
    console.error("[stripe-webhook] raw body", e);
    return res.status(400).send("Could not read body.");
  }
  let event;
  try {
    event = getStripe().webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const stripe = getStripe();
    const admin = getSupabaseAdmin();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.id) {
          await syncProfileFromCheckoutSession(stripe, admin, session.id);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        await updateProfileByStripeSubscription(admin, sub.id, {
          membership_tier: "tier1",
          subscription_status: sub.status,
          subscription_current_period_end: stripePeriodEndIso(sub.current_period_end),
          grace_period_start: null,
          grace_email_stage: 0,
        });
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (!subId) break;
        const { data: row } = await admin
          .from("profiles")
          .select("id, email, grace_period_start, grace_email_stage")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (!row?.id) break;
        const isFirstFailure = !row.grace_period_start || Number(row.grace_email_stage) === 0;
        if (isFirstFailure) {
          await applySubscriptionToUserProfile(admin, row.id, {
            grace_period_start: new Date().toISOString(),
            grace_email_stage: 1,
            subscription_status: "past_due",
          });
          await sendGraceEmail(row.email, 1);
        } else {
          await applySubscriptionToUserProfile(admin, row.id, {
            subscription_status: "past_due",
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await updateProfileByStripeSubscription(admin, sub.id, {
          subscription_status: sub.status,
          subscription_current_period_end: stripePeriodEndIso(sub.current_period_end),
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await updateProfileByStripeSubscription(admin, sub.id, {
          membership_tier: "free",
          subscription_status: "canceled",
          stripe_subscription_id: null,
          grace_period_start: null,
          grace_email_stage: 0,
        });
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook] handler", event?.type, e);
    return res.status(500).json({ error: e?.message || "Webhook handler error." });
  }

  return res.status(200).json({ received: true });
}
