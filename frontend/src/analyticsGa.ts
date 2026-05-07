/**
 * GA4 client_id for Stripe Checkout metadata → server-side Measurement Protocol `purchase`.
 * Parsed from the `_ga` cookie (same session as gtag on my.pitchcv.app).
 */
export function getGaClientIdFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)_ga=([^;]+)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1].trim());
  const parts = raw.split(".");
  if (parts.length >= 4) {
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }
  return null;
}
