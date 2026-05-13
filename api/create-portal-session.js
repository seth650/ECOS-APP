import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getPublicSiteUrl } from "./_lib/siteUrl.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";

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

    const admin = getSupabaseAdmin();
    const { data: profile, error: profErr } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();
    if (profErr || !profile?.stripe_customer_id) {
      return res.status(400).json({ error: "No Stripe customer on file. Subscribe to Tier 1 first." });
    }

    const stripe = getStripe();
    const siteUrl = getPublicSiteUrl(req);
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/?portal=return`,
    });
    if (!portal.url) {
      return res.status(500).json({ error: "Stripe did not return a portal URL." });
    }
    return res.status(200).json({ url: portal.url });
  } catch (e) {
    console.error("[create-portal-session]", e);
    return res.status(500).json({ error: e?.message || "Portal session failed." });
  }
}
