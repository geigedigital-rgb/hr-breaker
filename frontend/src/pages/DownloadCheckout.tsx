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

/** Short label for checkout (filename-style, ends with .pdf); stem often starts with the candidate name. */
function shortenResumeFileLabel(raw: string, maxChars = 34): string {
  let s = raw.trim() || "Resume.pdf";
  if (!/\.pdf$/i.test(s)) s = `${s.replace(/\.[^/.]+$/, "")}.pdf`;
  if (s.length <= maxChars) return s;
  const ext = ".pdf";
  const stem = s.slice(0, -ext.length) || "Resume";
  const budget = maxChars - ext.length - 1;
  const keep = Math.max(6, budget);
  return `${stem.slice(0, keep)}…${ext}`;
}

/** English "Improved_" prefix for the reserved-PDF line — same in sandbox (no doc) and prod. */
function improvedResumeBasename(raw: string): string {
  let s = raw.trim() || "Resume.pdf";
  if (!/\.pdf$/i.test(s)) s = `${s.replace(/\.[^/.]+$/, "")}.pdf`;
  const stem = s.slice(0, -4);
  if (/^improved_/i.test(stem)) return `${stem}.pdf`;
  return `Improved_${stem}.pdf`;
}

function improvedResumeCheckoutLabel(raw: string, maxChars = 34): string {
  return shortenResumeFileLabel(improvedResumeBasename(raw), maxChars);
}

function CheckoutResumeReserveBlock({
  fileShort,
  fileRaw,
  countdownLabel,
}: {
  fileShort: string;
  fileRaw: string;
  countdownLabel: string | null;
}) {
  return (
    <div className="mb-3 rounded-xl border border-[#E6EAF4] bg-[#f7f9fc] px-3 py-2.5 sm:px-3.5 sm:py-3">
      <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <img
            src="/media/pdf-icon.svg"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 object-contain opacity-95"
            decoding="async"
          />
          <span className="min-w-0 truncate text-left text-sm font-semibold text-[#111827]" title={fileRaw}>
            {fileShort}
          </span>
        </div>
        <span
          className={`shrink-0 tabular-nums text-sm font-medium leading-none tracking-tight ${
            countdownLabel ? "text-[#64748B]" : "text-[#94a3b8]"
          }`}
          aria-live={countdownLabel ? "polite" : undefined}
        >
          {countdownLabel ?? "--:--"}
        </span>
      </div>
      <p className="mt-2.5 text-left text-sm font-normal leading-relaxed text-[#5B6378]">
        {countdownLabel
          ? t("upgrade.downloadCheckoutReserveUrgencyLine")
          : t("upgrade.downloadCheckoutReservedFileHintNoTimer")}
      </p>
    </div>
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
    <li className="flex gap-4 sm:gap-5 items-start text-[13px] text-[#374151] leading-snug">
      <span
        className="inline-flex h-[1lh] w-[22px] shrink-0 items-center justify-center self-start text-[#111827]"
        aria-hidden
      >
        <Icon className="w-[22px] h-[22px] shrink-0" strokeWidth={1.25} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

/** Strikethrough “was” prices shown before current trial / monthly amounts */
const PRICE_WAS_TRIAL = "$5.99";
const PRICE_WAS_MONTHLY = "$39";

const SUBSCRIPTION_BENEFITS: { text: string; icon: string }[] = [
  { text: "Instantly tailor your resume to any job", icon: "target.svg" },
  { text: "Unlock AI-powered resume optimization", icon: "cv.svg" },
  { text: "Start getting more callbacks from your applications", icon: "dollar.svg" },
  { text: "Get noticed by recruiters faster", icon: "bag.svg" },
  { text: "Make sure your resume gets past ATS filters", icon: "puzle.svg" },
  { text: "Become a top 1% candidate", icon: "0fficedress.svg" },
  { text: "PDF download right after checkout", icon: "time.svg" },
  { text: "24/7 support whenever you need help", icon: "chat.svg" },
];

const TRUST_EMPLOYER_LOGOS: { file: string; label: string }[] = [
  { file: "amazon.png", label: "Amazon" },
  { file: "asml.png", label: "ASML" },
  { file: "canva.png", label: "Canva" },
  { file: "dhl.png", label: "DHL" },
  { file: "spotyfy.png", label: "Spotify" },
  { file: "vw.png", label: "Volkswagen" },
];

const TRUSTPILOT_GREEN = "#00B67A";

function TrustpilotStarFull({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        fill={TRUSTPILOT_GREEN}
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
      />
    </svg>
  );
}

function TrustpilotStars45({ size = "lg" }: { size?: "lg" | "sm" }) {
  const dim = size === "lg" ? "h-8 w-8" : "h-3.5 w-3.5";
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <TrustpilotStarFull key={i} className={`${dim} shrink-0`} />
      ))}
      <div className={`relative shrink-0 ${dim}`}>
        <TrustpilotStarFull className={`${dim} opacity-[0.22]`} />
        <div className="absolute inset-0 w-1/2 overflow-hidden">
          <TrustpilotStarFull className={dim} />
        </div>
      </div>
    </div>
  );
}

function TrustpilotStars5Small() {
  return (
    <div className="flex justify-start gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <TrustpilotStarFull key={i} className="h-3.5 w-3.5 shrink-0" />
      ))}
    </div>
  );
}

function CheckoutMobileTrustReviews() {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <h2 className="text-center text-lg font-semibold tracking-tight text-[#111827]">
        {t("upgrade.checkoutReviewsTitle")}
      </h2>
      <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-[#E8EDF3] bg-[#fafbfc] px-4 py-5">
        <p className="text-2xl font-bold leading-none text-[#191919]">{t("upgrade.checkoutTrustExcellent")}</p>
        <TrustpilotStars45 size="lg" />
        <p className="text-center text-sm font-semibold text-[#191919]">{t("upgrade.checkoutTrustReviewsOnTrustpilot")}</p>
        <p className="text-base font-bold text-[#191919]">{t("upgrade.checkoutTrustScoreOutOf5")}</p>
        <p className="text-center text-xs leading-snug text-[#6B7280]">{t("upgrade.checkoutTrustBasedOnReviews")}</p>
      </div>
      <div className="flex w-full flex-col gap-3 text-left">
        <article className="rounded-xl border border-[#E6EAF4] bg-[#f7f9fc] px-3.5 py-3">
          <p className="text-sm font-semibold text-[#111827]">{t("upgrade.checkoutReview1Author")}</p>
          <div className="my-1.5">
            <TrustpilotStars5Small />
          </div>
          <p className="text-[13px] leading-snug text-[#374151]">{t("upgrade.checkoutReview1Text")}</p>
          <p className="mt-2 text-[11px] text-[#94a3b8]">{t("upgrade.checkoutReview1Ago")}</p>
        </article>
        <article className="rounded-xl border border-[#E6EAF4] bg-[#f7f9fc] px-3.5 py-3">
          <p className="text-sm font-semibold text-[#111827]">{t("upgrade.checkoutReview2Author")}</p>
          <div className="my-1.5">
            <TrustpilotStars5Small />
          </div>
          <p className="text-[13px] leading-snug text-[#374151]">{t("upgrade.checkoutReview2Text")}</p>
          <p className="mt-2 text-[11px] text-[#94a3b8]">{t("upgrade.checkoutReview2Ago")}</p>
        </article>
      </div>
    </div>
  );
}

function EmployerTrustStrip() {
  return (
    <div className="w-full">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B7280] mb-2 sm:mb-2.5">
        {t("upgrade.trustEmployersTitle")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-4 sm:gap-x-8">
        {TRUST_EMPLOYER_LOGOS.map(({ file, label }) => (
          <img
            key={file}
            src={`/logos/${file}`}
            alt={label}
            className="h-7 w-auto max-h-8 max-w-[104px] object-contain sm:h-8"
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}

export default function DownloadCheckout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<"trial" | "monthly" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"trial" | "monthly">("trial");
  const fromState = location.state as {
    pendingExportToken?: string;
    returnTo?: string;
    resumeDoc?: string;
  } | null;
  const pendingExportToken = (fromState?.pendingExportToken || params.get("pending") || "").trim();
  const returnTo = (fromState?.returnTo || params.get("return_to") || "/optimize").trim() || "/optimize";
  const resumeDocRaw = (fromState?.resumeDoc || params.get("doc") || "").trim();
  const resumeDocFullLabel = useMemo(() => improvedResumeBasename(resumeDocRaw), [resumeDocRaw]);
  const resumeDocDisplay = useMemo(
    () => improvedResumeCheckoutLabel(resumeDocRaw || "Resume.pdf"),
    [resumeDocRaw],
  );
  const canceled = params.get("cancel") === "1";
  const sandboxMode = params.get("sandbox") === "1";
  const expiresAtRaw = (params.get("exp") || "").trim();
  const expiresAtMs = useMemo(() => {
    const n = Date.parse(expiresAtRaw);
    return Number.isFinite(n) ? n : null;
  }, [expiresAtRaw]);
  const [sessionFallbackEndMs] = useState(() => Date.now() + 15 * 60 * 1000);
  const effectiveEndMs = expiresAtMs ?? sessionFallbackEndMs;
  const [nowMs, setNowMs] = useState(Date.now());
  const remainingSeconds =
    !sandboxMode && pendingExportToken
      ? Math.max(0, Math.floor((effectiveEndMs - nowMs) / 1000))
      : null;

  const displayCountdownSeconds =
    pendingExportToken ? Math.max(0, Math.floor((effectiveEndMs - nowMs) / 1000)) : null;
  const reserveCountdownLabel = useMemo(() => {
    if (displayCountdownSeconds === null) return null;
    const mm = Math.floor(displayCountdownSeconds / 60);
    const ss = displayCountdownSeconds % 60;
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }, [displayCountdownSeconds]);

  useEffect(() => {
    if (!pendingExportToken) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pendingExportToken]);

  const successUrl = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}${returnTo}?checkout=success`;
  }, [returnTo]);

  const cancelUrl = useMemo(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const q = new URLSearchParams();
    if (pendingExportToken) q.set("pending", pendingExportToken);
    if (resumeDocRaw) q.set("doc", resumeDocRaw);
    if (expiresAtRaw) q.set("exp", expiresAtRaw);
    q.set("return_to", returnTo);
    q.set("cancel", "1");
    return `${baseUrl}/checkout/download-resume?${q.toString()}`;
  }, [pendingExportToken, returnTo, resumeDocRaw, expiresAtRaw]);

  const continueDisabled =
    loadingPlan !== null ||
    (!sandboxMode && !pendingExportToken) ||
    (!sandboxMode && remainingSeconds === 0);

  const showCheckoutSubtitle =
    !sandboxMode || canceled || Boolean(error);

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
    <div className="min-h-screen bg-[#F5F8FF] text-[#181819]">
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

      <main className="max-w-[1200px] mx-auto px-6 pt-3 pb-[calc(16rem+env(safe-area-inset-bottom,0px))] lg:px-8 lg:pb-14 lg:pt-8">
        <h1 className="text-center mb-3 lg:mb-5 max-w-2xl mx-auto">
          <span className="block text-3xl leading-tight md:text-[2rem] md:leading-tight font-semibold tracking-tight text-[#111827]">
            {t("upgrade.checkoutPageTitleLine1")}
          </span>
          <span className="mt-2 hidden md:block text-lg md:text-xl font-medium leading-snug tracking-tight text-[#4B5563]">
            {t("upgrade.checkoutPageTitleLine2")}
          </span>
        </h1>

        <div className="w-full md:hidden py-6 mb-6">
          <img
            src="/media/best-resume-download.svg"
            alt=""
            className="mx-auto h-auto w-full max-w-full object-contain object-center max-h-[min(48vh,360px)]"
            decoding="async"
          />
        </div>

        {showCheckoutSubtitle ? (
          <div className="mb-4 space-y-2 text-[13px] text-[#5B6378] max-w-2xl mx-auto text-center leading-relaxed">
            {!sandboxMode && !pendingExportToken ? (
              <p className="text-amber-900/90">No saved session. Go back to Optimize and tap Download PDF again.</p>
            ) : null}
            {!sandboxMode && pendingExportToken && remainingSeconds === 0 ? (
              <p className="text-red-700">Session expired. Run optimize again.</p>
            ) : null}
            {canceled ? <p>Payment was canceled — you can try again.</p> : null}
            {error ? <p className="text-red-700">{error}</p> : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[2fr_3fr] lg:gap-x-10 lg:gap-y-7 lg:items-stretch">
          <div className="min-w-0 flex flex-col h-full min-h-0 lg:row-start-1 lg:col-start-1">
            <>
                <div className="shrink-0 flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
                  <div className="relative w-full min-w-0 lg:mb-4">
                    <button
                      type="button"
                      onClick={() => setSelectedPlan("trial")}
                      className={`w-full text-left rounded-xl bg-white p-4 sm:p-5 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/35 focus-visible:ring-offset-2 ${
                        selectedPlan === "trial"
                          ? "border-2 border-[#4578FC] shadow-[0_1px_3px_rgba(69,120,252,0.12)]"
                          : "border border-[#E5E7EB] hover:border-[#D1D5DB]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3 lg:hidden">
                        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                          <span
                            className={`flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                              selectedPlan === "trial" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                            }`}
                            aria-hidden
                          >
                            {selectedPlan === "trial" ? (
                              <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                            ) : null}
                          </span>
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[#111827]">7-days</span>
                            <span className="inline-flex shrink-0 items-center rounded-md bg-gradient-to-r from-[#4578FC] to-[#5B6CF0] px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-sm sm:px-3.5 sm:py-1.5 sm:text-[13px]">
                              Most popular
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="flex flex-wrap items-baseline justify-end gap-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                            <span className="text-lg sm:text-xl font-semibold text-[#9CA3AF] line-through decoration-[#9CA3AF]">
                              {PRICE_WAS_TRIAL}
                            </span>
                            <span>{t("upgrade.trialPrice")}</span>
                          </p>
                        </div>
                      </div>
                      <div className="hidden lg:flex lg:flex-col lg:gap-2">
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                              selectedPlan === "trial" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                            }`}
                            aria-hidden
                          >
                            {selectedPlan === "trial" ? (
                              <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                            ) : null}
                          </span>
                          <p className="text-sm font-medium text-[#111827]">7-days</p>
                        </div>
                        <p className="flex flex-wrap items-baseline gap-2 text-xl lg:text-2xl font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                          <span className="text-base lg:text-lg font-semibold text-[#9CA3AF] line-through decoration-[#9CA3AF]">
                            {PRICE_WAS_TRIAL}
                          </span>
                          <span>{t("upgrade.trialPrice")}</span>
                        </p>
                      </div>
                    </button>
                    <span
                      className="pointer-events-none absolute bottom-0 left-1/2 z-[35] hidden -translate-x-1/2 translate-y-1/2 whitespace-nowrap rounded-md bg-gradient-to-r from-[#4578FC] to-[#5B6CF0] px-2.5 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-white shadow-sm lg:inline-flex"
                      aria-hidden
                    >
                      Most popular
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedPlan("monthly")}
                    className={`w-full text-left rounded-xl bg-white p-4 sm:p-5 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/25 focus-visible:ring-offset-2 ${
                      selectedPlan === "monthly"
                        ? "border-2 border-[#4578FC] shadow-[0_1px_3px_rgba(69,120,252,0.12)]"
                        : "border border-[#E5E7EB] hover:border-[#D1D5DB]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 lg:hidden">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                            selectedPlan === "monthly" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                          }`}
                          aria-hidden
                        >
                          {selectedPlan === "monthly" ? (
                            <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                          ) : null}
                        </span>
                        <p className="text-sm font-medium text-[#111827]">{t("upgrade.monthlyTitle")}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="flex flex-wrap items-baseline justify-end gap-2 text-2xl sm:text-3xl font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                          <span className="text-lg sm:text-xl font-semibold text-[#9CA3AF] line-through decoration-[#9CA3AF]">
                            {PRICE_WAS_MONTHLY}
                          </span>
                          <span>
                            {t("upgrade.monthlyPrice")}
                            <span className="text-base font-semibold text-[#6B7280]"> /mo</span>
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="hidden lg:flex lg:flex-col lg:gap-2">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 rounded-full border-2 items-center justify-center ${
                            selectedPlan === "monthly" ? "border-[#4578FC]" : "border-[#D1D5DB]"
                          }`}
                          aria-hidden
                        >
                          {selectedPlan === "monthly" ? (
                            <span className="h-2 w-2 rounded-full bg-[#4578FC]" />
                          ) : null}
                        </span>
                        <p className="text-sm font-medium text-[#111827]">{t("upgrade.monthlyTitle")}</p>
                      </div>
                      <p className="flex flex-wrap items-baseline gap-2 text-xl lg:text-2xl font-bold tracking-tight text-[#111827] tabular-nums leading-none">
                        <span className="text-base lg:text-lg font-semibold text-[#9CA3AF] line-through decoration-[#9CA3AF]">
                          {PRICE_WAS_MONTHLY}
                        </span>
                        <span>
                          {t("upgrade.monthlyPrice")}
                          <span className="text-sm font-semibold text-[#6B7280]"> /mo</span>
                        </span>
                      </p>
                    </div>
                  </button>
                </div>

                <div className="mt-2 rounded-xl border border-[#E6EAF4] bg-white px-6 py-7 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:rounded-none sm:border-0 sm:bg-transparent sm:px-5 sm:py-6 sm:shadow-none lg:mt-2 lg:px-6 lg:py-6">
                  <ul className="shrink-0 space-y-[20px] lg:space-y-6">
                    <SandboxFeatureRow Icon={DocumentDuplicateIcon}>
                      <strong className="font-semibold text-[#111827]">Unlimited</strong> ATS scans &amp; AI resume
                      optimization
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={BriefcaseIcon}>
                      Job-specific tailoring &amp; ATS keyword matching
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={DocumentTextIcon}>
                      Save multiple tailored resumes · PDF export
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={AcademicCapIcon}>
                      Full access 7 days, then {t("upgrade.monthlyTitle").toLowerCase()} · AI optimize &amp; PDF
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={ClockIcon}>
                      Auto-renews at <span className="font-normal">{t("upgrade.monthlyPrice")}</span>/mo after 7 days
                    </SandboxFeatureRow>
                    <SandboxFeatureRow Icon={BanknotesIcon}>
                      <strong className="font-semibold text-[#111827]">Money Back Guarantee</strong>
                    </SandboxFeatureRow>
                  </ul>
                </div>
            </>
          </div>

          <aside className="min-w-0 h-full flex flex-col rounded-2xl bg-white border border-[#E6EAF4] p-6 md:p-8 shadow-[0_4px_24px_rgba(15,23,42,0.06)] lg:row-start-1 lg:col-start-2">
            <div className="lg:hidden w-full shrink-0">
              <CheckoutMobileTrustReviews />
            </div>
            <div className="hidden lg:flex lg:flex-col flex-1 min-h-0">
              <h2 className="text-lg md:text-xl font-semibold tracking-tight text-[#111827] mb-6 shrink-0 text-center">
                {t("upgrade.allSubscriptionBenefits")}
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5 text-[13px] md:text-sm leading-snug text-[#374151] flex-1 min-h-0 content-start">
                {SUBSCRIPTION_BENEFITS.map(({ text, icon }) => (
                  <li
                    key={text}
                    className="flex gap-2 items-center rounded-xl bg-[#f7f9fc] px-3.5 py-3"
                  >
                    <img
                      src={`/icons/${icon}`}
                      alt=""
                      width={34}
                      height={34}
                      className="w-[34px] h-[34px] shrink-0 object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="min-w-0">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-6 max-lg:hidden shrink-0 flex flex-col items-stretch">
              <CheckoutResumeReserveBlock
                fileShort={resumeDocDisplay}
                fileRaw={resumeDocFullLabel}
                countdownLabel={reserveCountdownLabel}
              />
              <button
                type="button"
                disabled={continueDisabled}
                onClick={() => void startCheckout(selectedPlan)}
                className="w-full h-12 rounded-xl text-sm font-semibold text-white bg-[#339d5d] hover:bg-[#2e8a52] disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-sm"
              >
                {loadingPlan !== null ? t("upgrade.redirectingStripe") : t("upgrade.checkoutContinue")}
              </button>
              <p className="mt-2.5 text-center text-[11px] leading-snug text-[#5B6570] sm:text-xs sm:leading-normal">
                <span className="font-medium text-[#374151]">{t("upgrade.checkoutMoneyBackGuarantee")}</span>
              </p>
            </div>
          </aside>
        </div>

        <div className="mt-8 w-full max-w-[1200px] mx-auto px-6 border-t border-[#E6EAF4] pt-8 lg:mt-10 lg:px-8 lg:pt-10">
          <EmployerTrustStrip />
        </div>
      </main>

      <div
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[#E6EAF4] bg-[#F5F8FF]/95 backdrop-blur-md px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(15,23,42,0.08)]"
        role="presentation"
      >
        <div className="max-w-[1200px] mx-auto flex flex-col items-stretch">
          <CheckoutResumeReserveBlock
            fileShort={resumeDocDisplay}
            fileRaw={resumeDocFullLabel}
            countdownLabel={reserveCountdownLabel}
          />
          <button
            type="button"
            disabled={continueDisabled}
            onClick={() => void startCheckout(selectedPlan)}
            className="w-full h-12 rounded-xl text-sm font-semibold text-white bg-[#339d5d] hover:bg-[#2e8a52] disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-sm"
          >
            {loadingPlan !== null ? t("upgrade.redirectingStripe") : t("upgrade.checkoutContinue")}
          </button>
        </div>
      </div>
    </div>
  );
}
