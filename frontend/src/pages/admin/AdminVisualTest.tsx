import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { SparklesIcon, ChevronDownIcon, CheckIcon, EyeIcon } from "@heroicons/react/24/outline";
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

function impactFromIssue(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("ci/cd")) return "ATS treats you as less production-ready and lowers shortlist priority.";
  if (l.includes("figma")) return "Cross-team collaboration signal is weak for product roles.";
  if (l.includes("metrics")) return "Without numbers, recruiters cannot estimate your real impact.";
  if (l.includes("leadership")) return "You look like an individual contributor instead of a leader.";
  return "This gap reduces relevance and increases rejection risk at screening stage.";
}

function fixFromIssue(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("ci/cd")) return "Add one bullet showing CI/CD ownership and release impact.";
  if (l.includes("figma")) return "Mention collaboration with design and product discovery artifacts.";
  if (l.includes("metrics")) return "Rewrite 2-3 bullets with measurable outcomes (%, $, team size).";
  if (l.includes("leadership")) return "Add one leadership example with team scope and business result.";
  return "Add a focused bullet in summary/experience tied to this requirement.";
}

function priorityScore(label: string): number {
  const l = label.toLowerCase();
  let score = 1;
  if (l.includes("missing")) score += 3;
  if (l.includes("none")) score += 3;
  if (l.includes("weak")) score += 2;
  if (l.includes("metrics") || l.includes("leadership") || l.includes("ci/cd")) score += 2;
  return score;
}

function boostPctFromIssue(label: string): number {
  return Math.min(15, 4 + (priorityScore(label) % 10));
}

function matchTierShort(pct: number): { label: string; barClass: string; textClass: string } {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (p >= 85) {
    return {
      label: t("optimize.resumeQualityLevelExcellent"),
      barClass: "bg-gradient-to-r from-emerald-500 to-emerald-400",
      textClass: "text-emerald-700",
    };
  }
  if (p >= 65) {
    return {
      label: t("optimize.resumeQualityLevelStrong"),
      barClass: "bg-gradient-to-r from-amber-500 to-amber-400",
      textClass: "text-amber-700",
    };
  }
  if (p >= 45) {
    return {
      label: t("optimize.resumeQualityLevelGood"),
      barClass: "bg-gradient-to-r from-amber-500 to-orange-400",
      textClass: "text-orange-700",
    };
  }
  return {
    label: t("optimize.resumeQualityLevelFair"),
    barClass: "bg-gradient-to-r from-orange-500 to-rose-400",
    textClass: "text-orange-800",
  };
}

function categoryAvgBoost(problems: string[]): number {
  if (!problems.length) return 0;
  return Math.round(problems.reduce((s, l) => s + boostPctFromIssue(l), 0) / problems.length);
}

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

function getQualityLevelLabelSandbox(qualityPct: number): string {
  const q = Math.max(0, Math.min(100, Math.round(qualityPct)));
  if (q >= 80) return t("optimize.resumeQualityLevelExcellent");
  if (q >= 60) return t("optimize.resumeQualityLevelStrong");
  if (q >= 45) return t("optimize.resumeQualityLevelGood");
  if (q >= 25) return t("optimize.resumeQualityLevelFair");
  return t("optimize.resumeQualityLevelLow");
}

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

  const currentMatchPct = assessmentQualityPct;
  const potentialMatchPct = studioMatchPct;
  const currentTier = matchTierShort(currentMatchPct);
  const potentialTier = matchTierShort(potentialMatchPct);
  const assessmentLeftColumn = (
    <div className="flex flex-col gap-5 w-full min-w-0 overflow-x-hidden">
      <div className="space-y-1">
        <h2 className="text-[20px] sm:text-[22px] font-semibold leading-snug tracking-tight text-[#181819]">
          {t("admin.visualSandbox.assessmentTitleLead")}{" "}
          <span className="text-[#6366F1]">{t("admin.visualSandbox.assessmentTitleHighlight")}</span>
        </h2>
        <p className="text-[13px] leading-relaxed text-[#6B7280]">{t("admin.visualSandbox.assessmentSubtitle")}</p>
      </div>

      <section className="rounded-2xl border border-[#EBEDF5] bg-white p-4 shadow-[0_2px_16px_-12px_rgba(15,23,42,0.1)] sm:p-6">
        <p className="mb-5 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("optimize.overallMatchScore")}</p>
        <div className="flex flex-col items-stretch gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="flex flex-1 flex-wrap justify-center gap-12 sm:justify-center sm:gap-16 lg:gap-20">
            <div className="flex flex-col items-center text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("admin.visualSandbox.currentMatch")}</p>
              <div className="relative mt-4 h-[128px] w-[128px]">
                <ScoreRing percent={currentMatchPct} size={128} thickness={15} mode="score" />
                <span className="absolute inset-0 flex items-center justify-center text-[30px] font-bold tabular-nums text-[#181819]">{currentMatchPct}%</span>
              </div>
              <p className={`mt-4 text-[16px] font-semibold leading-none ${currentTier.textClass}`}>{currentTier.label}</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("admin.visualSandbox.potentialMatch")}</p>
              <div className="relative mt-4 h-[128px] w-[128px]">
                <ScoreRing percent={potentialMatchPct} size={128} thickness={15} mode="score" />
                <span className={`absolute inset-0 flex items-center justify-center text-[30px] font-bold tabular-nums ${potentialTier.textClass}`}>{potentialMatchPct}%</span>
              </div>
              <p className={`mt-4 text-[16px] font-semibold leading-none ${potentialTier.textClass}`}>{potentialTier.label}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border border-[#E8ECF4] bg-[#F8FAFC] px-10 py-10 text-center lg:min-w-[220px]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("admin.visualSandbox.atsFriendlyLabel")}</p>
            <p className="mt-3 flex items-baseline justify-center gap-0.5 tabular-nums">
              <span className="text-[44px] font-bold leading-none tracking-tight text-[#181819]">{MOCK.atsFriendlyScore}</span>
              <span className="text-[24px] font-semibold text-[#9CA3AF]">/100</span>
            </p>
          </div>
        </div>
      </section>

      <div className="w-full min-w-0 max-w-full overflow-x-clip">
        <div
          className="w-full min-w-0 max-w-full rounded-[22px] border border-transparent critical-border-shimmer p-[1px] overflow-hidden [contain:paint]"
          style={{
            background:
              "linear-gradient(#FAFAFC, #FAFAFC) padding-box, linear-gradient(120deg, #F36B7F 0%, #E94A63 45%, #C92A4B 100%) border-box, linear-gradient(120deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 60%) border-box",
            backgroundSize: "100% 100%, 100% 100%, 165% 165%",
            backgroundPosition: "0 0, 0 0, 125% 0",
            animation: "criticalBorderShimmer 3.2s linear infinite",
          }}
        >
          <div className="rounded-[21px] bg-white p-4 sm:p-6 min-w-0 overflow-x-hidden">
            <div className="flex items-start gap-2 mb-1.5 w-full min-w-0">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#C92A4B] text-[#C92A4B] text-[13px] font-bold">
                !
              </span>
              <p className="text-[15px] sm:text-base font-semibold text-[#181819] leading-snug min-w-0 flex-1 break-words">
                {t("optimize.whyNoCallbacksTitle")}
              </p>
            </div>
            <p className="mt-1.5 text-[13px] text-[#4B5563] leading-relaxed break-words">{scanSummaryText}</p>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-4">
              {treatmentGroups.map((group) => {
                const avgBoost = categoryAvgBoost(group.problems);
                return (
                  <div
                    key={group.category}
                    className="flex items-start justify-between gap-4 rounded-xl border border-[#EDF1F7] bg-[#FAFBFF] px-4 py-4 sm:min-h-[108px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold leading-snug text-[#181819]">{group.category}</p>
                      <p className="mt-1 text-[11px] leading-snug text-[#6B7280]">{t("optimize.issuesToFix")}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[34px] font-bold leading-none tabular-nums text-[#181819]">{group.problems.length}</p>
                      {group.problems.length > 0 ? (
                        <p className="mt-1 text-[17px] font-semibold tabular-nums text-emerald-600">+{avgBoost}%</p>
                      ) : (
                        <p className="mt-1 text-[13px] font-medium text-[#9CA3AF]">—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Disclosure>
              {({ open }) => (
                <div className="mt-6 border-t border-[#EDF1F7] pt-5">
                  <DisclosureButton className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3.5 text-[14px] font-semibold text-[#181819] transition-colors hover:bg-[#F3F4F6]">
                    <span>{t("admin.visualSandbox.expandIssueDetails")}</span>
                    <ChevronDownIcon className={`h-5 w-5 shrink-0 text-[#6B7280] transition-transform ${open ? "rotate-180" : ""}`} />
                  </DisclosureButton>
                  <DisclosurePanel className="mt-5 space-y-6">
                    {treatmentGroups.map((group) => (
                      <div key={`detail-${group.category}`}>
                        <p className="text-[13px] font-semibold text-[#181819]">{group.category}</p>
                        {group.problems.length > 0 ? (
                          <ul className="mt-3 space-y-3">
                            {group.problems.map((label) => (
                              <li key={`${group.category}-${label}`} className="rounded-xl bg-[#F8FAFD] px-3.5 py-3 ring-1 ring-[#EDF1F7]">
                                <p className="text-[12px] font-semibold text-[#181819]">{cleanReason(label)}</p>
                                <p className="mt-1.5 text-[12px] leading-relaxed text-[#4B5563]">
                                  <span className="font-semibold text-[#181819]">{t("optimize.ifIgnored")}</span> {impactFromIssue(label)}
                                </p>
                                <p className="mt-1.5 text-[12px] leading-relaxed text-[#4B5563]">
                                  <span className="font-semibold text-[#181819]">{t("optimize.whatToChange")}</span> {fixFromIssue(label)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-[12px] text-[#6B7280]">{t("optimize.noBlockingInCategory")}</p>
                        )}
                      </div>
                    ))}
                  </DisclosurePanel>
                </div>
              )}
            </Disclosure>
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
              <ul className="space-y-1.5">
                {[t("admin.visualSandbox.autoImproveBullet1"), t("admin.visualSandbox.autoImproveBullet2"), t("admin.visualSandbox.autoImproveBullet3")].map((line) => (
                  <li key={line} className="flex items-center gap-2 text-[12px] text-[#374151]">
                    <CheckIcon className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-[14px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.55)] transition-all hover:opacity-[0.97] active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/35 focus:ring-offset-2"
            style={{ background: "linear-gradient(165deg, #818cf8 0%, #6366f1 45%, #4f46e5 100%)" }}
          >
            {t("admin.visualSandbox.autoImproveBannerCta")}
          </button>
        </div>
      </section>
    </div>
  );

  const assessmentRightColumn = (
    <aside className="w-full min-w-0 lg:sticky lg:top-20 lg:self-start">
      <div className="mb-4">
        <h3 className="text-[15px] font-semibold text-[#181819]">{t("admin.visualSandbox.previewTitle")}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-[#6B7280]">{t("admin.visualSandbox.previewSubtitle")}</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E8ECF4] bg-white shadow-[0_8px_32px_-12px_rgba(15,23,42,0.12)]">
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
    </aside>
  );

  const assessmentBlock = (
    <div className="flex w-full min-w-0 flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      <div className="w-full min-w-0 lg:w-[65%]">{assessmentLeftColumn}</div>
      <div className="w-full min-w-0 lg:w-[35%]">{assessmentRightColumn}</div>
    </div>
  );

  const resultBlock = (
    <div className="flex flex-col gap-4 w-full min-w-0 max-w-3xl mx-auto items-stretch overflow-x-hidden">
      {/* Post–auto-improve match card (prod: green state + resume quality ring) */}
      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t("optimize.overallMatchScore")}</p>
        <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3.5 sm:p-4.5">
          <div className="flex flex-col gap-4 sm:gap-5">
            <div className="flex flex-col lg:flex-row items-center lg:items-center gap-5 lg:gap-6 min-w-0 max-w-full">
              <div className="flex items-center gap-3 shrink-0 max-w-full min-w-0 justify-center flex-wrap sm:flex-nowrap">
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] overflow-hidden group">
                  {mockThumbUrl ? (
                    <img src={mockThumbUrl} alt="" className="absolute inset-0 w-full h-full object-cover object-top opacity-90" />
                  ) : (
                    <div className="absolute inset-0 bg-[#F0FDF4] flex flex-col p-2 gap-1.5 opacity-70">
                      <div className="w-1/2 h-1.5 bg-[#BBF7D0] rounded-full mx-auto mb-1" />
                      <div className="w-full h-1 bg-[#BBF7D0] rounded-full" />
                      <div className="w-5/6 h-1 bg-[#BBF7D0] rounded-full" />
                      <div className="w-full h-1 bg-[#BBF7D0] rounded-full mt-1" />
                      <div className="w-4/5 h-1 bg-[#BBF7D0] rounded-full" />
                      <div className="w-full h-1 bg-[#BBF7D0] rounded-full" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px] pointer-events-none">
                    <span className="text-[9px] font-semibold text-[#166534] uppercase tracking-wider bg-white/95 px-1.5 py-0.5 rounded shadow-sm">{t("home.resume")}</span>
                  </div>
                </div>
                <span className="text-[#8A94A6] text-xl font-light">+</span>
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] p-2 text-center justify-center">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-[#181819] leading-tight line-clamp-4">Senior Product Manager</p>
                  <p className="text-[8px] sm:text-[9px] text-[#6B7280] mt-1.5 line-clamp-2">TechCorp</p>
                </div>
              </div>
              <div className="hidden lg:block w-px h-[100px] bg-[#BBF7D0] shrink-0" />
              <div className="lg:hidden w-full h-px bg-[#BBF7D0]" />
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-4 flex-1 w-full min-w-0 justify-center sm:justify-start">
                <div className="sm:hidden shrink-0 relative w-[104px] h-[104px]">
                  <ScoreRing percent={studioMatchPct} size={104} thickness={12} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#166534] tabular-nums">{studioMatchPct}%</span>
                </div>
                <div className="hidden sm:block lg:hidden shrink-0 relative w-[110px] h-[110px]">
                  <ScoreRing percent={studioMatchPct} size={110} thickness={13} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#166534] tabular-nums">{studioMatchPct}%</span>
                </div>
                <div className="hidden lg:block shrink-0 relative w-[118px] h-[118px]">
                  <ScoreRing percent={studioMatchPct} size={118} thickness={14} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-[#166534] tabular-nums">{studioMatchPct}%</span>
                </div>
                <div className="text-center sm:text-left flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#166534] uppercase tracking-wider">
                    {t("optimize.resumeQuality")} ({getQualityLevelLabelSandbox(studioMatchPct)})
                  </p>
                  <p className="mt-1.5 sm:mt-1 text-[11px] sm:text-[12px] text-[#6B7280] leading-relaxed max-w-[280px] mx-auto sm:mx-0">
                    {t("optimize.resumeQualityHintHigh")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">{t("optimize.keyChanges")}</h3>
        <div className="space-y-3">
          {MOCK.resultKeyChanges.map((group, idx) => (
            <div key={idx} className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[#181819]">{group.category}</p>
              {group.description && <p className="text-[13px] text-[#4B5563] leading-relaxed">{group.description}</p>}
              {group.items.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((item, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[11px] font-medium text-[#181819] bg-[#ECFDF5] border border-[#A7F3D0]"
                    >
                      <CheckIcon className="w-3.5 h-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Same block as prod Optimize: templates strip, photo, PDF preview, CTAs */}
      <div className="mt-4 w-full max-w-3xl mx-auto">
        <PostResultResumeStudio
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
      <style>{`
        @keyframes criticalBorderShimmer {
          0% {
            background-position: 0 0, 0 0, 125% 0;
          }
          100% {
            background-position: 0 0, 0 0, -125% 0;
          }
        }
      `}</style>
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
