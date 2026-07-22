/** UI locale + translation helpers. English is the source of truth; Spanish falls back to EN. */

import en, { type EnDict } from "./en";
import es from "./es";

export type UiLocale = "en" | "es";
export type OutputLanguage = "en" | "es" | "ru";

export const UI_LOCALE_KEY = "app_ui_locale";
export const OUTPUT_LANGUAGE_KEY = "app_output_language";

const catalogs: Record<UiLocale, Record<string, unknown>> = {
  en: en as unknown as Record<string, unknown>,
  es: es as unknown as Record<string, unknown>,
};

let currentLocale: UiLocale = "en";
const listeners = new Set<() => void>();

export function getUiLocale(): UiLocale {
  return currentLocale;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyLocaleListeners(): void {
  listeners.forEach((l) => l());
}

export function readStoredUiLocale(): UiLocale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(UI_LOCALE_KEY);
  return stored === "es" ? "es" : "en";
}

export function setUiLocale(locale: UiLocale): void {
  currentLocale = locale;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(UI_LOCALE_KEY, locale);
    document.documentElement.lang = locale;
  }
  notifyLocaleListeners();
}

/** Call once at app boot before first paint when possible. */
export function initUiLocale(): UiLocale {
  const locale = readStoredUiLocale();
  currentLocale = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  return locale;
}

function get(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const k of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[k];
  }
  return typeof current === "string" ? current : undefined;
}

/** Translate by key (e.g. "nav.home"). Active UI locale with English fallback. */
export function t(key: string): string {
  const loc = catalogs[currentLocale] ?? catalogs.en;
  return get(loc, key) ?? get(catalogs.en, key) ?? key;
}

/** Human-readable label for `usage_audit` action codes in admin (Usage table, user journey). */
export function adminAuditActionLabel(action: string | null | undefined): string {
  if (action == null || action === "") return "—";
  const v = get(catalogs.en, `admin.userDetail.journeyAction.${action}`);
  return typeof v === "string" ? v : action;
}

/** Replace {name}, {n} etc. in template with values. */
export function tFormat(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? `{${k}}`));
}

export { en, es };
export type { EnDict };
