import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AcademicCapIcon,
  BanknotesIcon,
  BriefcaseIcon,
  CheckIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

/** Neutral notice (resume.io–style): no amber/red fills. */
function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] text-[#4B5563] leading-relaxed border border-[#E5E7EB] bg-white rounded-lg px-3.5 py-2.5">
      {children}
    </p>
  );
}

function StepItem({
  label,
  state,
  idx,
}: {
  label: string;
  state: "done" | "active" | "todo";
  idx: number;
}) {
  const baseCls =
    "w-7 h-7 rounded-full border flex items-center justify-center text-xs font-semibold shrink-0 transition-colors";
  const cls =
    state === "done"
      ? `${baseCls} border-[#4578FC] bg-[#4578FC] text-white`
      : state === "active"
        ? `${baseCls} border-[#4578FC] bg-[#EEF3FF] text-[#2f40df]`
        : `${baseCls} border-[#D7DBE8] bg-white text-[#8A93AB]`;
  return (
    <div className="inline-flex items-center gap-2 min-w-0">
      <span className={cls}>
        {state === "done" ? <CheckIcon className="w-4 h-4" /> : idx}
      </span>
      <span className={`text-xs md:text-sm truncate ${state === "todo" ? "text-[#8A93AB]" : "text-[#181819] font-medium"}`}>
        {label}
      </span>
    </div>
  );
}

function SandboxFeatureRow({
  Icon,
  children,
}: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5 items-start text-[13px] text-[#374151] leading-snug">
      <Icon className="w-[22px] h-[22px] shrink-0 text-[#111827] mt-0.5" strokeWidth={1.25} />
      <span>{children}</span>
    </li>
  );
}

export default function DownloadCheckout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<"trial" | "monthly" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sandboxSelected, setSandboxSelected] = useState<"trial" | "monthly">("trial");
  const [socialProofCount] = useState(() => 412 + Math.floor(Math.random() * (670 - 412 + 1)));

  const fromState = location.state as { pendingExportToken?: string; returnTo?: string } | null;
  const pendingExportToken = (fromState?.pendingExportToken || params.get("pending") || "").trim();
  const returnTo = (fromState?.returnTo || params.get("return_to") || "/optimize").trim() || "/optimize";
  const canceled = params.get("cancel") === "1";
  const sandboxMode = params.get("sandbox") === "1";
  const expiresAtRaw = (params.get("exp") || "").trim();
  const expiresAtMs = useMemo(() => {
    const n = Date.parse(expiresAtRaw);
    return Number.isFinite(n) ? n : null;
  }, [expiresAtRaw]);
  const [nowMs, setNowMs] = useState(Date.now());
  const remainingSeconds = expiresAtMs ? Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000)) : null;
  const timerLabel = useMemo(() => {
    if (remainingSeconds == null) return null;
    const mm = Math.floor(remainingSeconds / 60);
    const ss = remainingSeconds % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, [remainingSeconds]);

  useEffect(() => {
    if (expiresAtMs == null || sandboxMode) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAtMs, sandboxMode]);

  const successUrl = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}${returnTo}?checkout=success`;
  }, [returnTo]);

  const cancelUrl = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const q = new URLSearchParams();
    if (pendingExportToken) q.set("pending", pendingExportToken);
    q.set("return_to", returnTo);
    q.set("cancel", "1");
    return `${baseUrl}/checkout/download-resume?${q.toString()}`;
  }, [pendingExportToken, returnTo]);

  async function startCheckout(priceKey: "trial" | "monthly") {
    if (sandboxMode) {
      setError("Sandbox mode: checkout is disabled. This page is for UI flow preview.");
      return;
    }
    if (!user || user.id === "local") {
      navigate("/login");
      return;
    }
    setError(null);
    setLoadingPlan(priceKey);
    try {
      const { url } = await api.createCheckoutSession({
        price_key: priceKey,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (url) window.location.href = url;
      else setError("Could not open checkout. Please try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout error");
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6FB] text-[#181819]">
      <header className="border-b border-[#E6EAF4] bg-white/85 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
          <Link to={returnTo} className="inline-flex items-center gap-2 shrink-0">
            <img src="/logo-color.svg" alt="" className="w-6 h-6 object-contain" />
            <span className="text-sm md:text-base font-semibold tracking-tight">PitchCV</span>
          </Link>

          <div className="hidden md:flex items-center gap-5 min-w-0">
            <StepItem idx={1} state="done" label="Optimization complete" />
            <div className="w-6 h-px bg-[#D7DBE8]" />
            <StepItem idx={2} state="active" label="Choose plan" />
            <div className="w-6 h-px bg-[#D7DBE8]" />
            <StepItem idx={3} state="todo" label="Payment details" />
            <div className="w-6 h-px bg-[#D7DBE8]" />
            <StepItem idx={4} state="todo" label="Download resume" />
          </div>

          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#8A93AB] hover:text-[#181819] hover:bg-[#F2F4FA] transition-colors"
            aria-label="Close and return"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-10">
        <section className="rounded-2xl border border-[#E6EAF4] bg-white p-5 md:p-7 shadow-sm">
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-7">
            <div className="lg:w-[330px] shrink-0 space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4578FC]">Resume export</p>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Choose a plan to unlock PDF download</h1>
              <p className="text-sm text-[#5B6378] leading-relaxed">
                Your optimized resume is already saved in this session. After payment, you return to your result page and download it.
              </p>
              {sandboxMode ? (
                <InlineNotice>
                  Sandbox mode for admin: no Stripe redirect, no charges, visual flow only.
                </InlineNotice>
              ) : pendingExportToken ? (
                <InlineNotice>
                  Saved optimization found. No repeated analysis or optimization will run after payment.
                </InlineNotice>
              ) : (
                <InlineNotice>
                  Saved optimization token is missing. Return to optimize and click Download PDF again.
                </InlineNotice>
              )}
              {!sandboxMode && pendingExportToken && timerLabel && (
                <div className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] text-[#374151]">
                  <span className="text-[#6B7280]">Saved for</span>
                  <span className="font-semibold tabular-nums text-[#111827]">{timerLabel}</span>
                </div>
              )}
              {!sandboxMode && pendingExportToken && remainingSeconds === 0 && (
                <InlineNotice>
                  Saved session expired. Return to optimize and click Download PDF again.
                </InlineNotice>
              )}
              {canceled && (
                <InlineNotice>Payment was canceled. Your saved optimization is still available.</InlineNotice>
              )}
              {error && <InlineNotice>{error}</InlineNotice>}
            </div>

            {sandboxMode ? (
              <div className="flex-1 flex flex-col gap-5 min-w-0">
                <div className="grid sm:grid-cols-2 gap-4 sm:gap-5 items-start">
                  <div className="relative pb-5">
                    <button
                      type="button"
                      onClick={() => setSandboxSelected("trial")}
                      className={`w-full text-left rounded-xl bg-white p-4 sm:p-5 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/35 focus-visible:ring-offset-2 ${
                        sandboxSelected === "trial"
                          ? "border-2 border-[#4578FC] shadow-[0_1px_3px_rgba(69,120,252,0.12)]"
                          : "border border-[#E5E7EB] hover:border-[#D1D5DB]"
                      }`}
                    >
                      <div className="flex gap-3">
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                            sandboxSelected === "trial" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                          }`}
                          aria-hidden
                        >
                          {sandboxSelected === "trial" ? (
                            <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium text-[#111827]">7-days</p>
                          <p className="mt-1 text-[28px] font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                            {t("upgrade.trialPrice")}
                          </p>
                          <p className="mt-2.5 text-[11px] leading-snug text-[#6B7280]">
                            {socialProofCount} people chose this in the last 24 hours
                          </p>
                        </div>
                      </div>
                    </button>
                    <span
                      className="pointer-events-none absolute bottom-0 left-1/2 z-[1] -translate-x-1/2 translate-y-1/2 whitespace-nowrap rounded-md bg-gradient-to-r from-[#4578FC] to-[#5B6CF0] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
                      aria-hidden
                    >
                      Most popular
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSandboxSelected("monthly")}
                    className={`w-full text-left rounded-xl bg-white p-4 sm:p-5 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/25 focus-visible:ring-offset-2 ${
                      sandboxSelected === "monthly"
                        ? "border-2 border-[#4578FC] shadow-[0_1px_3px_rgba(69,120,252,0.12)]"
                        : "border border-[#E5E7EB] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="flex gap-3">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                          sandboxSelected === "monthly" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                        }`}
                        aria-hidden
                      >
                        {sandboxSelected === "monthly" ? (
                          <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-[#111827]">{t("upgrade.monthlyTitle")}</p>
                        <p className="mt-1 text-[28px] font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                          {t("upgrade.monthlyPrice")}
                          <span className="text-[15px] font-semibold text-[#6B7280]"> /mo</span>
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-5 sm:px-6 sm:py-6">
                  <ul className="space-y-4">
                    <SandboxFeatureRow Icon={DocumentDuplicateIcon}>
                      <strong className="font-semibold text-[#111827]">Unlimited</strong> ATS scans and AI resume
                      optimizations
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={BriefcaseIcon}>
                      {t("upgrade.trialFeature3")} — {t("upgrade.monthlyFeature2")}
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={DocumentTextIcon}>
                      {t("upgrade.monthlyFeature5")} and {t("upgrade.trialFeature4").toLowerCase()}
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={AcademicCapIcon}>
                      <strong className="font-semibold text-[#111827]">Full access</strong> for 7 days, then{" "}
                      {t("upgrade.monthlyTitle").toLowerCase()} billing — {t("upgrade.trialFeature2")},{" "}
                      {t("upgrade.trialFeature4").toLowerCase()}
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={ClockIcon}>
                      Auto-renews at {t("upgrade.monthlyPrice")}/mo after 7 days (billed monthly). Cancel anytime.
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={BanknotesIcon}>
                      <strong className="font-semibold text-[#111827]">Billing &amp; refunds</strong> —{" "}
                      {t("upgrade.billingRules4")}
                    </SandboxFeatureRow>
                  </ul>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={loadingPlan !== null}
                    onClick={() => void startCheckout("trial")}
                    className="h-11 rounded-lg border-2 border-[#4578FC] bg-white text-sm font-semibold text-[#4578FC] hover:bg-[#F5F8FF] disabled:opacity-50 transition-colors"
                  >
                    {loadingPlan === "trial" ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
                  </button>
                  <button
                    type="button"
                    disabled={loadingPlan !== null}
                    onClick={() => void startCheckout("monthly")}
                    className="h-11 rounded-lg border border-[#D1D5DB] bg-white text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors"
                  >
                    {loadingPlan === "monthly" ? t("upgrade.redirectingStripe") : t("upgrade.subscribe")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 grid md:grid-cols-2 gap-4">
                <article className="rounded-2xl border border-[#C9D7FF] bg-[#F7FAFF] p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold">{t("upgrade.trialTitle")}</h2>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-[#4578FC] text-white">
                      {t("upgrade.recommended")}
                    </span>
                  </div>
                  <p className="mt-2 text-3xl font-bold">{t("upgrade.trialPrice")}</p>
                  <p className="text-xs text-[#5B6378] mt-1">{t("upgrade.trialAutoRenew")}</p>
                  <ul className="mt-5 space-y-2 text-sm text-[#1F2937] flex-1">
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />
                      {t("upgrade.trialFeature1")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />
                      {t("upgrade.trialFeature2")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />
                      {t("upgrade.trialFeature3")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />
                      {t("upgrade.trialFeature4")}
                    </li>
                  </ul>
                  <button
                    type="button"
                    disabled={(!pendingExportToken && !sandboxMode) || (!sandboxMode && remainingSeconds === 0) || loadingPlan !== null}
                    onClick={() => void startCheckout("trial")}
                    className="mt-5 h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: "linear-gradient(160deg, #5e8afc 0%, #4578FC 45%, #3d6ae6 100%)" }}
                  >
                    {loadingPlan === "trial" ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
                  </button>
                </article>

                <article className="rounded-2xl border border-[#E6EAF4] bg-white p-5 flex flex-col">
                  <h2 className="text-lg font-semibold">{t("upgrade.monthlyTitle")}</h2>
                  <p className="mt-2 text-3xl font-bold">{t("upgrade.monthlyPrice")}</p>
                  <p className="text-xs text-[#5B6378] mt-1">{t("upgrade.monthlyDesc")}</p>
                  <ul className="mt-5 space-y-2 text-sm text-[#1F2937] flex-1">
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />
                      {t("upgrade.monthlyFeature1")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />
                      {t("upgrade.monthlyFeature2")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />
                      {t("upgrade.monthlyFeature3")}
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />
                      {t("upgrade.monthlyFeature4")}
                    </li>
                  </ul>
                  <button
                    type="button"
                    disabled={(!pendingExportToken && !sandboxMode) || (!sandboxMode && remainingSeconds === 0) || loadingPlan !== null}
                    onClick={() => void startCheckout("monthly")}
                    className="mt-5 h-11 rounded-xl text-sm font-semibold border border-[#D5DBEA] text-[#181819] bg-white hover:bg-[#F5F7FC] disabled:opacity-50"
                  >
                    {loadingPlan === "monthly" ? t("upgrade.redirectingStripe") : t("upgrade.subscribe")}
                  </button>
                </article>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
