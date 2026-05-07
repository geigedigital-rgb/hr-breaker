import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  KeyIcon,
  SparklesIcon,
  UserCircleIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { t, tFormat } from "../../i18n";
import * as api from "../../api";
import { PostResultResumeStudio } from "../../components/PostResultResumeStudio";
import { storeCheckoutResumePreview } from "../../checkoutResumePreview";

const MOCK = {
  atsPct: 72,
  kwPct: 68,
  /** Sandbox-only ATS readability score (0–100), shown next to match rings. */
  atsFriendlyScore: 56,
  displayName: "Anna Muller",
  displaySpecialty: "Senior Product Manager",
  displaySkills: "Agile, Scrum, Jira, SQL, Stakeholder Management, Roadmapping, A/B Testing, OKRs",
  recommendations: [
    {
      category: "Technical Skills",
      labels: ["Python - present", "SQL - present", "CI/CD - missing", "Figma - missing", "Docker - weak mention"],
    },
    {
      category: "Soft Skills & Leadership",
      labels: ["Stakeholder Management - OK", "Cross-functional Leadership - missing", "Mentoring - present"],
    },
    {
      category: "Resume Structure",
      labels: ["Summary section - OK", "Quantifiable metrics - missing", "Education - OK", "Certifications - none listed"],
    },
  ],
  resultKeyChanges: [
    {
      category: "Professional Summary",
      description: "Stronger alignment with the role and clearer value proposition for screening.",
      items: ["Optimized for ATS screening", "Stronger leadership signal", "Clearer impact framing"],
    },
    {
      category: "Experience",
      description: "Tighter bullets and metrics that parsers and recruiters scan faster.",
      items: ["Quantified outcomes highlighted", "Role-relevant keywords aligned", "STAR-style clarity"],
    },
    {
      category: "Skills Section",
      description: null,
      items: ["Keyword alignment with posting", "Stack grouped for ATS", "Nice-to-have tools surfaced"],
    },
  ],
  /** Same shape as `/analyze` `callback_blockers` — headline / impact / action from LLM */
  callback_blockers: [
    {
      headline: "Missing important keywords",
      impact: "ATS may rank you below candidates who mirror the posting language.",
      action: "Mirror 4–6 phrases from the job description in summary and skills.",
    },
    {
      headline: "Weak measurable outcomes",
      impact: "Recruiters cannot verify impact when bullets stay qualitative.",
      action: "Add metrics (% , $ , scope) to two experience bullets.",
    },
    {
      headline: "Leadership signal unclear",
      impact: "You may read as an individual contributor instead of a lead.",
      action: "Add one line: team size, stakeholders, or budget scope.",
    },
  ] satisfies api.CallbackBlockerOut[],
  resultFilters: [
    { filter_name: "ContentLengthChecker", passed: true, score: 0.95, threshold: 0.8 },
    { filter_name: "DataValidator", passed: true, score: 1.0, threshold: 0.5 },
    { filter_name: "HallucinationChecker", passed: true, score: 0.88, threshold: 0.7 },
    { filter_name: "KeywordMatcher", passed: true, score: 0.82, threshold: 0.6 },
    { filter_name: "LLMChecker", passed: true, score: 0.78, threshold: 0.65 },
    { filter_name: "VectorSimilarityMatcher", passed: false, score: 0.55, threshold: 0.6 },
    { filter_name: "AIGeneratedChecker", passed: true, score: 0.72, threshold: 0.5 },
  ],
};

/** Same shape as optimize `schema_json` — drives /templates/render-pdf in PostResultResumeStudio. */
function buildSandboxOptimizedSchemaJson(): string {
  return JSON.stringify({
    basics: {
      name: MOCK.displayName,
      label: MOCK.displaySpecialty,
      email: "anna.muller@example.com",
      summary:
        "Product leader focused on discovery, roadmaps, and measurable outcomes across B2B platforms.",
    },
    work: [
      {
        name: "TechCorp",
        position: "Senior Product Manager",
        start_date: "2021-03",
        end_date: "Present",
        highlights: [
          "Owned roadmap for a core platform with 2M+ MAU",
          "Cut initiative cycle time ~28% by tightening discovery and prioritization",
        ],
      },
    ],
    skills: [
      {
        name: "Core",
        keywords: MOCK.displaySkills.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 14),
      },
    ],
  });
}

const SANDBOX_OPTIMIZED_SCHEMA_JSON = buildSandboxOptimizedSchemaJson();

type ViewMode = "assessment" | "result" | "both";

function isProblemLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("missing") || l.includes("weak") || l.includes("none");
}

function cleanReason(label: string): string {
  return label
    .replace(/\s*-\s*(missing|weak mention|none listed|ok|present)$/i, "")
    .trim();
}

function matchTierShort(
  pct: number,
  opts?: { excellentFrom?: number }
): { label: string; hint: string; barClass: string; textClass: string } {
  const excellentFrom = opts?.excellentFrom ?? 85;
  const p = Math.max(0, Math.min(100, Math.round(pct)));

  if (p >= excellentFrom) {
    return {
      label: t("admin.visualSandbox.matchTierExcellent"),
      hint: t("admin.visualSandbox.matchTierExcellentHint"),
      barClass: "bg-gradient-to-r from-emerald-500 to-emerald-400",
      textClass: "text-emerald-700",
    };
  }

  // Between 78 and “excellent” threshold only when excellent is 85+ — 78% is already a strong baseline.
  if (excellentFrom > 78 && p >= 78 && p < excellentFrom) {
    return {
      label: t("admin.visualSandbox.matchTierSolid"),
      hint: t("admin.visualSandbox.matchTierSolidHint"),
      barClass: "bg-gradient-to-r from-teal-500 to-emerald-400",
      textClass: "text-teal-700",
    };
  }

  if (p >= 65) {
    return {
      label: t("admin.visualSandbox.matchTierNeedsRefinement"),
      hint: t("admin.visualSandbox.matchTierNeedsRefinementHint"),
      barClass: "bg-gradient-to-r from-amber-500 to-amber-400",
      textClass: "text-amber-700",
    };
  }
  if (p >= 45) {
    return {
      label: t("admin.visualSandbox.matchTierFair"),
      hint: t("admin.visualSandbox.matchTierFairHint"),
      barClass: "bg-gradient-to-r from-amber-500 to-orange-400",
      textClass: "text-orange-700",
    };
  }
  return {
    label: t("admin.visualSandbox.matchTierNeedsWork"),
    hint: t("admin.visualSandbox.matchTierNeedsWorkHint"),
    barClass: "bg-gradient-to-r from-orange-500 to-rose-400",
    textClass: "text-orange-800",
  };
}

/** Stable mock “boost” percent per callback row (prod API has no numeric boost). */
function boostPctForSandboxBlocker(i: number): number {
  return 6 + ((i * 5) % 10);
}

function impactToneForBlocker(cb: api.CallbackBlockerOut, index: number): "high" | "medium" {
  const h = cb.headline.toLowerCase();
  if (h.includes("missing") || h.includes("keyword") || h.includes("measurable")) return "high";
  if (h.includes("leadership") || h.includes("signal")) return index === 0 ? "high" : "medium";
  return index === 0 ? "high" : "medium";
}

const CALLBACK_PREVIEW_ICONS = [KeyIcon, BoltIcon, UserCircleIcon] as const;

function mixHex(a: string, b: string, t: number): string {
  const ah = a.replace("#", "");
  const bh = b.replace("#", "");
  const ar = parseInt(ah.slice(0, 2), 16);
  const ag = parseInt(ah.slice(2, 4), 16);
  const ab = parseInt(ah.slice(4, 6), 16);
  const br = parseInt(bh.slice(0, 2), 16);
  const bg = parseInt(bh.slice(2, 4), 16);
  const bb = parseInt(bh.slice(4, 6), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function scoreProgressColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 25) return mixHex("#dc2626", "#f59e0b", p / 25);
  if (p <= 45) return "#f59e0b";
  if (p <= 60) return mixHex("#f59e0b", "#16a34a", (p - 45) / 15);
  return "#16a34a";
}

function riskProgressColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 40) return "#16a34a";
  if (p <= 75) return mixHex("#16a34a", "#f59e0b", (p - 40) / 35);
  return mixHex("#f59e0b", "#dc2626", (p - 75) / 25);
}

function ScoreRing({
  percent,
  size = 46,
  thickness = 6,
  mode = "score",
}: {
  percent: number;
  size?: number;
  thickness?: number;
  mode?: "score" | "risk";
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const angle = (pct / 100) * 360;
  const startDeg = 270; // 0% at 9 o'clock
  const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 calc(100% - ${thickness}px))`;
  const qualityColor = mode === "risk" ? riskProgressColor(pct) : scoreProgressColor(pct);
  const filledGradient =
    mode === "risk"
      ? `conic-gradient(from ${startDeg}deg, #16a34a 0%, #16a34a 40%, #f59e0b 75%, #dc2626 100%)`
      : `conic-gradient(from ${startDeg}deg, #dc2626 0%, #f59e0b 25%, #f59e0b 45%, #16a34a 60%, #16a34a 100%)`;
  const markerRadius = Math.max(2.5, thickness / 2 + 0.5);
  const orbit = size / 2 - thickness / 2 - 0.25;
  const markerDeg = startDeg + angle;
  const markerRad = (markerDeg * Math.PI) / 180;
  const markerX = size / 2 + orbit * Math.sin(markerRad) - markerRadius;
  const markerY = size / 2 - orbit * Math.cos(markerRad) - markerRadius;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: filledGradient,
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            pct <= 0
              ? "#E5E7EB"
              : pct >= 100
                ? "transparent"
                : `conic-gradient(from ${startDeg}deg, transparent 0deg ${angle}deg, #E5E7EB ${angle}deg 360deg)`,
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
        }}
      />
      <span
        className="absolute rounded-full ring-2 ring-white"
        style={{
          width: markerRadius * 2,
          height: markerRadius * 2,
          left: markerX,
          top: markerY,
          backgroundColor: qualityColor,
        }}
      />
    </div>
  );
}

const RESULT_KEY_ICONS = [DocumentTextIcon, BriefcaseIcon, AcademicCapIcon] as const;

export default function AdminVisualTest() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [sandboxTemplateId, setSandboxTemplateId] = useState("");
  const [sandboxPhoto, setSandboxPhoto] = useState<string | null>(null);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [mockThumbUrl, setMockThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById("admin-header-portal"));
    
    // Fetch a real thumbnail from history to use as mock
    const token = api.getStoredToken();
    if (token) {
      api
        .getHistory()
        .then((res) => {
          if (res.items?.length) {
            setMockThumbUrl(api.historyThumbnailUrl(res.items[0].filename, token));
          }
        })
        .catch(() => {});
    }
  }, []);

  const overallPct = Math.round((MOCK.atsPct + MOCK.kwPct) / 2);
  /** Matches prod Optimize: main ring = resume quality (not rejection risk). */
  const assessmentQualityPct = overallPct;
  /** Same band as prod post–auto-improve (82–93), stable for this sandbox session. */
  const studioMatchPct = useMemo(() => 82 + Math.floor(Math.random() * 12), []);

  const scanSummaryText =
    "The current resume looks acceptable at first glance, but key proof points are missing. This is why responses stay low.";

  const treatmentGroups = MOCK.recommendations.map((group) => {
    const problems = group.labels.filter((label) => isProblemLabel(label));
    return { category: group.category, problems };
  });
  const totalIssueCount = treatmentGroups.reduce((n, g) => n + g.problems.length, 0);

  const resultTierResult = useMemo(
    () => matchTierShort(studioMatchPct, { excellentFrom: 78 }),
    [studioMatchPct],
  );
  const resultImprovementCount = useMemo(
    () => MOCK.resultKeyChanges.reduce((n, g) => n + g.items.length, 0),
    [],
  );
  const resultScoreFactorLines = useMemo(
    () => [
      t("admin.visualSandbox.resultScoreFactor1"),
      t("admin.visualSandbox.resultScoreFactor2"),
      t("admin.visualSandbox.resultScoreFactor3"),
      t("admin.visualSandbox.resultScoreFactor4"),
      t("admin.visualSandbox.resultScoreFactor5"),
    ],
    [],
  );
  const resultTopBucketPct = studioMatchPct >= 92 ? 2 : studioMatchPct >= 85 ? 5 : null;

  const currentMatchPct = assessmentQualityPct;
  const potentialMatchPct = studioMatchPct;
  const currentTier = matchTierShort(currentMatchPct);
  const potentialTier = matchTierShort(potentialMatchPct, { excellentFrom: 78 });

  const assessmentHero = (
    <div className="w-full min-w-0 space-y-1">
      <h2 className="text-[20px] sm:text-[22px] font-semibold leading-snug tracking-tight text-[#181819]">
        {t("admin.visualSandbox.assessmentTitleLead")}{" "}
        <span className="text-[#6366F1]">{t("admin.visualSandbox.assessmentTitleHighlight")}</span>
      </h2>
      <p className="text-[13px] leading-relaxed text-[#6B7280]">{t("admin.visualSandbox.assessmentSubtitle")}</p>
    </div>
  );

  const assessmentLeftColumn = (
    <div className="flex flex-col gap-5 w-full min-w-0 overflow-x-hidden">
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
        <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t("optimize.overallMatchScore")}</p>
        <div className="grid flex-1 grid-cols-1 items-start gap-8 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          <div className="min-w-0 text-center sm:text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t("admin.visualSandbox.currentMatch")}</p>
            <p className="mt-2 text-[clamp(2rem,8vw,2.75rem)] font-bold tabular-nums leading-none tracking-tight text-[#0f172a]">{currentMatchPct}%</p>
            <p className={`mt-2 text-[15px] font-semibold ${currentTier.textClass}`}>{currentTier.label}</p>
            <p className="mx-auto mt-1 max-w-[240px] text-[11px] leading-snug text-slate-500 sm:mx-0">{currentTier.hint}</p>
            <div className="mx-auto mt-4 h-2 max-w-[220px] overflow-hidden rounded-full bg-slate-100 sm:mx-0 sm:max-w-none">
              <div className={`h-full rounded-full ${currentTier.barClass}`} style={{ width: `${currentMatchPct}%` }} />
            </div>
          </div>
          <div className="flex justify-center sm:pt-10">
            <ArrowRightIcon className="h-6 w-6 shrink-0 text-slate-300 rotate-90 sm:rotate-0" aria-hidden />
          </div>
          <div className="min-w-0 text-center sm:text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t("admin.visualSandbox.potentialMatch")}</p>
            <p className={`mt-2 text-[clamp(2rem,8vw,2.75rem)] font-bold tabular-nums leading-none ${potentialTier.textClass}`}>{potentialMatchPct}%</p>
            <p className={`mt-2 text-[15px] font-semibold ${potentialTier.textClass}`}>{potentialTier.label}</p>
            <p className="mx-auto mt-1 max-w-[240px] text-[11px] leading-snug text-slate-500 sm:mx-0">{potentialTier.hint}</p>
            <div className="mx-auto mt-4 h-2 max-w-[220px] overflow-hidden rounded-full bg-slate-100 sm:mx-0 sm:max-w-none">
              <div className={`h-full rounded-full ${potentialTier.barClass}`} style={{ width: `${potentialMatchPct}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
            {t("admin.visualSandbox.recommendationsEyebrow")}
          </p>
          <h3 className="mt-2 text-[17px] font-semibold tracking-tight text-[#0f172a]">{t("optimize.whyNoCallbacksTitle")}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500">{scanSummaryText}</p>
        </div>

        <ul className="mt-4 space-y-3">
          {MOCK.callback_blockers.map((cb, i) => {
            const Icon = CALLBACK_PREVIEW_ICONS[i % CALLBACK_PREVIEW_ICONS.length];
            const tone = impactToneForBlocker(cb, i);
            const boost = boostPctForSandboxBlocker(i);
            return (
              <li
                key={cb.headline}
                className="rounded-xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/50 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div className="flex gap-3">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      tone === "high"
                        ? "bg-red-50 text-red-600"
                        : "bg-amber-50 text-amber-700"
                    }`}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-snug text-[#0f172a]">{cb.headline}</p>
                    <p className="mt-1.5 text-[12px] leading-snug text-slate-600">{cb.action}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 self-start">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium tracking-tight ${
                        tone === "high"
                          ? "bg-red-50 text-red-800"
                          : "bg-amber-50 text-amber-900"
                      }`}
                    >
                      {tone === "high" ? t("admin.visualSandbox.impactHigh") : t("admin.visualSandbox.impactMedium")}
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums text-[#0f766e]">
                      {tFormat(t("admin.visualSandbox.potentialBoost"), { pct: boost })}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <Disclosure>
          {({ open }) => (
            <div className="mt-2 border-t border-slate-100 pt-4">
              <DisclosureButton className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-[#0f172a] shadow-sm transition-colors hover:bg-slate-50">
                <span>{tFormat(t("admin.visualSandbox.seeGapBreakdown"), { count: totalIssueCount })}</span>
                <ChevronDownIcon className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
              </DisclosureButton>
              <DisclosurePanel className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="grid max-h-[min(50vh,340px)] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {treatmentGroups
                    .filter((g) => g.problems.length > 0)
                    .map((group) => (
                      <div
                        key={group.category}
                        className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{group.category}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {group.problems.map((label) => (
                            <span
                              key={`${group.category}-${label}`}
                              className="inline-flex max-w-full break-words rounded-md bg-white px-2 py-1 text-[11px] font-medium leading-snug text-[#334155] ring-1 ring-slate-200/90"
                            >
                              {cleanReason(label)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </DisclosurePanel>
            </div>
          )}
        </Disclosure>
      </section>
    </div>
  );

  const assessmentRightColumn = (
    <aside className="flex w-full min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
      <div className="overflow-hidden rounded-2xl border border-[#E8ECF4] bg-white shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)]">
        <div className="flex flex-nowrap items-center gap-3 border-b border-[#E8ECF4] bg-[#FAFBFC] px-4 py-3">
          <div className="shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t("admin.visualSandbox.atsFriendlyLabel")}</p>
            <div className="mt-0.5 flex items-baseline gap-0.5 tabular-nums leading-none">
              <span className="text-[1.375rem] font-bold tracking-tight text-[#0f172a]">{MOCK.atsFriendlyScore}</span>
              <span className="text-sm font-medium text-slate-400">/100</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 self-center">
            <div className="h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-slate-200/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400"
                style={{ width: `${MOCK.atsFriendlyScore}%` }}
              />
            </div>
          </div>
        </div>
        <div className="relative aspect-[210/270] bg-[#F4F6FA]">
          {mockThumbUrl ? (
            <img src={mockThumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 flex gap-3 p-4">
              <div className="w-[28%] shrink-0 rounded-lg bg-[#1e3a5f]" />
              <div className="min-w-0 flex-1 space-y-2 pt-2">
                <div className="mx-auto h-2 w-1/2 rounded-full bg-[#DCE3F0]" />
                <div className="h-1.5 w-full rounded bg-[#E8ECF4]" />
                <div className="h-1.5 w-5/6 rounded bg-[#E8ECF4]" />
                <div className="mt-4 h-1.5 w-full rounded bg-[#E8ECF4]" />
                <div className="h-1.5 w-4/5 rounded bg-[#E8ECF4]" />
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-4 pt-16">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#C7D2FE] bg-white/95 py-2.5 text-[13px] font-semibold text-[#4338CA] shadow-sm backdrop-blur-sm"
            >
              <EyeIcon className="h-4 w-4 shrink-0" aria-hidden />
              {t("admin.visualSandbox.viewFullResume")}
            </button>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-[#E8E4FF] bg-gradient-to-br from-[#F5F3FF] via-white to-[#EDE9FE] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#818CF8] to-[#6366F1] shadow-md">
              <SparklesIcon className="h-7 w-7 text-white" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-[14px] font-semibold leading-snug text-[#181819] sm:text-[15px]">
                {tFormat(t("admin.visualSandbox.autoImproveBannerTitle"), { pct: potentialMatchPct })}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {[t("admin.visualSandbox.autoImproveBullet1"), t("admin.visualSandbox.autoImproveBullet2"), t("admin.visualSandbox.autoImproveBullet3")].map((line) => (
                  <span key={line} className="inline-flex items-center gap-1.5 text-[12px] text-[#374151]">
                    <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
                    {line}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-[14px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.55)] transition-all hover:opacity-[0.97] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/35 focus:ring-offset-2 sm:w-auto"
            style={{ background: "linear-gradient(165deg, #818cf8 0%, #6366f1 45%, #4f46e5 100%)" }}
          >
            {t("admin.visualSandbox.autoImproveBannerCta")}
          </button>
        </div>
      </section>
    </aside>
  );

  const assessmentBlock = (
    <div className="flex w-full min-w-0 flex-col gap-8">
      {assessmentHero}
      <div className="flex w-full min-w-0 flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        <div className="w-full min-w-0 lg:w-[65%]">{assessmentLeftColumn}</div>
        <div className="w-full min-w-0 lg:w-[35%]">{assessmentRightColumn}</div>
      </div>
    </div>
  );

  const resultBlock = (
    <div className="flex w-full min-w-0 max-w-5xl flex-col gap-8 overflow-x-hidden mx-auto items-stretch">
      <div className="space-y-2">
        <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-[#0f172a] sm:text-[24px]">
          {t("admin.visualSandbox.resultOptimizedTitle")}
        </h2>
        <p className="text-[14px] leading-relaxed text-[#64748b]">{t("admin.visualSandbox.resultOptimizedSubtitle")}</p>
      </div>

      <section className="w-full rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/95 via-white to-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-8">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748b]">
              {t("admin.visualSandbox.resultYourMatchScoreLabel")}
            </p>
            <p className="mt-2 text-[clamp(2.5rem,10vw,3.5rem)] font-bold tabular-nums leading-none tracking-tight text-emerald-700">
              {studioMatchPct}%
            </p>
            <p className={`mt-2 text-[16px] font-semibold ${resultTierResult.textClass}`}>{resultTierResult.label}</p>
            <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-snug text-[#64748b] lg:mx-0">{resultTierResult.hint}</p>
            {resultTopBucketPct != null && (
              <span className="mt-4 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-900">
                {tFormat(t("admin.visualSandbox.resultTopCandidatesBadge"), { pct: resultTopBucketPct })}
              </span>
            )}
          </div>

          <div className="relative mx-auto flex shrink-0 justify-center lg:mx-0">
            <span className="absolute -left-3 top-6 h-2 w-2 rounded-full bg-emerald-400/45" aria-hidden />
            <span className="absolute -right-2 bottom-10 h-1.5 w-1.5 rounded-full bg-teal-300/60" aria-hidden />
            <span className="absolute left-8 -top-1 h-1.5 w-1.5 rounded-full bg-emerald-300/50" aria-hidden />
            <span className="absolute -bottom-1 right-6 h-2 w-2 rounded-full bg-lime-400/35" aria-hidden />
            <div className="relative h-[120px] w-[120px] shrink-0">
              <ScoreRing percent={studioMatchPct} size={120} thickness={14} mode="score" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <CheckIcon className="h-10 w-10 text-emerald-600" strokeWidth={2.25} aria-hidden />
              </div>
            </div>
          </div>

          <div className="hidden min-w-0 border-l border-emerald-100 pl-6 lg:block">
            <p className="text-[12px] font-medium text-[#64748b]">{t("admin.visualSandbox.resultScoreBasedOn")}</p>
            <ul className="mt-4 space-y-3">
              {resultScoreFactorLines.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13px] leading-snug text-[#334155]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <CheckIcon className="h-3 w-3 text-emerald-700" strokeWidth={2.5} aria-hidden />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-emerald-100 pt-6 lg:hidden">
          <p className="text-[12px] font-medium text-[#64748b]">{t("admin.visualSandbox.resultScoreBasedOn")}</p>
          <ul className="mt-3 space-y-2.5">
            {resultScoreFactorLines.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[13px] text-[#334155]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <CheckIcon className="h-3 w-3 text-emerald-700" strokeWidth={2.5} aria-hidden />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="w-full">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight text-[#0f172a]">{t("admin.visualSandbox.resultKeyChangesTitle")}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[#64748b]">{t("admin.visualSandbox.resultKeyChangesSubtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[13px] font-semibold text-emerald-700">
            <CheckIcon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            {tFormat(t("admin.visualSandbox.resultImprovementsApplied"), { count: resultImprovementCount })}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MOCK.resultKeyChanges.map((group, idx) => {
            const Icon = RESULT_KEY_ICONS[idx % RESULT_KEY_ICONS.length];
            const subtitle = group.description ?? group.items[0] ?? "";
            return (
              <div
                key={group.category}
                className="flex gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    idx === 0
                      ? "bg-violet-50 text-violet-600"
                      : idx === 1
                        ? "bg-amber-50 text-amber-700"
                        : "bg-emerald-50 text-emerald-700"
                  }`}
                  aria-hidden
                >
                  <Icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[#0f172a]">{group.category}</p>
                  <p className="mt-1 text-[12px] leading-snug text-[#64748b]">{subtitle}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <CheckIcon className="h-4 w-4 text-emerald-600" strokeWidth={2.5} aria-hidden />
                  <span className="text-[11px] font-semibold text-emerald-700">{t("admin.visualSandbox.resultImprovedLabel")}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="w-full">
        <PostResultResumeStudio
          sandboxVariant
          qualityPct={studioMatchPct}
          jobTitle={`${MOCK.displaySpecialty} — TechCorp`}
          fallbackPreviewUrl={mockThumbUrl}
          schemaJson={SANDBOX_OPTIMIZED_SCHEMA_JSON}
          initialTemplateId={sandboxTemplateId || undefined}
          initialPhotoDataUrl={sandboxPhoto}
          onTemplateChange={setSandboxTemplateId}
          onPhotoChange={setSandboxPhoto}
          onDownload={(previewUrl) => {
            storeCheckoutResumePreview(previewUrl);
            navigate(
              "/checkout/download-resume?pending=admin_ui_preview&sandbox=1&return_to=%2Fadmin%2Fcheckout-preview",
            );
          }}
          onTailorAnother={() => {}}
          onImproveEvenStronger={() => {}}
          showImproveEvenStronger={studioMatchPct <= 82}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 pb-24 sm:pb-12 w-full min-w-0">
      {portalTarget &&
        createPortal(
          <div className="flex items-center justify-between w-full">
            <div className="flex flex-col min-w-0 pr-2">
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold text-[#181819] tracking-tight truncate">Visual Sandbox</h1>
                <span className="hidden sm:inline-block text-[11px] text-[#6B7280] truncate bg-[#F5F6FA] px-1.5 py-0.5 rounded font-medium">
                  Optimize UI + templates (same APIs as prod)
                </span>
              </div>
            </div>
            <div className="flex items-center bg-[#EBEDF5] rounded-lg p-0.5 shrink-0">
              {(["assessment", "result", "both"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 sm:px-3 py-1 rounded-md text-[11px] sm:text-xs font-medium transition-all ${
                    viewMode === mode ? "bg-white text-[#181819] shadow-sm" : "text-[#6B7280] hover:text-[#181819]"
                  }`}
                >
                  {mode === "assessment" ? "Assessment" : mode === "result" ? "Result" : "Both"}
                </button>
              ))}
            </div>
          </div>,
          portalTarget
        )}

      {(viewMode === "assessment" || viewMode === "both") && (
        <section>
          {viewMode === "both" && (
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Stage: Assessment (Diagnosis)</h2>
          )}
          {assessmentBlock}
        </section>
      )}

      {(viewMode === "result" || viewMode === "both") && (
        <section>
          {viewMode === "both" && (
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider mb-3 mt-8">Stage: Result (After treatment)</h2>
          )}
          {resultBlock}
        </section>
      )}
    </div>
  );
}
