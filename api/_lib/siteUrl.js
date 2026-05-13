/**
 * Canonical public origin for Stripe redirects (no trailing slash).
 * Set PUBLIC_SITE_URL in Vercel (e.g. https://ecos-app-ten.vercel.app or your custom domain).
 */
export function getPublicSiteUrl(req) {
  const envUrl = (process.env.PUBLIC_SITE_URL || process.env.VITE_APP_URL || "").replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "") : "";
  if (vercel) return vercel;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  return "http://localhost:5173";
}
