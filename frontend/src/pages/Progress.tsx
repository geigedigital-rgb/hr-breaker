import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  InformationCircleIcon,
  FireIcon,
  SparklesIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  ChartBarIcon,
  CheckCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "../contexts/AuthContext";
import {
  READINESS_STAGE_LABEL,
  READINESS_STAGE_ORDER,
  READINESS_STAGE_ICON_STYLE,
  READINESS_STAGE_ICON_IMAGE,
} from "../readiness";
import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { t as tStr } from "../i18n";

/** Glow/shadow by level: 1 silver, 2 light purple, 3 silver+purple, 4 purple+gold, 5 gold+purple */
const STAGE_GLOW: Record<string, { bg: string; shadow: string }> = {
  Emerging: {
    bg: "linear-gradient(145deg, rgba(203,213,225,0.4) 0%, rgba(148,163,184,0.25) 100%)",
    shadow: "0 12px 40px rgba(100,116,139,0.35), 0 0 60px rgba(148,163,184,0.2)",
  },
  Structured: {
    bg: "linear-gradient(145deg, rgba(216,180,254,0.35) 0%, rgba(192,132,252,0.2) 100%)",
    shadow: "0 12px 40px rgba(167,139,250,0.4), 0 0 60px rgba(192,132,252,0.25)",
  },
  Competitive: {
    bg: "linear-gradient(145deg, rgba(196,181,253,0.4) 0%, rgba(167,139,250,0.3) 50%, rgba(148,163,184,0.2) 100%)",
    shadow: "0 12px 40px rgba(139,92,246,0.45), 0 0 70px rgba(167,139,250,0.3)",
  },
  Strong: {
    bg: "linear-gradient(145deg, rgba(192,132,252,0.4) 0%, rgba(251,191,36,0.25) 100%)",
    shadow: "0 12px 40px rgba(168,85,247,0.4), 0 0 65px rgba(251,191,36,0.2)",
  },
  "Interview-Ready": {
    bg: "linear-gradient(145deg, rgba(251,191,36,0.35) 0%, rgba(192,132,252,0.35) 100%)",
    shadow: "0 14px 48px rgba(245,158,11,0.5), 0 0 80px rgba(139,92,246,0.35)",
  },
};

/** Mock event for "Что дало рост" (backend can replace with real feed later). */
type GrowthEvent = { icon: typeof DocumentTextIcon; label: string; points: number };
const MOCK_GROWTH_EVENTS: GrowthEvent[] = [
  { icon: ChartBarIcon, label: tStr("progress.growthResumeDone"), points: 12 },
  { icon: PencilSquareIcon, label: tStr("progress.growthExperience"), points: 18 },
  { icon: ArrowUpTrayIcon, label: tStr("progress.growthUpload"), points: 6 },
  { icon: DocumentTextIcon, label: tStr("progress.growthOptimized"), points: 10 },
  { icon: ChartBarIcon, label: tStr("progress.growthCheckPassed"), points: 5 },
];

function getNextStep(stage: string): { title: string; description: string; cta: string; to: string } {
  if (stage === "Interview-Ready" || stage === "Strong") {
    return {
      title: tStr("progress.nextStep"),
      description: tStr("progress.nextStepDescStrong"),
      cta: tStr("progress.nextStepCtaStrong"),
      to: "/optimize",
    };
  }
  return {
    title: tStr("progress.nextStep"),
    description: tStr("progress.nextStepDesc"),
    cta: tStr("progress.nextStepCta"),
    to: "/optimize",
  };
}

export default function Progress() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [progressAnimated, setProgressAnimated] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const readiness = user?.id !== "local" ? user?.readiness : null;

  useEffect(() => {
    const t = setTimeout(() => setProgressAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  if (!readiness) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-[var(--text-muted)] text-sm">Progress is available in your account. Sign in or sign up.</p>
        <button
          type="button"
          onClick={() => navigate("/settings")}
          className="mt-4 text-sm font-medium text-[#4578FC] hover:underline"
        >
          {tStr("nav.settings")}
        </button>
      </div>
    );
  }

  const stage = readiness.stage;
  const progressPct = Math.round(readiness.progress_to_next * 100);
  const stageLabel = READINESS_STAGE_LABEL[stage] ?? stage;
  const nextStep = getNextStep(stage);
  const currentIndex = READINESS_STAGE_ORDER.indexOf(stage as (typeof READINESS_STAGE_ORDER)[number]);
  const streak = readiness.streak_days ?? 0;
  const stageGlow = STAGE_GLOW[stage] ?? STAGE_GLOW.Emerging;

  return (
    <div className="min-h-full bg-[#F2F3F9]">
      <div className="max-w-5xl mx-auto p-5 pb-12 grid grid-cols-1 lg:grid-cols-[6fr_4fr] gap-5 auto-rows-auto">
        {/* Primary Bento (60%): Score + CTA + star for current level (shadow/glow by level) */}
        <section
          className="rounded-3xl p-6 lg:p-8 flex flex-col min-h-[280px] shadow-lg border border-white/50"
          style={{
            background: "linear-gradient(145deg, rgba(255,255,255,0.92) 0%, rgba(245,243,255,0.95) 100%)",
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(139, 92, 246, 0.12), 0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div className="flex flex-1 gap-6 items-center">
            <div className="flex flex-col items-start">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl lg:text-5xl font-bold tabular-nums bg-gradient-to-br from-[#6d28d9] to-[#4578FC] bg-clip-text text-transparent">
                  {readiness.score}
                </span>
                <button
                  type="button"
                  onClick={() => setInfoOpen(true)}
                  className="p-1 rounded-full text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] transition-colors"
                  aria-label="How points are earned"
                >
                  <InformationCircleIcon className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm font-medium text-[var(--text-muted)] mt-0.5">Market Readiness Score</p>
              <Link
                to={nextStep.to}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl py-3.5 px-6 text-sm font-semibold text-white shadow-lg shadow-[#6d28d9]/30 transition-all hover:shadow-xl hover:shadow-[#6d28d9]/35 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[#a78bfa] focus:ring-offset-2"
                style={{
                  background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #4578FC 100%)",
                }}
              >
                <SparklesIcon className="w-5 h-5" />
                {nextStep.cta}
              </Link>
            </div>
            <div
              className="shrink-0 ml-auto flex items-center justify-center w-28 h-28 rounded-2xl"
              style={{
                background: stageGlow.bg,
                boxShadow: stageGlow.shadow,
              }}
            >
              {READINESS_STAGE_ICON_IMAGE[stage] ? (
                <img
                  src={READINESS_STAGE_ICON_IMAGE[stage]}
                  alt=""
                  className="w-20 h-20 object-contain"
                  style={{ filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.2))" }}
                />
              ) : (
                <span
                  className="block w-16 h-16 rounded-2xl opacity-95"
                  style={{
                    ...(READINESS_STAGE_ICON_STYLE[stage] ?? READINESS_STAGE_ICON_STYLE.Emerging),
                    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                  }}
                />
              )}
            </div>
          </div>
        </section>

        {/* Gamification Bento (40%): Rhythm + Level + roadmap */}
        <section
          className="rounded-3xl p-6 flex flex-col shadow-md border border-[#EBEDF5] bg-white min-h-[300px]"
          style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
        >
          <div className="flex items-center gap-2 rounded-full bg-[#f5f3ff] px-3 py-2 w-fit mb-4">
            <FireIcon className="w-5 h-5 text-[#7c3aed]" />
            <span className="text-sm font-medium text-[#181819]">
              {streak > 0 ? `${streak} days in a row` : "No streak yet"}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-2">Progress to next level</p>
          <div className="h-2 rounded-full bg-[#EBEDF5] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: progressAnimated ? `${progressPct}%` : "0%",
                background: "linear-gradient(90deg, #a855f7 0%, #c084fc 50%, #6366f1 100%)",
                transitionDelay: "0.15s",
              }}
            />
          </div>
          <p className="text-sm font-semibold text-[#181819] mt-3">{stageLabel}</p>
          <div className="relative mt-4 flex-1 min-h-0 overflow-auto flex justify-center">
            <div className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-[#EBEDF5]" aria-hidden />
            <div className="relative z-10 flex flex-col items-center gap-1">
              {READINESS_STAGE_ORDER.map((s, i) => {
                const isCurrent = s === stage;
                const isPast = currentIndex >= 0 && i < currentIndex;
                const isFuture = currentIndex >= 0 && i > currentIndex;
                return (
                  <div
                    key={s}
                    className={`flex items-center gap-3 py-1.5 ${
                      isCurrent ? "rounded-xl bg-[#f5f3ff] px-3 py-2" : ""
                    }`}
                  >
                    <div className="flex shrink-0 w-5 h-5 items-center justify-center">
                      {isPast && <CheckCircleIcon className="w-5 h-5 text-[#7c3aed]" />}
                      {isCurrent && (
                        READINESS_STAGE_ICON_IMAGE[s] ? (
                          <img
                            src={READINESS_STAGE_ICON_IMAGE[s]}
                            alt=""
                            className="w-5 h-5 object-contain"
                          />
                        ) : (
                          <span
                            className="block w-4 h-4 rounded-full"
                            style={READINESS_STAGE_ICON_STYLE[s] ?? READINESS_STAGE_ICON_STYLE.Emerging}
                          />
                        )
                      )}
                      {isFuture && (
                        <LockClosedIcon className="w-5 h-5 text-[var(--text-muted)] opacity-50" />
                      )}
                    </div>
                    <p
                      className={`text-xs font-medium whitespace-nowrap ${isCurrent ? "text-[#181819]" : "text-[var(--text-muted)]"} ${isFuture ? "opacity-60" : ""}`}
                    >
                      {READINESS_STAGE_LABEL[s] ?? s}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Activity Bento (full width): What caused growth — vertical list, единая палитра */}
        <section
          className="rounded-3xl p-6 border border-[#EBEDF5] bg-white shadow-md col-span-full"
          style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
        >
          <h2 className="text-sm font-semibold text-[#181819] mb-4">What drove growth</h2>
          <ul className="space-y-2">
            {MOCK_GROWTH_EVENTS.slice(0, 5).map((ev, i) => {
              const Icon = ev.icon;
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-[#FAFAFC] border border-[#EBEDF5]"
                >
                  <span className="flex shrink-0 items-center justify-center w-9 h-9 rounded-lg bg-[#EBEDF5] text-[#6d28d9]">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#181819]">{ev.label}</p>
                    <p className="text-xs font-medium text-[var(--text-muted)] tabular-nums">+{ev.points}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* 6) Info bottom sheet */}
      <Transition show={infoOpen} as={Fragment}>
        <Dialog onClose={() => setInfoOpen(false)} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          </Transition.Child>
          <div className="fixed inset-0 flex items-end justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-full opacity-0"
              enterTo="translate-y-0 opacity-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100"
              leaveTo="translate-y-full opacity-0"
            >
              <Dialog.Panel className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl border border-[#EBEDF5]">
                <Dialog.Title className="text-lg font-semibold text-[#181819]">
                  How points are earned
                </Dialog.Title>
                <div className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                  <p>Points increase from actions that improve your resume.</p>
                  <p>We do not award points for random clicks.</p>
                  <ul className="list-disc list-inside space-y-1 mt-3">
                    <li>Resume analysis for a job</li>
                    <li>Successful improvement (PDF generation)</li>
                    <li>Uploading a new resume version</li>
                    <li>Regular app sign-in (once per day)</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  className="mt-6 w-full rounded-xl bg-[#4578FC] text-white py-3 text-sm font-semibold hover:bg-[#3d6ae6] transition-colors"
                >
                  Got it
                </button>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      <style>{`
        @keyframes fadeRise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%, 90%, 100% { opacity: 1; }
          95% { opacity: 0.92; }
        }
      `}</style>
    </div>
  );
}
