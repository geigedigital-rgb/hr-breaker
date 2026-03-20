import { useMemo, useState } from "react";
import { Disclosure, DisclosureButton, DisclosurePanel, RadioGroup } from "@headlessui/react";
import {
  SparklesIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { t } from "../../i18n";

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
  const [aggressiveTailoring, setAggressiveTailoring] = useState(false);

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
  const badLabelsCount = problemLabels.length;
  const scanSummaryText =
    "The current resume looks acceptable at first glance, but key proof points are missing. This is why responses stay low.";

  const treatmentGroups = MOCK.recommendations.map((group) => {
    const problems = group.labels.filter((label) => isProblemLabel(label));
    return { category: group.category, problems };
  });

  const assessmentBlock = (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-4 w-full items-start">
      <div className="space-y-4 min-w-0">
        <section className="rounded-[22px] bg-white ring-1 ring-[#E8ECF4] p-4 sm:p-6">
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.scanResults")}</p>
          <p className="mt-2 text-[15px] sm:text-base font-semibold text-[#181819] leading-tight">
            Why you are not getting callbacks
          </p>
          <p className="mt-1.5 text-[13px] text-[#4B5563] leading-relaxed">{scanSummaryText}</p>

          <div className="mt-4 space-y-2.5">
            {topIssues.map((issue) => (
              <Disclosure key={issue}>
                {({ open }) => (
                  <div
                    className="rounded-2xl border border-transparent critical-border-shimmer"
                    style={{
                      background:
                        "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(120deg, #F36B7F 0%, #E94A63 45%, #C92A4B 100%) border-box, linear-gradient(120deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 60%) border-box",
                      backgroundSize: "100% 100%, 100% 100%, 240% 240%",
                      backgroundPosition: "0 0, 0 0, 200% 0",
                      animation: "criticalBorderShimmer 3.2s linear infinite",
                    }}
                  >
                    <div className="rounded-2xl">
                      <DisclosureButton className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FDECEF] text-[#C92A4B] text-[12px] font-semibold">
                          !
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-[#181819] leading-snug">{cleanReason(issue)}</p>
                          <p className="text-[11px] text-[#C92A4B] mt-0.5">Critical reason</p>
                        </div>
                        <ChevronDownIcon className={`w-4 h-4 text-[#6B7280] transition-transform ${open ? "rotate-180" : ""}`} />
                      </DisclosureButton>
                      <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                        <p className="text-[12px] text-[#374151] leading-relaxed">
                          <span className="font-semibold text-[#181819]">If ignored:</span> {impactFromIssue(issue)}
                        </p>
                        <p className="text-[12px] text-[#374151] leading-relaxed">
                          <span className="font-semibold text-[#181819]">What to change:</span> {fixFromIssue(issue)}
                        </p>
                      </DisclosurePanel>
                    </div>
                  </div>
                )}
              </Disclosure>
            ))}
          </div>

          <div className="my-4 h-px bg-[#E8ECF4]" />
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

      <div className="space-y-4 min-w-0">
        <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6">
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.overallMatchScore")}</p>
          <div className="mt-3 rounded-xl bg-white border border-[#ECEFF5] p-3.5 sm:p-4.5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
              <div className="flex items-center gap-3 sm:gap-4 lg:min-w-[320px]">
                <div className="sm:hidden">
                  <div className="relative w-[104px] h-[104px]">
                    <ScoreRing percent={assessmentRiskPct} size={104} thickness={12} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#181819] tabular-nums">
                      {assessmentRiskPct}%
                    </span>
                  </div>
                </div>
                <div className="hidden sm:block lg:hidden">
                  <div className="relative w-[118px] h-[118px]">
                    <ScoreRing percent={assessmentRiskPct} size={118} thickness={13} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#181819] tabular-nums">
                      {assessmentRiskPct}%
                    </span>
                  </div>
                </div>
                <div className="hidden lg:block">
                  <div className="relative w-[148px] h-[148px]">
                    <ScoreRing percent={assessmentRiskPct} size={148} thickness={15} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[26px] font-bold text-[#181819] tabular-nums">
                      {assessmentRiskPct}%
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
                    Rejection risk ({getRiskLevelLabel(assessmentRiskPct)})
                  </p>
                  <p className="mt-1 text-[11px] text-[#6B7280] leading-relaxed max-w-[320px]">
                    Without applying recommendations, rejection risk remains high. This resume still misses key job signals.
                  </p>
                </div>
              </div>
              <div className="flex-1 lg:max-w-[280px] space-y-3">
                <MiniMetricRow label="Skills" percent={MOCK.skillsPct} />
                <MiniMetricRow label="Experience" percent={MOCK.experiencePct} />
                <MiniMetricRow label="Portfolio" percent={MOCK.portfolioPct} />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 space-y-3">
          <RadioGroup
            value={aggressiveTailoring ? "strict" : "soft"}
            onChange={(v: string) => setAggressiveTailoring(v === "strict")}
            className="space-y-2"
          >
            <RadioGroup.Label className="flex items-center gap-2 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
              <span>Auto apply changes</span>
              <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-[#FFEAEA] text-[#991B1B] font-semibold tabular-nums">
                {badLabelsCount}
              </span>
            </RadioGroup.Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <RadioGroup.Option value="soft" className="rounded-xl outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                {({ checked }) => (
                  <div
                    className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"
                    }`}
                  >
                    <span className="text-[13px] font-medium text-[#181819]">Light touch</span>
                    <span className="mt-0.5 text-[11px] text-[#6B7280] leading-snug">
                      Reordering and emphasis from your resume only. Better structure and delivery, no unknown skills added.
                    </span>
                  </div>
                )}
              </RadioGroup.Option>
              <RadioGroup.Option value="strict" className="rounded-lg outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                {({ checked }) => (
                  <div
                    className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"
                    }`}
                  >
                    <span className="text-[13px] font-medium text-[#181819]">Full optimization</span>
                    <span className="mt-0.5 text-[11px] text-[#6B7280] leading-snug">
                      Stronger rewrite for match quality. Missing but relevant skills may be added when needed.
                    </span>
                  </div>
                )}
              </RadioGroup.Option>
            </div>
          </RadioGroup>
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[13px] font-semibold text-white bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
          >
            <SparklesIcon className="w-5 h-5 shrink-0" />
            {t("optimize.improveResume")}
          </button>
        </section>
      </div>
    </div>
  );

  const resultBlock = (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-4 w-full items-start">
      <div className="space-y-4">
        <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 space-y-4">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{t("optimize.result")}</h2>
            <p className="text-base font-medium text-[#181819]" role="status">
              {t("optimize.done")}
            </p>
          </header>
          <p className="text-[13px] text-[#4B5563]">
            {t("optimize.mode")}:{" "}
            <span className="font-medium text-[#181819]">{aggressiveTailoring ? t("optimize.aggressiveMode") : t("optimize.softMode")}</span>
          </p>
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F5F6FA] text-[#181819] text-sm font-medium hover:bg-[#EBEDF5] transition-colors"
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
                        <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium text-[#181819] bg-[#F5F6FA]">
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

      <div className="space-y-4">
        <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6">
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.overallMatchScore")}</p>
          <div className="mt-3 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] p-3.5 sm:p-4.5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
              <div className="flex items-center gap-3 sm:gap-4 lg:min-w-[320px]">
                <div className="sm:hidden">
                  <div className="relative w-[104px] h-[104px]">
                    <ScoreRing percent={resultRiskPct} size={104} thickness={12} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[19px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                  </div>
                </div>
                <div className="hidden sm:block lg:hidden">
                  <div className="relative w-[118px] h-[118px]">
                    <ScoreRing percent={resultRiskPct} size={118} thickness={13} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[21px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                  </div>
                </div>
                <div className="hidden lg:block">
                  <div className="relative w-[148px] h-[148px]">
                    <ScoreRing percent={resultRiskPct} size={148} thickness={15} mode="risk" />
                    <span className="absolute inset-0 flex items-center justify-center text-[26px] font-bold text-[#166534] tabular-nums">{resultRiskPct}%</span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#166534] uppercase tracking-wider">
                    Rejection risk ({getRiskLevelLabel(resultRiskPct)})
                  </p>
                  <p className="mt-1 text-[11px] text-[#4B5563] leading-relaxed max-w-[320px]">
                    This resume now better matches the vacancy. Rejection risk is reduced after applying recommendations.
                  </p>
                </div>
              </div>
              <div className="flex-1 lg:max-w-[280px] space-y-3">
                <MiniMetricRow label="Skills" percent={88} />
                <MiniMetricRow label="Experience" percent={79} />
                <MiniMetricRow label="Portfolio" percent={65} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
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
      <div>
        <h1 className="text-xl font-bold text-[#181819] tracking-tight">Visual Sandbox</h1>
        <p className="text-sm text-[#6B7280] mt-1">Simulation of Optimize with focus on diagnosis, pain point, and clear action.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["assessment", "result", "both"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              viewMode === mode ? "bg-[#4578FC] text-white" : "bg-[#EBEDF5] text-[#181819] hover:bg-[#E0E4EE]"
            }`}
          >
            {mode === "assessment" ? "Assessment" : mode === "result" ? "Result" : "Both"}
          </button>
        ))}
      </div>

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
