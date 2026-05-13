import { loadStripe } from "@stripe/stripe-js";

/** Same-origin `/api/*` on Vercel; override when running API separately (e.g. `vercel dev` on another port). */
export function getApiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

/** Reserved for future in-app card entry; Checkout redirect does not require this. */
export const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;
