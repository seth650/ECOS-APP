import Stripe from "stripe";
import getRawBody from "raw-body";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { syncProfileFromCheckoutSession } from "./_lib/stripeProfileSync.js";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  return new Stripe(key);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const buf = await getRawBody(req, { length: req.headers["content-length"], limit: "256kb" });
  return JSON.parse(buf.toString("utf8") || "{}");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
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

    const sessionId = body?.sessionId || body?.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Missing sessionId." });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const ownerId = session.metadata?.supabase_user_id || session.client_reference_id;
    if (ownerId !== user.id) {
      return res.status(403).json({ error: "This checkout session does not belong to your account." });
    }

    const admin = getSupabaseAdmin();
    const result = await syncProfileFromCheckoutSession(stripe, admin, sessionId);
    if (!result.ok) {
      return res.status(400).json({ error: result.reason || "Could not sync subscription." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[sync-checkout-session]", e);
    return res.status(500).json({ error: e?.message || "Sync failed." });
  }
}
