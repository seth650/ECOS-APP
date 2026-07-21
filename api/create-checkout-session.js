import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getPublicSiteUrl } from "./_lib/siteUrl.js";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
}

/**
 * Body: { product?: "estimator" | "calculator" | "tier1" | "tier2" }
 * Default: estimator ($49).
 */
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
    const url = process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return res.status(500).json({ error: "Supabase URL/anon key not configured on server." });
    }
    const supabase = createClient(url, anon, { auth: { persistSession: false } });
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(jwt);
    if (userErr || !user?.id) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    const requested = String(req.body?.product || "estimator").toLowerCase();
    const isCalculator =
      requested === "calculator" || requested === "tier2" || requested === "ecos_tier2";

    const priceId = isCalculator
      ? process.env.STRIPE_CALCULATOR_PRICE_ID
      : process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({
        error: isCalculator
          ? "STRIPE_CALCULATOR_PRICE_ID is not configured."
          : "STRIPE_PRICE_ID is not configured.",
      });
    }

    const productMeta = isCalculator ? "ecos_tier2" : "ecos_tier1";
    const productLabel = isCalculator ? "ECOS Calculator" : "ECOS Estimator";
    const productBlurb = isCalculator
      ? "ECOS Calculator unlocks Professional Estimates (PDF + JPG), unlimited POs, custom systems, and everything in Estimator."
      : "ECOS Estimator unlocks all 8 ET flooring systems, custom systems, My Orders, 50 POs/year, and contractor pricing applications.";

    const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();

    const stripe = getStripe();
    const siteUrl = getPublicSiteUrl(req);
    const successUrl = `${siteUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${siteUrl}/?checkout=cancelled`;

    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { supabase_user_id: user.id, product: productMeta },
      client_reference_id: user.id,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      locale: "en",
      custom_text: {
        submit: {
          message: productBlurb,
        },
      },
      subscription_data: {
        metadata: { supabase_user_id: user.id, product: productMeta },
      },
    };
    if (profile?.stripe_customer_id) {
      sessionParams.customer = profile.stripe_customer_id;
    } else if (user.email) {
      sessionParams.customer_email = user.email;
    }

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeErr) {
      // Older Stripe API versions may reject custom_text — retry without it.
      if (stripeErr?.message?.includes("custom_text") || stripeErr?.code === "parameter_unknown") {
        delete sessionParams.custom_text;
        session = await stripe.checkout.sessions.create(sessionParams);
      } else {
        throw stripeErr;
      }
    }

    return res.status(200).json({ url: session.url, product: productMeta, label: productLabel });
  } catch (e) {
    console.error("[create-checkout-session]", e);
    return res.status(500).json({ error: e?.message || "Checkout session failed." });
  }
}
