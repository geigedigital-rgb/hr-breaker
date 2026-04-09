import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import {
  SparklesIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { t, tFormat } from "../../i18n";
import * as api from "../../api";

const MOCK = {
  atsPct: 72,
  kwPct: 68,
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
  const resultQualityPct = Math.min(100, overallPct + 14);

  const problemLabels = useMemo(
    () =>
      MOCK.recommendations
        .flatMap((group) => group.labels)
        .filter((label) => isProblemLabel(label))
        .sort((a, b) => priorityScore(b) - priorityScore(a)),
    [],
  );

  const topIssues = problemLabels.slice(0, 2);
  const scanSummaryText =
    "The current resume looks acceptable at first glance, but key proof points are missing. This is why responses stay low.";

  const treatmentGroups = MOCK.recommendations.map((group) => {
    const problems = group.labels.filter((label) => isProblemLabel(label));
    return { category: group.category, problems };
  });

  const assessmentBlock = (
    <div className="flex flex-col gap-4 w-full min-w-0 max-w-3xl mx-auto overflow-x-hidden">
      {/* Scan Results + Overall Match Score Combined (aligned with Optimize.tsx assessment) */}
      <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t("optimize.overallMatchScore")}</p>
        <div className="rounded-xl bg-white border border-[#ECEFF5] p-3.5 sm:p-4.5">
          <div className="flex flex-col gap-4 sm:gap-5">
            <div className="flex flex-col lg:flex-row items-center lg:items-center gap-5 lg:gap-6 min-w-0 max-w-full">
              <div className="flex items-center gap-3 shrink-0 max-w-full min-w-0 justify-center flex-wrap sm:flex-nowrap">
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] overflow-hidden group">
                  {mockThumbUrl ? (
                    <img src={mockThumbUrl} alt="Resume preview" className="absolute inset-0 w-full h-full object-cover object-top opacity-90" />
                  ) : (
                    <div className="absolute inset-0 bg-[#F8FAFD] flex flex-col p-2 gap-1.5 opacity-70">
                      <div className="w-1/2 h-1.5 bg-[#DCE3F0] rounded-full mx-auto mb-1" />
                      <div className="w-full h-1 bg-[#DCE3F0] rounded-full" />
                      <div className="w-5/6 h-1 bg-[#DCE3F0] rounded-full" />
                      <div className="w-full h-1 bg-[#DCE3F0] rounded-full mt-1" />
                      <div className="w-4/5 h-1 bg-[#DCE3F0] rounded-full" />
                      <div className="w-full h-1 bg-[#DCE3F0] rounded-full" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px] pointer-events-none">
                    <span className="text-[9px] font-semibold text-[#181819] uppercase tracking-wider bg-white/95 px-1.5 py-0.5 rounded shadow-sm">{t("home.resume")}</span>
                  </div>
                </div>
                <span className="text-[#8A94A6] text-xl font-light">+</span>
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] p-2 text-center justify-center">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-[#181819] leading-tight line-clamp-4">Senior Product Manager</p>
                  <p className="text-[8px] sm:text-[9px] text-[#6B7280] mt-1.5 line-clamp-2">TechCorp</p>
                </div>
              </div>
              <div className="hidden lg:block w-px h-[100px] bg-[#E8ECF4] shrink-0" />
              <div className="lg:hidden w-full h-px bg-[#E8ECF4]" />
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-4 flex-1 w-full min-w-0 justify-center sm:justify-start">
                <div className="sm:hidden shrink-0 relative w-[104px] h-[104px]">
                  <ScoreRing percent={assessmentQualityPct} size={104} thickness={12} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#181819] tabular-nums">{assessmentQualityPct}%</span>
                </div>
                <div className="hidden sm:block lg:hidden shrink-0 relative w-[110px] h-[110px]">
                  <ScoreRing percent={assessmentQualityPct} size={110} thickness={13} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#181819] tabular-nums">{assessmentQualityPct}%</span>
                </div>
                <div className="hidden lg:block shrink-0 relative w-[118px] h-[118px]">
                  <ScoreRing percent={assessmentQualityPct} size={118} thickness={14} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-[#181819] tabular-nums">{assessmentQualityPct}%</span>
                </div>
                <div className="text-center sm:text-left flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                    {t("optimize.resumeQuality")} ({getQualityLevelLabelSandbox(assessmentQualityPct)})
                  </p>
                  <p className="mt-1.5 sm:mt-1 text-[11px] sm:text-[12px] text-[#6B7280] leading-relaxed max-w-[280px] mx-auto sm:mx-0">
                    {t("optimize.resumeQualityHintLow")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 w-full min-w-0 max-w-full overflow-x-clip">
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
            <div className="rounded-[21px] bg-white p-4 sm:p-5 min-w-0 overflow-x-hidden">
              <div className="flex items-start gap-2 mb-1.5 w-full min-w-0">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#C92A4B] text-[#C92A4B] text-[13px] font-bold">
                  !
                </span>
                <p className="text-[15px] sm:text-base font-semibold text-[#181819] leading-snug min-w-0 flex-1 break-words">
                  {t("optimize.whyNoCallbacksTitle")}
                </p>
              </div>
              <p className="mt-1.5 text-[13px] text-[#4B5563] leading-relaxed break-words">{scanSummaryText}</p>

              <div className="mt-4 space-y-2.5">
                {topIssues.map((issue) => (
                  <Disclosure key={issue}>
                    {({ open }) => (
                      <div className="rounded-xl bg-white ring-1 ring-[#EDF1F7]">
                        <DisclosureButton className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[#F8FAFD] transition-colors rounded-xl">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-[#181819] leading-snug">{cleanReason(issue)}</p>
                            <div className="mt-0.5 inline-flex items-center gap-1.5">
                              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FDECEF] px-1.5 text-[11px] font-bold text-[#C92A4B]">
                                !
                              </span>
                              <p className="text-[11px] text-[#C92A4B] font-medium">{t("optimize.criticalReason")}</p>
                            </div>
                          </div>
                          <ChevronDownIcon className={`w-4 h-4 text-[#6B7280] transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
                        </DisclosureButton>
                        <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                          <div className="pt-2 border-t border-[#EDF1F7] mt-1">
                            <p className="text-[12px] text-[#374151] leading-relaxed">
                              <span className="font-semibold text-[#181819]">{t("optimize.ifIgnored")}</span> {impactFromIssue(issue)}
                            </p>
                            <p className="text-[12px] text-[#374151] leading-relaxed mt-1.5">
                              <span className="font-semibold text-[#181819]">{t("optimize.whatToChange")}</span> {fixFromIssue(issue)}
                            </p>
                          </div>
                        </DisclosurePanel>
                      </div>
                    )}
                  </Disclosure>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Improvement Recommendations - Separate Block */}
      <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.recommendationsTitle")}</p>
        <div className="mt-3 space-y-2.5">
          {treatmentGroups.map((group) => (
            <Disclosure key={group.category}>
              {({ open }) => (
                <div className="rounded-xl bg-white ring-1 ring-[#EDF1F7]">
                  <DisclosureButton className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#181819] leading-snug">{group.category}</p>
                      <div className="mt-0.5 inline-flex items-center gap-1.5">
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FFF4E5] px-1.5 text-[11px] font-semibold text-[#B45309]">
                          {group.problems.length}
                        </span>
                        <p className="text-[11px] text-[#6B7280]">issues to fix</p>
                      </div>
                    </div>
                    <ChevronDownIcon className={`w-4 h-4 text-[#6B7280] transition-transform ${open ? "rotate-180" : ""}`} />
                  </DisclosureButton>
                  <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                    {group.problems.length > 0 ? (
                      <ul className="space-y-1.5 pl-0">
                        {group.problems.map((label) => (
                          <li key={`${group.category}-${label}`} className="px-0.5 py-1">
                            <p className="text-[12px] font-medium text-[#181819] leading-snug">{cleanReason(label)}</p>
                            <p className="mt-0.5 text-[11px] text-[#6B7280] leading-relaxed">{fixFromIssue(label)}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12px] text-[#6B7280]">No blocking issues in this category.</p>
                    )}
                  </DisclosurePanel>
                </div>
              )}
            </Disclosure>
          ))}
        </div>
      </section>
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
                  <ScoreRing percent={resultQualityPct} size={104} thickness={12} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#166534] tabular-nums">{resultQualityPct}%</span>
                </div>
                <div className="hidden sm:block lg:hidden shrink-0 relative w-[110px] h-[110px]">
                  <ScoreRing percent={resultQualityPct} size={110} thickness={13} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#166534] tabular-nums">{resultQualityPct}%</span>
                </div>
                <div className="hidden lg:block shrink-0 relative w-[118px] h-[118px]">
                  <ScoreRing percent={resultQualityPct} size={118} thickness={14} mode="score" />
                  <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-[#166534] tabular-nums">{resultQualityPct}%</span>
                </div>
                <div className="text-center sm:text-left flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#166534] uppercase tracking-wider">
                    {t("optimize.resumeQuality")} ({getQualityLevelLabelSandbox(resultQualityPct)})
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

      {/* Prod-aligned post-result export band */}
      <section className="mt-4 mb-6 w-full max-w-3xl mx-auto rounded-2xl border border-[#E8ECF4] bg-[#FAFAFC] p-5 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4578FC]">{t("optimize.resultExportKicker")}</p>
            <p className="text-xl sm:text-2xl font-semibold text-[#181819] tracking-tight leading-snug">
              {tFormat(t("optimize.resultReadyForRole"), { jobTitle: MOCK.displaySpecialty })}
            </p>
            <p className="text-[13px] sm:text-[14px] text-[#6B7280] truncate">{tFormat(t("optimize.resultReadySourceFile"), { file: "Anna_Muller_resume.pdf" })}</p>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-lg lg:shrink-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <button
                type="button"
                onClick={() =>
                  navigate("/checkout/download-resume?pending=admin_ui_preview&return_to=%2Fadmin%2Fcheckout-preview")
                }
                className="inline-flex min-h-[3rem] w-full flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold text-white shadow-[0_4px_20px_-8px_rgba(69,120,252,0.45)] whitespace-nowrap"
                style={{ background: "linear-gradient(160deg, #5e8afc 0%, #4578FC 45%, #3d6ae6 100%)" }}
              >
                <ArrowDownTrayIcon className="w-5 h-5 shrink-0" aria-hidden />
                {t("optimize.downloadPdf")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-[3rem] w-full flex-1 items-center justify-center rounded-xl border-2 border-[#4578FC] bg-white px-5 text-[15px] font-semibold text-[#4578FC] whitespace-nowrap"
              >
                {t("optimize.tailorAnotherVacancy")}
              </button>
            </div>
            <button
              type="button"
              className="inline-flex min-h-[3rem] w-full items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-5 text-[15px] font-medium text-[#374151] whitespace-nowrap"
            >
              {t("optimize.optimizeAgainForAts")}
            </button>
            <p className="text-[11px] text-[#9CA3AF] leading-snug text-center sm:text-left">{t("optimize.downloadPdfPaidHint")}</p>
          </div>
        </div>
      </section>
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
                  Simulation of Optimize
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
          {/* Same placement as Optimize.tsx after diagnosis (stage === "assessment") */}
          <div className="mt-8 sm:mt-10 mb-6 flex flex-col items-center text-center px-2">
            <div className="inline-flex items-center justify-center gap-2 sm:gap-3 mb-4 w-full max-w-[320px] sm:max-w-none">
              <svg className="w-5 h-5 sm:w-7 sm:h-7 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M12 1L14.8 8.2L22 11L14.8 13.8L12 21L9.2 13.8L2 11L9.2 8.2L12 1Z" fill="url(#sparkle-grad-visual-sandbox)" />
                <defs>
                  <linearGradient id="sparkle-grad-visual-sandbox" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4578FC" />
                    <stop offset="0.5" stopColor="#5e8afc" />
                    <stop offset="1" stopColor="#2E9FFF" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="text-[17px] sm:text-[22px] font-medium text-[#181819] leading-tight text-left sm:text-center">
                {t("optimize.nextStepImproveTitle")}
              </span>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(69,120,252,0.55)] hover:shadow-[0_6px_20px_-4px_rgba(69,120,252,0.45)] hover:opacity-[0.97] active:scale-[0.99] transition-all focus:outline-none focus:ring-2 focus:ring-[#4578FC]/35 focus:ring-offset-2"
              style={{
                background: "linear-gradient(165deg, #5e8afc 0%, #4578FC 42%, #3d6ae6 100%)",
              }}
            >
              <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
              {t("optimize.applyAutoImprove")}
            </button>
            <p className="mt-3 text-[11px] text-[#6B7280] max-w-md leading-relaxed">{t("optimize.strictNote")}</p>
          </div>
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
