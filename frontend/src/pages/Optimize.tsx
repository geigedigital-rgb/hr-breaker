import { useState, useEffect, useRef, useId } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel, RadioGroup } from "@headlessui/react";
import { SparklesIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, ArrowPathIcon, BriefcaseIcon, ClipboardDocumentIcon, DocumentTextIcon, LinkIcon, ExclamationTriangleIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t } from "../i18n";

const RESUME_FILE_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf,.doc,.docx";
const RESUME_TEXT_EXTS = ["txt", "md", "html", "htm", "tex", "pdf", "doc", "docx"];

/** Backend message when URL is a job search page, not a single job */
const JOB_LIST_URL_MARKER = "job search page";
/** Backend message when scraping failed (Cloudflare etc.) — suggests pasting text */
const SCRAPE_FAILED_PASTE_MARKER = "Paste";

function isOfferPasteAsTextError(msg: string): boolean {
  return msg.includes(JOB_LIST_URL_MARKER) || msg.includes(SCRAPE_FAILED_PASTE_MARKER);
}

type Stage = "landing" | "idle" | "scanning" | "assessment" | "loading" | "result";

/** Контент предпросмотра: вакансия структурирована — заголовки, требования, описание абзацами */
function JobPreviewContent({
  parsedJob,
  rawText,
  isParsing,
}: {
  parsedJob: api.JobPostingOut | null;
  rawText: string;
  isParsing?: boolean;
}) {
  if (isParsing) {
    return (
      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
        {t("optimize.parsingJob")}
      </p>
    );
  }
  const hasStructured = parsedJob && (parsedJob.title || parsedJob.company || parsedJob.requirements?.length || parsedJob.description);
  if (hasStructured) {
    return (
      <div className="mt-3 space-y-4 text-sm max-h-72 overflow-y-auto" itemScope itemType="https://schema.org/JobPosting">
        <section>
          <p className="font-bold text-[#181819] text-base leading-tight" itemProp="title">{parsedJob!.title || "—"}</p>
          <p className="mt-0.5 font-medium text-[#181819] text-[13px]" itemProp="hiringOrganization" itemScope itemType="https://schema.org/Organization">
            <span itemProp="name">{parsedJob!.company || "—"}</span>
          </p>
        </section>
        {parsedJob!.keywords && parsedJob!.keywords.length > 0 && (
          <section>
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">{t("optimize.keywordsSkills")}</p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.keywords.slice(0, 20).join(", ")}
              {parsedJob!.keywords.length > 20 ? " …" : ""}
            </p>
          </section>
        )}
        {parsedJob!.requirements && parsedJob!.requirements.length > 0 && (
          <section>
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">{t("optimize.requirements")}</p>
            <ul className="list-disc list-inside space-y-0.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        {parsedJob!.description && (
          <section itemProp="description">
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">{t("optimize.description")}</p>
            <div className="text-[13px] text-[var(--text-muted)] leading-relaxed space-y-2">
              {parsedJob!.description.trim().split(/\n\n+/).filter(Boolean).map((block, i) => (
                <p key={i}>{block}</p>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }
  // Fallback: разбить сырой текст по типичным заголовкам секций (DE/EN)
  const sectionPattern = /^(Deine Aufgaben:|Du bringst mit:|Wir bieten:|Requirements?:|Responsibilities?:|Qualifications?:|Описание|Требования|Обязанности|Условия)\s*$/im;
  const parts = rawText.trim().split(/\n\n+/).filter(Boolean);
  const sections: { title?: string; body: string }[] = [];
  let current: { title?: string; body: string } = { body: "" };
  for (const block of parts) {
    const firstLine = block.split(/\n/)[0]?.trim() ?? "";
    if (sectionPattern.test(firstLine) || (firstLine.endsWith(":") && firstLine.length < 50)) {
      if (current.body.trim()) sections.push(current);
      const afterTitle = block.includes("\n") ? block.slice(block.indexOf("\n") + 1).trim() : "";
      current = { title: firstLine, body: afterTitle || block };
    } else {
      current.body = current.body ? `${current.body}\n\n${block}` : block;
    }
  }
  if (current.body.trim()) sections.push(current);

  if (sections.length > 0) {
    return (
      <div className="mt-3 max-h-72 overflow-y-auto space-y-4">
        {sections.map((s, i) => (
          <section key={i}>
            {s.title && <p className="font-semibold text-[#181819] text-[13px] mb-1.5">{s.title}</p>}
            <div className="text-[13px] text-[var(--text-muted)] leading-relaxed space-y-2">
              {s.body.split(/\n\n+/).filter(Boolean).map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  const paragraphs = parts;
  return (
    <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
      {paragraphs.length > 0 ? (
        paragraphs.map((block, i) => (
          <p key={i} className={i === 0 ? "font-semibold text-[#181819] text-sm" : "text-[13px] text-[var(--text-muted)] leading-relaxed"}>
            {block}
          </p>
        ))
      ) : (
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{rawText.slice(0, 800)}{rawText.length > 800 ? "…" : ""}</p>
      )}
    </div>
  );
}

/** Заголовки секций резюме (DE, EN, RU) — для построчного разбора */
const RESUME_SECTION_HEADERS_SET = new Set([
  "SPRACHEN", "KENNTNISSE", "ERFAHRUNG", "BILDUNG", "PERSONLICHE DATEN", "PERSONLIHE DATEN",
  "EDUCATION", "EXPERIENCE", "SKILLS", "SUMMARY", "QUALIFICATIONS", "CONTACT", "CONTACTS",
  "ОПЫТ", "ОБРАЗОВАНИЕ", "НАВЫКИ", "КОНТАКТЫ", "Опыт работы", "Образование", "Навыки", "Контакт", "Личные качества",
  "BERUFSERFAHRUNG", "BILDUNGSWEG", "ERFOLGREICHE PROJEKTE", "AUSBILDUNG", "WEITERBILDUNG",
  "ARBEITSWEISE", "KOMMUNIKATION", "VERANTWORTUNG", "PERSONLICHE DATEN",
  "Languages", "Experience", "Education", "Skills", "Summary", "Contact",
]);

function isResumeSectionHeader(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const upper = t.toUpperCase().replace(/\s+/g, " ");
  if (RESUME_SECTION_HEADERS_SET.has(upper)) return true;
  if (t.length <= 50 && t === t.toUpperCase() && /^[A-ZÄÖÜ0-9\s&\-\.]+$/i.test(t)) return true;
  return false;
}

/** Расшифровка резюме: имя, должность, навыки + секции по заголовкам (построчный разбор) */
function ResumePreviewContent({
  rawContent,
  name,
  specialty,
  skills,
  isExtracting,
}: {
  rawContent: string;
  name: string;
  specialty: string;
  skills: string;
  isExtracting?: boolean;
}) {
  if (isExtracting && !name) {
    return (
      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
        {t("optimize.structuringResume")}
      </p>
    );
  }
  const text = rawContent.trim();
  if (!text) {
    return <p className="mt-3 text-[13px] text-[var(--text-muted)]">{t("optimize.noData")}</p>;
  }

  const lines = text.split(/\n/).map((l) => l.trimEnd());
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } = { title: "", body: "" };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isResumeSectionHeader(line)) {
      if (current.title && current.body.trim()) sections.push({ ...current, body: current.body.trim() });
      else if (current.title) sections.push({ title: current.title, body: current.body.trim() });
      current = { title: line.trim(), body: "" };
      continue;
    }
    current.body = current.body ? `${current.body}\n${line}` : line;
  }
  if (current.title && current.body.trim()) sections.push({ title: current.title, body: current.body.trim() });

  const hasSections = sections.length > 0;

  return (
    <div className="mt-3 space-y-4 text-sm max-h-72 overflow-y-auto">
      <section>
        <p className="font-bold text-[#181819] text-base leading-tight">{name || "—"}</p>
        <p className="mt-0.5 font-medium text-[#181819] text-[13px]">{specialty || "—"}</p>
        {skills && (
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)] leading-snug">
            {skills}
          </p>
        )}
      </section>
      {hasSections ? (
        sections.filter((s) => s.body || s.title).map((s, i) => (
          <section key={i}>
            {s.title && <p className="font-semibold text-[#181819] text-[13px] mb-1.5">{s.title}</p>}
            {s.body && (
              <div className="text-[13px] text-[var(--text-muted)] leading-snug space-y-1.5">
                {s.body.split(/\n\n+/).filter(Boolean).map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </div>
            )}
          </section>
        ))
      ) : (
        <div className="text-[13px] text-[var(--text-muted)] leading-snug space-y-1.5">
          {text.split(/\n\n+/).filter(Boolean).slice(0, 12).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {text.split(/\n\n+/).filter(Boolean).length > 12 && <p>…</p>}
        </div>
      )}
    </div>
  );
}

function getAtsScore(result: api.OptimizeResponse): number | null {
  const r = result.validation.results.find((f) => f.filter_name === "LLMChecker");
  return r != null ? Math.round(r.score * 100) : null;
}

function getKeywordsScore(result: api.OptimizeResponse): { score: number; threshold: number } | null {
  const r = result.validation.results.find((f) => f.filter_name === "KeywordMatcher");
  return r != null ? { score: r.score, threshold: r.threshold } : null;
}

const ATS_BANDS: { max: number; category: string; description: string }[] = [
  { max: 55, category: "Inadequate", description: "Critically low. Resume is classified as irrelevant. High chance of auto-reject." },
  { max: 65, category: "Borderline", description: "Borderline. You meet basic criteria but rank low. May be reviewed only when candidates are scarce." },
  { max: 75, category: "Qualified", description: "Professional minimum. You have shown core competencies. Resume makes it to the initial screening list." },
  { max: 85, category: "Top Tier", description: "Gold standard. Strong balance of hard skills and context. You rank in the top 5 in the system." },
  { max: 99, category: "Elite / Expert", description: "Maximum priority. Full match on all filters. Expect thorough verification at interview." },
  { max: 100, category: "System Match", description: "Technical ideal. Can be seen as copy-paste of the job. Some HRs may view it with skepticism." },
];

const KEYWORDS_BANDS: { max: number; category: string; description: string }[] = [
  { max: 55, category: "Weak", description: "Critical hard skills missing. The algorithm sees you as from a different field." },
  { max: 65, category: "Basic", description: "Basic skills listed but specific tools (stack, methodologies, certs) are missing." },
  { max: 75, category: "Strong", description: "All must-have requirements covered. You pass filters for most search queries." },
  { max: 85, category: "Optimal", description: "Ideal coverage. Both core and nice-to-have skills. Maximum weight in search." },
  { max: 99, category: "Exact", description: "Near-perfect match to job wording. Guarantees top placement but may need human polish." },
  { max: 100, category: "Overfit", description: "Word-for-word match. May trigger anti-spam (keyword stuffing) in some ATS." },
];

function getAtsCategory(percent: number): { category: string; description: string } {
  const band = ATS_BANDS.find((b) => percent <= b.max);
  return band ? { category: band.category, description: band.description } : ATS_BANDS[ATS_BANDS.length - 1];
}

function getKeywordsCategory(percent: number): { category: string; description: string } {
  const band = KEYWORDS_BANDS.find((b) => percent <= b.max);
  return band ? { category: band.category, description: band.description } : KEYWORDS_BANDS[KEYWORDS_BANDS.length - 1];
}

function getScoreStrokeColor(pct: number): string {
  if (pct < 55) return "#dc2626";
  if (pct < 75) return "#eab308";
  return "#16a34a";
}

const CIRCLE_STROKE = 5;

/** Небольшая круговая диаграмма заполнения (0–100%). */
function CircleScore({ percent, size = 44 }: { percent: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, percent));
  const r = (size - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (pct / 100) * circumference;
  const stroke = getScoreStrokeColor(pct);
  return (
    <svg width={size} height={size} className="shrink-0" aria-hidden>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#EBEDF5"
        strokeWidth={CIRCLE_STROKE}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={CIRCLE_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </svg>
  );
}

/** Одна ячейка в ряду: метка + полоска (loader) + процент. Цвет по уровню. compact = в один ряд с другими. */
function BarScoreRow({ label, percent, compact }: { label: string; percent: number; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, percent));
  const fillColor = getScoreStrokeColor(pct);
  return (
    <div className={compact ? "flex flex-col gap-1 min-w-0 flex-1" : "flex items-center gap-2 w-full min-w-0"}>
      <span className="text-[11px] text-[var(--text)] font-medium shrink-0">{label}</span>
      <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2 w-full min-w-0"}>
        <div className={`${compact ? "flex-1 min-w-[52px]" : "flex-1 min-w-0"} h-1.5 rounded-full bg-[#EBEDF5] overflow-hidden`}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: fillColor }}>
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}

/* Мягкие градиенты для вида «Дополнительный»: близкие оттенки, плавный переход (на малых % не резкий контраст). */
const PROGRESS_GRADIENT_BLUE = "linear-gradient(90deg, #a5bdf8 0%, #9eb6f7 20%, #8baaf6 45%, #7a9cf5 70%, #6a8ef4 100%)";
const PROGRESS_GRADIENT_AMBER = "linear-gradient(90deg, #e5dbb5 0%, #dfd19f 25%, #d4c078 50%, #c9af5c 75%, #c0a34d 100%)";
const PROGRESS_GRADIENT_RED = "linear-gradient(90deg, #e2b8b8 0%, #dca8a8 25%, #d09292 50%, #c47d7d 75%, #b86b6b 100%)";

/** Яркая палитра от зелёного до красного: один градиент на все заполненные сегменты по результату. */
const READINESS_GRADIENT_IDS = {
  red: "readiness-grad-red",
  orange: "readiness-grad-orange",
  yellow: "readiness-grad-yellow",
  green: "readiness-grad-green",
} as const;

function getReadinessGradientId(pct: number): string {
  if (pct < 40) return READINESS_GRADIENT_IDS.red;
  if (pct < 55) return READINESS_GRADIENT_IDS.orange;
  if (pct < 75) return READINESS_GRADIENT_IDS.yellow;
  return READINESS_GRADIENT_IDS.green;
}

/** Дуга 90° «Готовность к вакансии»: сегменты с закруглёнными краями и зазорами, пропорциональные; супер-яркие градиенты. */
function JobReadinessSemicircle({ percent, size = 140 }: { percent: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, percent));
  const strokeWidth = 12;
  const r = size * 0.38;
  const cx = size * 0.5;
  const cy = size * 0.52;
  const numSegments = 24;
  const totalAngle = Math.PI / 2;
  const gapFraction = 0.22;
  const segmentAngle = (totalAngle / numSegments) * (1 - gapFraction);
  const angleStep = totalAngle / numSegments;
  const startAngle = Math.PI;
  const gradientId = getReadinessGradientId(pct);
  const filledCount = Math.round((pct / 100) * numSegments);
  const svgH = size * 0.72;

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: svgH + 24 }}>
      <svg width={size} height={svgH} className="overflow-visible" aria-hidden viewBox={`0 0 ${size} ${svgH}`}>
        <defs>
          <linearGradient id={READINESS_GRADIENT_IDS.red} x1="0" y1="0" x2={size} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff4444" />
            <stop offset="50%" stopColor="#ff1744" />
            <stop offset="100%" stopColor="#d50000" />
          </linearGradient>
          <linearGradient id={READINESS_GRADIENT_IDS.orange} x1="0" y1="0" x2={size} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffab40" />
            <stop offset="50%" stopColor="#ff9100" />
            <stop offset="100%" stopColor="#ff6d00" />
          </linearGradient>
          <linearGradient id={READINESS_GRADIENT_IDS.yellow} x1="0" y1="0" x2={size} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffee58" />
            <stop offset="50%" stopColor="#ffeb3b" />
            <stop offset="100%" stopColor="#ffc107" />
          </linearGradient>
          <linearGradient id={READINESS_GRADIENT_IDS.green} x1="0" y1="0" x2={size} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#69f0ae" />
            <stop offset="50%" stopColor="#00e676" />
            <stop offset="100%" stopColor="#00c853" />
          </linearGradient>
        </defs>
        {Array.from({ length: numSegments }, (_, i) => {
          const a0 = startAngle + i * angleStep;
          const a1 = a0 + segmentAngle;
          const x0 = cx + r * Math.cos(a0);
          const y0 = cy - r * Math.sin(a0);
          const x1 = cx + r * Math.cos(a1);
          const y1 = cy - r * Math.sin(a1);
          const filled = i < filledCount;
          return (
            <path
              key={i}
              d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`}
              fill="none"
              stroke={filled ? `url(#${gradientId})` : "#E8EAEF"}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <span className="absolute text-[22px] font-bold text-[#181819] tabular-nums" style={{ top: svgH * 0.38 - 6 }}>
        {Math.round(pct)}%
      </span>
      <span className="text-[12px] font-medium text-[var(--text-tertiary)] mt-1">{t("optimize.jobReadiness")}</span>
    </div>
  );
}

/** Одна строка навыка: название слева, толстая полоска с градиентом, процент справа (светлый текст). */
function SkillBarRowAligned({ label, percent }: { label: string; percent: number }) {
  const pct = Math.max(0, Math.min(100, percent));
  const gradient = pct >= 75 ? PROGRESS_GRADIENT_BLUE : pct >= 55 ? PROGRESS_GRADIENT_AMBER : PROGRESS_GRADIENT_RED;
  return (
    <div className="flex items-center gap-3 w-full min-w-0">
      <span className="text-[13px] font-normal text-[#181819] shrink-0 w-[100px]">{label}</span>
      <div className="flex-1 min-w-0 h-3 rounded-full overflow-hidden" style={{ backgroundColor: "#E8EAEF" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: gradient }}
        />
      </div>
      <span className="text-[13px] font-normal text-[var(--text-tertiary)] tabular-nums shrink-0 w-9 text-right">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

type SummaryData = {
  atsPct: number;
  kwPct: number;
  atsCat: { category: string; description: string };
  kwCat: { category: string; description: string };
  overallPct: number;
  skillsPct: number;
  experiencePct: number;
  portfolioPct: number;
  displayName: string;
  displaySpecialty: string;
  displaySkills: string;
};

function getAssessmentTierLabel(pct: number): string {
  if (pct <= 55) return t("optimize.levelCritical");
  if (pct <= 65) return t("optimize.levelBorderline");
  if (pct <= 75) return t("optimize.levelJunior");
  if (pct <= 85) return t("optimize.levelStrong");
  return t("optimize.levelExpert");
}

/** Дополнительный вид результатов: Assessment + Рекомендации + Готовность + Улучшение (стиль скриншота). */
function AdditionalResultsView({
  summaryData,
  preScores,
  stage,
  aggressiveTailoring,
  setAggressiveTailoring,
  onImprove,
  canImprove,
  result,
  showImproveMore,
  isImprovingMore,
  onImproveMore,
}: {
  summaryData: SummaryData;
  preScores: api.AnalyzeResponse | null;
  stage: Stage;
  aggressiveTailoring: boolean;
  setAggressiveTailoring: (v: boolean) => void;
  onImprove: () => void;
  canImprove: boolean;
  result: api.OptimizeResponse | null;
  showImproveMore: boolean;
  isImprovingMore: boolean;
  onImproveMore: () => void;
}) {
  const tierLabel = getAssessmentTierLabel(summaryData.overallPct);
  const levelPos = Math.max(0, Math.min(100, summaryData.overallPct));
  const strongCandidates = [
    { name: t("optimize.skills"), pct: summaryData.skillsPct },
    { name: t("optimize.experience"), pct: summaryData.experiencePct },
    { name: t("optimize.portfolio"), pct: summaryData.portfolioPct },
  ];
  const strongAt = strongCandidates.filter((s) => s.pct >= 70).map((s) => s.name);
  const strongAtDisplay = strongAt.length > 0 ? strongAt : [strongCandidates.reduce((a, b) => (a.pct >= b.pct ? a : b)).name];
  const growthAreas = [
    summaryData.skillsPct < 60 && t("optimize.skills"),
    summaryData.experiencePct < 60 && t("optimize.experience"),
    summaryData.portfolioPct < 60 && t("optimize.portfolio"),
  ].filter(Boolean) as string[];
  const skillRows = [
    { label: t("optimize.skills"), percent: summaryData.skillsPct },
    { label: t("optimize.experience"), percent: summaryData.experiencePct },
    { label: t("optimize.portfolio"), percent: summaryData.portfolioPct },
    { label: "ATS match", percent: summaryData.atsPct },
    { label: t("optimize.keywords"), percent: summaryData.kwPct },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 w-full flex-1 min-h-0 content-start items-stretch overflow-auto">
      {/* Левая колонка: Assessment + Расшифровка */}
      <div className="flex flex-col gap-4 min-h-0 min-w-0">
        <div className="rounded-2xl bg-white border border-[#EBEDF5] shadow-sm overflow-hidden flex flex-col gap-4 p-5 shrink-0">
          <h2 className="text-base font-bold text-[#181819]">{tierLabel}</h2>
          <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
            {summaryData.atsCat.description.slice(0, 180)}
            {summaryData.atsCat.description.length > 180 ? "…" : ""}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-[11px] font-medium text-[var(--text-tertiary)]">
              <span>Easy Level</span>
              <span>Mid Level</span>
              <span>Senior Level</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "#E8EAEF" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${levelPos}%`,
                  background: summaryData.overallPct >= 75 ? PROGRESS_GRADIENT_BLUE : summaryData.overallPct >= 55 ? PROGRESS_GRADIENT_AMBER : PROGRESS_GRADIENT_RED,
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#EBEDF5]">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <CheckCircleIcon className="w-5 h-5 text-[var(--text-tertiary)] shrink-0" aria-hidden />
                <span className="text-[13px] font-semibold text-[#181819]">{t("optimize.strongSides")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {strongAtDisplay.map((s) => (
                  <span key={s} className="inline-flex px-2.5 py-1 rounded-lg bg-[#F2F3F9] text-[12px] font-medium text-[var(--text-muted)]">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#F2F3F9] shrink-0" aria-hidden>
                  <span className="text-[var(--text-tertiary)] text-[10px] font-bold">!</span>
                </span>
                <span className="text-[13px] font-semibold text-[#181819]">{t("optimize.growthAreas")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {growthAreas.length > 0 ? growthAreas.map((s) => (
                  <span key={s} className="inline-flex px-2.5 py-1 rounded-lg bg-[#F2F3F9] text-[12px] font-medium text-[var(--text-muted)]">
                    {s}
                  </span>
                )) : (
                  <span className="text-[12px] text-[var(--text-tertiary)]">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-[#EBEDF5] shadow-sm p-5 flex flex-col gap-0 min-h-0 min-w-0 overflow-auto flex-1">
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-2">
            {t("optimize.recommendationsTitle")}
          </p>
          {preScores?.improvement_tips ? (
            <div className="text-[13px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap space-y-3">
              {preScores.improvement_tips.split(/\n\n+/).filter(Boolean).map((block, i) => {
                const firstLine = block.split("\n")[0] ?? "";
                const rest = block.includes("\n") ? block.slice(block.indexOf("\n") + 1).trim() : "";
                const isHeader = firstLine.length < 60 && (firstLine.endsWith(":") || !firstLine.includes("."));
                return (
                  <section key={i}>
                    {isHeader ? <p className="font-semibold text-[#181819] mb-1">{firstLine.replace(/:$/, "")}</p> : <p className="mb-1">{firstLine}</p>}
                    {rest && <p className="text-[var(--text-tertiary)]">{rest}</p>}
                    {!isHeader && !rest && <p className="text-[var(--text-tertiary)]">{block}</p>}
                  </section>
                );
              })}
            </div>
          ) : preScores?.recommendations && preScores.recommendations.length > 0 ? (
            <ul className="space-y-3">
              {preScores.recommendations
                .filter((rec) => !rec.labels.every((l) => l === "OK"))
                .map((rec, i) => (
                  <li key={i}>
                    <p className="font-semibold text-[#181819] text-[13px] mb-1">{rec.category}</p>
                    <ul className="list-disc list-inside space-y-0.5 text-[13px] text-[var(--text-tertiary)]">
                      {rec.labels.map((label, j) => (
                        <li key={j}>{label}</li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[var(--text-tertiary)]">{t("optimize.runAnalysisForRec")}</p>
          )}
        </div>
      </div>
      {/* Правая колонка: Готовность к вакансии (полукруг + полосы) + Улучшение */}
      <div className="flex flex-col gap-4 min-h-0 min-w-0">
        <div className="rounded-2xl bg-white border border-[#EBEDF5] shadow-sm p-5 flex flex-col gap-4 shrink-0">
          <h2 className="text-base font-bold text-[#181819] w-full">{t("optimize.jobReadiness")}</h2>
          <div className="flex flex-row items-start gap-6 w-full">
            <JobReadinessSemicircle percent={summaryData.overallPct} size={140} />
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-3 pt-2">
              {skillRows.map((row) => (
                <SkillBarRowAligned key={row.label} label={row.label} percent={row.percent} />
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-[#EBEDF5] shadow-sm p-5 flex flex-col gap-3 shrink-0">
          <RadioGroup
            value={aggressiveTailoring ? "strict" : "soft"}
            onChange={(v) => setAggressiveTailoring(v === "strict")}
            className="space-y-2"
          >
            <RadioGroup.Label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {t("optimize.autoImprove")}
            </RadioGroup.Label>
            <div className="grid grid-cols-1 gap-2">
              <RadioGroup.Option value="soft" className="rounded-xl outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2">
                {({ checked }) => (
                  <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
                    <span className="text-[13px] font-medium text-[#181819]">{t("optimize.soft")}</span>
                    <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">{t("optimize.softDesc")}</span>
                  </div>
                )}
              </RadioGroup.Option>
              <RadioGroup.Option value="strict" className="rounded-lg outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2">
                {({ checked }) => (
                  <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
                    <span className="text-[13px] font-medium text-[#181819]">{t("optimize.aggressive")}</span>
                    <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">{t("optimize.aggressiveDesc")}</span>
                  </div>
                )}
              </RadioGroup.Option>
            </div>
          </RadioGroup>
          <button
            type="button"
            onClick={onImprove}
            disabled={!canImprove}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[13px] font-semibold text-white bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SparklesIcon className="w-5 h-5 shrink-0" />
            {t("optimize.improveResume")}
          </button>
        </div>
        {stage === "result" && result && (
          <div className="rounded-2xl bg-white border border-[#EBEDF5] shadow-sm p-5 space-y-4 shrink-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t("optimize.result")}</h2>
            {result.error ? (
              <p className="text-sm text-[var(--text-tertiary)]">{result.error}</p>
            ) : (
              <>
                <p className="text-[13px] text-[var(--text-muted)]">
                  {t("optimize.mode")}: <span className="font-medium text-[#181819]">{aggressiveTailoring ? t("optimize.aggressiveMode") : t("optimize.softMode")}</span>
                </p>
                {result.pdf_filename && result.pdf_base64 && (
                  <div className="flex flex-wrap gap-2">
                    <a href={`data:application/pdf;base64,${result.pdf_base64}`} download={result.pdf_filename} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#181819] text-sm font-medium hover:opacity-95 transition-opacity" style={{ background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)" }}>
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      {t("optimize.downloadPdf")}
                    </a>
                    {showImproveMore && (
                      <button type="button" onClick={onImproveMore} disabled={isImprovingMore} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F5F6FA] text-[#181819] text-sm font-medium hover:bg-[#EBEDF5] transition-colors disabled:opacity-50">
                        {isImprovingMore ? t("optimize.improving") : t("optimize.improveMore")}
                      </button>
                    )}
                  </div>
                )}
                {result.success && !result.pdf_base64 && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("optimize.subscribeToDownload")} <Link to="/upgrade" className="text-[#4578FC] font-medium hover:underline">{t("optimize.subscribeLink")}</Link>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const RESUME_SECTION_HEADERS = /^(SPRACHEN|KENNTNISSE|ERFAHRUNG|BILDUNG|PERSONLICHE\s+DATEN|EDUCATION|EXPERIENCE|SKILLS|SUMMARY|QUALIFICATIONS|ОПЫТ|ОБРАЗОВАНИЕ|НАВЫКИ|КОНТАКТЫ)$/i;

function looksLikeSectionHeader(line: string): boolean {
  if (!line || line.length < 2) return true;
  if (line === line.toUpperCase() && line.length <= 25) return true;
  return RESUME_SECTION_HEADERS.test(line.trim());
}

function looksLikeJobTitle(line: string): boolean {
  if (!line || line.length < 5 || line.length > 55) return false;
  if (looksLikeSectionHeader(line)) return false;
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}|\+\d{2}/.test(line)) return false;
  return true;
}

function getResumeSummary(
  content: string,
  name: { first?: string; last?: string } | null
): { name: string; specialty: string; skillsLine: string } {
  const apiName = name ? ([name.first, name.last].filter(Boolean).join(" ").trim() || "") : "";
  const lines = content.trim().split(/\n/).map((l) => l.trim()).filter(Boolean);
  const nameStr = apiName || (lines[0] && lines[0].length <= 40 && !looksLikeSectionHeader(lines[0]) ? lines[0] : "") || "—";
  const restLines = apiName ? lines.filter((l) => l.toLowerCase() !== apiName.toLowerCase()) : lines.slice(1);
  let specialty = "";
  let specialtyIdx = -1;
  for (let i = 0; i < restLines.length; i++) {
    const line = restLines[i];
    if (looksLikeSectionHeader(line)) continue;
    if (looksLikeJobTitle(line)) {
      specialty = line;
      specialtyIdx = i;
      break;
    }
  }
  const afterSpecialty = specialtyIdx >= 0 ? restLines.slice(specialtyIdx + 1) : restLines;
  const skillLines = afterSpecialty.filter((l) => !looksLikeSectionHeader(l)).slice(0, 4);
  const skillsLine = skillLines.join(" ").replace(/\s+/g, " ").slice(0, 120);
  return {
    name: nameStr,
    specialty: specialty || "—",
    skillsLine: skillsLine ? `${skillsLine}${skillsLine.length >= 120 ? "…" : ""}` : "—",
  };
}

/** Block 3: title, horizontal bar with gradient, percent, category label (no ring) */
function ScoreCard({
  title,
  value,
  categoryLabel,
  id: _id,
}: {
  title: string;
  value: number;
  categoryLabel: string;
  id: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-xl bg-white border border-[#EBEDF5] p-4 flex flex-col gap-2 min-w-0">
      <p className="text-sm font-semibold text-[#181819] uppercase tracking-wider">{title}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="h-2 rounded-full bg-[#EBEDF5] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg, #dc2626 0%, #eab308 50%, #16a34a 100%)",
              }}
            />
          </div>
          <p className="text-xs font-medium text-[var(--text-muted)]">{categoryLabel}</p>
        </div>
        <span className="text-sm font-bold text-[#181819] shrink-0" aria-hidden>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

/** Gauge as in reference: thick band, flared “feet” at 0/100, gradient, dot with glow, text in open space inside arc. */
function ScoreGauge({
  value,
  scoreLabel,
  categoryLabel,
  size = 140,
}: {
  value: number;
  scoreLabel: string;
  categoryLabel: string;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(100, value));
  const R = 48;
  const thick = 26;
  const r = R - thick;
  const capR = thick / 2;
  const footDrop = 5;
  const cx = 50;
  const baseline = 60;
  const centerY = baseline - R;
  const leftEnd = cx - R;
  const rightEnd = cx + R;
  const midLeft = cx - (R + r) / 2;
  const midRight = cx + (R + r) / 2;
  const capTop = baseline - thick / 2;
  const leftFoot = baseline + footDrop;
  const rightFoot = baseline + footDrop;
  const angle = 180 - (pct / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const ix = cx + R * Math.cos(rad);
  const iy = centerY + R * Math.sin(rad);
  const pathBand =
    `M ${leftEnd} ${baseline} ` +
    `A ${R} ${R} 0 0 1 ${rightEnd} ${baseline} ` +
    `L ${rightEnd} ${rightFoot} ` +
    `A ${capR} ${capR} 0 0 1 ${midRight} ${capTop} A ${capR} ${capR} 0 0 1 ${cx + r} ${baseline} ` +
    `A ${r} ${r} 0 0 0 ${cx - r} ${baseline} ` +
    `A ${capR} ${capR} 0 0 1 ${midLeft} ${capTop} A ${capR} ${capR} 0 0 1 ${leftEnd} ${leftFoot} L ${leftEnd} ${baseline} Z`;
  const openCenterY = (centerY + baseline) / 2;
  const scoreY = openCenterY - 6;
  const categoryY = openCenterY + 8;
  const labelsY = baseline + footDrop + 5;
  const viewH = 82;
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: size }}>
      <svg
        viewBox={`0 0 100 ${viewH}`}
        className="w-full"
        style={{ height: (size * viewH) / 100 }}
        aria-hidden
      >
        <defs>
          <linearGradient id={`gaugeGrad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="30%" stopColor="#ea580c" />
            <stop offset="50%" stopColor="#eab308" />
            <stop offset="70%" stopColor="#84cc16" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <filter id={`gaugeGlow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feFlood floodColor="#f97316" floodOpacity="0.45" result="glow" />
            <feComposite in="glow" in2="blur" operator="in" result="softGlow" />
            <feMerge>
              <feMergeNode in="softGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Thick band: semicircle + flared feet (doubly rounded) at 0 and 100 */}
        <path d={pathBand} fill={`url(#gaugeGrad-${id})`} />
        <circle
          cx={ix}
          cy={iy}
          r="6"
          fill="white"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="1.5"
          filter={`url(#gaugeGlow-${id})`}
        />
        {/* Score and category in open space inside the semicircle (not on the band) */}
        <text x={cx} y={scoreY} textAnchor="middle" fill="white" fontSize="20" fontFamily="system-ui" fontWeight="700">
          {scoreLabel}
        </text>
        <text x={cx} y={categoryY} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize="12" fontFamily="system-ui" fontWeight="500">
          {categoryLabel}
        </text>
        {/* 0 and 100 at the lowest points of the feet */}
        <text x={leftEnd} y={labelsY} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="10" fontFamily="system-ui" fontWeight="500">
          0
        </text>
        <text x={rightEnd} y={labelsY} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="10" fontFamily="system-ui" fontWeight="500">
          100
        </text>
      </svg>
    </div>
  );
}

export { ScoreCard, ScoreGauge };

export default function Optimize() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const [resumeContent, setResumeContent] = useState("");
  const [resumeName, setResumeName] = useState<{ first?: string; last?: string } | null>(null);
  const [jobInput, setJobInput] = useState("");
  const [jobMode, setJobMode] = useState<"url" | "text">("url");
  const [stage, setStage] = useState<Stage>("landing");
  const [result, setResult] = useState<api.OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedJob, setParsedJob] = useState<api.JobPostingOut | null>(null);
  const [_isParsingJob, _setIsParsingJob] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [preScores, setPreScores] = useState<api.AnalyzeResponse | null>(null);
  const [_isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState("");
  const [aggressiveTailoring, setAggressiveTailoring] = useState(false);
  const [isImprovingMore, setIsImprovingMore] = useState(false);
  const [resumeSummaryFromApi, setResumeSummaryFromApi] = useState<api.ExtractResumeSummaryResponse | null>(null);
  const [isExtractingSummary, setIsExtractingSummary] = useState(false);
  const [isFetchingJobUrl, _setIsFetchingJobUrl] = useState(false);
  const [resumeInputMode, setResumeInputMode] = useState<"file" | "text">("file");
  const [resumeSourceWasPdf, setResumeSourceWasPdf] = useState(false);
  const [offerPasteAsText, setOfferPasteAsText] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [lastUploadedPdfFile, setLastUploadedPdfFile] = useState<File | null>(null);
  const [resultsViewMode, setResultsViewMode] = useState<"main" | "additional">("main");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const step2SectionRef = useRef<HTMLDivElement>(null);
  const prevHadResumeRef = useRef(false);
  const claimedPendingRef = useRef<string | null>(null);

  // Claim pending landing upload after login: подставляем резюме и вакансию и запускаем анализ
  const pendingToken = searchParams.get("pending");
  useEffect(() => {
    if (!pendingToken || !user || user.id === "local" || claimedPendingRef.current === pendingToken) return;
    claimedPendingRef.current = pendingToken;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("pending");
      return next;
    }, { replace: true });
    api
      .claimLandingPending(pendingToken)
      .then((data) => {
        setResumeContent(data.resume_content);
        setUploadedFileName(data.resume_filename);
        if (data.job_url) {
          setJobInput(data.job_url);
          setJobMode("url");
        } else if (data.job_text) {
          setJobInput(data.job_text);
          setJobMode("text");
        }
        setResult(null);
        setError(null);
        setStage("scanning");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t("optimize.claimError"));
        claimedPendingRef.current = null;
      });
  }, [pendingToken, user, setSearchParams]);

  // Редирект с главной после загрузки файла — сразу шаг 2 (файл уже есть)
  useEffect(() => {
    const state = location.state as { resumeContent?: string; uploadedFileName?: string; sourceWasPdf?: boolean } | null;
    if (state?.resumeContent != null && state.resumeContent !== "") {
      setResumeContent(state.resumeContent);
      setUploadedFileName(state.uploadedFileName ?? null);
      setResumeSourceWasPdf(state.sourceWasPdf ?? false);
      setStage("idle");
      setResult(null);
      setResumeName(null);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const hasResume = !!resumeContent.trim();
  const hasJob = !!jobInput.trim();
  const canImprove = hasResume && hasJob && stage === "assessment" && result === null;

  // Сброс при неполных данных
  useEffect(() => {
    if (!hasResume || !hasJob) {
      if (stage !== "landing" && stage !== "idle") {
        setStage("idle");
      }
    }
  }, [hasResume, hasJob, stage]);

  // После загрузки файла резюме — сразу прокрутить к шагу 2
  useEffect(() => {
    if (hasResume && uploadedFileName && !prevHadResumeRef.current) {
      step2SectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevHadResumeRef.current = hasResume;
  }, [hasResume, uploadedFileName]);

  // Сброс структурированного резюме при очистке контента
  useEffect(() => {
    if (!resumeContent.trim()) setResumeSummaryFromApi(null);
  }, [resumeContent]);

  // Прокрутка к полю вакансии при показе подсказки «вставьте текстом»
  useEffect(() => {
    if (offerPasteAsText) step2SectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [offerPasteAsText]);

  // Извлечение структуры резюме через LLM (имя, должность, навыки)
  useEffect(() => {
    const text = resumeContent.trim();
    if (text.length < 80) return;
    const t = setTimeout(() => {
      setIsExtractingSummary(true);
      api
        .extractResumeSummary(text)
        .then(setResumeSummaryFromApi)
        .catch(() => setResumeSummaryFromApi(null))
        .finally(() => setIsExtractingSummary(false));
    }, 700);
    return () => clearTimeout(t);
  }, [resumeContent]);

  // Парсинг вакансии не вызываем до старта анализа — он выполняется внутри /analyze и результат приходит в data.job (экономия токенов).

  // На этапе «Сканирование» — прогресс 0→100% и переход в «Оценка» (отдельный эффект, чтобы интервал не сбрасывался при ре-рендере)
  const SCAN_DURATION_MS = 1800;
  const SCAN_TICK_MS = 80;
  useEffect(() => {
    if (stage !== "scanning") return;
    setScanProgress(0);
    const step = (100 * SCAN_TICK_MS) / SCAN_DURATION_MS;
    const interval = setInterval(() => {
      setScanProgress((p) => {
        const next = p + step;
        return next >= 100 ? 100 : next;
      });
    }, SCAN_TICK_MS);
    const t = setTimeout(() => {
      clearInterval(interval);
      setScanProgress(100);
      setStage("assessment");
    }, SCAN_DURATION_MS);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [stage]);

  // Запуск анализа сразу при входе в «Сканирование»; при размонтировании (перезагрузка) — не обновляем state
  const analyzeMountedRef = useRef(true);
  useEffect(() => {
    analyzeMountedRef.current = true;
    return () => {
      analyzeMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (stage !== "scanning" || !hasResume || !hasJob || result != null) return;
    setIsAnalyzing(true);
    setPreScores(null);
    const jobPayload = jobMode === "text" ? { job_text: jobInput.trim() } : { job_url: jobInput.trim() };
    api
      .analyze({ resume_content: resumeContent.trim(), ...jobPayload })
      .then((data) => {
        if (!analyzeMountedRef.current) return;
        setPreScores(data);
        if (data.job) setParsedJob(data.job);
        void refreshUser();
      })
      .catch((e) => {
        if (!analyzeMountedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!isOfferPasteAsTextError(msg)) setError(msg);
        setPreScores(null);
        if (isOfferPasteAsTextError(msg)) {
          setError(null);
          setStage("idle");
          setJobMode("text");
          setJobInput("");
          setParsedJob(null);
          setOfferPasteAsText(true);
        }
      })
      .finally(() => {
        if (analyzeMountedRef.current) setIsAnalyzing(false);
      });
  }, [stage, hasResume, hasJob, jobMode, jobInput, resumeContent, result, refreshUser]);

  // После успешного анализа сохранить загруженный PDF в «Мои резюме», если пользователь авторизован
  useEffect(() => {
    if (!preScores || !lastUploadedPdfFile || !user) return;
    const file = lastUploadedPdfFile;
    setLastUploadedPdfFile(null);
    api.registerResumeUpload(file).then(() => void refreshUser()).catch(() => {});
  }, [preScores, lastUploadedPdfFile, user, refreshUser]);

  async function handleResumePaste() {
    if (!resumeContent.trim()) return;
    setError(null);
    try {
      const r = await api.extractName(resumeContent);
      setResumeName({ first: r.first_name ?? undefined, last: r.last_name ?? undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract name");
    }
  }

  async function readResumeFile(file: File) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    const isPdf = ext === "pdf";
    const isDocx = ext === "docx";
    setUploadedFileName(file.name);
    if (isPdf) {
      try {
        const res = await api.parseResumePdf(file);
        setResumeContent(res.content || "");
        setResumeName(null);
        setResult(null);
        setStage("idle");
        setResumeSourceWasPdf(true);
        setLastUploadedPdfFile(file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Не удалось распознать PDF";
        setError(
          msg +
            (msg.includes("500") || msg.includes("NetworkError")
              ? " Запустите бэкенд: uv run uvicorn hr_breaker.api:app --reload --port 8000"
              : "")
        );
      }
      return;
    }
    if (isDocx) {
      setLastUploadedPdfFile(null);
      try {
        const res = await api.parseResumeDocx(file);
        setResumeContent(res.content || "");
        setResumeName(null);
        setResult(null);
        setStage("idle");
        setResumeSourceWasPdf(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Не удалось распознать DOCX";
        setError(
          msg +
            (msg.includes("500") || msg.includes("NetworkError")
              ? " Запустите бэкенд: uv run uvicorn hr_breaker.api:app --reload --port 8000"
              : "")
        );
      }
      return;
    }
    setResumeSourceWasPdf(false);
    setLastUploadedPdfFile(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setResumeContent(text);
      setResumeName(null);
      setResult(null);
      setStage("idle");
    };
    reader.onerror = () => setError(t("home.readFileError"));
    reader.readAsText(file, "UTF-8");
  }
  function getUploadedFileExt(): "pdf" | "docx" | "text" | null {
    if (!uploadedFileName) return null;
    const ext = uploadedFileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "pdf";
    if (ext === "docx" || ext === "doc") return "docx";
    return "text";
  }

  function handleResumeFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void readResumeFile(file);
    e.target.value = "";
  }

  function handleResumeDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    const allowed = [...RESUME_TEXT_EXTS];
    if (!ext || !allowed.includes(ext)) {
      setError("Supported formats: .txt, .md, .html, .tex, .pdf, .doc, .docx");
      return;
    }
    void readResumeFile(file);
  }

  function handleResumeDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function handleResumeDragLeave() {
    setIsDragging(false);
  }

  function handleStartScan() {
    if (!hasResume || !hasJob) return;
    setStage("scanning");
  }

  async function handleImprove() {
    if (!canImprove) return;
    setError(null);
    setStage("loading");
    setLoadProgress(0);
    setLoadMessage("Старт…");
    const params = {
      resume_content: resumeContent.trim(),
      job_text: jobMode === "text" ? jobInput.trim() : undefined,
      job_url: jobMode === "url" ? jobInput.trim() : undefined,
      parallel: true,
      aggressive_tailoring: aggressiveTailoring,
      pre_ats_score: preScores?.ats_score ?? undefined,
      pre_keyword_score: preScores?.keyword_score ?? undefined,
      source_was_pdf: resumeSourceWasPdf,
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent, message) => {
          setLoadProgress(percent);
          setLoadMessage(message);
        });
      } catch (streamErr) {
        setLoadMessage("Ожидание ответа…");
        res = await api.optimize(params);
      }
      setResult(res);
      setLoadProgress(100);
      setLoadMessage("Готово");
      if (res.error && isOfferPasteAsTextError(res.error)) {
        setError(null);
        setStage("assessment");
        setJobMode("text");
        setJobInput("");
        setParsedJob(null);
        setOfferPasteAsText(true);
      } else {
        setStage("result");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Optimization failed";
      if (!isOfferPasteAsTextError(msg)) setError(msg);
      setLoadProgress(100);
      setLoadMessage("");
      setStage("assessment");
      if (isOfferPasteAsTextError(msg)) {
        setError(null);
        setJobMode("text");
        setJobInput("");
        setParsedJob(null);
        setOfferPasteAsText(true);
      }
    }
  }

  async function handleImproveMore() {
    if (!result || !hasResume || !hasJob) return;
    setError(null);
    setIsImprovingMore(true);
    setStage("loading");
    setLoadProgress(0);
    setLoadMessage("Making your resume even better…");
    const improvedContent = result.optimized_resume_text?.trim() || resumeContent.trim();
    const params = {
      resume_content: improvedContent,
      job_text: jobMode === "text" ? jobInput.trim() : undefined,
      job_url: jobMode === "url" ? jobInput.trim() : undefined,
      parallel: true,
      aggressive_tailoring: true,
      max_iterations: 1,
      pre_ats_score: preScores?.ats_score ?? undefined,
      pre_keyword_score: preScores?.keyword_score ?? undefined,
      source_was_pdf: resumeSourceWasPdf,
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent, message) => {
          setLoadProgress(percent);
          setLoadMessage(message);
        });
      } catch {
        setLoadMessage("Ожидание ответа…");
        res = await api.optimize(params);
      }
      setResult(res);
      setLoadProgress(100);
      setLoadMessage("Готово");
      setStage("result");
      await refreshUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
      setStage("result");
    } finally {
      setIsImprovingMore(false);
    }
  }

  const atsValue = result ? getAtsScore(result) : null;
  const keywordsValue = result ? getKeywordsScore(result) : null;
  const showImproveMore =
    result &&
    !result.error &&
    ((atsValue != null && atsValue < 85) ||
      (keywordsValue != null && Math.round(keywordsValue.score * 100) < 85));

  const showSummaryBlocks = (stage === "assessment" && preScores != null) || stage === "result";

  const summaryData = showSummaryBlocks
    ? (() => {
        const resumeSummary = getResumeSummary(resumeContent, resumeName);
        const atsPct = result && atsValue != null ? atsValue : preScores?.ats_score ?? 0;
        const kwPct = result && keywordsValue != null ? Math.round(keywordsValue.score * 100) : preScores != null ? Math.round(preScores.keyword_score * 100) : 0;
        const atsCat = result && atsValue != null ? getAtsCategory(atsValue) : preScores != null ? getAtsCategory(preScores.ats_score) : { category: "—", description: "" };
        const kwCat = result && keywordsValue != null ? getKeywordsCategory(Math.round(keywordsValue.score * 100)) : preScores != null ? getKeywordsCategory(Math.round(preScores.keyword_score * 100)) : { category: "—", description: "" };
        const overallPct = Math.round((atsPct + kwPct) / 2);
        const skillsPct = preScores?.skills_score ?? kwPct;
        const experiencePct = preScores?.experience_score ?? atsPct;
        const portfolioPct = preScores?.portfolio_score ?? overallPct;
        const displayName = resumeSummaryFromApi?.full_name?.trim() || resumeSummary.name;
        const displaySpecialty = resumeSummaryFromApi?.specialty?.trim() || resumeSummary.specialty;
        const displaySkills = resumeSummaryFromApi?.skills?.trim() || resumeSummary.skillsLine;
        return { atsPct, kwPct, atsCat, kwCat, overallPct, skillsPct, experiencePct, portfolioPct, displayName, displaySpecialty, displaySkills };
      })()
    : null;

  return (
    <div className="flex flex-col gap-5 h-full min-h-0 overflow-auto">
        {error && !isOfferPasteAsTextError(error) && (
          <div className="flex gap-2 text-sm text-[var(--text-muted)]/90 rounded-xl border border-[#EBEDF5] bg-[#FAFAFC] px-4 py-3 shrink-0" role="alert">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
            <p>{error}</p>
          </div>
        )}

      {showSummaryBlocks && summaryData ? (
        <div className="relative w-full flex-1 min-h-0 flex flex-col">
          {/* Переключатель вида: поверх контента, прижат к правому краю */}
          <div className="absolute top-0 right-0 z-10 flex rounded-xl overflow-hidden border border-[#EBEDF5] bg-white shadow-sm" role="tablist" aria-label="Вариант отображения">
            <button
              type="button"
              role="tab"
              aria-selected={resultsViewMode === "main"}
              onClick={() => setResultsViewMode("main")}
              className={`px-3 py-2 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-1 ${
                resultsViewMode === "main"
                  ? "bg-[#4578FC] text-white"
                  : "bg-white text-[var(--text)] hover:bg-[#F5F6FA] border-r border-[#EBEDF5]"
              }`}
            >
              Основной
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={resultsViewMode === "additional"}
              onClick={() => setResultsViewMode("additional")}
              className={`px-3 py-2 text-[12px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-1 ${
                resultsViewMode === "additional"
                  ? "bg-[#4578FC] text-white"
                  : "bg-white text-[var(--text)] hover:bg-[#F5F6FA]"
              }`}
            >
              Дополнительный
            </button>
          </div>

          {resultsViewMode === "main" ? (
        /* Единая сетка: результаты после сканирования */
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 w-full flex-1 min-h-0 content-start items-stretch">
          {/* Результаты сканирования */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 flex flex-col gap-0 min-h-0 relative">
            {(() => {
              const desc = [getAtsCategory(summaryData.atsPct).description, getKeywordsCategory(summaryData.kwPct).description].filter(Boolean).join(" ");
              const is90Rejection = /90%|отказ\s*—\s*90|90\s*%/.test(desc);
              return is90Rejection ? (
                <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                  Отказ гарантирован
                </span>
              ) : null;
            })()}
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1.5">
              Результаты сканирования
            </p>
            <div className="rounded-lg bg-[#F5F6FA] px-2.5 py-2 min-w-0">
              <p className="text-[11px] leading-snug text-[var(--text-tertiary)] min-w-0">
                {[getAtsCategory(summaryData.atsPct).description, getKeywordsCategory(summaryData.kwPct).description].filter(Boolean).join(" ")}
              </p>
            </div>
          </div>
          {/* ATS + Ключевые слова + Общий балл + Skills / Experience / Portfolio */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 flex flex-col gap-2.5 min-h-0 min-w-0">
            <div className="flex flex-col sm:flex-row gap-3 min-h-0 min-w-0">
              <div className="flex flex-col sm:flex-row items-stretch gap-3 min-w-0 flex-1">
                <div className="flex flex-col gap-1 min-w-0 flex-1 min-h-0">
                  <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">ATS match</p>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CircleScore percent={summaryData.atsPct} size={44} />
                    <div className="flex flex-col gap-0 min-w-0">
                      <p className="text-lg font-bold text-[#181819] tabular-nums">{Math.round(summaryData.atsPct)}%</p>
                      <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">{summaryData.atsCat.category}</p>
                    </div>
                  </div>
                </div>
                <div className="hidden sm:block w-px self-stretch bg-[#EBEDF5] shrink-0 min-h-[40px]" aria-hidden />
                <div className="flex flex-col gap-1 min-w-0 flex-1 min-h-0">
                  <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">Ключевые слова</p>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CircleScore percent={summaryData.kwPct} size={44} />
                    <div className="flex flex-col gap-0 min-w-0">
                      <p className="text-lg font-bold text-[#181819] tabular-nums">{Math.round(summaryData.kwPct)}%</p>
                      <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">{summaryData.kwCat.category}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden sm:block w-px self-stretch bg-[#EBEDF5] shrink-0 min-h-[40px]" aria-hidden />
              <div className="flex flex-col gap-1 min-w-0 shrink-0 sm:w-[160px]">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">Общий балл match</p>
                <div className="flex items-center gap-2.5 min-w-0 w-full">
                  <CircleScore percent={summaryData.overallPct} size={40} />
                  <div className="flex flex-col gap-0 min-w-0">
                    <p className="text-lg font-bold text-[#181819] tabular-nums">{summaryData.overallPct}%</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
                      {summaryData.overallPct <= 55 ? "Высокий риск отказа" : summaryData.overallPct <= 75 ? "Средние шансы на скрининг" : "Высокие шансы прохождения"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-[#EBEDF5] pt-2" role="separator" />
            <div className="flex flex-row items-end gap-3">
              <BarScoreRow label="Skills" percent={summaryData.skillsPct} compact />
              <BarScoreRow label="Experience" percent={summaryData.experiencePct} compact />
              <BarScoreRow label="Portfolio" percent={summaryData.portfolioPct} compact />
            </div>
          </div>
          {/* Расшифровка резюме */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 flex flex-col gap-0 min-h-0 min-w-0 overflow-auto" aria-label={t("optimize.resumeBreakdown")}>
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-2">
              {t("optimize.resumeBreakdown")}
            </p>
            <ResumePreviewContent
              rawContent={resumeContent}
              name={summaryData.displayName}
              specialty={summaryData.displaySpecialty}
              skills={summaryData.displaySkills}
              isExtracting={isExtractingSummary && !resumeSummaryFromApi}
            />
          </div>
          {/* Нижняя секция, ряд 2: Рекомендации + Режим улучшения + кнопка + результат */}
          <div className="flex flex-col gap-3 min-h-0 min-w-0 overflow-auto">
            {stage === "assessment" && (
              <>
                {preScores?.recommendations && (() => {
                  const toShow = preScores.recommendations.filter(
                    (rec) => !rec.labels.every((l) => l === "В порядке")
                  );
                  return toShow.length > 0 ? (
                    <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 shrink-0">
                      <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-2">
                        Рекомендации по улучшению
                      </p>
                      <ul className="space-y-2">
                        {toShow.map((rec, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                            <span className="font-medium text-[#181819] shrink-0">{rec.category}</span>
                            <span className="text-[var(--text-tertiary)] shrink-0">—</span>
                            <span className="flex flex-wrap gap-1.5">
                              {rec.labels.map((label, j) => (
                                <span
                                  key={j}
                                  className={
                                    rec.category === "Ключевые слова" || label.length <= 25
                                      ? "inline-flex items-center rounded-full bg-[#F5F6FA] text-[var(--text)] px-2 py-0.5 text-[11px] font-medium"
                                      : "text-[var(--text)]"
                                  }
                                >
                                  {label}
                                </span>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
                <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 space-y-3 shrink-0">
                  <RadioGroup
                      value={aggressiveTailoring ? "strict" : "soft"}
                      onChange={(v) => setAggressiveTailoring(v === "strict")}
                      className="space-y-2"
                    >
                      <RadioGroup.Label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                        Автоматическое улучшение
                      </RadioGroup.Label>
                      <div className="grid grid-cols-2 gap-2">
                        <RadioGroup.Option value="soft" className="rounded-xl outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                          {({ checked }) => (
                            <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
                              <span className="text-[13px] font-medium text-[#181819]">Мягкое</span>
                              <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">{t("optimize.softDesc")}</span>
                            </div>
                          )}
                        </RadioGroup.Option>
                        <RadioGroup.Option value="strict" className="rounded-lg outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                          {({ checked }) => (
                            <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
                              <span className="text-[13px] font-medium text-[#181819]">Жёсткое</span>
                              <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">Может добавить навыки из вакансии</span>
                            </div>
                          )}
                        </RadioGroup.Option>
                      </div>
                      <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                        {aggressiveTailoring ? t("optimize.addSkillsNote") : t("optimize.softOnlyNote")}
                      </p>
                      {aggressiveTailoring && (
                        <p className="text-[11px] text-[var(--text-tertiary)] font-medium">Резюме может быть дополнено навыками из вакансии. Проверьте перед отправкой.</p>
                      )}
                    </RadioGroup>
                    <button
                      type="button"
                      onClick={handleImprove}
                      disabled={!canImprove}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[13px] font-semibold text-white bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <SparklesIcon className="w-5 h-5 shrink-0" />
                      {t("optimize.improveResume")}
                    </button>
                </div>
              </>
            )}
            {stage === "result" && result && (
              <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-6 space-y-4">
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Результат</h2>
                  {result.error ? <p className="text-base font-medium text-[var(--text-tertiary)]">Ошибка</p> : <p className="text-base font-medium text-[#181819]" role="status">Готово.</p>}
                </header>
                {result.error ? (
                  <p className="text-sm text-[var(--text-tertiary)] whitespace-pre-wrap">{result.error}</p>
                ) : (
                  <>
                    <p className="text-[13px] text-[var(--text-muted)] mb-2">
                      Режим оптимизации: <span className="font-medium text-[#181819]">{aggressiveTailoring ? "Жёсткий" : "Мягкий"}</span>
                    </p>
                {result.pdf_filename && result.pdf_base64 && (
                  <section aria-label={t("optimize.downloadResume")} className="flex flex-wrap items-center gap-2">
                    <a href={`data:application/pdf;base64,${result.pdf_base64}`} download={result.pdf_filename} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#181819] text-sm font-medium hover:opacity-95 transition-opacity" style={{ background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)" }}>
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      Скачать PDF
                    </a>
                    {showImproveMore && (
                      <button type="button" onClick={handleImproveMore} disabled={isImprovingMore} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F5F6FA] text-[#181819] text-sm font-medium hover:bg-[#EBEDF5] transition-colors disabled:opacity-50">
                        {isImprovingMore ? "Улучшаем…" : "Улучшить ещё больше"}
                      </button>
                    )}
                  </section>
                )}
                {result.success && !result.pdf_base64 && (
                  <p className="text-sm text-[var(--text-muted)]">
                    Оптимизация выполнена. <Link to="/upgrade" className="text-[#4578FC] font-medium hover:underline">Оформите подписку</Link>, чтобы скачать PDF.
                  </p>
                )}
                    {result.key_changes && result.key_changes.length > 0 && (
                      <section className="pt-3 border-t border-[#EBEDF5]" aria-labelledby="key-changes-heading">
                        <h3 id="key-changes-heading" className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Ключевые изменения</h3>
                        <div className="space-y-3">
                          {result.key_changes.map((group, idx) => (
                            <div key={idx} className="space-y-1.5">
                              <p className="text-[13px] font-semibold text-[#181819]">{group.category}</p>
                              {group.description && <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{group.description}</p>}
                              {group.items.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {group.items.map((item, i) => (
                                    <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium text-[#181819] bg-[#F5F6FA]">{item}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {result.validation.results.length > 0 && (
                      <section className="pt-3 border-t border-[#EBEDF5]" aria-labelledby="filter-details-heading">
                        <Disclosure>
                          <DisclosureButton id="filter-details-heading" className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[#181819]">Детали проверок</DisclosureButton>
                          <DisclosurePanel className="mt-2 space-y-1.5">
                            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed mb-2">
                              Внутренние проверки ATS: для каждой — ваша оценка (слева) и порог прохождения (справа). ✓ — проверка пройдена, ✗ — не пройдена.
                            </p>
                            <ul className="space-y-2" role="list">
                              {result.validation.results.map((r) => (
                                <li key={r.filter_name} className="flex flex-wrap items-center gap-2 text-[13px]">
                                  <span className={r.passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{r.passed ? "✓" : "✗"} {r.filter_name}</span>
                                  <span className="text-[var(--text-tertiary)] tabular-nums">{r.score.toFixed(2)} / {r.threshold.toFixed(2)}</span>
                                </li>
                              ))}
                            </ul>
                          </DisclosurePanel>
                        </Disclosure>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
          ) : (
          /* Дополнительный вид: Assessment + Skill Gap + Расшифровка + Улучшение */
          <AdditionalResultsView
            summaryData={summaryData}
            preScores={preScores}
            stage={stage}
            aggressiveTailoring={aggressiveTailoring}
            setAggressiveTailoring={setAggressiveTailoring}
            onImprove={handleImprove}
            canImprove={canImprove}
            result={result}
            showImproveMore={!!showImproveMore}
            isImprovingMore={isImprovingMore}
            onImproveMore={handleImproveMore}
          />
          )}
        </div>
      ) : stage === "landing" ? (
        <div className="flex-1 flex flex-col items-center justify-center pt-2 pb-12 px-6 w-full max-w-5xl mx-auto min-h-0 overflow-auto">
          {/* Top Illustration (cropped to hide text from image) */}
          <div className="w-full relative flex justify-center overflow-hidden mb-8 rounded-[32px]" style={{ maxHeight: "480px" }}>
            <img 
              src="/assets/landing-hero.png" 
              alt="" 
              className="w-full max-w-[900px] h-auto object-cover object-top" 
            />
          </div>
          
          {/* Text Content */}
          <div className="text-center max-w-2xl mx-auto space-y-5 px-4">
            <h1 className="text-3xl md:text-[40px] leading-tight font-bold text-[#141b34] tracking-tight">
              Get expert feedback on your resume
            </h1>
            <p className="text-base md:text-[17px] text-[#5b657e] leading-relaxed">
              Get an instant AI-powered score for your resume and personalized tips to make it stand out and land more interviews.
            </p>
          </div>

          {/* Action Button */}
          <div className="mt-8 mb-4 flex justify-center w-full">
            <button
              type="button"
              onClick={() => setStage("idle")}
              className="bg-[#4558ff] hover:bg-[#3d4deb] text-white px-8 py-3.5 rounded-[14px] text-[16px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-[#4558ff]/50 focus:ring-offset-2 shadow-[0_4px_14px_rgba(69,88,255,0.25)]"
            >
              Check your resume now
            </button>
          </div>
        </div>
      ) : stage === "idle" ? (
        /* Два блока на одной странице: слева Шаг 1 (резюме), справа Шаг 2 (вакансия). Шаг 2 затемнён до загрузки резюме. */
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-4 lg:p-6 max-w-6xl mx-auto w-full items-stretch content-start">
          {/* Шаг 1 — слева */}
          <section className="rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden flex flex-col min-h-0" aria-labelledby="step1-heading">
            <div className="p-6 pb-4 text-center">
              <span className="inline-block rounded-lg border border-[#4578FC] px-3 py-1 text-xs font-medium text-[#4578FC] mb-3">
                {t("optimize.step1")}
              </span>
              <h1 id="step1-heading" className="text-xl font-bold tracking-tight text-[#181819] mb-1">
                {t("optimize.addResume")}
              </h1>
              <p className="text-sm text-[var(--text-tertiary)]">
                {t("optimize.addResumeHint")}
              </p>
            </div>
            <div className="flex-1 flex flex-col min-h-0 px-6 pb-6">
              <input
                ref={fileInputRef}
                type="file"
                accept={RESUME_FILE_ACCEPT}
                className="hidden"
                onChange={handleResumeFileSelect}
                aria-label="Choose resume file"
              />
              <div
                onDragOver={handleResumeDragOver}
                onDragLeave={handleResumeDragLeave}
                onDrop={handleResumeDrop}
                className={`relative rounded-2xl border-2 border-dashed overflow-hidden transition-all duration-200 flex-1 min-h-[200px] flex flex-col ${
                  isDragging ? "border-[#5e8afc]/60" : "border-[#d8dce8]"
                }`}
                style={{
                  background: isDragging
                    ? "linear-gradient(165deg, #e8eeff 0%, #f0f4ff 50%, #e0e8fc 100%)"
                    : "linear-gradient(165deg, #f8fafc 0%, #f0f4ff 40%, #e8eef8 100%)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-40 pointer-events-none"
                  style={{
                    backgroundImage: `
                      linear-gradient(to right, rgba(69,120,252,0.08) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(69,120,252,0.08) 1px, transparent 1px)
                    `,
                    backgroundSize: "20px 20px",
                    maskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 0%, transparent 70%)",
                    WebkitMaskImage: "radial-gradient(ellipse 75% 75% at 50% 50%, black 0%, transparent 70%)",
                  }}
                  aria-hidden
                />
                <div className="relative p-6 flex flex-col items-center gap-4 flex-1 justify-center">
                  <div className="rounded-full bg-white/90 border border-[#4578FC]/20 p-3 shadow-sm" aria-hidden>
                    <ArrowUpTrayIcon className="w-8 h-8 text-[#4578FC]" />
                  </div>
                  <p className="text-sm font-bold text-[#181819] uppercase tracking-wide">
                    {t("optimize.dragHere")}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {t("optimize.orFormats")}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setResumeInputMode("file"); fileInputRef.current?.click(); }}
                      className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/50 focus:ring-offset-2 ${
                        resumeInputMode === "file"
                          ? "bg-[#4578FC]/15 text-[#4578FC] border border-[#4578FC]/50 hover:bg-[#4578FC]/25"
                          : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[#F5F6FA]"
                      }`}
                    >
                      <ArrowUpTrayIcon className="w-4 h-4 shrink-0" aria-hidden />
                      Файл
                    </button>
                    <button
                      type="button"
                      onClick={() => { setResumeInputMode("text"); setResumeSourceWasPdf(false); }}
                      className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 ${
                        resumeInputMode === "text"
                          ? "bg-[#d4f090]/60 text-[#181819] border border-[#b8d86a] hover:bg-[#d4f090]/80"
                          : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[#F5F6FA]"
                      }`}
                    >
                      <ClipboardDocumentIcon className="w-4 h-4 shrink-0" aria-hidden />
                      Текст
                    </button>
                  </div>
                  {resumeInputMode === "text" && (
                    <textarea
                      value={resumeContent}
                      onChange={(e) => setResumeContent(e.target.value)}
                      onBlur={handleResumePaste}
                      placeholder={t("optimize.jobTextPlaceholder")}
                      className="w-full min-h-[5rem] max-w-md rounded-xl border border-[#c8cddc] bg-white/80 px-3 py-2.5 text-sm text-[#181819] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:border-[#4578FC]/50 resize-none"
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Шаг 2 — справа; затемнён и неактивен, пока нет резюме */}
          <section
            ref={step2SectionRef}
            className={`relative rounded-2xl border border-[#EBEDF5] bg-white overflow-hidden flex flex-col min-h-0 transition-all duration-200 ${
              !hasResume ? "opacity-60 pointer-events-none select-none" : ""
            }`}
            aria-labelledby="step2-heading"
            aria-disabled={!hasResume}
          >
            {!hasResume && (
              <div className="absolute inset-0 rounded-2xl bg-[#F2F3F9]/95 flex items-center justify-center z-10" aria-hidden>
                <p className="text-sm font-medium text-[var(--text-muted)] px-4 text-center">
                  {t("optimize.uploadResumeFirst")}
                </p>
              </div>
            )}
            <div className="relative flex-1 flex flex-col min-h-0">
            <div className="p-6 pb-4 text-center">
            <span className="inline-block rounded-lg border border-[#4578FC] px-3 py-1 text-xs font-medium text-[#4578FC] mb-3">
              {t("optimize.step2")}
            </span>
            <h1 id="step2-heading" className="text-xl font-bold tracking-tight text-[#181819] mb-1">
              {t("optimize.addJobTitle")}
            </h1>
            <p className="text-sm text-[var(--text-tertiary)]">
              Ссылка или вставьте описание вручную
            </p>
            </div>
            <div className="rounded-2xl border border-[#EBEDF5] bg-[#FAFAFC] overflow-hidden text-left mx-6 mb-6 flex-1 min-h-0 flex flex-col">
              <div className="p-5 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center gap-2 mb-4 min-w-0" role="group" aria-label="Загруженный файл резюме">
                {getUploadedFileExt() === "pdf" && (
                  <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#dc2626]/10" title="PDF">
                    <DocumentTextIcon className="w-3.5 h-3.5 text-[#dc2626]" aria-hidden />
                  </span>
                )}
                {getUploadedFileExt() === "docx" && (
                  <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#2563eb]/10" title="Word">
                    <DocumentTextIcon className="w-3.5 h-3.5 text-[#2563eb]" aria-hidden />
                  </span>
                )}
                {getUploadedFileExt() === "text" && (
                  <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#EBEDF5]" title="Текст">
                    <ClipboardDocumentIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" aria-hidden />
                  </span>
                )}
                {!getUploadedFileExt() && (
                  <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#EBEDF5]" aria-hidden>
                    <DocumentTextIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  </span>
                )}
                <strong className="text-sm font-semibold text-[#181819] truncate min-w-0 max-w-[50vw]" title={uploadedFileName ?? undefined}>
                  {uploadedFileName ?? (resumeName ? `${resumeName.first ?? ""} ${resumeName.last ?? ""}`.trim() || "Загружено" : "Загружено")}
                </strong>
              </div>
              {hasJob ? (
                <>
                  <div className="flex items-center gap-2 mb-3 min-w-0" role="group" aria-label="Вакансия">
                    <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#4578FC]/12" title={t("optimize.jobLinkPlaceholder")}>
                      <BriefcaseIcon className="w-3.5 h-3.5 text-[#4578FC]" aria-hidden />
                    </span>
                    <strong className="text-sm font-semibold text-[#181819] truncate min-w-0 max-w-[50vw]" title={jobInput.trim()}>
                      {jobMode === "url" ? jobInput.trim() : jobInput.trim().slice(0, 60) + (jobInput.trim().length > 60 ? "…" : "")}
                    </strong>
                    <button
                      type="button"
                      onClick={() => {
                        setJobInput("");
                        setParsedJob(null);
                        setResult(null);
                        setStage("idle");
                      }}
                      className="group shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/20 focus:ring-offset-1 rounded px-1.5 py-0.5 transition-colors"
                    >
                      <ArrowPathIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      Изменить
                    </button>
                  </div>
                  {(() => {
                    const hasStructured = parsedJob && (parsedJob.title || parsedJob.company || parsedJob.requirements?.length || parsedJob.description);
                    const isPreviewLoading = jobMode === "url" && isFetchingJobUrl;
                    if (isPreviewLoading) {
                      return (
                        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full pl-6">
                          <p className="text-xs text-[var(--text-tertiary)] min-w-0">{t("optimize.loadingJob")}</p>
                          <span className="absolute left-0 top-2 h-4 w-4 border-2 border-[#EBEDF5] border-t-[#4578FC] rounded-full animate-spin sm:static sm:order-last" aria-hidden />
                        </div>
                      );
                    }
                    if (jobMode === "url" && !hasStructured) {
                      return (
                        <p className="text-xs text-[var(--text-tertiary)]">Предпросмотр появится после загрузки вакансии</p>
                      );
                    }
                    return (
                      <JobPreviewContent parsedJob={parsedJob} rawText={jobInput} isParsing={false} />
                    );
                  })()}
                  {stage === "idle" && (
                    <div className="mt-5 pt-4 border-t border-[#EBEDF5]">
                      <button
                        type="button"
                        onClick={handleStartScan}
                        className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3.5 px-5 text-sm font-semibold bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
                      >
                        <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
                        Проверить соответствие
                      </button>
                      <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">
                        {t("optimize.willStartScan")}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-[#EBEDF5] bg-[#F5F6FA] p-5 space-y-5">
                  {offerPasteAsText && (
                    <div id="paste-job-hint" className="flex gap-2 text-sm text-[var(--text-muted)]/90" role="status" aria-live="polite">
                      <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
                      <p>
                        Упс, ссылку с этого ресурса не удалось обработать. Скопируйте текст вакансии со страницы целиком — от названия должности до конца — и вставьте в поле ниже.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-sm text-[var(--text-muted)] font-medium">{t("optimize.howToAddJob")}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => { setJobMode("url"); setOfferPasteAsText(false); }}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#F5F6FA] ${
                          jobMode === "url"
                            ? "bg-[#4578FC]/12 text-[#4578FC] hover:bg-[#4578FC]/18"
                            : "bg-[#EBEDF5] text-[#181819] hover:bg-[#E0E4EE]"
                        }`}
                        title={t("optimize.pasteJobLinkTitle")}
                      >
                        <LinkIcon className="w-4 h-4 shrink-0" aria-hidden />
                        URL
                      </button>
                      <button
                        type="button"
                        onClick={() => { setJobMode("text"); setOfferPasteAsText(false); }}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#F5F6FA] ${
                          jobMode === "text"
                            ? "bg-[#4578FC]/12 text-[#4578FC] hover:bg-[#4578FC]/18"
                            : "bg-[#EBEDF5] text-[#181819] hover:bg-[#E0E4EE]"
                        }`}
                        title={t("optimize.pasteJobTextTitle")}
                      >
                        <ClipboardDocumentIcon className="w-4 h-4 shrink-0" aria-hidden />
                        Текст
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {jobMode === "url" && (
                      <p className="text-sm text-[var(--text-tertiary)]">
                        Ссылка на страницу вакансии — загрузим и разберём описание.
                      </p>
                    )}
                    <textarea
                      value={jobInput}
                      onChange={(e) => {
                        setJobInput(e.target.value);
                        if (e.target.value.trim().length > 100) setOfferPasteAsText(false);
                      }}
                      placeholder={jobMode === "url" ? "https://…" : "Скопируйте текст со страницы вакансии (должность, требования, описание) и вставьте сюда."}
                    className="w-full min-h-[7rem] rounded-xl border border-[#EBEDF5] bg-white px-4 py-3 text-sm text-[#181819] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25 focus:border-[#4578FC]/40 resize-none"
                      aria-describedby={offerPasteAsText ? "paste-job-hint" : undefined}
                    />
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
          </section>
        </div>
      ) : (
      <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-auto">
        {(stage === "scanning" || stage === "loading" || stage === "assessment" || stage === "result") && hasResume && hasJob && (
          <>
            {(stage === "scanning" || (stage === "assessment" && preScores == null)) && (
              <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-8 flex flex-col items-center justify-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-[#EBEDF5] flex items-center justify-center" aria-hidden>
                  {stage === "scanning" ? (
                    <SparklesIcon className="w-7 h-7 text-[#4578FC] animate-pulse" />
                  ) : (
                    <span
                      className="inline-block w-8 h-8 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin"
                      aria-hidden
                    />
                  )}
                </div>
                <p className="text-[#181819] font-medium">
                  {stage === "scanning" ? t("optimize.scanningLabel") : t("optimize.analysisLabel")}
                </p>
                <p className="text-sm text-[var(--text-tertiary)]">
                  {stage === "scanning"
                    ? t("optimize.analyzingResume")
                    : "Получаем оценки ATS и ключевых слов"}
                </p>
                {stage === "scanning" ? (
                  <div className="w-full max-w-xs space-y-2">
                    <div className="h-2 rounded-full bg-[#EBEDF5] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#4578FC] transition-all duration-150 ease-linear"
                        style={{ width: `${Math.round(scanProgress)}%` }}
                        role="progressbar"
                        aria-valuenow={Math.round(scanProgress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Прогресс сканирования"
                      />
                    </div>
                    <p className="text-center text-sm font-medium text-[#181819]">{Math.round(scanProgress)}%</p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-tertiary)]">Ожидание ответа…</p>
                )}
              </div>
            )}

            {stage === "loading" && (
              <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-8 flex flex-col items-center justify-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-[#EBEDF5] flex items-center justify-center" aria-hidden>
                  <span
                    className="inline-block w-8 h-8 border-2 border-[#4578FC] border-t-transparent rounded-full animate-spin"
                    aria-hidden
                  />
                </div>
                <p className="text-[#181819] font-medium">{t("optimize.improvingResume")}</p>
                <p className="text-sm text-[var(--text-muted)] text-center max-w-sm">
                  {loadMessage || "Не закрывайте страницу"}
                </p>
                <div className="w-full max-w-xs space-y-2">
                  <div className="h-2 rounded-full bg-[#EBEDF5] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#4578FC] transition-all duration-300 ease-out"
                      style={{ width: `${Math.round(loadProgress)}%` }}
                      role="progressbar"
                      aria-valuenow={Math.round(loadProgress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Прогресс улучшения"
                    />
                  </div>
                  <p className="text-center text-sm font-medium text-[#181819]">{Math.round(loadProgress)}%</p>
                </div>
              </div>
            )}

            {/* При showSummaryBlocks контент (Режим улучшения + результат) рендерится в сетке выше */}
          </>
        )}

      </div>
      )}
    </div>
  );
}
