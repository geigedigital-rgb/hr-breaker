import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";

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

export default function DownloadCheckout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<"trial" | "monthly" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
                <p className="text-xs text-[#6B7280] bg-[#F7F9FF] border border-[#E5EAF7] rounded-lg px-3 py-2">
                  Sandbox mode for admin: no Stripe redirect, no charges, visual flow only.
                </p>
              ) : pendingExportToken ? (
                <p className="text-xs text-[#6B7280] bg-[#F7F9FF] border border-[#E5EAF7] rounded-lg px-3 py-2">
                  Saved optimization found. No repeated analysis or optimization will run after payment.
                </p>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Saved optimization token is missing. Return to optimize and click Download PDF again.
                </p>
              )}
              {!sandboxMode && pendingExportToken && timerLabel && (
                <div className="inline-flex items-center gap-2 rounded-md border border-[#DDE3F3] bg-[#0F172A] px-2.5 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" aria-hidden />
                  <span className="text-[11px] font-medium text-white/90">Saved for</span>
                  <span className="text-[11px] font-semibold tabular-nums text-white">{timerLabel}</span>
                </div>
              )}
              {!sandboxMode && pendingExportToken && remainingSeconds === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Saved session expired. Return to optimize and click Download PDF again.
                </p>
              )}
              {canceled && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Payment was canceled. Your saved optimization is still available.
                </p>
              )}
              {error && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="flex-1 grid md:grid-cols-2 gap-4">
              <article className="rounded-2xl border border-[#C9D7FF] bg-[#F7FAFF] p-5 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">Trial 7 days</h2>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-[#4578FC] text-white">
                    Popular
                  </span>
                </div>
                <p className="mt-2 text-3xl font-bold">$2.99</p>
                <p className="text-xs text-[#5B6378] mt-1">Then $29/month. Cancel anytime before next charge.</p>
                <ul className="mt-5 space-y-2 text-sm text-[#1F2937] flex-1">
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />Unlimited ATS scans</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />Unlimited AI optimization</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />PDF export and download</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-[#4578FC]" />Multiple tailored versions</li>
                </ul>
                <button
                  type="button"
                  disabled={(!pendingExportToken && !sandboxMode) || (!sandboxMode && remainingSeconds === 0) || loadingPlan !== null}
                  onClick={() => void startCheckout("trial")}
                  className="mt-5 h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: "linear-gradient(160deg, #5e8afc 0%, #4578FC 45%, #3d6ae6 100%)" }}
                >
                  {loadingPlan === "trial" ? "Redirecting…" : "Continue with trial"}
                </button>
              </article>

              <article className="rounded-2xl border border-[#E6EAF4] bg-white p-5 flex flex-col">
                <h2 className="text-lg font-semibold">Monthly</h2>
                <p className="mt-2 text-3xl font-bold">$29</p>
                <p className="text-xs text-[#5B6378] mt-1">Best for ongoing applications and frequent tailoring.</p>
                <ul className="mt-5 space-y-2 text-sm text-[#1F2937] flex-1">
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />Unlimited resume tailoring</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />Advanced ATS keyword matching</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />Unlimited job scans</li>
                  <li className="flex items-start gap-2"><CheckIcon className="w-4 h-4 mt-0.5 text-emerald-600" />PDF export included</li>
                </ul>
                <button
                  type="button"
                  disabled={(!pendingExportToken && !sandboxMode) || (!sandboxMode && remainingSeconds === 0) || loadingPlan !== null}
                  onClick={() => void startCheckout("monthly")}
                  className="mt-5 h-11 rounded-xl text-sm font-semibold border border-[#D5DBEA] text-[#181819] bg-white hover:bg-[#F5F7FC] disabled:opacity-50"
                >
                  {loadingPlan === "monthly" ? "Redirecting…" : "Continue monthly"}
                </button>
              </article>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
