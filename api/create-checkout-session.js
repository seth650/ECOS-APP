import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getPublicSiteUrl } from "./_lib/siteUrl.js";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
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

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(500).json({ error: "STRIPE_PRICE_ID is not configured." });
    }

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
      metadata: { supabase_user_id: user.id },
      client_reference_id: user.id,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { supabase_user_id: user.id },
      },
    };
    if (profile?.stripe_customer_id) {
      sessionParams.customer = profile.stripe_customer_id;
    } else if (user.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      return res.status(500).json({ error: "Stripe did not return a checkout URL." });
    }
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("[create-checkout-session]", e);
    return res.status(500).json({ error: e?.message || "Checkout session failed." });
  }
}
