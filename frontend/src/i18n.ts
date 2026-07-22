/**
 * Back-compat entry: prefer `import { t } from "./i18n"` (resolves to i18n/index via folder).
 * This file remains for any deep imports of `./i18n.ts`.
 */
export {
  t,
  tFormat,
  adminAuditActionLabel,
  en,
  es,
  getUiLocale,
  setUiLocale,
  initUiLocale,
  subscribeLocale,
  UI_LOCALE_KEY,
  OUTPUT_LANGUAGE_KEY,
} from "./i18n/index";
export type { UiLocale, OutputLanguage, EnDict } from "./i18n/index";
