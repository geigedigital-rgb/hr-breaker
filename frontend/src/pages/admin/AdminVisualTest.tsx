import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import {
  SparklesIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  PlusIcon,
  PuzzlePieceIcon,
  ChatBubbleLeftEllipsisIcon,
  MicrophoneIcon,
  ArrowUpIcon,
  DocumentTextIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { t } from "../../i18n";
import * as api from "../../api";

const MOCK = {
  atsPct: 72,
  kwPct: 68,
  skillsPct: 75,
  experiencePct: 62,
  portfolioPct: 48,
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
      description: "Rewritten to emphasize product strategy and leadership over operational detail.",
      items: ["Added Cross-functional Leadership", "Added CI/CD context", "Quantified portfolio impact"],
    },
    {
      category: "Experience",
      description: "Bullet points restructured with STAR method. Added metrics.",
      items: ["Revenue +35% YoY", "Team of 12 engineers", "3 product launches"],
    },
    {
      category: "Skills Section",
      description: null,
      items: ["Figma", "CI/CD", "OKR Framework", "A/B Testing"],
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

function getRiskLevelLabel(riskPct: number): string {
  const r = Math.max(0, Math.min(100, Math.round(riskPct)));
  if (r >= 80) return "Critical";
  if (r >= 60) return "High";
  if (r >= 40) return "Elevated";
  if (r >= 20) return "Moderate";
  return "Low";
}

function MiniMetricRow({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-medium text-[#4B5563]">{label}</p>
        <p className="text-[13px] font-semibold text-[#181819] tabular-nums">{Math.round(percent)}%</p>
      </div>
      <div className="h-1.5 rounded-full bg-[#E9EDF4] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, percent))}%`,
            background: "linear-gradient(90deg, #dc2626 0%, #f59e0b 22%, #16a34a 58%, #16a34a 100%)",
          }}
        />
      </div>
    </div>
  );
}

export default function AdminVisualTest() {
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
  const assessmentRiskPct = 100 - overallPct;
  const resultRiskPct = 17;

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
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto">
      {/* Scan Results + Overall Match Score Combined */}
      <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t("optimize.overallMatchScore")}</p>
        <div className="rounded-xl bg-white border border-[#ECEFF5] p-3.5 sm:p-4.5">
          <div className="flex flex-col gap-4 sm:gap-5">
            <div className="flex flex-col lg:flex-row items-center lg:items-center gap-5 lg:gap-6">
              
              {/* Materials: Resume + Job */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Resume Preview Mock */}
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
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px]">
                    <span className="text-[9px] font-semibold text-[#181819] uppercase tracking-wider bg-white/95 px-1.5 py-0.5 rounded shadow-sm">Resume</span>
                  </div>
                </div>

                <span className="text-[#8A94A6] text-xl font-light">+</span>

                {/* Job Info Mock */}
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] p-2 text-center justify-center">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-[#181819] leading-tight line-clamp-4">Senior Product Manager</p>
                  <p className="text-[8px] sm:text-[9px] text-[#6B7280] mt-1.5 line-clamp-2">TechCorp</p>
                </div>
              </div>

              {/* Divider */}
              <div className="hidden lg:block w-px h-[100px] bg-[#E8ECF4]" />
              <div className="lg:hidden w-full h-px bg-[#E8ECF4]" />

              {/* Rejection Risk */}
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-4 flex-1 w-full justify-center sm:justify-start">
                {/* Mobile Ring */}
                <div className="sm:hidden shrink-0 relative w-[104px] h-[104px]">
                  <ScoreRing percent={assessmentRiskPct} size={104} thickness={12} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#181819] tabular-nums">
                    {assessmentRiskPct}%
                  </span>
                </div>
                {/* Tablet Ring */}
                <div className="hidden sm:block lg:hidden shrink-0 relative w-[110px] h-[110px]">
                  <ScoreRing percent={assessmentRiskPct} size={110} thickness={13} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#181819] tabular-nums">
                    {assessmentRiskPct}%
                  </span>
                </div>
                {/* Desktop Ring */}
                <div className="hidden lg:block shrink-0 relative w-[118px] h-[118px]">
                  <ScoreRing percent={assessmentRiskPct} size={118} thickness={14} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-[#181819] tabular-nums">
                    {assessmentRiskPct}%
                  </span>
                </div>
                
                <div className="text-center sm:text-left flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
                    Rejection risk ({getRiskLevelLabel(assessmentRiskPct)})
                  </p>
                  <p className="mt-1.5 sm:mt-1 text-[11px] sm:text-[12px] text-[#6B7280] leading-relaxed max-w-[280px] mx-auto sm:mx-0">
                    Without applying recommendations, rejection risk remains high. This resume still misses key job signals.
                  </p>
                </div>
              </div>
            </div>
            <div className="border-t border-[#F3F4F6] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <MiniMetricRow label="Skills" percent={MOCK.skillsPct} />
              <MiniMetricRow label="Experience" percent={MOCK.experiencePct} />
              <MiniMetricRow label="Portfolio" percent={MOCK.portfolioPct} />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div
            className="rounded-[22px] border border-transparent critical-border-shimmer p-[1px]"
            style={{
              background:
                "linear-gradient(#FAFAFC, #FAFAFC) padding-box, linear-gradient(120deg, #F36B7F 0%, #E94A63 45%, #C92A4B 100%) border-box, linear-gradient(120deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 60%) border-box",
              backgroundSize: "100% 100%, 100% 100%, 240% 240%",
              backgroundPosition: "0 0, 0 0, 200% 0",
              animation: "criticalBorderShimmer 3.2s linear infinite",
            }}
          >
            <div className="rounded-[21px] bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#C92A4B] text-[#C92A4B] text-[13px] font-bold">
                  !
                </span>
                <p className="text-[15px] sm:text-base font-semibold text-[#181819] leading-tight">
                  Why you are not getting callbacks
                </p>
              </div>
              <p className="mt-1.5 text-[13px] text-[#4B5563] leading-relaxed">{scanSummaryText}</p>

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
                              <p className="text-[11px] text-[#C92A4B] font-medium">Critical reason</p>
                            </div>
                          </div>
                          <ChevronDownIcon className={`w-4 h-4 text-[#6B7280] transition-transform ${open ? "rotate-180" : ""}`} />
                        </DisclosureButton>
                        <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                          <div className="pt-2 border-t border-[#EDF1F7] mt-1">
                            <p className="text-[12px] text-[#374151] leading-relaxed">
                              <span className="font-semibold text-[#181819]">If ignored:</span> {impactFromIssue(issue)}
                            </p>
                            <p className="text-[12px] text-[#374151] leading-relaxed mt-1.5">
                              <span className="font-semibold text-[#181819]">What to change:</span> {fixFromIssue(issue)}
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
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto items-start">
      {/* Result Overall Match Score */}
      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
        <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t("optimize.overallMatchScore")}</p>
        <div className="rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] p-3.5 sm:p-4.5">
          <div className="flex flex-col gap-4 sm:gap-5">
            <div className="flex flex-col lg:flex-row items-center lg:items-center gap-5 lg:gap-6">
              
              {/* Materials: Resume + Job */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Resume Preview Mock */}
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] overflow-hidden group">
                  {mockThumbUrl ? (
                    <img src={mockThumbUrl} alt="Resume preview" className="absolute inset-0 w-full h-full object-cover object-top opacity-90" />
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
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px]">
                    <span className="text-[9px] font-semibold text-[#166534] uppercase tracking-wider bg-white/95 px-1.5 py-0.5 rounded shadow-sm">Resume</span>
                  </div>
                </div>

                <span className="text-[#8A94A6] text-xl font-light">+</span>

                {/* Job Info Mock */}
                <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] p-2 text-center justify-center">
                  <p className="text-[10px] sm:text-[11px] font-semibold text-[#181819] leading-tight line-clamp-4">Senior Product Manager</p>
                  <p className="text-[8px] sm:text-[9px] text-[#6B7280] mt-1.5 line-clamp-2">TechCorp</p>
                </div>
              </div>

              {/* Divider */}
              <div className="hidden lg:block w-px h-[100px] bg-[#BBF7D0]" />
              <div className="lg:hidden w-full h-px bg-[#BBF7D0]" />

              {/* Rejection Risk */}
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-4 flex-1 w-full justify-center sm:justify-start">
                {/* Mobile Ring */}
                <div className="sm:hidden shrink-0 relative w-[104px] h-[104px]">
                  <ScoreRing percent={resultRiskPct} size={104} thickness={12} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                </div>
                {/* Tablet Ring */}
                <div className="hidden sm:block lg:hidden shrink-0 relative w-[110px] h-[110px]">
                  <ScoreRing percent={resultRiskPct} size={110} thickness={13} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                </div>
                {/* Desktop Ring */}
                <div className="hidden lg:block shrink-0 relative w-[118px] h-[118px]">
                  <ScoreRing percent={resultRiskPct} size={118} thickness={14} mode="risk" />
                  <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                </div>

                <div className="text-center sm:text-left flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[#166534] uppercase tracking-wider">
                    Rejection risk ({getRiskLevelLabel(resultRiskPct)})
                  </p>
                  <p className="mt-1.5 sm:mt-1 text-[11px] sm:text-[12px] text-[#4B5563] leading-relaxed max-w-[280px] mx-auto sm:mx-0">
                    This resume now better matches the vacancy. Rejection risk is reduced after applying recommendations.
                  </p>
                </div>
              </div>
            </div>
            <div className="border-t border-[#BBF7D0] pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <MiniMetricRow label="Skills" percent={88} />
              <MiniMetricRow label="Experience" percent={79} />
              <MiniMetricRow label="Portfolio" percent={65} />
            </div>
          </div>
        </div>
      </section>

      {/* Key Changes and Downloads */}
      <section className="w-full rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5 space-y-4">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("optimize.result")}</h2>
          <p className="text-base font-medium text-[#181819]" role="status">
            {t("optimize.done")}
          </p>
        </header>
        
        <section className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#181819] text-sm font-medium hover:opacity-95 transition-opacity"
            style={{ background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)" }}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {t("optimize.downloadPdf")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F5F6FA] text-[#181819] text-sm font-medium hover:bg-[#EBEDF5] transition-colors border border-[#E8ECF4]"
          >
            {t("optimize.improveMoreLabel")}
          </button>
        </section>

        <section className="pt-3 border-t border-[#EBEDF5]">
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">{t("optimize.keyChanges")}</h3>
          <div className="space-y-3">
            {MOCK.resultKeyChanges.map((group, idx) => (
              <div key={idx} className="space-y-1.5">
                <p className="text-[13px] font-semibold text-[#181819]">{group.category}</p>
                {group.description && <p className="text-[13px] text-[#4B5563] leading-relaxed">{group.description}</p>}
                {group.items.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((item, i) => (
                      <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium text-[#181819] bg-[#F5F6FA] border border-[#E8ECF4]">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="pt-3 border-t border-[#EBEDF5]">
          <Disclosure>
            <DisclosureButton className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider hover:text-[#181819]">
              {t("optimize.filterDetails")}
            </DisclosureButton>
            <DisclosurePanel className="mt-2 space-y-1.5">
              <p className="text-[11px] text-[#6B7280] leading-relaxed mb-2">{t("optimize.filterDetailsDesc")}</p>
              <ul className="space-y-2" role="list">
                {MOCK.resultFilters.map((r) => (
                  <li key={r.filter_name} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className={r.passed ? "text-[#166534] font-medium" : "text-[#B91C1C] font-medium"}>
                      {r.passed ? "✓" : "✗"} {r.filter_name}
                    </span>
                    <span className="text-[#6B7280] tabular-nums">
                      {r.score.toFixed(2)} / {r.threshold.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </DisclosurePanel>
          </Disclosure>
        </section>
      </section>
    </div>
  );

  return (
    <div className="space-y-6 pb-44 sm:pb-48">
      <style>{`
        @keyframes criticalBorderShimmer {
          0% {
            background-position: 0 0, 0 0, 200% 0;
          }
          100% {
            background-position: 0 0, 0 0, -200% 0;
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

      {/* Call to action text (Document Flow) */}
      <div className="mt-16 sm:mt-24 mb-6 flex flex-col items-center text-center px-4 w-full max-w-3xl mx-auto">
        <div className="inline-flex items-center justify-center gap-2 sm:gap-3 mb-1 w-full max-w-[320px] sm:max-w-none">
          <svg className="w-5 h-5 sm:w-7 sm:h-7 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 1L14.8 8.2L22 11L14.8 13.8L12 21L9.2 13.8L2 11L9.2 8.2L12 1Z" fill="url(#sparkle-grad)" />
            <defs>
              <linearGradient id="sparkle-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4578FC" />
                <stop offset="0.5" stopColor="#A05CFF" />
                <stop offset="1" stopColor="#34D399" />
              </linearGradient>
            </defs>
          </svg>
          <span className="text-[17px] sm:text-[24px] font-normal text-[#181819] leading-tight">Next step: improve your resume.</span>
        </div>
        <h2 className="text-[26px] sm:text-[44px] font-normal text-[#181819] tracking-tight leading-tight mb-8">
          What would you like to change?
        </h2>
        
        {/* Quick action chips (static position above chat) */}
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl mx-auto">
          {[
            { label: "Light polish", icon: SparklesIcon, accent: true },
            { label: "Deep rewrite", icon: DocumentTextIcon },
            { label: "Add more metrics", icon: CodeBracketIcon },
            { label: "Focus on leadership", icon: ArrowUpIcon },
          ].map((chip) => {
            if (chip.accent) {
              return (
                <div key={chip.label} className="relative shrink-0 flex rounded-full p-[1px] overflow-hidden group shadow-[0_2px_8px_-4px_rgba(20,25,40,0.08)] bg-[#4578FC]/20 cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-transform">
                  <div className="absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,rgba(69,120,252,0)_0%,#4578FC_50%,rgba(69,120,252,0)_100%)] opacity-80 group-hover:opacity-100 transition-opacity" />
                  <button
                    type="button"
                    className="relative flex items-center gap-2 rounded-full bg-[#F0F5FF] px-3.5 py-2 text-[14px] font-medium text-[#4578FC] hover:bg-[#E6EFFF] transition-colors"
                  >
                    <chip.icon className="h-4 w-4 text-[#4578FC]" />
                    {chip.label}
                  </button>
                </div>
              );
            }
            return (
              <button
                key={chip.label}
                type="button"
                className="shrink-0 flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14px] font-medium shadow-[0_2px_8px_-4px_rgba(20,25,40,0.08)] transition-all bg-white text-[#4B5563] border-[#E8ECF4] hover:bg-[#F5F6FA] hover:text-[#181819] hover:border-[#DCE3F0] hover:scale-[1.02] active:scale-[0.98]"
              >
                <chip.icon className="h-4 w-4 text-[#8A94A6]" />
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating AI Chat Panel */}
      <div className="fixed bottom-6 left-0 right-0 md:left-64 z-30 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-3xl flex flex-col gap-3">
          
          {/* Input Area */}
          <div className="relative flex w-full flex-col rounded-[28px] border border-[#E8ECF4] bg-white shadow-[0_8px_30px_-12px_rgba(20,25,40,0.12)] transition-shadow focus-within:shadow-[0_8px_40px_-12px_rgba(20,25,40,0.2)] focus-within:border-[#DCE3F0]">
            <textarea
              rows={1}
              placeholder="Assign a task or ask anything"
              className="w-full resize-none bg-transparent px-5 pt-4 pb-14 text-[15px] text-[#181819] placeholder:text-[#8A94A6] focus:outline-none"
              style={{ minHeight: "110px" }}
            />
            
            {/* Left Icons */}
            <div className="absolute bottom-3 left-4 flex items-center gap-2">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E8ECF4] text-[#6B7280] hover:bg-[#F5F6FA] hover:text-[#181819] transition-colors" aria-label="Add attachment">
                <PlusIcon className="h-4 w-4" />
              </button>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E8ECF4] text-[#6B7280] hover:bg-[#F5F6FA] hover:text-[#181819] transition-colors" aria-label="Use plugin">
                <PuzzlePieceIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Right Icons */}
            <div className="absolute bottom-3 right-4 flex items-center gap-1.5">
              <button type="button" className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F5F6FA] hover:text-[#181819] transition-colors" aria-label="Chat options">
                <ChatBubbleLeftEllipsisIcon className="h-[18px] w-[18px]" />
              </button>
              <button type="button" className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F5F6FA] hover:text-[#181819] transition-colors" aria-label="Voice input">
                <MicrophoneIcon className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F6FA] text-[#181819] hover:bg-[#E8ECF4] transition-colors ml-1"
                aria-label="Send message"
              >
                <ArrowUpIcon className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
