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
import { useAdminSandboxShell } from "../../AdminSandboxShellContext";

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
): { label: string; hint: string; fillMod: "" | "--success" | "--warning" | "--danger"; textClass: string } {
  const excellentFrom = opts?.excellentFrom ?? 85;
  const p = Math.max(0, Math.min(100, Math.round(pct)));

  if (p >= excellentFrom) {
    return {
      label: t("admin.visualSandbox.matchTierExcellent"),
      hint: t("admin.visualSandbox.matchTierExcellentHint"),
      fillMod: "--success",
      textClass: "text-[var(--success)]",
    };
  }

  if (excellentFrom > 78 && p >= 78 && p < excellentFrom) {
    return {
      label: t("admin.visualSandbox.matchTierSolid"),
      hint: t("admin.visualSandbox.matchTierSolidHint"),
      fillMod: "--success",
      textClass: "text-[var(--success)]",
    };
  }

  if (p >= 65) {
    return {
      label: t("admin.visualSandbox.matchTierNeedsRefinement"),
      hint: t("admin.visualSandbox.matchTierNeedsRefinementHint"),
      fillMod: "--warning",
      textClass: "text-[var(--warning)]",
    };
  }
  if (p >= 45) {
    return {
      label: t("admin.visualSandbox.matchTierFair"),
      hint: t("admin.visualSandbox.matchTierFairHint"),
      fillMod: "--warning",
      textClass: "text-[var(--warning)]",
    };
  }
  return {
    label: t("admin.visualSandbox.matchTierNeedsWork"),
    hint: t("admin.visualSandbox.matchTierNeedsWorkHint"),
    fillMod: "--danger",
    textClass: "text-[var(--danger)]",
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

function scoreProgressColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p <= 45) return "#c03545";
  if (p <= 65) return "#b45309";
  return "#1a7a4c";
}

/** Segmented score bar — cells fill by %, tinted to match tier. */
function SegmentedScoreBar({
  percent,
  tone,
  segments = 12,
}: {
  percent: number;
  tone: "" | "--success" | "--warning" | "--danger";
  segments?: number;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * segments);
  const gradient =
    tone === "--success"
      ? "var(--grad-fill-success)"
      : tone === "--danger"
        ? "var(--grad-fill-danger)"
        : tone === "--warning"
          ? "var(--grad-fill-warning)"
          : "var(--grad-fill-accent)";
  const glow =
    tone === "--success"
      ? "0 0 8px -2px rgba(26, 122, 76, 0.35)"
      : tone === "--danger"
        ? "0 0 8px -2px rgba(192, 53, 69, 0.3)"
        : tone === "--warning"
          ? "0 0 8px -2px rgba(180, 83, 9, 0.3)"
          : "0 0 8px -2px rgba(69, 120, 252, 0.3)";

  return (
    <div
      className="mx-auto flex w-full max-w-[220px] gap-1 sm:mx-0 sm:max-w-none"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, i) => {
        const on = i < filled;
        const t = segments <= 1 ? 1 : i / (segments - 1);
        return (
          <span
            key={i}
            className="h-2.5 min-w-0 flex-1 rounded-[3px] transition-opacity"
            style={
              on
                ? {
                    background: gradient,
                    opacity: 0.55 + t * 0.45,
                    boxShadow: glow,
                  }
                : {
                    background: "rgba(232, 236, 245, 0.95)",
                  }
            }
            aria-hidden
          />
        );
      })}
    </div>
  );
}

/** Large semicircle gauge — light track, thick arc, design-token colors. */
function ScoreArc({
  percent,
  width = 220,
  stroke = 18,
}: {
  percent: number;
  width?: number;
  stroke?: number;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const color = scoreProgressColor(pct);
  const height = width * 0.62;
  const cx = width / 2;
  const cy = height - stroke / 2 - 2;
  const r = (width - stroke) / 2 - 4;
  // Semicircle from left (π) to right (0), through top
  const startX = cx - r;
  const startY = cy;
  const endX = cx + r;
  const endY = cy;
  const trackPath = `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`;
  const circumference = Math.PI * r;
  const dash = (pct / 100) * circumference;

  return (
    <div className="relative mx-auto" style={{ width, height }} aria-hidden>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <defs>
          <linearGradient id="scoreArcFill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3ecf8e" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <path
          d={trackPath}
          fill="none"
          stroke="rgba(232, 236, 245, 0.95)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={trackPath}
          fill="none"
          stroke="url(#scoreArcFill)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="drop-shadow-[0_0_12px_rgba(26,122,76,0.25)]"
        />
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center justify-end pb-1">
        <CheckIcon className="h-7 w-7 text-[var(--success)]" strokeWidth={2.25} />
      </div>
    </div>
  );
}
const RESULT_KEY_ICONS = [DocumentTextIcon, BriefcaseIcon, AcademicCapIcon] as const;

export default function AdminVisualTest() {
  const navigate = useNavigate();
  const { setStudioFocus } = useAdminSandboxShell();
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

  useEffect(() => {
    const focus = viewMode === "result" || viewMode === "both";
    setStudioFocus(focus);
    return () => setStudioFocus(false);
  }, [viewMode, setStudioFocus]);

  /** Fixed mock pre/post match scores (no random band). */
  const MOCK_PRE_MATCH = 70;
  const MOCK_POST_MATCH = 86;
  const studioMatchPct = MOCK_POST_MATCH;

  const scanSummaryText =
    "The current resume looks acceptable at first glance, but key proof points are missing. This is why responses stay low.";

  const treatmentGroups = MOCK.recommendations.map((group) => {
    const problems = group.labels.filter((label) => isProblemLabel(label));
    return { category: group.category, problems };
  });
  const totalIssueCount = treatmentGroups.reduce((n, g) => n + g.problems.length, 0);

  const resultTierResult = matchTierShort(studioMatchPct, { excellentFrom: 78 });
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

  const currentMatchPct = MOCK_PRE_MATCH;
  const potentialMatchPct = MOCK_POST_MATCH;
  const currentTier = matchTierShort(currentMatchPct);
  const potentialTier = matchTierShort(potentialMatchPct, { excellentFrom: 78 });

  const assessmentHero = (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-2 text-center lg:mx-0 lg:max-w-none lg:text-left">
      <h2 className="ds-title text-[clamp(1.25rem,2.4vw,1.5rem)]">
        {t("admin.visualSandbox.assessmentTitleLead")}{" "}
        <span className="text-[var(--accent)]">{t("admin.visualSandbox.assessmentTitleHighlight")}</span>
      </h2>
      <p className="ds-subtitle mx-auto lg:mx-0">{t("admin.visualSandbox.assessmentSubtitle")}</p>
    </div>
  );

  const assessmentLeftColumn = (
    <div className="flex flex-col gap-5 w-full min-w-0 overflow-x-hidden">
      <section className="ds-card p-5 sm:p-7">
        <p className="ds-label mb-6 text-center sm:text-left">{t("optimize.overallMatchScore")}</p>
        <div className="grid flex-1 grid-cols-1 gap-6 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch sm:gap-5">
          <div className="flex min-w-0 flex-col text-center sm:text-left">
            <p className="ds-label">{t("admin.visualSandbox.currentMatch")}</p>
            <p className="mt-2 text-[length:var(--text-display)] font-bold tabular-nums leading-none tracking-tight text-[var(--text)]">
              {currentMatchPct}%
            </p>
            <p className={`mt-2 text-[length:var(--text-base)] font-semibold ${currentTier.textClass}`}>{currentTier.label}</p>
            <p className="ds-hint mx-auto mt-1 max-w-[240px] sm:mx-0">{currentTier.hint}</p>
            <div className="mt-auto w-full pt-4">
              <SegmentedScoreBar percent={currentMatchPct} tone={currentTier.fillMod} />
            </div>
          </div>
          <div className="flex items-center justify-center self-center sm:self-stretch sm:items-center">
            <ArrowRightIcon
              className="h-5 w-5 shrink-0 text-[var(--border-strong)] rotate-90 sm:rotate-0"
              strokeWidth={1.75}
              aria-hidden
            />
          </div>
          <div className="flex min-w-0 flex-col text-center sm:text-left">
            <p className="ds-label">{t("admin.visualSandbox.potentialMatch")}</p>
            <p className={`mt-2 text-[length:var(--text-display)] font-bold tabular-nums leading-none ${potentialTier.textClass}`}>
              {potentialMatchPct}%
            </p>
            <p className={`mt-2 text-[length:var(--text-base)] font-semibold ${potentialTier.textClass}`}>{potentialTier.label}</p>
            <p className="ds-hint mx-auto mt-1 max-w-[240px] sm:mx-0">{potentialTier.hint}</p>
            <div className="mt-auto w-full pt-4">
              <SegmentedScoreBar percent={potentialMatchPct} tone={potentialTier.fillMod} />
            </div>
          </div>
        </div>
      </section>

      <section className="ds-card p-5 sm:p-7">
        <div className="border-b border-[var(--border)]/80 pb-5">
          <p className="ds-label text-[var(--accent)]">{t("admin.visualSandbox.recommendationsEyebrow")}</p>
          <h3 className="mt-1.5 text-[length:var(--text-lg)] font-semibold tracking-tight text-[var(--text)]">
            {t("optimize.whyNoCallbacksTitle")}
          </h3>
          <p className="ds-body mt-2 max-w-2xl">{scanSummaryText}</p>
        </div>

        <ul className="mt-5 space-y-3">
          {MOCK.callback_blockers.map((cb, i) => {
            const Icon = CALLBACK_PREVIEW_ICONS[i % CALLBACK_PREVIEW_ICONS.length];
            const tone = impactToneForBlocker(cb, i);
            const boost = boostPctForSandboxBlocker(i);
            return (
              <li
                key={cb.headline}
                className="rounded-[var(--radius-md)] border border-white/70 bg-white/55 p-4 shadow-[var(--shadow-sm)] backdrop-blur-sm"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`ds-icon-well ${tone === "high" ? "ds-icon-well--danger" : "ds-icon-well--warning"}`}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.35} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[length:var(--text-sm)] font-semibold leading-snug text-[var(--text)]">{cb.headline}</p>
                    <p className="ds-hint mt-1.5 !text-[var(--text-muted)]">{cb.action}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
                    <span className={`ds-soft-pill ${tone === "high" ? "ds-soft-pill--danger" : "ds-soft-pill--warning"}`}>
                      {tone === "high" ? t("admin.visualSandbox.impactHigh") : t("admin.visualSandbox.impactMedium")}
                    </span>
                    <span className="text-[length:var(--text-sm)] font-semibold tabular-nums text-[var(--success)]">
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
            <div className="mt-3 border-t border-[var(--border)]/80 pt-4">
              <DisclosureButton className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-white/80 bg-white/70 px-4 py-3 text-[length:var(--text-sm)] font-semibold text-[var(--text)] shadow-[var(--shadow-sm)] backdrop-blur-sm transition-colors hover:bg-white">
                <span>{tFormat(t("admin.visualSandbox.seeGapBreakdown"), { count: totalIssueCount })}</span>
                <ChevronDownIcon
                  className={`h-5 w-5 shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
                />
              </DisclosureButton>
              <DisclosurePanel className="mt-4 rounded-[var(--radius-md)] border border-white/80 bg-white/60 px-3 py-3 backdrop-blur-sm">
                <div className="grid max-h-[min(50vh,340px)] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {treatmentGroups
                    .filter((g) => g.problems.length > 0)
                    .map((group) => (
                      <div key={group.category} className="rounded-[var(--radius-md)] border border-[var(--border)]/80 bg-white/80 p-3">
                        <p className="ds-label">{group.category}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {group.problems.map((label) => (
                            <span key={`${group.category}-${label}`} className="ds-chip">
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
      <div className="ds-card overflow-hidden !shadow-[var(--shadow-md)]">
        <div
          className="flex flex-nowrap items-center gap-3 border-b border-[var(--border)]/80 px-4 py-3.5"
          style={{ background: "var(--grad-accent-soft)" }}
        >
          <div className="shrink-0">
            <p className="ds-label">{t("admin.visualSandbox.atsFriendlyLabel")}</p>
            <div className="mt-0.5 flex items-baseline gap-0.5 tabular-nums leading-none">
              <span className="text-[1.375rem] font-bold tracking-tight text-[var(--text)]">{MOCK.atsFriendlyScore}</span>
              <span className="text-sm font-medium text-[var(--text-tertiary)]">/100</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 self-center">
            <div className="ds-progress-track w-full min-w-0 !h-1.5">
              <div className="ds-progress-fill" style={{ width: `${MOCK.atsFriendlyScore}%` }} />
            </div>
          </div>
        </div>
        <div className="relative aspect-[210/270] bg-[var(--bg-elevated)]">
          {mockThumbUrl ? (
            <img src={mockThumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 flex gap-3 p-4">
              <div className="w-[28%] shrink-0 rounded-[var(--radius-md)] bg-[var(--text)]/80" />
              <div className="min-w-0 flex-1 space-y-2 pt-2">
                <div className="mx-auto h-2 w-1/2 rounded-full bg-[var(--border-strong)]" />
                <div className="h-1.5 w-full rounded bg-[var(--border)]" />
                <div className="h-1.5 w-5/6 rounded bg-[var(--border)]" />
                <div className="mt-4 h-1.5 w-full rounded bg-[var(--border)]" />
                <div className="h-1.5 w-4/5 rounded bg-[var(--border)]" />
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/90 to-transparent px-4 pb-4 pt-16">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-white/90 py-2.5 text-[length:var(--text-sm)] font-semibold text-[var(--accent)] shadow-[var(--shadow-sm)] backdrop-blur-sm"
            >
              <EyeIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {t("admin.visualSandbox.viewFullResume")}
            </button>
          </div>
        </div>
      </div>

      <section className="ds-card ds-card--accent w-full p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="ds-icon-well ds-icon-well--accent !h-11 !w-11" aria-hidden>
              <SparklesIcon className="h-5 w-5" strokeWidth={1.35} />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
              <p className="text-[length:var(--text-sm)] font-semibold leading-snug text-[var(--text)]">
                {tFormat(t("admin.visualSandbox.autoImproveBannerTitle"), { pct: potentialMatchPct })}
              </p>
              <div className="flex flex-col gap-1.5">
                {[t("admin.visualSandbox.autoImproveBullet1"), t("admin.visualSandbox.autoImproveBullet2"), t("admin.visualSandbox.autoImproveBullet3")].map(
                  (line) => (
                    <span key={line} className="inline-flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)]">
                        <CheckIcon className="h-2.5 w-2.5 text-[var(--success)]" strokeWidth={2.5} aria-hidden />
                      </span>
                      {line}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>
          <button type="button" className="ds-btn-primary w-full">
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
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col items-stretch gap-8 overflow-x-hidden">
      <div className="mx-auto max-w-2xl space-y-2 text-center sm:mx-0 sm:max-w-none sm:text-left">
        <h2 className="ds-title text-[clamp(1.25rem,2.4vw,1.375rem)]">{t("admin.visualSandbox.resultOptimizedTitle")}</h2>
        <p className="ds-subtitle mx-auto sm:mx-0">{t("admin.visualSandbox.resultOptimizedSubtitle")}</p>
      </div>

      <section className="ds-card ds-card--success w-full p-6 sm:p-8">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0 text-center lg:text-left">
            <span className="ds-soft-pill ds-soft-pill--success">{t("admin.visualSandbox.resultYourMatchScoreLabel")}</span>
            <p className="mt-3 text-[clamp(2.5rem,10vw,3.25rem)] font-bold tabular-nums leading-none tracking-tight text-[var(--success)]">
              {studioMatchPct}%
            </p>
            <p className="mt-2 text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
              {MOCK_PRE_MATCH}% → {MOCK_POST_MATCH}%
              <span className="ml-2 font-semibold text-[var(--success)]">+{MOCK_POST_MATCH - MOCK_PRE_MATCH} pp</span>
            </p>
            <p className={`mt-2 text-[length:var(--text-base)] font-semibold ${resultTierResult.textClass}`}>{resultTierResult.label}</p>
            <p className="ds-hint mx-auto mt-2 max-w-[280px] lg:mx-0">{resultTierResult.hint}</p>
            {resultTopBucketPct != null && (
              <span className="ds-soft-pill ds-soft-pill--success mt-4">
                {tFormat(t("admin.visualSandbox.resultTopCandidatesBadge"), { pct: resultTopBucketPct })}
              </span>
            )}
          </div>

          <div className="relative mx-auto flex w-full max-w-[240px] shrink-0 justify-center sm:max-w-[260px]">
            <ScoreArc percent={studioMatchPct} width={240} stroke={20} />
          </div>

          <div className="hidden min-w-0 border-l border-[var(--border)]/80 pl-6 lg:block">
            <p className="ds-hint !text-[var(--text-muted)]">{t("admin.visualSandbox.resultScoreBasedOn")}</p>
            <ul className="mt-4 space-y-3">
              {resultScoreFactorLines.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[length:var(--text-sm)] leading-snug text-[var(--text-muted)]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-[var(--shadow-sm)]">
                    <CheckIcon className="h-3 w-3 text-[var(--success)]" strokeWidth={2.5} aria-hidden />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--border)]/80 pt-6 lg:hidden">
          <p className="ds-hint !text-[var(--text-muted)]">{t("admin.visualSandbox.resultScoreBasedOn")}</p>
          <ul className="mt-3 space-y-2.5">
            {resultScoreFactorLines.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-[var(--shadow-sm)]">
                  <CheckIcon className="h-3 w-3 text-[var(--success)]" strokeWidth={2.5} aria-hidden />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="w-full">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-center sm:text-left">
            <h3 className="text-[length:var(--text-lg)] font-semibold tracking-tight text-[var(--text)]">
              {t("optimize.keyChangesTitle")}
            </h3>
            <p className="ds-subtitle mt-1 mx-auto sm:mx-0">{t("optimize.keyChangesSubtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center justify-center sm:justify-end">
            <span className="ds-soft-pill ds-soft-pill--success">
              <CheckIcon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {tFormat(t("optimize.keyChangesApplied"), { count: resultImprovementCount })}
            </span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MOCK.resultKeyChanges.map((group, idx) => {
            const Icon = RESULT_KEY_ICONS[idx % RESULT_KEY_ICONS.length];
            const well =
              idx === 0 ? "ds-icon-well--accent" : idx === 1 ? "ds-icon-well--warning" : "ds-icon-well--success";
            const headlines = [
              t("optimize.keyChangeBenefitSummaryTitle"),
              t("optimize.keyChangeBenefitExperienceTitle"),
              t("optimize.keyChangeBenefitSkillsTitle"),
            ];
            const whys = [
              t("optimize.keyChangeBenefitSummaryWhy"),
              t("optimize.keyChangeBenefitExperienceWhy"),
              t("optimize.keyChangeBenefitSkillsWhy"),
            ];
            return (
              <div key={group.category} className="ds-card flex flex-col !rounded-[var(--radius-md)] p-4">
                <div className="flex items-start gap-3.5">
                  <div className={`ds-icon-well ${well}`} aria-hidden>
                    <Icon className="h-5 w-5" strokeWidth={1.35} />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[length:var(--text-sm)] font-semibold text-[var(--text)]">
                        {headlines[idx] ?? group.category}
                      </p>
                      <span className="ds-soft-pill ds-soft-pill--success !py-1 !px-2.5 !text-[11px] shrink-0">
                        {t("optimize.keyChangesImproved")}
                      </span>
                    </div>
                    <p className="ds-body mt-1.5 !text-[12px]">{whys[idx] ?? group.description}</p>
                  </div>
                </div>
                {group.items.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-[var(--border)]/80 pt-3">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--text-muted)]">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)]">
                          <CheckIcon className="h-2.5 w-2.5 text-[var(--success)]" strokeWidth={2.5} aria-hidden />
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
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
          showImproveEvenStronger={studioMatchPct < 85}
        />
      </div>
    </div>
  );

  return (
    <div className="ds-sandbox space-y-8 pb-24 sm:pb-12 w-full min-w-0">
      {portalTarget &&
        createPortal(
          <div className="ds-sandbox flex items-center justify-between w-full gap-3">
            <div className="flex flex-col min-w-0 pr-2">
              <div className="flex items-center gap-2">
                <h1 className="text-[length:var(--text-base)] font-semibold text-[var(--text)] tracking-tight truncate">
                  Visual Sandbox
                </h1>
                <span className="ds-chip hidden sm:inline-flex truncate !py-0.5 !text-[10px]">
                  Optimize UI + templates (same APIs as prod)
                </span>
              </div>
            </div>
            <div className="flex items-center rounded-[var(--radius-full)] border border-white/70 bg-white/55 p-0.5 shadow-[var(--shadow-sm)] backdrop-blur-sm shrink-0">
              {(["assessment", "result", "both"] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 sm:px-3 py-1 rounded-[var(--radius-full)] text-[11px] sm:text-xs font-medium transition-all ${
                    viewMode === mode
                      ? "text-white shadow-[var(--shadow-sm)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text)]"
                  }`}
                  style={viewMode === mode ? { background: "var(--grad-accent-btn)" } : undefined}
                >
                  {mode === "assessment" ? "Assessment" : mode === "result" ? "Result" : "Both"}
                </button>
              ))}
            </div>
          </div>,
          portalTarget,
        )}

      {(viewMode === "assessment" || viewMode === "both") && (
        <section>
          {viewMode === "both" && (
            <h2 className="ds-label mb-3 text-center sm:text-left">Assessment</h2>
          )}
          {assessmentBlock}
        </section>
      )}

      {(viewMode === "result" || viewMode === "both") && (
        <section>
          {viewMode === "both" && (
            <h2 className="ds-label mb-3 mt-2 text-center sm:text-left">Result</h2>
          )}
          {resultBlock}
        </section>
      )}
    </div>
  );
}
