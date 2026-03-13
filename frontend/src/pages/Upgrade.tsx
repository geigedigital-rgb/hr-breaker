import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

export default function Upgrade() {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadingTrial, setLoadingTrial] = useState(false);
  const [loadingMonthly, setLoadingMonthly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    const success = searchParams.get("success");
    const cancel = searchParams.get("cancel");
    if (success === "1" || cancel === "1") {
      void refreshUser();
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, refreshUser]);

  const plan = user?.subscription?.plan ?? "free";
  const status = user?.subscription?.status ?? "free";
  const periodEnd = user?.subscription?.current_period_end ?? null;
  const hasPaidPlan = plan === "trial" || plan === "monthly" || status === "active";

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const successUrl = `${baseUrl}/upgrade?success=1`;
  const cancelUrl = `${baseUrl}/upgrade?cancel=1`;

  const startCheckout = async (priceKey: "trial" | "monthly") => {
    if (!user) {
      navigate("/login");
      return;
    }
    setError(null);
    if (priceKey === "trial") setLoadingTrial(true);
    else setLoadingMonthly(true);
    try {
      const { url } = await api.createCheckoutSession({
        price_key: priceKey,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (url) window.location.href = url;
      else setError(t("upgrade.getPaymentLinkError"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("upgrade.checkoutError"));
    } finally {
      setLoadingTrial(false);
      setLoadingMonthly(false);
    }
  };

  return (
    <div className="min-h-full bg-[#F2F3F9]">
      <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-sm text-[var(--text-muted)] hover:text-[#181819] transition-colors"
          >
            {t("upgrade.backHome")}
          </Link>
          <h1 className="text-xl font-semibold text-[#181819] tracking-tight">{t("upgrade.title")}</h1>
        </div>

        {hasPaidPlan && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-sm text-[#181819] flex items-center justify-between shadow-sm">
            <div>
              <strong className="font-semibold">{t("upgrade.currentPlan")}</strong>{" "}
              {plan === "trial" ? t("upgrade.trial7days") : plan === "monthly" ? t("upgrade.monthly") : status}
            </div>
            {periodEnd && (
              <span className="text-[var(--text-muted)] text-xs bg-white border border-blue-100 px-2 py-1 rounded-md shadow-sm">
                {t("upgrade.activeUntil")} {new Date(periodEnd).toLocaleDateString()}
              </span>
            )}
          </section>
        )}

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </section>
        )}

        <section className="grid gap-6 lg:gap-8 md:grid-cols-3">
          {/* Free */}
          <div className="rounded-2xl border border-[#EBEDF5] bg-white p-6 flex flex-col">
            <h2 className="text-base font-semibold text-[#181819]">{t("upgrade.free")}</h2>
            <p className="mt-2 text-2xl font-bold text-[#181819]">{t("upgrade.freePrice")}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)] font-medium">{t("upgrade.freeDesc")}</p>
            <ul className="mt-6 space-y-3 text-sm text-[#181819] font-medium flex-1">
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.freeFeature1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.freeFeature2")}</span>
              </li>
              <li className="flex items-start gap-2.5 text-[var(--text-muted)] opacity-70">
                <LockClosedIcon className="w-5 h-5 shrink-0" />
                <span>{t("upgrade.freeFeature3")}</span>
              </li>
              <li className="flex items-start gap-2.5 text-[var(--text-muted)] opacity-70">
                <LockClosedIcon className="w-5 h-5 shrink-0" />
                <span>{t("upgrade.freeFeature4")}</span>
              </li>
            </ul>
            <div className="mt-6 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest text-center h-[40px] flex items-center justify-center">
              {plan === "free" ? t("upgrade.currentPlanLabel") : ""}
            </div>
          </div>

          {/* Trial */}
          <div 
            className="rounded-2xl border border-purple-200/60 p-6 flex flex-col relative overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            style={{
              background: "linear-gradient(135deg, rgba(233, 213, 255, 0.4) 0%, rgba(216, 180, 254, 0.25) 40%, rgba(196, 181, 253, 0.15) 70%, rgba(232, 121, 249, 0.2) 100%)"
            }}
          >
            {/* Background blur/glow effect */}
            <div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 rounded-full bg-purple-300/30 blur-2xl pointer-events-none" aria-hidden />

            <div className="absolute top-0 right-0 rounded-bl-xl bg-purple-600 px-3 py-1.5 text-[10px] font-bold text-white uppercase tracking-wide z-10 shadow-sm">
              {t("upgrade.recommended")}
            </div>
            <h2 className="relative z-10 text-base font-semibold text-purple-950 pr-24">{t("upgrade.trialTitle")}</h2>
            <p className="relative z-10 mt-2 text-2xl font-bold text-purple-950">{t("upgrade.trialPrice")}</p>
            <p className="relative z-10 mt-1 text-xs font-medium text-purple-800/80">{t("upgrade.trialDesc")}</p>
            <p className="relative z-10 mt-1.5 text-[11px] leading-snug text-purple-900/60 font-medium">{t("upgrade.trialAutoRenew")}</p>
            <ul className="relative z-10 mt-6 space-y-3 text-sm font-medium text-purple-950 flex-1">
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
                <span>{t("upgrade.trialFeature1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
                <span>{t("upgrade.trialFeature2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
                <span>{t("upgrade.trialFeature3")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
                <span>{t("upgrade.trialFeature4")}</span>
              </li>
            </ul>
            <div className="relative z-10 mt-6 h-[40px] flex items-center justify-center">
              {!user && !loading ? (
                <Link
                  to="/login"
                  className="flex items-center justify-center w-full rounded-xl bg-purple-600 text-sm font-semibold text-white h-full shadow-sm hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2"
                >
                  {t("upgrade.signInToSubscribe")}
                </Link>
              ) : plan === "trial" || (plan === "monthly" && status === "active") ? (
                <div className="text-xs font-bold text-purple-800/80 uppercase tracking-widest text-center">{t("upgrade.currentPlanLabel")}</div>
              ) : (
                <button
                  type="button"
                  disabled={loadingTrial}
                  onClick={() => startCheckout("trial")}
                  className="flex items-center justify-center w-full rounded-xl bg-purple-600 text-sm font-semibold text-white h-full shadow-sm hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2 disabled:opacity-70"
                >
                  {loadingTrial ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
                </button>
              )}
            </div>
          </div>

          {/* Monthly */}
          <div className="rounded-2xl border border-[#EBEDF5] bg-white p-6 flex flex-col">
            <h2 className="text-base font-semibold text-[#181819]">{t("upgrade.monthlyTitle")}</h2>
            <p className="mt-2 text-2xl font-bold text-[#181819]">{t("upgrade.monthlyPrice")}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)] font-medium">{t("upgrade.monthlyDesc")}</p>
            <ul className="mt-6 space-y-3 text-sm text-[#181819] font-medium flex-1">
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.monthlyFeature1")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.monthlyFeature2")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.monthlyFeature3")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.monthlyFeature4")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>{t("upgrade.monthlyFeature5")}</span>
              </li>
            </ul>
            <div className="mt-6 h-[40px] flex items-center justify-center">
              {!user && !loading ? (
                <Link
                  to="/login"
                  className="flex items-center justify-center w-full rounded-xl border border-[#EBEDF5] text-sm font-semibold h-full text-[#181819] hover:bg-[#F2F3F9]"
                >
                  {t("upgrade.signInToSubscribe")}
                </Link>
              ) : plan === "monthly" && status === "active" ? (
                <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest text-center">{t("upgrade.currentPlanLabel")}</div>
              ) : (
                <button
                  type="button"
                  disabled={loadingMonthly}
                  onClick={() => startCheckout("monthly")}
                  className="flex items-center justify-center w-full rounded-xl border border-[#EBEDF5] text-sm font-semibold h-full text-[#181819] hover:bg-[#F2F3F9] disabled:opacity-60"
                >
                  {loadingMonthly ? t("upgrade.redirectingStripe") : t("upgrade.subscribe")}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="mt-10 text-center space-y-3 pb-8">
          <p className="text-[13px] text-[var(--text-muted)] max-w-xl mx-auto leading-relaxed">
            {t("upgrade.paymentNoteShort")}
          </p>
          <div>
            <button 
              onClick={() => setShowRules(!showRules)} 
              className="text-[13px] text-[#4578FC] hover:text-[#3d6ae6] hover:underline font-medium transition-colors"
            >
              {t("upgrade.readBillingRules")}
            </button>
          </div>
          
          {showRules && (
            <div className="mt-6 text-left p-5 bg-white border border-[#EBEDF5] rounded-2xl text-[13px] text-[var(--text-muted)] space-y-3 mx-auto max-w-2xl shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-sm font-semibold text-[#181819]">{t("upgrade.billingRulesTitle")}</p>
              <p>{t("upgrade.billingRules1")}</p>
              <p>{t("upgrade.billingRules2")}</p>
              <p>{t("upgrade.billingRules3")}</p>
              <p>{t("upgrade.billingRules4")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
