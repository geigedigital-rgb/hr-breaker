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

  const planLabel =
    plan === "trial" ? t("upgrade.trial7days") : plan === "monthly" ? t("upgrade.monthly") : status;

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
    <div className="ds-page-stage">
    <div className="ds-page-stage-body mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          {t("upgrade.backHome")}
        </Link>
        <span className="text-[var(--border-strong)]" aria-hidden>
          /
        </span>
        <h1 className="text-xl font-semibold text-[var(--text)] tracking-tight">{t("upgrade.title")}</h1>
      </div>

      {hasPaidPlan && (
        <section className="ds-card ds-card--success flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="ds-label !text-[var(--text-muted)]">{t("upgrade.currentPlan")}</span>
            <span className="ds-soft-pill ds-soft-pill--success">
              <CheckIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              {planLabel}
            </span>
          </div>
          {periodEnd && (
            <span className="ds-chip shrink-0">
              {t("upgrade.activeUntil")} {new Date(periodEnd).toLocaleDateString()}
            </span>
          )}
        </section>
      )}

      {error && (
        <section className="rounded-[var(--radius-lg)] border border-[var(--danger-soft)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
          {error}
        </section>
      )}

      <section className="grid gap-5 md:grid-cols-3 lg:gap-6">
        {/* Free */}
        <div className="ds-card flex flex-col p-6">
          <h2 className="text-base font-semibold text-[var(--text)]">{t("upgrade.free")}</h2>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]">{t("upgrade.freePrice")}</p>
          <p className="ds-hint mt-1">{t("upgrade.freeDesc")}</p>
          <ul className="mt-6 flex-1 space-y-3 text-sm font-medium text-[var(--text)]">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.freeFeature1")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.freeFeature2")}</span>
            </li>
            <li className="flex items-start gap-2.5 text-[var(--text-muted)] opacity-70">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.freeFeature3")}</span>
            </li>
            <li className="flex items-start gap-2.5 text-[var(--text-muted)] opacity-70">
              <LockClosedIcon className="h-5 w-5 shrink-0" />
              <span>{t("upgrade.freeFeature4")}</span>
            </li>
          </ul>
          <div className="mt-6 flex h-10 items-center justify-center">
            {plan === "free" ? (
              <span className="ds-soft-pill ds-soft-pill--muted">{t("upgrade.currentPlanLabel")}</span>
            ) : null}
          </div>
        </div>

        {/* Trial */}
        <div className="ds-card ds-card--accent relative flex flex-col overflow-hidden p-6">
          <div className="absolute right-0 top-0 z-10 rounded-bl-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-[10px] font-bold text-white shadow-sm">
            {t("upgrade.recommended")}
          </div>
          <h2 className="pr-24 text-base font-semibold text-[var(--text)]">{t("upgrade.trialTitle")}</h2>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]">{t("upgrade.trialPrice")}</p>
          <p className="ds-hint mt-1">{t("upgrade.trialDesc")}</p>
          <p className="mt-1.5 text-[11px] font-medium leading-snug text-[var(--text-tertiary)]">
            {t("upgrade.trialAutoRenew")}
          </p>
          <ul className="mt-6 flex-1 space-y-3 text-sm font-medium text-[var(--text)]">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
              <span>{t("upgrade.trialFeature1")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
              <span>{t("upgrade.trialFeature2")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
              <span>{t("upgrade.trialFeature3")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={2} />
              <span>{t("upgrade.trialFeature4")}</span>
            </li>
          </ul>
          <div className="mt-6 flex h-10 items-center justify-center">
            {!user && !loading ? (
              <Link to="/login" className="ds-btn-primary flex h-full w-full items-center justify-center !rounded-xl !text-sm">
                {t("upgrade.signInToSubscribe")}
              </Link>
            ) : plan === "trial" || (plan === "monthly" && status === "active") ? (
              <span className="ds-soft-pill ds-soft-pill--accent">{t("upgrade.currentPlanLabel")}</span>
            ) : (
              <button
                type="button"
                disabled={loadingTrial}
                onClick={() => startCheckout("trial")}
                className="ds-btn-primary flex h-full w-full items-center justify-center !rounded-xl !text-sm disabled:opacity-70"
              >
                {loadingTrial ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
              </button>
            )}
          </div>
        </div>

        {/* Monthly */}
        <div className="ds-card flex flex-col p-6">
          <h2 className="text-base font-semibold text-[var(--text)]">{t("upgrade.monthlyTitle")}</h2>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)]">{t("upgrade.monthlyPrice")}</p>
          <p className="ds-hint mt-1">{t("upgrade.monthlyDesc")}</p>
          <ul className="mt-6 flex-1 space-y-3 text-sm font-medium text-[var(--text)]">
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.monthlyFeature1")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.monthlyFeature2")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.monthlyFeature3")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.monthlyFeature4")}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckIcon className="h-5 w-5 shrink-0 text-[var(--success)]" strokeWidth={2} />
              <span>{t("upgrade.monthlyFeature5")}</span>
            </li>
          </ul>
          <div className="mt-6 flex h-10 items-center justify-center">
            {!user && !loading ? (
              <Link
                to="/login"
                className="inline-flex h-full w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              >
                {t("upgrade.signInToSubscribe")}
              </Link>
            ) : plan === "monthly" && status === "active" ? (
              <span className="ds-soft-pill ds-soft-pill--success">{t("upgrade.currentPlanLabel")}</span>
            ) : (
              <button
                type="button"
                disabled={loadingMonthly}
                onClick={() => startCheckout("monthly")}
                className="inline-flex h-full w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-60"
              >
                {loadingMonthly ? t("upgrade.redirectingStripe") : t("upgrade.subscribe")}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3 pt-2 text-center">
        <p className="ds-body mx-auto max-w-xl">{t("upgrade.paymentNoteShort")}</p>
        <button
          type="button"
          onClick={() => setShowRules(!showRules)}
          className="text-[13px] font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)] hover:underline"
        >
          {t("upgrade.readBillingRules")}
        </button>

        {showRules && (
          <div className="ds-card mx-auto mt-4 max-w-2xl space-y-3 p-5 text-left text-[13px] text-[var(--text-muted)]">
            <p className="text-sm font-semibold text-[var(--text)]">{t("upgrade.billingRulesTitle")}</p>
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
