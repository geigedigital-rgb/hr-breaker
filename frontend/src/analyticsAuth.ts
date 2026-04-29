/**
 * Auth events for Google Ads / GA4 / GTM.
 * In GTM: create a trigger on Custom Event name `pitchcv_auth` or use GA4 events `sign_up` / `login`.
 */

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  }
}

export type AuthAnalyticsMethod = "email" | "google";

export function trackAuthConversion(opts: { registration: boolean; method: AuthAnalyticsMethod }) {
  const { registration, method } = opts;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: registration ? "sign_up" : "login",
      auth_method: method,
      registration,
    });
    window.dataLayer.push({
      event: "pitchcv_auth",
      pitchcv_auth_registration: registration,
      pitchcv_auth_method: method,
    });
  } catch {
    /* ignore */
  }
  try {
    if (typeof window.gtag === "function") {
      if (registration) {
        window.gtag("event", "sign_up", { method });
      } else {
        window.gtag("event", "login", { method });
      }
    }
  } catch {
    /* ignore */
  }
}
