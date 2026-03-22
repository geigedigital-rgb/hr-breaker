import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SparklesIcon, GlobeAltIcon, ChevronDownIcon, CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

const LANGUAGES = [
  { id: "en", name: "English" },
  { id: "ru", name: "Русский" }
];

function getInitialLanguage() {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("app_output_language") : null;
  return LANGUAGES.find((l) => l.id === stored) ?? LANGUAGES[0];
}

export default function Settings() {
  const { user, loading: authLoading, logout } = useAuth();
  const [settings, setSettings] = useState<api.SettingsResponse | null>(null);
  const [language, setLanguage] = useState(getInitialLanguage);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);

  useEffect(() => {
    api.setOutputLanguage(language.id as "en" | "ru");
  }, [language]);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {}); // silently fail settings fetch since we only care about user settings now
  }, []);

  const loading = authLoading && !user && !settings;

  const canOpenBillingPortal =
    !!user &&
    user.id !== "local" &&
    (user.subscription?.plan === "monthly" || user.subscription?.plan === "trial") &&
    (user.subscription?.status === "active" || user.subscription?.status === "trial");

  async function openBillingPortal() {
    if (!canOpenBillingPortal || billingPortalLoading) return;
    const returnUrl = `${window.location.origin}/settings`;
    setBillingPortalLoading(true);
    try {
      const { url } = await api.createBillingPortalSession({ return_url: returnUrl });
      if (url) window.location.href = url;
    } catch {
      window.alert(t("settings.billingPortalError"));
    } finally {
      setBillingPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
        <span className="inline-block w-4 h-4 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin" />
        {t("settings.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 flex flex-col h-full">
      <h1 className="text-2xl font-bold text-[#181819] tracking-tight">{t("settings.title")}</h1>

      <div className="flex flex-col lg:flex-row gap-8 w-full items-stretch">
        <div className="flex-1 grid gap-6 md:grid-cols-2 content-start">
          {/* Account */}
          <section className="rounded-2xl bg-[#FFFFFF] border border-[#EBEDF5] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#181819]">{t("settings.account")}</h2>
          {user && user.id !== "local" ? (
            <>
              <div>
                <p className="text-sm font-medium text-[#181819]">
                  {user.name || user.email.split("@")[0]}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#EBEDF5] text-sm font-medium text-[#181819] hover:bg-[#E0E4EE] transition-colors"
              >
                  {t("settings.logoutButton")}
              </button>
              {canOpenBillingPortal && (
                <div className="pt-5 mt-1 border-t border-[#F0F1F5]">
                  <button
                    type="button"
                    disabled={billingPortalLoading}
                    onClick={() => void openBillingPortal()}
                    title={t("settings.cancelSubscriptionHint")}
                    className="text-[11px] font-normal text-[#b4b8c5] hover:text-[#8b90a0] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#4578FC]/20 rounded px-0 py-1 disabled:opacity-60"
                  >
                    {billingPortalLoading ? t("settings.openingBillingPortal") : t("settings.cancelSubscriptionLink")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
                {t("settings.localModeNote")}
            </p>
          )}
        </section>

          {/* Resumes and data */}
          <section className="rounded-2xl bg-[#FFFFFF] border border-[#EBEDF5] p-6 space-y-3">
            <h2 className="text-base font-semibold text-[#181819]">{t("settings.resumesAndData")}</h2>
          <p className="text-sm text-[var(--text-muted)]">
              {t("settings.resumesDataNote")}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
              {t("settings.deleteNote")}
          </p>
        </section>

          {/* Preferences */}
          <section className="rounded-2xl bg-[#FFFFFF] border border-[#EBEDF5] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#181819]">{t("settings.preferences")}</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--text-muted)] flex items-center gap-2">
                  <GlobeAltIcon className="w-4 h-4" />
                  {t("settings.language")}
                </span>
                <Listbox value={language} onChange={setLanguage}>
                  <div className="relative mt-1 min-w-[180px]">
                    <ListboxButton className="relative w-full min-w-[180px] cursor-pointer rounded-xl bg-[#F5F6FA] border border-[#EBEDF5] py-2 pl-3 pr-10 text-left text-sm text-[#181819] hover:bg-[#EBEDF5] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30">
                      <span className="block truncate font-medium">{language.name}</span>
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronDownIcon className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                      </span>
                    </ListboxButton>
                    <ListboxOptions className="absolute z-10 mt-1 max-h-60 min-w-[180px] w-full overflow-auto rounded-xl bg-white py-1 shadow-lg border border-[#EBEDF5] ring-1 ring-black/5 focus:outline-none text-sm">
                      {LANGUAGES.map((lang) => (
                        <ListboxOption
                          key={lang.id}
                          className="relative cursor-pointer select-none py-2 pl-10 pr-4 text-[#181819] data-[focus]:bg-[#F5F6FA] data-[focus]:text-[#4578FC] transition-colors"
                          value={lang}
                        >
                          {({ selected }) => (
                            <>
                              <span className={`block ${selected ? 'font-medium' : 'font-normal'}`}>
                                {lang.name}
                              </span>
                              {selected ? (
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#4578FC]">
                                  <CheckIcon className="h-4 w-4" aria-hidden="true" />
                                </span>
                              ) : null}
                            </>
                          )}
                        </ListboxOption>
                      ))}
                    </ListboxOptions>
                  </div>
                </Listbox>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section className="rounded-2xl bg-[#FFFFFF] border border-[#EBEDF5] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#181819]">{t("settings.notifications")}</h2>
            <div className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="flex items-center h-5">
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-[#4578FC] bg-white border-gray-300 rounded focus:ring-[#4578FC]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-[#181819]">{t("settings.emailAlerts")}</span>
                  <span className="text-xs text-[var(--text-muted)]">{t("settings.emailAlertsDesc")}</span>
                </div>
              </label>
              
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="flex items-center h-5">
                  <input type="checkbox" className="w-4 h-4 text-[#4578FC] bg-white border-gray-300 rounded focus:ring-[#4578FC]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-[#181819]">{t("settings.marketingEmails")}</span>
                  <span className="text-xs text-[var(--text-muted)]">{t("settings.marketingEmailsDesc")}</span>
                </div>
              </label>
            </div>
          </section>
        </div>

        {/* Subscription block on the right */}
        <div className="w-full lg:w-[320px] xl:w-[360px] shrink-0 flex flex-col">
          <section 
            className="flex-1 rounded-2xl border border-purple-200/60 p-6 flex flex-col relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(233, 213, 255, 0.4) 0%, rgba(216, 180, 254, 0.25) 40%, rgba(196, 181, 253, 0.15) 70%, rgba(232, 121, 249, 0.2) 100%)"
            }}
          >
            {/* Background blur/glow effect */}
            <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 rounded-full bg-purple-300/30 blur-2xl pointer-events-none" aria-hidden />
            
            <div className="relative z-10 flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-white/60 flex items-center justify-center shadow-sm">
                <SparklesIcon className="w-4 h-4 text-purple-600" />
              </div>
              <h2 className="text-base font-bold text-purple-950 tracking-tight">{t("settings.subscription")}</h2>
            </div>
            
            {user && user.id !== "local" ? (
              <div className="space-y-5 flex-1 flex flex-col">
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-purple-800/70 uppercase tracking-widest">{t("settings.plan")}</p>
                  <p className="text-xl font-black text-purple-950 capitalize drop-shadow-sm">
                    {user.subscription?.plan === "monthly" 
                      ? t("upgrade.monthly") 
                      : user.subscription?.plan === "trial" 
                        ? t("upgrade.trial7days") 
                        : t("settings.freePlan")}
                  </p>
                  <p className="text-xs text-purple-900/70 leading-relaxed max-w-[200px] mb-3">
                    {user.subscription?.plan === "monthly" 
                      ? t("settings.monthlyPlanDesc") 
                      : user.subscription?.plan === "trial" 
                        ? t("settings.trialPlanDesc") 
                        : t("settings.freePlanDesc")}
                  </p>
                  {user.subscription?.plan === "monthly" && (
                    <ul className="space-y-2 text-xs text-purple-900/80 font-medium">
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.monthlyFeature1")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.monthlyFeature2")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.monthlyFeature3")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.monthlyFeature4")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.monthlyFeature5")}</span>
                      </li>
                    </ul>
                  )}
                  {user.subscription?.plan === "trial" && (
                    <ul className="space-y-2 text-xs text-purple-900/80 font-medium">
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.trialFeature1")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.trialFeature2")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.trialFeature3")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.trialFeature4")}</span>
                      </li>
                    </ul>
                  )}
                  {(!user.subscription?.plan || user.subscription?.plan === "free") && (
                    <ul className="space-y-2 text-xs text-purple-900/80 font-medium">
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.freeFeature1")}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                        <span>{t("upgrade.freeFeature2")}</span>
                      </li>
                      <li className="flex items-start gap-2 opacity-60">
                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                        <span>{t("upgrade.freeFeature3")} {t("upgrade.availableWithSub")}</span>
                      </li>
                      <li className="flex items-start gap-2 opacity-60">
                        <LockClosedIcon className="w-4 h-4 shrink-0" />
                        <span>{t("upgrade.freeFeature4")} {t("upgrade.availableWithSub")}</span>
                      </li>
                    </ul>
                  )}
                </div>
                
                {user.subscription && user.subscription.status !== "free" && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-purple-800/70 uppercase tracking-widest">{t("settings.status")}</p>
                      <div className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-white/70 text-purple-800 shadow-sm border border-purple-200/50">
                        {user.subscription.status}
                      </div>
                    </div>
                    {user.subscription.current_period_end && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-purple-800/70 uppercase tracking-widest">{t("settings.activeUntil")}</p>
                        <p className="text-sm font-semibold text-purple-950">
                          {new Date(user.subscription.current_period_end).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-auto pt-6">
                  <Link
                    to="/upgrade"
                    className="flex items-center justify-center w-full px-4 py-3 rounded-xl bg-purple-600 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2 focus:ring-offset-purple-50"
                  >
                    {user.subscription?.status === "active" || user.subscription?.status === "trial"
                      ? t("settings.manageButton")
                      : t("settings.upgradeButton")}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-5 flex-1 flex flex-col">
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-purple-800/70 uppercase tracking-widest">{t("settings.plan")}</p>
                  <p className="text-xl font-black text-purple-950 capitalize drop-shadow-sm">
                    {t("settings.freePlan")}
                  </p>
                  <p className="text-xs text-purple-900/70 leading-relaxed max-w-[200px] mb-3">
                    {t("settings.freePlanDesc")}
                  </p>
                  <ul className="space-y-2 text-xs text-purple-900/80 font-medium">
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                      <span>{t("upgrade.freeFeature1")}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 text-purple-600 shrink-0" />
                      <span>{t("upgrade.freeFeature2")}</span>
                    </li>
                    <li className="flex items-start gap-2 opacity-60">
                      <LockClosedIcon className="w-4 h-4 shrink-0" />
                      <span>{t("upgrade.freeFeature3")} {t("upgrade.availableWithSub")}</span>
            </li>
                    <li className="flex items-start gap-2 opacity-60">
                      <LockClosedIcon className="w-4 h-4 shrink-0" />
                      <span>{t("upgrade.freeFeature4")} {t("upgrade.availableWithSub")}</span>
              </li>
                  </ul>
                </div>
                <div className="mt-auto pt-6">
                  <Link
                    to="/upgrade"
                    className="flex items-center justify-center w-full px-4 py-3 rounded-xl bg-purple-600 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2 focus:ring-offset-purple-50"
                  >
                    {t("settings.upgradeButton")}
                  </Link>
                </div>
              </div>
            )}
        </section>
        </div>
      </div>
    </div>
  );
}
