import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getUiLocale,
  initUiLocale,
  setUiLocale,
  subscribeLocale,
  type UiLocale,
} from "../i18n";

type LocaleContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

initUiLocale();

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getUiLocale, () => "en" as UiLocale);
  const [, bump] = useState(0);

  const setLocale = useCallback((next: UiLocale) => {
    setUiLocale(next);
    bump((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: getUiLocale(),
      setLocale: (locale: UiLocale) => setUiLocale(locale),
    };
  }
  return ctx;
}

/** Re-render when UI locale changes (for modules that call t() outside React context). */
export function useLocaleVersion(): number {
  return useSyncExternalStore(
    subscribeLocale,
    () => getUiLocale().length + (getUiLocale() === "es" ? 100 : 0),
    () => 0,
  );
}
