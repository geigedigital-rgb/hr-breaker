import { useState, useEffect, useLayoutEffect, useRef, useId, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { SparklesIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, ArrowPathIcon, ArrowLeftIcon, BriefcaseIcon, ClipboardDocumentIcon, ExclamationTriangleIcon, CheckCircleIcon, CheckIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t, tFormat } from "../i18n";
import { storeCheckoutResumePreview } from "../checkoutResumePreview";
import { PipelineVerticalStepCards } from "../components/PipelineVerticalStepCards";
import { OptimizeWorkspace } from "../components/optimize-workspace/OptimizeWorkspace";
import { StylePanel } from "../components/optimize-workspace/StylePanel";
import { resolveWorkspaceAnnotations } from "../components/optimize-workspace/annotationsFromAnalyze";
import {
  beginNewOptimizeWork,
  clearOptimizeWorkSession,
  loadOptimizeWorkSession,
  saveOptimizeWorkSession,
} from "../optimizeWorkSession";

const RESUME_FILE_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf,.doc,.docx";
const RESUME_TEXT_EXTS = ["txt", "md", "html", "htm", "tex", "pdf", "doc", "docx"];

const OPTIMIZE_CHECKOUT_SNAPSHOT_KEY = "pitchcv_optimize_checkout_snapshot_v1";
const OPTIMIZE_PENDING_AUTO_IMPROVE_KEY = "pitchcv_optimize_pending_auto_improve";
const FREE_ANALYSES_PER_MONTH = 10;
const FREE_OPTIMIZES_PER_MONTH = 10;
/** Independent rotation for scan/analyze/improve “Fact” lines (not tied to progress ticks). */
const LOADING_FACT_ROTATE_MS = 15_000;
/** Optimize wall time is typically ~60–80s; loader targets this so the bar does not sprint ahead of reality. */
const OPTIMIZE_LOAD_TARGET_MS = 72_000;
const OPTIMIZE_LOAD_TICK_MS = 300;
/** Do not show backend “done” percent from SSE until the stream returns (avoids instant 100%). */
const OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE = 98;

/** Backend message when URL is a job search page, not a single job */
const JOB_LIST_URL_MARKER = "job search page";
/** Backend message when scraping failed (Cloudflare etc.) — suggests pasting text */
const SCRAPE_FAILED_PASTE_MARKER = "Paste";

function isOfferPasteAsTextError(msg: string): boolean {
  return msg.includes(JOB_LIST_URL_MARKER) || msg.includes(SCRAPE_FAILED_PASTE_MARKER);
}

/** Shared block: resume thumbnail image. */
function ResumeThumbnailBlock({
  imageUrl,
}: {
  imageUrl: string;
}) {
  return (
    <div className="relative w-full max-w-[240px] flex flex-col items-center pointer-events-auto translate-y-3">
      <div className="w-full rounded-md overflow-hidden border border-[#d1d5db] bg-white shadow-lg flex flex-col relative aspect-[210/297] max-h-[200px]">
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      </div>
    </div>
  );
}

/** PDF resume preview: first page as image from API (same as Home cards). Calls onThumbnailLoaded so parent can keep URL after file is cleared. */
function ResumePdfPreview({
  file,
  onThumbnailLoaded,
}: {
  file: File;
  onThumbnailLoaded?: (url: string) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const urlRef = useRef<string | null>(null);
  const passedToParentRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    passedToParentRef.current = false;
    setError(false);
    setThumbUrl(null);
    api.getResumeThumbnailUrl(file).then((url) => {
      if (!cancelled) {
        urlRef.current = url;
        setThumbUrl(url);
        onThumbnailLoaded?.(url);
        passedToParentRef.current = !!onThumbnailLoaded;
      } else {
        URL.revokeObjectURL(url);
      }
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      if (urlRef.current && !passedToParentRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
      urlRef.current = null;
    };
  }, [file, onThumbnailLoaded]);
  if (error) {
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <p className="text-xs text-[var(--text-muted)]">Preview unavailable</p>
      </div>
    );
  }
  if (!thumbUrl) {
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <div className="w-24 h-32 rounded bg-[#e8eaef] animate-pulse" aria-hidden />
        <span className="text-xs text-[var(--text-muted)]">Loading…</span>
      </div>
    );
  }
  return <ResumeThumbnailBlock imageUrl={thumbUrl} />;
}

/** Document-style skeleton inside the small resume frame (Overall match preview). */
function ResumeFrameSkeleton() {
  return (
    <div
      className="absolute inset-0 z-[1] flex flex-col gap-2 p-2.5 bg-gradient-to-b from-[#f1f5f9] to-[#e8ecf4]"
      aria-hidden
    >
      <div className="h-2 w-[55%] rounded bg-white/80 animate-pulse" />
      <div className="flex-1 min-h-[48px] rounded-md bg-white/45 animate-pulse" />
      <div className="h-2 w-[40%] rounded bg-white/70 animate-pulse mx-auto" />
    </div>
  );
}

/** Preview from history: fetch PNG with Bearer (same as other API calls) — img src alone can miss auth on some setups. */
function ResumeHistoryThumbnailPreview({
  filename,
}: {
  filename: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [failed, setFailed] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDecoded(false);
    setObjectUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const token = api.getStoredToken();
    const url = api.historyThumbnailUrl(filename, token);
    void (async () => {
      try {
        const r = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        if (!blob.type.startsWith("image/")) throw new Error("unexpected");
        if (cancelled) return;
        const u = URL.createObjectURL(blob);
        objectUrlRef.current = u;
        setObjectUrl(u);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [filename]);

  if (failed) {
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <p className="text-xs text-[var(--text-muted)]">Preview unavailable</p>
      </div>
    );
  }
  return (
    <div className="relative w-full max-w-[240px] flex flex-col items-center pointer-events-auto translate-y-3">
      <div className="w-full rounded-md overflow-hidden border border-[#d1d5db] bg-white shadow-lg flex flex-col relative aspect-[210/297] max-h-[200px]">
        {!decoded && <ResumeFrameSkeleton />}
        {objectUrl ? (
          <img
            src={objectUrl}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-200 ${
              decoded ? "opacity-90" : "opacity-0"
            }`}
            onLoad={() => setDecoded(true)}
            onError={() => {
              setFailed(true);
              if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Text resume: document-style sheet peeking from bottom */
function ResumeSheetPreview({ name }: { name: string }) {
  return (
    <div className="relative w-full max-w-[260px] flex flex-col items-center pointer-events-auto translate-y-3">
      <div
        className="w-full rounded-lg border border-[#d1d5db] bg-white shadow-lg py-4 px-4 text-center"
        style={{ boxShadow: "0 4px 14px rgba(0,0,0,0.08)" }}
      >
        <p className="text-base font-bold text-[var(--text)] tracking-tight">{name}</p>
        <div className="mt-2 h-12 bg-[#f5f6f9] rounded mx-2" aria-hidden />
        <div className="mt-1 h-3 bg-[#e8eaef] rounded w-3/4 mx-auto" aria-hidden />
        <div className="mt-1 h-3 bg-[#e8eaef] rounded w-1/2 mx-auto" aria-hidden />
      </div>
    </div>
  );
}

function stripFactPrefix(value: string): string {
  return value.replace(/^Fact:\s*/i, "").trim();
}

function LoaderFactCard({ fact }: { fact: string }) {
  const body = stripFactPrefix(fact);
  if (!body) return null;
  return (
    <p className="mt-4 mx-auto flex max-w-md items-center justify-center gap-2 px-3 text-left">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]/80">
        {t("optimize.quickFactLabel")}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium text-[#475569] sm:text-[14px]">{body}</span>
    </p>
  );
}

/** Loader fills the scrollable main column; no faux full-viewport gradient sheet */
function OptimizePipelineLoader({
  labels,
  subtitles,
  completedSteps,
  fact,
  topHint,
  ariaLabel,
  variant = "main",
  heroVariant = "analysis",
}: {
  labels: readonly string[];
  subtitles?: readonly string[];
  completedSteps: number;
  fact?: string;
  topHint?: string;
  ariaLabel: string;
  variant?: "main" | "overlay";
  heroVariant?: "analysis" | "optimize" | "restore";
}) {
  const heroTitle =
    heroVariant === "optimize"
      ? t("optimize.loaderHeroOptimizeTitle")
      : heroVariant === "restore"
        ? t("optimize.restoringResumeSession")
        : t("optimize.loaderHeroAnalysisTitle");
  const heroDesc =
    heroVariant === "optimize"
      ? t("optimize.loaderHeroOptimizeDesc")
      : heroVariant === "restore"
        ? t("optimize.doNotClosePage")
        : t("optimize.loaderHeroAnalysisDesc");

  return (
    <div
      className={
        variant === "overlay"
          ? "flex h-full min-h-0 w-full flex-col items-center justify-center overflow-y-auto px-4 py-8 text-center"
          : "flex w-full min-h-0 flex-col items-center justify-start overflow-y-auto px-3 py-6 text-center sm:px-4 sm:py-10"
      }
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-4 sm:gap-6">
        {topHint ? (
          <p className="text-[10px] font-medium ds-label">{topHint}</p>
        ) : null}

        <div className="flex flex-col items-center gap-3 px-1">
          <div className="relative">
            <div className="rounded-full bg-white p-3.5 shadow-[0_4px_28px_-14px_rgba(69,120,252,0.45)] ring-1 ring-[#4578FC]/12">
              {heroVariant === "optimize" ? (
                <SparklesIcon className="h-8 w-8 text-[var(--accent)]" aria-hidden />
              ) : (
                <MagnifyingGlassIcon className="h-8 w-8 text-[var(--accent)]" aria-hidden />
              )}
            </div>
            {heroVariant === "analysis" ? (
              <SparklesIcon
                className="pointer-events-none absolute -right-1 -top-1 h-5 w-5 text-violet-400 opacity-95"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="max-w-lg space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-[#0f172a] sm:text-2xl sm:leading-snug">{heroTitle}</h2>
            <p className="text-sm leading-relaxed text-[#64748b] sm:text-[15px]">{heroDesc}</p>
          </div>
        </div>

        <div className="w-full pt-1">
          <PipelineVerticalStepCards labels={labels} subtitles={subtitles} completedSteps={completedSteps} />
        </div>
        {fact ? <LoaderFactCard fact={fact} /> : null}
      </div>
    </div>
  );
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
          <p className="font-bold text-[var(--text)] text-base leading-tight" itemProp="title">{parsedJob!.title || "—"}</p>
          <p className="mt-0.5 font-medium text-[var(--text)] text-[13px]" itemProp="hiringOrganization" itemScope itemType="https://schema.org/Organization">
            <span itemProp="name">{parsedJob!.company || "—"}</span>
          </p>
        </section>
        {parsedJob!.keywords && parsedJob!.keywords.length > 0 && (
          <section>
            <p className="font-semibold text-[var(--text)] text-[13px] mb-1.5">{t("optimize.keywordsSkills")}</p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.keywords.slice(0, 20).join(", ")}
              {parsedJob!.keywords.length > 20 ? " …" : ""}
            </p>
          </section>
        )}
        {parsedJob!.requirements && parsedJob!.requirements.length > 0 && (
          <section>
            <p className="font-semibold text-[var(--text)] text-[13px] mb-1.5">{t("optimize.requirements")}</p>
            <ul className="list-disc list-inside space-y-0.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        {parsedJob!.description && (
          <section itemProp="description">
            <p className="font-semibold text-[var(--text)] text-[13px] mb-1.5">{t("optimize.description")}</p>
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
            {s.title && <p className="font-semibold text-[var(--text)] text-[13px] mb-1.5">{s.title}</p>}
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
          <p key={i} className={i === 0 ? "font-semibold text-[var(--text)] text-sm" : "text-[13px] text-[var(--text-muted)] leading-relaxed"}>
            {block}
          </p>
        ))
      ) : (
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{rawText.slice(0, 800)}{rawText.length > 800 ? "…" : ""}</p>
      )}
    </div>
  );
}

function getAtsScore(result: api.OptimizeResponse): number | null {
  const r = result.validation.results.find((f) => f.filter_name === "LLMChecker");
  return r != null ? normalizeScorePercent(r.score) : null;
}

function getKeywordsScore(result: api.OptimizeResponse): { score: number; threshold: number } | null {
  const r = result.validation.results.find((f) => f.filter_name === "KeywordMatcher");
  return r != null ? { score: r.score, threshold: r.threshold } : null;
}

function getScoreTextColor(pct: number): string {
  if (pct < 55) return "#dc2626";
  if (pct < 75) return "#ca8a04";
  return "#15803d";
}

/** Small circular progress (0–100%) with full 0–100 gradient and gray unrevealed part. */
function CircleScore({ percent, size = 44 }: { percent: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, percent));
  const angle = (pct / 100) * 360;
  const stroke = Math.max(4, Math.round(size * 0.13));
  const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`;
  const unrevealedOverlay =
    pct <= 0
      ? "#E5E7EB"
      : pct >= 100
        ? "transparent"
        : `conic-gradient(from -90deg, transparent 0deg ${angle}deg, #E5E7EB ${angle}deg 360deg)`;
  return (
    <div
      className="relative shrink-0 rounded-full"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: SCORE_GRADIENT,
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: unrevealedOverlay,
          WebkitMaskImage: ringMask,
          maskImage: ringMask,
        }}
      />
    </div>
  );
}

/** One row: label + bar (red→green gradient by %) + percent. Slightly thicker bar. */
const SCORE_GRADIENT = "linear-gradient(90deg, #dc2626 0%, #eab308 50%, #16a34a 100%)";

function BarScoreRow({ label, percent, compact }: { label: string; percent: number; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, percent));
  const fillColor = getScoreTextColor(pct);
  return (
    <div className={compact ? "flex flex-col gap-1 min-w-0 flex-1" : "flex items-center gap-2 w-full min-w-0"}>
      <span className="text-[11px] text-[var(--text)] font-medium shrink-0">{label}</span>
      <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2 w-full min-w-0"}>
        <div className={`${compact ? "flex-1 min-w-[52px]" : "flex-1 min-w-0"} h-2 rounded-full bg-[#E5E7EB] overflow-hidden relative`}>
          <div
            className="absolute inset-0 h-full rounded-full"
            style={{ background: SCORE_GRADIENT }}
          />
          <div
            className="absolute top-0 right-0 h-full bg-[#E5E7EB] transition-all duration-300"
            style={{ width: `${100 - pct}%` }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums shrink-0" style={{ color: fillColor }}>
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Prefer API post scores (same methodology as analyze); fall back to filter scores. */
function resolvePostMatchScores(
  result: api.OptimizeResponse | null,
  filterAts: number | null,
  filterKw: { score: number; threshold: number } | null,
): { atsPct: number | null; kwPct: number | null; overallPct: number | null } {
  if (!result || result.error) {
    return { atsPct: null, kwPct: null, overallPct: null };
  }
  const atsFromApi = normalizeScorePercent(result.post_ats_score ?? null);
  const kwFromApi = normalizeScorePercent(result.post_keyword_score ?? null);
  const atsPct = atsFromApi ?? filterAts;
  const kwPct =
    kwFromApi ??
    (filterKw != null ? normalizeScorePercent(filterKw.score) : null);
  const vals = [atsPct, kwPct].filter((v): v is number => v != null && Number.isFinite(v));
  const overallPct = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return { atsPct, kwPct, overallPct };
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

function normalizeScorePercent(raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  if (raw <= 1) return Math.round(raw * 100);
  return Math.round(raw);
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
    <div className="ds-card !rounded-[var(--radius-md)] p-4 flex flex-col gap-2 min-w-0">
      <p className="text-sm font-semibold text-[var(--text)] uppercase tracking-wider">{title}</p>
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
        <span className="text-sm font-bold text-[var(--text)] shrink-0" aria-hidden>{Math.round(pct)}%</span>
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

export { CircleScore, BarScoreRow, ScoreCard, ScoreGauge };

/** Upsell modal content when monthly free analysis limit is reached. */
function OptimizeFreeLimitWall({
  checkoutError,
  checkoutLoading,
  onEditSetup,
  onStartTrial,
}: {
  checkoutError: string | null;
  checkoutLoading: boolean;
  onEditSetup: () => void;
  onStartTrial: () => void;
}) {
  return (
    <div className="w-full max-w-xl mx-auto space-y-4 rounded-2xl bg-[#FAFAFC] p-4 sm:p-5 shadow-xl border border-[var(--border)]">
      <section
        className="rounded-2xl border border-[#E6E9F5] bg-white p-4 sm:p-5 shadow-sm"
        aria-labelledby="free-limit-heading"
      >
        <div className="min-w-0 space-y-2">
          <h1 id="free-limit-heading" className="text-lg sm:text-xl font-semibold tracking-tight text-[var(--text)]">
            {t("optimize.freeLimitWallTitle")}
          </h1>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            {t("optimize.freeLimitWallSubtitle")}
          </p>
          <button
            type="button"
            onClick={onEditSetup}
            className="text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 rounded"
          >
            {t("optimize.freeLimitWallEditSetup")}
          </button>
        </div>
      </section>

      {checkoutError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {checkoutError}
        </div>
      )}

      <section
        className="ds-card--accent rounded-[var(--radius-lg)] border border-[var(--border)] p-6 sm:p-7 flex flex-col relative overflow-hidden shadow-[var(--shadow-sm)]"
        aria-labelledby="inline-trial-heading"
      >
        <div className="absolute top-0 right-0 rounded-bl-xl bg-[var(--accent)] px-3 py-1.5 text-[10px] font-bold text-white z-10 shadow-sm">
          {t("upgrade.recommended")}
        </div>
        <h2 id="inline-trial-heading" className="relative z-10 text-base font-semibold text-[var(--text)] pr-24">
          {t("upgrade.trialTitle")}
        </h2>
        <p className="relative z-10 mt-2 text-2xl font-bold text-[var(--text)]">{t("upgrade.trialPrice")}</p>
        <p className="relative z-10 mt-1 text-xs font-medium text-[var(--text-muted)]">{t("upgrade.trialDesc")}</p>
        <p className="relative z-10 mt-1.5 text-[11px] leading-snug text-[var(--text-tertiary)] font-medium">
          {t("upgrade.trialAutoRenew")}
        </p>
        <ul className="relative z-10 mt-6 space-y-3 text-sm font-medium text-[var(--text)]">
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <span>{t("upgrade.trialFeature1")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <span>{t("upgrade.trialFeature2")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <span>{t("upgrade.trialFeature3")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <span>{t("upgrade.trialFeature4")}</span>
          </li>
        </ul>
        <div className="relative z-10 mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={checkoutLoading}
            onClick={onStartTrial}
            className="ds-btn-primary flex items-center justify-center w-full !rounded-xl !text-sm !py-3 !px-4 disabled:opacity-70"
          >
            {checkoutLoading ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
          </button>
          <Link
            to="/upgrade"
            className="text-center text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] underline-offset-2 hover:underline"
          >
            {t("optimize.freeLimitWallComparePlans")}
          </Link>
        </div>
        <p className="relative z-10 mt-4 text-[11px] text-[var(--text-tertiary)] text-center leading-snug">
          {t("optimize.freeLimitWallPaymentNote")}
        </p>
      </section>
    </div>
  );
}

/** True on first paint if URL has ?pending= (landing → login → optimize flow). */
function pendingTokenInUrl(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(new URLSearchParams(window.location.search).get("pending"));
}

const MAX_SESSION_PHOTO_CHARS = 700_000;

function sessionPayloadForOptimizeRequest(
  preScores: api.AnalyzeResponse | null,
  photoDataUrl: string | null,
  selectedTemplateId: string,
): {
  session_template_id?: string;
  session_photo_data_url?: string;
  session_analyze?: Record<string, unknown>;
} {
  const out: {
    session_template_id?: string;
    session_photo_data_url?: string;
    session_analyze?: Record<string, unknown>;
  } = {};
  const tid = selectedTemplateId.trim();
  if (tid) out.session_template_id = tid;
  const ph = photoDataUrl?.trim();
  if (ph && ph.length <= MAX_SESSION_PHOTO_CHARS) out.session_photo_data_url = ph;
  if (preScores) {
    try {
      const raw = JSON.parse(JSON.stringify(preScores)) as Record<string, unknown>;
      delete raw.admin_pipeline_log;
      out.session_analyze = raw;
    } catch {
      /* ignore */
    }
  }
  return out;
}

function persistSnapshotJwtFromResponse(res: api.OptimizeResponse) {
  const url = res.snapshot_url?.trim();
  if (!url || typeof window === "undefined" || !res.success) return;
  try {
    const parsed = new URL(url, window.location.origin);
    const tok = parsed.searchParams.get(api.OPTIMIZE_RESUME_QUERY_PARAM);
    if (tok) sessionStorage.setItem(api.OPTIMIZE_LAST_SNAPSHOT_JWT_KEY, tok);
  } catch {
    /* ignore */
  }
}

function jobTextFromSnapshotForResume(job: api.JobPostingOut, jobUrl: string | null | undefined): string {
  const u = (jobUrl || "").trim();
  if (u) return u;
  const parts = [
    job.title,
    job.company,
    ...(job.requirements || []),
    job.description,
  ].filter((x) => (x || "").trim());
  const s = parts.join("\n\n").trim();
  return s || (job.title || "").trim() || "—";
}

function snapshotDataToOptimizeResponse(snap: api.OptimizationSnapshotPublic): api.OptimizeResponse {
  return {
    success: true,
    pdf_base64: null,
    pdf_filename: snap.pdf_download_available ? snap.pdf_filename : null,
    pending_export_token: snap.pending_export_token ?? null,
    pending_export_expires_at: null,
    validation: snap.validation,
    job: snap.job,
    key_changes: snap.key_changes ?? null,
    error: null,
    optimized_resume_text: snap.optimized_resume_text ?? null,
    schema_json: snap.schema_json ?? null,
    snapshot_expires_at: snap.expires_at,
    snapshot_url: null,
    pre_ats_score: snap.pre_ats_score ?? null,
    pre_keyword_score: snap.pre_keyword_score ?? null,
    post_ats_score: snap.post_ats_score ?? null,
    post_keyword_score: snap.post_keyword_score ?? null,
  };
}

export default function Optimize() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading, refreshUser } = useAuth();
  const [resumeContent, setResumeContent] = useState("");
  const [resumeName, setResumeName] = useState<{ first?: string; last?: string } | null>(null);
  const [jobInput, setJobInput] = useState("");
  const [jobMode, setJobMode] = useState<"url" | "text">("text");
  /** Until claim finishes, don't reset stage to idle (avoids hero flash + broken state). */
  const [claimGate, setClaimGate] = useState(pendingTokenInUrl);
  const [stage, setStage] = useState<Stage>(() => (pendingTokenInUrl() ? "scanning" : "landing"));
  const [result, setResult] = useState<api.OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [styleVisited, setStyleVisited] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedJob, setParsedJob] = useState<api.JobPostingOut | null>(null);
  const [_isParsingJob, _setIsParsingJob] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [preScores, setPreScores] = useState<api.AnalyzeResponse | null>(null);
  const [_isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const optimizeLoadStartedAtRef = useRef(0);
  /** Max percent reported by SSE during this run (capped until stream completes). */
  const sseOptimizeCapRef = useRef(0);
  const [displayLoadProgress, setDisplayLoadProgress] = useState(0);
  const [_isImprovingMore, setIsImprovingMore] = useState(false);
  /** After result: full-screen step before clearing session for another vacancy (not a modal). */
  const [postResultFlow, setPostResultFlow] = useState<"main" | "newJobWarning">("main");
  const [optimizePaywallOpen, setOptimizePaywallOpen] = useState(false);
  const [optimizePaywallCheckoutLoading, setOptimizePaywallCheckoutLoading] = useState(false);
  const [optimizePaywallCheckoutError, setOptimizePaywallCheckoutError] = useState<string | null>(null);
  const [pendingPdfDownloadLoading, setPendingPdfDownloadLoading] = useState(false);
  const [pendingAutoImproveAfterCheckout, setPendingAutoImproveAfterCheckout] = useState(false);
  const checkoutSnapshotRestoredRef = useRef(false);
  const workSessionRestoredRef = useRef(false);
  const workSessionSkipPersistRef = useRef(false);
  const autoImproveStartedRef = useRef(false);
  const [loadingHintIndex, setLoadingHintIndex] = useState(0);
  const [analysisPipelineCompleted, setAnalysisPipelineCompleted] = useState(0);
  const [resumeSummaryFromApi, setResumeSummaryFromApi] = useState<api.ExtractResumeSummaryResponse | null>(null);
  const [_isFetchingJobUrl, _setIsFetchingJobUrl] = useState(false);
  const [resumeInputMode, setResumeInputMode] = useState<"file" | "text">("file");
  const [resumeSourceWasPdf, setResumeSourceWasPdf] = useState(false);
  const [offerPasteAsText, setOfferPasteAsText] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [lastUploadedPdfFile, setLastUploadedPdfFile] = useState<File | null>(null);
  /** Keeps thumbnail URL after lastUploadedPdfFile is cleared (e.g. after register), so we still show real image. */
  const [resumeThumbnailUrl, setResumeThumbnailUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Latest blob URL for PDF preview — read in effects without subscribing to re-runs. */
  const resumeThumbnailUrlRef = useRef<string | null>(null);
  resumeThumbnailUrlRef.current = resumeThumbnailUrl;
  const step2SectionRef = useRef<HTMLDivElement>(null);
  const prevHadResumeRef = useRef(false);
  const claimedPendingRef = useRef<string | null>(null);
  const resumeHydratedTokenRef = useRef<string | null>(null);
  const resumeGuestRedirectStartedRef = useRef(false);
  const [resumeBootstrapping, setResumeBootstrapping] = useState(false);
  const [bootstrapPipelineCompleted, setBootstrapPipelineCompleted] = useState(0);
  /** When true, user came from /improve → "Improve my resume" mode (no job required). */
  const [isImproveMode, setIsImproveMode] = useState(false);
  const pipelineAnalysisLabels = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((i) =>
        isImproveMode ? t(`optimize.pipelineAnalysisImprove${i}`) : t(`optimize.pipelineAnalysisTailor${i}`),
      ),
    [isImproveMode],
  );
  const pipelineOptimizeLabels = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((i) =>
        isImproveMode ? t(`optimize.pipelineOptimizeImprove${i}`) : t(`optimize.pipelineOptimizeTailor${i}`),
      ),
    [isImproveMode],
  );
  const pipelineAnalysisSubtitles = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((i) =>
        isImproveMode ? t(`optimize.pipelineAnalysisImprove${i}Sub`) : t(`optimize.pipelineAnalysisTailor${i}Sub`),
      ),
    [isImproveMode],
  );
  const pipelineOptimizeSubtitles = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((i) =>
        isImproveMode ? t(`optimize.pipelineOptimizeImprove${i}Sub`) : t(`optimize.pipelineOptimizeTailor${i}Sub`),
      ),
    [isImproveMode],
  );
  /** When true, auto-start scan immediately after resume+job state is hydrated. */
  const autoStartPendingRef = useRef(false);
  const autoImproveGateRef = useRef<{
    preScores: api.AnalyzeResponse | null;
    resumeContent: string;
    jobInput: string;
    stage: Stage;
  }>({ preScores: null, resumeContent: "", jobInput: "", stage: "landing" });
  const prevStagePipelineRef = useRef<Stage | null>(null);
  const scanSessionStartedAtRef = useRef<number | null>(null);
  const assessEnteredAtRef = useRef<number | null>(null);

  // Clean focus chrome: hide app sidebar from analyze / optimize loaders through workspace
  useEffect(() => {
    const hideChrome =
      stage === "scanning" ||
      stage === "loading" ||
      stage === "assessment" ||
      stage === "result" ||
      resumeBootstrapping ||
      claimGate;
    if (hideChrome) document.body.classList.add("optimize-ws-active");
    else document.body.classList.remove("optimize-ws-active");
    return () => {
      document.body.classList.remove("optimize-ws-active");
    };
  }, [stage, resumeBootstrapping, claimGate]);

  const plan = user?.subscription?.plan || "free";
  const subStatus = user?.subscription?.status || "free";
  const hasPaidPlan = (plan === "trial" || plan === "monthly") && (subStatus === "active" || subStatus === "trial");
  const freeAnalysesCount = user?.subscription?.free_analyses_count || 0;
  const freeOptimizeCount = user?.subscription?.free_optimize_count ?? 0;
  const canAnalyzeSubscription = hasPaidPlan || freeAnalysesCount < FREE_ANALYSES_PER_MONTH;
  const canOptimizeSubscription = user?.id === "local" || hasPaidPlan || freeOptimizeCount < FREE_OPTIMIZES_PER_MONTH;
  /** When true, user closed the free-limit overlay to edit resume/job; compact CTA remains in step 2. */
  const [freeLimitUpsellDismissed, setFreeLimitUpsellDismissed] = useState(false);
  const [freeLimitCheckoutLoading, setFreeLimitCheckoutLoading] = useState(false);
  const [freeLimitCheckoutError, setFreeLimitCheckoutError] = useState<string | null>(null);
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
        const job = (data.job_text || "").trim();
        if (!job) {
          navigate("/improve", {
            replace: true,
            state: {
              resumeContent: data.resume_content,
              uploadedFileName: data.resume_filename,
              originalFileName: data.original_filename || undefined,
              sourceWasPdf: (data.resume_filename || "").toLowerCase().endsWith(".pdf")
                || Boolean(data.original_filename?.toLowerCase().endsWith(".pdf")),
            },
          });
          setClaimGate(false);
          return;
        }
        setResumeContent(data.resume_content);
        setUploadedFileName(data.resume_filename);
        setResumeSourceWasPdf(
          (data.resume_filename || "").toLowerCase().endsWith(".pdf")
            || Boolean(data.original_filename?.toLowerCase().endsWith(".pdf")),
        );
        setJobInput(job);
        setJobMode("text");
        beginNewOptimizeWork();
        setResult(null);
        setError(null);
        setStage("scanning");
        setClaimGate(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t("optimize.claimError"));
        claimedPendingRef.current = null;
        setClaimGate(false);
        setStage("idle");
      });
  }, [pendingToken, user, setSearchParams, navigate]);

  // Email / deep link: ?resume=JWT — full Result UI (same account); guests → login with token in sessionStorage
  const resumeTokenParam = searchParams.get(api.OPTIMIZE_RESUME_QUERY_PARAM);
  useEffect(() => {
    if (!resumeTokenParam) {
      resumeGuestRedirectStartedRef.current = false;
      return;
    }
    if (loading) return;
    if (!user || user.id === "local") {
      if (resumeGuestRedirectStartedRef.current) return;
      resumeGuestRedirectStartedRef.current = true;
      try {
        sessionStorage.setItem(api.OPTIMIZE_RESUME_SESSION_KEY, resumeTokenParam);
      } catch {
        /* ignore */
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
          return next;
        },
        { replace: true },
      );
      navigate("/login", { replace: true });
      return;
    }
    if (resumeHydratedTokenRef.current === resumeTokenParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
          return next;
        },
        { replace: true },
      );
      return;
    }
    let cancelled = false;
    setResumeBootstrapping(true);
    setError(null);
    void (async () => {
      const res = await api.fetchOptimizationSnapshotForMe(resumeTokenParam);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.detail || t("optimize.restoreResumeError"));
        setResumeBootstrapping(false);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
            return next;
          },
          { replace: true },
        );
        return;
      }
      const bundle = res.data;
      if (bundle.kind === "draft" && bundle.draft) {
        const dr = bundle.draft;
        setError(null);
        setResult(null);
        setPostResultFlow("main");
        setLastUploadedPdfFile(null);
        setClaimGate(false);
        setSelectedTemplateId((dr.selected_template_id || "").trim());
        setPhotoDataUrl(null);
        setUploadedFileName(null);
        setResumeSourceWasPdf(false);
        const jobLine = jobTextFromSnapshotForResume(dr.job, dr.job_url);
        setJobInput(jobLine);
        setJobMode((dr.job_url || "").trim() ? "url" : "text");
        setParsedJob(dr.job);
        setResumeContent((dr.resume_content || "").trim());
        if (dr.stage === 1) {
          setPreScores(null);
          setStage("idle");
        } else if (dr.stage === 2) {
          const pre =
            dr.analyze ??
            ({
              ats_score: 0,
              keyword_score: 0,
              keyword_threshold: 0.6,
              job: dr.job,
              recommendations: [],
            } satisfies api.AnalyzeResponse);
          setPreScores(pre);
          setStage("assessment");
        } else {
          setPreScores(null);
          setStage("idle");
        }
        try {
          sessionStorage.setItem(api.OPTIMIZE_LAST_SNAPSHOT_JWT_KEY, resumeTokenParam);
        } catch {
          /* ignore */
        }
        resumeHydratedTokenRef.current = resumeTokenParam;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
            return next;
          },
          { replace: true },
        );
        setResumeBootstrapping(false);
        return;
      }
      const d = bundle.complete;
      if (!d) {
        setError(t("optimize.restoreResumeError"));
        setResumeBootstrapping(false);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
            return next;
          },
          { replace: true },
        );
        return;
      }
      const jobLine = jobTextFromSnapshotForResume(d.job, d.job_url);
      const rc = (d.optimized_resume_text || "").trim();
      setResumeContent(rc || t("optimize.restoredResumePlaceholder"));
      setJobInput(jobLine);
      setJobMode(d.job_url?.trim() ? "url" : "text");
      setParsedJob(d.job);
      if (d.pre_analyze) {
        setPreScores(d.pre_analyze);
      } else {
        setPreScores({
          ats_score: d.pre_ats_score ?? 0,
          keyword_score: d.pre_keyword_score ?? 0,
          keyword_threshold: 0.6,
          job: d.job,
          recommendations: [],
        });
      }
      setResult(snapshotDataToOptimizeResponse(d));
      setPostResultFlow("main");
      setSelectedTemplateId((d.selected_template_id || "").trim());
      setPhotoDataUrl(d.photo_data_url?.trim() ? d.photo_data_url.trim() : null);
      if (d.pdf_download_available && d.pdf_filename) {
        setUploadedFileName(d.pdf_filename);
        setResumeSourceWasPdf(
          d.snapshot_source_was_pdf === true ||
            (d.snapshot_source_was_pdf == null && Boolean(d.pdf_download_available && d.pdf_filename)),
        );
      } else {
        setUploadedFileName(null);
        setResumeSourceWasPdf(Boolean(d.snapshot_source_was_pdf));
      }
      try {
        sessionStorage.setItem(api.OPTIMIZE_LAST_SNAPSHOT_JWT_KEY, resumeTokenParam);
      } catch {
        /* ignore */
      }
      setLastUploadedPdfFile(null);
      setClaimGate(false);
      setStage("result");
      resumeHydratedTokenRef.current = resumeTokenParam;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(api.OPTIMIZE_RESUME_QUERY_PARAM);
          return next;
        },
        { replace: true },
      );
      setResumeBootstrapping(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeTokenParam, user, loading, navigate, setSearchParams]);

  // Restore analyze state after trial checkout (before paint) so data is ready for auto-improve
  useLayoutEffect(() => {
    if (typeof window === "undefined" || checkoutSnapshotRestoredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    const pending = sessionStorage.getItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY) === "1";
    const raw = sessionStorage.getItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY);
    if (!pending || !raw) return;
    try {
      const p = JSON.parse(raw) as {
        v: number;
        resumeContent?: string;
        jobInput?: string;
        jobMode?: "url" | "text";
        preScores?: api.AnalyzeResponse;
        parsedJob?: api.JobPostingOut | null;
        resumeSourceWasPdf?: boolean;
        uploadedFileName?: string | null;
        resumeSummaryFromApi?: api.ExtractResumeSummaryResponse | null;
        result?: api.OptimizeResponse | null;
        stage?: Stage;
        selectedTemplateId?: string;
        photoDataUrl?: string | null;
      };
      if (p.v !== 1) return;
      workSessionSkipPersistRef.current = true;
      setResumeContent(p.resumeContent ?? "");
      setJobInput(p.jobInput ?? "");
      setJobMode(p.jobMode === "url" ? "url" : "text");
      setPreScores(p.preScores ?? null);
      setParsedJob(p.parsedJob ?? null);
      setResumeSourceWasPdf(!!p.resumeSourceWasPdf);
      setUploadedFileName(p.uploadedFileName ?? null);
      setResumeSummaryFromApi(p.resumeSummaryFromApi ?? null);
      setResult(p.result ?? null);
      setSelectedTemplateId(p.selectedTemplateId ?? "");
      setPhotoDataUrl(p.photoDataUrl ?? null);
      setError(null);
      const hasResultToResume = !!(p.result && !p.result.error);
      setStage(hasResultToResume ? "result" : (p.stage === "result" ? "assessment" : (p.stage ?? "assessment")));
      setPendingAutoImproveAfterCheckout(!hasResultToResume);
      checkoutSnapshotRestoredRef.current = true;
      workSessionRestoredRef.current = true;
      sessionStorage.removeItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY);
      sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
      queueMicrotask(() => {
        workSessionSkipPersistRef.current = false;
      });
    } catch {
      /* ignore */
    }
  }, []);

  // Restore last analyze/optimize work for ~30 min (refresh / accidental leave)
  useLayoutEffect(() => {
    if (typeof window === "undefined" || workSessionRestoredRef.current) return;
    if (checkoutSnapshotRestoredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(api.OPTIMIZE_RESUME_QUERY_PARAM)) return;
    if (params.get("pending")) return;
    if (params.get("checkout") === "success") return;
    const incoming = location.state as { resumeContent?: string } | null;
    if (incoming?.resumeContent != null && incoming.resumeContent !== "") {
      // New file from Home/Improve — drop stale session, let the state effect take over
      clearOptimizeWorkSession();
      workSessionRestoredRef.current = true;
      return;
    }
    const session = loadOptimizeWorkSession();
    if (!session) {
      workSessionRestoredRef.current = true;
      return;
    }
    workSessionSkipPersistRef.current = true;
    workSessionRestoredRef.current = true;
    setResumeContent(session.resumeContent);
    setJobInput(session.jobInput);
    setJobMode(session.jobMode === "url" ? "url" : "text");
    setIsImproveMode(Boolean(session.isImproveMode));
    setPreScores(session.preScores);
    setParsedJob(session.parsedJob);
    setResumeSourceWasPdf(Boolean(session.resumeSourceWasPdf));
    setUploadedFileName(session.uploadedFileName);
    setResumeSummaryFromApi(session.resumeSummaryFromApi);
    setResult(session.result);
    setSelectedTemplateId(session.selectedTemplateId || "");
    setPhotoDataUrl(session.photoDataUrl);
    setError(null);
    setClaimGate(false);
    setStage(session.stage);
    queueMicrotask(() => {
      workSessionSkipPersistRef.current = false;
    });
  }, [location.state]);

  // Return from Stripe checkout (trial / subscription) — refresh profile until paid or retries exhausted
  useEffect(() => {
    const co = searchParams.get("checkout");
    if (co !== "success" && co !== "cancel") return;
    if (co === "cancel") {
      sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
    }
    let cancelled = false;
    void (async () => {
      if (co === "success") {
        for (let i = 0; i < 4; i++) {
          if (cancelled) return;
          const me = await refreshUser();
          const p = me?.subscription?.plan ?? "free";
          const s = me?.subscription?.status ?? "free";
          const paid = (p === "trial" || p === "monthly") && (s === "active" || s === "trial");
          if (paid) break;
          if (i < 3) await new Promise((r) => setTimeout(r, 1500));
        }
      } else {
        await refreshUser();
      }
      if (cancelled) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("checkout");
          return next;
        },
        { replace: true },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, refreshUser]);

  // Редирект с главной после загрузки файла — сразу шаг 2 (файл уже есть)
  useEffect(() => {
    const state = location.state as {
      resumeContent?: string;
      uploadedFileName?: string;
      originalFileName?: string;
      sourceWasPdf?: boolean;
      improveMode?: boolean;
      jobInputPreset?: string;
      autoStart?: boolean;
    } | null;
    if (state?.resumeContent != null && state.resumeContent !== "") {
      beginNewOptimizeWork();
      setResumeContent(state.resumeContent);
      setUploadedFileName(state.uploadedFileName ?? null);
      setResumeSourceWasPdf(state.sourceWasPdf ?? false);
      if (state.improveMode) {
        setIsImproveMode(true);
        autoStartPendingRef.current = true;
      }
      if (state.jobInputPreset) {
        setJobInput(state.jobInputPreset);
        if (state.autoStart) autoStartPendingRef.current = true;
      }
      setPreScores(null);
      setStage("idle");
      setResult(null);
      setResumeName(null);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const hasResume = !!resumeContent.trim();
  const hasJobInput = !!jobInput.trim();
  const hasJob = hasJobInput || isImproveMode;

  // Auto-start scan when navigated from /improve with autoStart flag
  useEffect(() => {
    if (!autoStartPendingRef.current) return;
    if (!hasResume || !hasJob) return;
    if (stage !== "idle") return;
    autoStartPendingRef.current = false;
    setStage("scanning");
  }, [hasResume, hasJob, stage]);
  const canImprove = hasResume && hasJob && stage === "assessment" && result === null;

  const freeLimitIdleBlock =
    stage === "idle" &&
    !canAnalyzeSubscription &&
    user?.id !== "local" &&
    hasResume &&
    hasJob;
  const showFreeLimitOverlay = freeLimitIdleBlock && !freeLimitUpsellDismissed;

  useEffect(() => {
    if (!hasResume || !hasJob) setFreeLimitUpsellDismissed(false);
  }, [hasResume, hasJob]);

  useEffect(() => {
    if (!showFreeLimitOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFreeLimitUpsellDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFreeLimitOverlay]);

  // Сброс при неполных данных (не трогаем пока ждём claim с лендинга)
  useEffect(() => {
    if (resumeBootstrapping) return;
    if (!hasResume || !hasJob) {
      if (claimGate) return;
      if (stage !== "landing" && stage !== "idle") {
        setStage("idle");
      }
    }
  }, [hasResume, hasJob, stage, claimGate, resumeBootstrapping]);

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
    const timer = setTimeout(() => {
      api.extractResumeSummary(text).then(setResumeSummaryFromApi).catch(() => setResumeSummaryFromApi(null));
    }, 700);
    return () => clearTimeout(timer);
  }, [resumeContent]);

  // Парсинг вакансии не вызываем до старта анализа — он выполняется внутри /analyze и результат приходит в data.job (экономия токенов).

  // На этапе «Сканирование» — прогресс 0→100% и переход в «Оценка» (отдельный эффект, чтобы интервал не сбрасывался при ре-рендере)
  const SCAN_DURATION_MS = 1800;
  const SCAN_TICK_MS = 80;
  useEffect(() => {
    // Не запускаем таймер до данных с лендинга — иначе уйдём в assessment до claim/analyze
    if (stage !== "scanning" || !hasResume || !hasJob) return;
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
  }, [stage, hasResume, hasJob]);

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
    beginNewOptimizeWork();
    setIsAnalyzing(true);
    setPreScores(null);
    const jobPayload = isImproveMode
      ? {}
      : jobMode === "text"
        ? { job_text: jobInput.trim() }
        : { job_url: jobInput.trim() };
    api
      .analyze({
        resume_content: resumeContent.trim(),
        ...jobPayload,
        ...(isImproveMode ? { improve_mode: true } : {}),
        output_language: api.getOutputLanguage(),
        session_template_id: selectedTemplateId.trim() || undefined,
      })
      .then((data) => {
        if (!analyzeMountedRef.current) return;
        setPreScores(data);
        if (data.job) setParsedJob(data.job);
        const rt = (data.resume_session_token || "").trim();
        if (rt) {
          try {
            sessionStorage.setItem(api.OPTIMIZE_LAST_SNAPSHOT_JWT_KEY, rt);
          } catch {
            /* ignore */
          }
        }
        void refreshUser();
      })
      .catch((e) => {
        if (!analyzeMountedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!isOfferPasteAsTextError(msg)) {
          setError(msg);
          setStage("idle");
        }
        setPreScores(null);
        if (isOfferPasteAsTextError(msg)) {
          setError(null);
          setStage("idle");
          setJobMode("text");
          setJobInput("");
          setParsedJob(null);
          setOfferPasteAsText(true);
          // Paste-as-text is only for job-tailor scrape failures — leave improve mode alone.
          if (isImproveMode) setIsImproveMode(false);
        }
      })
      .finally(() => {
        if (analyzeMountedRef.current) setIsAnalyzing(false);
      });
  }, [stage, hasResume, hasJob, jobMode, jobInput, resumeContent, result, refreshUser, selectedTemplateId, isImproveMode]);

  // PDF thumbnail on assessment — for guests and logged-in users.
  useEffect(() => {
    if (stage !== "assessment" || !lastUploadedPdfFile || resumeThumbnailUrl) return;
    if (!lastUploadedPdfFile.name.toLowerCase().endsWith(".pdf")) return;
    let cancelled = false;
    api
      .getResumeThumbnailUrl(lastUploadedPdfFile)
      .then((url) => {
        if (!cancelled) setResumeThumbnailUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stage, lastUploadedPdfFile, resumeThumbnailUrl]);

  // После успешного анализа: сначала PNG превью (пока есть File), затем register — иначе гонка с очисткой File ломала превью.
  useEffect(() => {
    if (!preScores || !lastUploadedPdfFile || !user) return;
    const file = lastUploadedPdfFile;
    let cancelled = false;
    void (async () => {
      try {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        if (isPdf && !resumeThumbnailUrlRef.current) {
          try {
            const url = await api.getResumeThumbnailUrl(file);
            if (cancelled) {
              URL.revokeObjectURL(url);
              return;
            }
            setResumeThumbnailUrl(url);
          } catch {
            /* превью опционально */
          }
        }
        if (cancelled) return;
        setLastUploadedPdfFile(null);
        try {
          await api.registerResumeUpload(file);
        } catch {
          /* не блокируем экран оценки */
        }
        if (!cancelled) void refreshUser();
      } catch {
        if (!cancelled) setLastUploadedPdfFile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const handleClearResume = () => {
    beginNewOptimizeWork();
    if (resumeThumbnailUrl) {
      URL.revokeObjectURL(resumeThumbnailUrl);
      setResumeThumbnailUrl(null);
    }
    setResumeContent("");
    setResumeName(null);
    setUploadedFileName(null);
    setLastUploadedPdfFile(null);
    setResumeSourceWasPdf(false);
  };

  async function readResumeFile(file: File) {
    beginNewOptimizeWork();
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
        // Eager thumbnail so assessment workspace has a preview immediately.
        if (resumeThumbnailUrlRef.current) {
          URL.revokeObjectURL(resumeThumbnailUrlRef.current);
          setResumeThumbnailUrl(null);
        }
        void api
          .getResumeThumbnailUrl(file)
          .then((url) => setResumeThumbnailUrl(url))
          .catch(() => {});
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
    if (!canAnalyzeSubscription && user?.id !== "local") {
      setError(`Free plan limit reached (${FREE_ANALYSES_PER_MONTH} analyses/month). Please upgrade for unlimited scans.`);
      return;
    }
    setStage("scanning");
  }

  async function handleFreeLimitStartTrial() {
    if (!user || user.id === "local") {
      navigate("/login");
      return;
    }
    setFreeLimitCheckoutError(null);
    setFreeLimitCheckoutLoading(true);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const successUrl = `${baseUrl}/optimize?checkout=success`;
    const cancelUrl = `${baseUrl}/optimize?checkout=cancel`;
    try {
      const { url } = await api.createCheckoutSession({
        price_key: "trial",
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (url) window.location.href = url;
      else setFreeLimitCheckoutError(t("upgrade.getPaymentLinkError"));
    } catch (e) {
      setFreeLimitCheckoutError(e instanceof Error ? e.message : t("upgrade.checkoutError"));
    } finally {
      setFreeLimitCheckoutLoading(false);
    }
  }

  function persistOptimizeSnapshotForCheckout() {
    try {
      if (!resumeContent.trim() || !jobInput.trim()) return;
      const payload = {
        v: 1 as const,
        resumeContent,
        jobInput,
        jobMode,
        preScores,
        parsedJob,
        resumeSourceWasPdf,
        uploadedFileName,
        resumeSummaryFromApi,
        result,
        stage,
        selectedTemplateId,
        photoDataUrl,
      };
      sessionStorage.setItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY, JSON.stringify(payload));
      sessionStorage.setItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function handleOptimizePaywallStartTrial() {
    if (!user || user.id === "local") {
      navigate("/login");
      return;
    }
    persistOptimizeSnapshotForCheckout();
    setOptimizePaywallCheckoutError(null);
    setOptimizePaywallCheckoutLoading(true);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const successUrl = `${baseUrl}/optimize?checkout=success`;
    const cancelUrl = `${baseUrl}/optimize?checkout=cancel`;
    try {
      const { url } = await api.createCheckoutSession({
        price_key: "trial",
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (url) window.location.href = url;
      else setOptimizePaywallCheckoutError(t("upgrade.getPaymentLinkError"));
    } catch (e) {
      setOptimizePaywallCheckoutError(e instanceof Error ? e.message : t("upgrade.checkoutError"));
    } finally {
      setOptimizePaywallCheckoutLoading(false);
    }
  }

  function openDownloadCheckoutFlow(previewDataUrl: string | null = null) {
    if (!user || user.id === "local") {
      navigate("/login");
      return;
    }
    storeCheckoutResumePreview(previewDataUrl);
    persistOptimizeSnapshotForCheckout();
    const q = new URLSearchParams();
    q.set("return_to", "/optimize");
    if (result?.pending_export_token) q.set("pending", result.pending_export_token);
    if (result?.pending_export_expires_at) q.set("exp", result.pending_export_expires_at);
    const docName = (result?.pdf_filename || uploadedFileName || "Resume.pdf").trim();
    if (docName) q.set("doc", docName);
    navigate(`/checkout/download-resume?${q.toString()}`);
  }

  async function runOptimizeResumeMax() {
    beginNewOptimizeWork();
    setError(null);
    optimizeLoadStartedAtRef.current = Date.now();
    sseOptimizeCapRef.current = 0;
    setStage("loading");
    setLoadProgress(0);
    setDisplayLoadProgress(0);
    const params = {
      resume_content: resumeContent.trim(),
      job_text: isImproveMode ? undefined : (jobMode === "text" ? jobInput.trim() : undefined),
      job_url: isImproveMode ? undefined : (jobMode === "url" ? jobInput.trim() : undefined),
      improve_mode: isImproveMode || undefined,
      max_iterations: 1,
      parallel: true,
      aggressive_tailoring: true,
      pre_ats_score: preScores?.ats_score ?? undefined,
      pre_keyword_score: preScores?.keyword_score ?? undefined,
      source_was_pdf: resumeSourceWasPdf,
      output_language: api.getOutputLanguage(),
      ...sessionPayloadForOptimizeRequest(preScores, photoDataUrl, selectedTemplateId),
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent) => {
          const c = clampPercent(percent);
          sseOptimizeCapRef.current = Math.max(
            sseOptimizeCapRef.current,
            Math.min(OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE, c),
          );
        });
      } catch {
        res = await api.optimize(params);
      }
      setResult(res);
      sseOptimizeCapRef.current = 100;
      setDisplayLoadProgress(100);
      setLoadProgress(100);
      persistSnapshotJwtFromResponse(res);
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
      await refreshUser();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Optimization failed";
      if (msg.includes("Free plan limit reached")) {
        setError(t("optimize.freeOptimizeLimitError"));
      } else if (!isOfferPasteAsTextError(msg)) {
        setError(msg);
      }
      sseOptimizeCapRef.current = 100;
      setDisplayLoadProgress(100);
      setLoadProgress(100);
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

  async function handleDownloadCustomPdf() {
    if (pendingPdfDownloadLoading) return;
    setPendingPdfDownloadLoading(true);
    setError(null);
    try {
      // Preferred path: template render from schema_json (product download path).
      if (result?.schema_json?.trim()) {
        let baseSchema: Record<string, unknown> = {};
        try {
          baseSchema = JSON.parse(result.schema_json) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
        const basics =
          baseSchema.basics && typeof baseSchema.basics === "object"
            ? (baseSchema.basics as Record<string, unknown>)
            : {};
        const schemaWithPhoto = {
          ...baseSchema,
          basics: {
            ...basics,
            image: photoDataUrl || undefined,
          },
        };

        const res = await api.renderTemplatePdf({
          template_id: selectedTemplateId || "jsonresume-classic-inspired",
          schema: schemaWithPhoto as unknown as api.UnifiedResumeSchema,
        });

        const u8 = b64ToUint8ArraySandbox(res.pdf_base64);
        const blob = new Blob([u8.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = result.pdf_filename || "Optimized_Resume.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }

      // Fallback for paid optimize response when schema extract failed.
      if (result?.pdf_base64) {
        const u8 = b64ToUint8ArraySandbox(result.pdf_base64);
        const blob = new Blob([u8.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = url;
          a.download = result.pdf_filename || "Optimized_Resume.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }

      setError(t("optimize.downloadSchemaMissing"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not render custom PDF");
    } finally {
      setPendingPdfDownloadLoading(false);
    }
  }

  // Used only for b64 conversion
  function b64ToUint8ArraySandbox(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  async function handleImprove() {
    if (!canImprove) return;
    if (!canOptimizeSubscription && user?.id !== "local") {
      setOptimizePaywallOpen(true);
      return;
    }
    await runOptimizeResumeMax();
  }

  autoImproveGateRef.current = { preScores, resumeContent, jobInput, stage };

  useEffect(() => {
    if (!pendingAutoImproveAfterCheckout) return;
    if (user?.id !== "local" && !hasPaidPlan) return;
    const ctx = autoImproveGateRef.current;
    if (!ctx.preScores || !ctx.resumeContent.trim() || ctx.stage !== "assessment") return;
    // Improve mode has no job; tailor mode requires job text/URL.
    if (!isImproveMode && !ctx.jobInput.trim()) return;
    if (autoImproveStartedRef.current) return;
    autoImproveStartedRef.current = true;
    setPendingAutoImproveAfterCheckout(false);
    sessionStorage.removeItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY);
    sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
    void runOptimizeResumeMax().finally(() => {
      autoImproveStartedRef.current = false;
    });
  }, [pendingAutoImproveAfterCheckout, hasPaidPlan, user?.id, isImproveMode]);

  useEffect(() => {
    if (stage !== "result") setPostResultFlow("main");
  }, [stage]);

  // Persist assessment/result for ~30 minutes (refresh-safe)
  useEffect(() => {
    if (workSessionSkipPersistRef.current) return;
    if (!resumeContent.trim()) return;
    if (stage === "assessment" && preScores) {
      saveOptimizeWorkSession({
        stage: "assessment",
        resumeContent,
        jobInput,
        jobMode,
        isImproveMode,
        preScores,
        parsedJob,
        resumeSourceWasPdf,
        uploadedFileName,
        resumeSummaryFromApi,
        result: null,
        selectedTemplateId,
        photoDataUrl,
      });
      return;
    }
    if (stage === "result" && result && !result.error) {
      saveOptimizeWorkSession({
        stage: "result",
        resumeContent,
        jobInput,
        jobMode,
        isImproveMode,
        preScores,
        parsedJob,
        resumeSourceWasPdf,
        uploadedFileName,
        resumeSummaryFromApi,
        result,
        selectedTemplateId,
        photoDataUrl,
      });
    }
  }, [
    stage,
    preScores,
    result,
    resumeContent,
    jobInput,
    jobMode,
    isImproveMode,
    parsedJob,
    resumeSourceWasPdf,
    uploadedFileName,
    resumeSummaryFromApi,
    selectedTemplateId,
    photoDataUrl,
  ]);

  function applyNewJobSameResume() {
    if (!result) return;
    beginNewOptimizeWork();
    try {
      sessionStorage.removeItem(api.OPTIMIZE_LAST_SNAPSHOT_JWT_KEY);
    } catch {
      /* ignore */
    }
    const nextContent = result.optimized_resume_text?.trim() || resumeContent.trim();
    setResumeContent(nextContent);
    setJobInput("");
    setJobMode("text");
    setParsedJob(null);
    setPreScores(null);
    setResult(null);
    setPostResultFlow("main");
    setStage("idle");
    setError(null);
    setOfferPasteAsText(false);
  }

  async function handleImproveMore() {
    if (!result || !hasResume || !hasJob) return;
    if (user?.id !== "local" && !hasPaidPlan) {
      setOptimizePaywallOpen(true);
      return;
    }
    beginNewOptimizeWork();
    setError(null);
    setIsImprovingMore(true);
    optimizeLoadStartedAtRef.current = Date.now();
    sseOptimizeCapRef.current = 0;
    setStage("loading");
    setLoadProgress(0);
    setDisplayLoadProgress(0);
    const improvedContent = result.optimized_resume_text?.trim() || resumeContent.trim();
    const currentAtsForRetry = atsValue ?? preScores?.ats_score;
    const currentKwForRetry = keywordsValue?.score ?? preScores?.keyword_score;
    const params = {
      resume_content: improvedContent,
      job_text: isImproveMode ? undefined : (jobMode === "text" ? jobInput.trim() : undefined),
      job_url: isImproveMode ? undefined : (jobMode === "url" ? jobInput.trim() : undefined),
      improve_mode: isImproveMode || undefined,
      parallel: true,
      aggressive_tailoring: true,
      max_iterations: 1,
      pre_ats_score: currentAtsForRetry ?? undefined,
      pre_keyword_score: currentKwForRetry ?? undefined,
      source_was_pdf: resumeSourceWasPdf,
      output_language: api.getOutputLanguage(),
      ...sessionPayloadForOptimizeRequest(preScores, photoDataUrl, selectedTemplateId),
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent) => {
          const c = clampPercent(percent);
          sseOptimizeCapRef.current = Math.max(
            sseOptimizeCapRef.current,
            Math.min(OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE, c),
          );
        });
      } catch {
        res = await api.optimize(params);
      }
      setResult(res);
      sseOptimizeCapRef.current = 100;
      setDisplayLoadProgress(100);
      setLoadProgress(100);
      persistSnapshotJwtFromResponse(res);
      setStage("result");
      await refreshUser();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
      sseOptimizeCapRef.current = 100;
      setDisplayLoadProgress(100);
      setLoadProgress(100);
      setStage("result");
    } finally {
      setIsImprovingMore(false);
    }
  }

  const atsValue = result ? getAtsScore(result) : null;
  const keywordsValue = result ? getKeywordsScore(result) : null;
  const postMatch = resolvePostMatchScores(result, atsValue, keywordsValue);

  /** Show "improve again" when real overall match is below 85%. */
  const showOptimizeAgainForAts = Boolean(
    result && !result.error && postMatch.overallPct != null && postMatch.overallPct < 85,
  );

  const showSummaryBlocks = (stage === "assessment" && preScores != null) || stage === "result";
  /** Ждём claim `/landing/claim` после ?pending= — показываем лоадер вместо hero */
  const awaitingLandingClaim = stage === "scanning" && claimGate && (!hasResume || !hasJob);
  const showFullBleedPipelineLoader =
    !showSummaryBlocks &&
    (stage === "scanning" || stage === "loading" || (stage === "assessment" && preScores == null)) &&
    ((hasResume && hasJob) || awaitingLandingClaim);
  const isLoadingAssessment =
    awaitingLandingClaim || stage === "scanning" || (stage === "assessment" && preScores == null);
  /** Include optimize (`loading`) so fact lines keep rotating; `isLoadingAssessment` stays scan/analyze-only for pipeline ticks. */
  const rotateLoadingHints =
    isLoadingAssessment || stage === "loading";

  useEffect(() => {
    const prev = prevStagePipelineRef.current;
    if (stage === "scanning" && prev !== "scanning") {
      scanSessionStartedAtRef.current = Date.now();
    }
    if (stage === "assessment" && prev !== "assessment") {
      assessEnteredAtRef.current = Date.now();
    }
    if (stage === "idle" || stage === "landing") {
      scanSessionStartedAtRef.current = null;
      assessEnteredAtRef.current = null;
    }
    prevStagePipelineRef.current = stage;
  }, [stage]);

  useEffect(() => {
    if (!isLoadingAssessment) {
      setAnalysisPipelineCompleted(0);
      return;
    }
    const tick = () => {
      if (preScores) {
        setAnalysisPipelineCompleted(5);
        return;
      }
      if (awaitingLandingClaim) {
        const t0 = scanSessionStartedAtRef.current ?? Date.now();
        scanSessionStartedAtRef.current = t0;
        const elapsed = Date.now() - t0;
        setAnalysisPipelineCompleted(elapsed < 900 ? 0 : 1);
        return;
      }
      if (stage === "scanning") {
        const sp = scanProgress;
        if (sp < 30) setAnalysisPipelineCompleted(0);
        else if (sp < 58) setAnalysisPipelineCompleted(1);
        else if (sp < 90) setAnalysisPipelineCompleted(2);
        else setAnalysisPipelineCompleted(3);
        return;
      }
      if (stage === "assessment") {
        const at = assessEnteredAtRef.current ?? Date.now();
        assessEnteredAtRef.current = at;
        const elapsed = Date.now() - at;
        const bump = Math.min(2, Math.floor(elapsed / 9000));
        setAnalysisPipelineCompleted(Math.min(4, 3 + bump));
      }
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [isLoadingAssessment, stage, scanProgress, preScores, awaitingLandingClaim]);

  const loadingHints =
    stage === "scanning"
      ? [
          t("optimize.loadingHintScan1"),
          t("optimize.loadingHintScan2"),
          t("optimize.loadingHintScan3"),
          t("optimize.loadingHintScan4"),
          t("optimize.loadingHintScan5"),
          t("optimize.loadingHintScan6"),
          t("optimize.loadingHintScan7"),
          t("optimize.loadingHintScan8"),
          t("optimize.loadingHintScan9"),
          t("optimize.loadingHintScan10"),
        ]
      : [
          t("optimize.loadingHintAnalyze1"),
          t("optimize.loadingHintAnalyze2"),
          t("optimize.loadingHintAnalyze3"),
          t("optimize.loadingHintAnalyze4"),
          t("optimize.loadingHintAnalyze5"),
          t("optimize.loadingHintAnalyze6"),
          t("optimize.loadingHintAnalyze7"),
          t("optimize.loadingHintAnalyze8"),
          t("optimize.loadingHintAnalyze9"),
          t("optimize.loadingHintAnalyze10"),
        ];
  const activeLoadingHint = loadingHints[loadingHintIndex % loadingHints.length];
  const visibleLoadProgress = stage === "loading" ? displayLoadProgress : loadProgress;
  const optimizePipelineCompleted =
    stage === "loading" ? Math.min(5, Math.floor(visibleLoadProgress / 20)) : 0;

  useEffect(() => {
    if (!rotateLoadingHints) {
      setLoadingHintIndex(0);
      return;
    }
    const timer = setInterval(() => setLoadingHintIndex((idx) => idx + 1), LOADING_FACT_ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotateLoadingHints]);

  useEffect(() => {
    if (stage !== "loading") {
      setDisplayLoadProgress(0);
      return;
    }
    const baseStep = (OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE * OPTIMIZE_LOAD_TICK_MS) / OPTIMIZE_LOAD_TARGET_MS;
    const progressTimer = setInterval(() => {
      setDisplayLoadProgress((prev) => {
        if (prev >= 100) return 100;
        const elapsed = Date.now() - optimizeLoadStartedAtRef.current;
        const timeFloor = Math.min(
          OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE,
          (elapsed / OPTIMIZE_LOAD_TARGET_MS) * OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE,
        );
        const cap = Math.max(Math.min(OPTIMIZE_LOAD_SSE_CAP_BEFORE_DONE, sseOptimizeCapRef.current), timeFloor);
        const gap = cap - prev;
        const step = Math.min(gap, Math.max(baseStep, gap * 0.07));
        return Math.min(cap, prev + step);
      });
    }, OPTIMIZE_LOAD_TICK_MS);
    return () => clearInterval(progressTimer);
  }, [stage]);

  useEffect(() => {
    if (!resumeBootstrapping) {
      setBootstrapPipelineCompleted(0);
      return;
    }
    const bootStart = Date.now();
    const tick = () => {
      const elapsed = Date.now() - bootStart;
      setBootstrapPipelineCompleted(Math.min(3, Math.floor(elapsed / 500)));
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [resumeBootstrapping]);

  const summaryData = showSummaryBlocks
    ? (() => {
        const resumeSummary = getResumeSummary(resumeContent, resumeName);
        const normPreAts = normalizeScorePercent(preScores?.ats_score ?? result?.pre_ats_score ?? null);
        const normPreKw = normalizeScorePercent(preScores?.keyword_score ?? result?.pre_keyword_score ?? null);
        const hasPost = Boolean(result && !result.error);
        const atsPct = hasPost
          ? (postMatch.atsPct ?? normPreAts ?? 0)
          : (normPreAts ?? 0);
        const kwPct = hasPost
          ? (postMatch.kwPct ?? normPreKw ?? 0)
          : (normPreKw ?? 0);
        const safeAts = Number.isFinite(atsPct) ? atsPct : 0;
        const safeKw = Number.isFinite(kwPct) ? kwPct : 0;
        const overallPct = hasPost
          ? (postMatch.overallPct ?? Math.round((safeAts + safeKw) / 2))
          : Math.round((safeAts + safeKw) / 2);
        /** After successful auto-improve, never show a weak “win” — floor for UI confidence. */
        const POST_QUALITY_FLOOR = 74;
        const rawQuality = clampPercent(overallPct);
        const qualityPct = hasPost ? Math.max(POST_QUALITY_FLOOR, rawQuality) : rawQuality;
        const normRejection = normalizeScorePercent(preScores?.rejection_risk_score);
        const riskPct =
          normRejection != null
            ? Math.max(0, Math.min(100, normRejection))
            : Math.max(0, 100 - qualityPct);
        const displayName = resumeSummaryFromApi?.full_name?.trim() || resumeSummary.name;
        const displaySpecialty = resumeSummaryFromApi?.specialty?.trim() || resumeSummary.specialty;
        const displaySkills = resumeSummaryFromApi?.skills?.trim() || resumeSummary.skillsLine;
        const preOverall =
          normPreAts != null || normPreKw != null
            ? Math.round(
                ([normPreAts, normPreKw].filter((v): v is number => v != null).reduce((a, b) => a + b, 0) /
                  Math.max(1, [normPreAts, normPreKw].filter((v): v is number => v != null).length)),
              )
            : null;
        const improvementOverallPp =
          hasPost && preOverall != null
            ? qualityPct - preOverall
            : result?.improvement_overall_pp ?? null;
        const improvementAtsPp =
          result?.improvement_ats_pp ??
          (hasPost && normPreAts != null && postMatch.atsPct != null
            ? Math.round(postMatch.atsPct - normPreAts)
            : null);
        const improvementKwPp =
          result?.improvement_keyword_pp ??
          (hasPost && normPreKw != null && postMatch.kwPct != null
            ? Math.round(postMatch.kwPct - normPreKw)
            : null);
        return {
          atsPct: safeAts,
          kwPct: safeKw,
          overallPct,
          riskPct,
          qualityPct,
          preOverall,
          preAts: normPreAts,
          preKw: normPreKw,
          improvementOverallPp,
          improvementAtsPp,
          improvementKwPp,
          displayName,
          displaySpecialty,
          displaySkills,
        };
      })()
    : null;
  const resultJobTitleLabel =
    parsedJob?.title?.trim() ||
    (jobInput.trim()
      ? (() => {
          const line = jobInput.trim().split(/\r?\n/).find((l) => l.trim())?.trim() || jobInput.trim();
          return line.length > 80 ? `${line.slice(0, 77)}…` : line;
        })()
      : t("optimize.vacancyUntitled"));

  const workspaceAnnotations = useMemo(() => {
    if (result?.annotations?.length) return result.annotations;
    if (preScores?.annotations?.length) return preScores.annotations;
    // Legacy / LLM-miss: rail only shows annotations — synthesize from tip cards
    return resolveWorkspaceAnnotations(null, preScores);
  }, [result?.annotations, preScores]);

  const workspaceCategoryScores = useMemo(() => {
    if (result?.category_scores) return result.category_scores;
    if (preScores?.category_scores) return preScores.category_scores;
    return null;
  }, [result?.category_scores, preScores?.category_scores]);

  const workspaceMissingKeywords = useMemo(() => {
    const kw = preScores?.recommendations?.find((r) => r.category === "Keywords");
    return kw?.labels?.filter(Boolean) ?? [];
  }, [preScores?.recommendations]);

  const [resultPdfPreviewUrl, setResultPdfPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!result?.pdf_base64) {
      setResultPdfPreviewUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
        GlobalWorkerOptions.workerSrc = workerSrc;
        const bytes = Uint8Array.from(atob(result.pdf_base64!), (c) => c.charCodeAt(0));
        const loadingTask = getDocument({ data: bytes.slice() });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const targetW = 520;
        const viewport = page.getViewport({ scale: targetW / natural.width });
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, viewport.width, viewport.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled) setResultPdfPreviewUrl(canvas.toDataURL("image/png"));
        loadingTask.destroy();
      } catch {
        if (!cancelled) setResultPdfPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result?.pdf_base64]);

  const workspacePaperUrl =
    stage === "result"
      ? resultPdfPreviewUrl || resumeThumbnailUrl || resumeThumbnailUrlRef.current
      : resumeThumbnailUrl || resumeThumbnailUrlRef.current;

  const workspacePaperText =
    (stage === "result" ? result?.optimized_resume_text?.trim() : "") ||
    resumeContent.trim() ||
    null;

  const workspaceSchemaJson =
    (stage === "result" ? result?.schema_json : null)?.trim() ||
    preScores?.schema_json?.trim() ||
    null;

  const [workspaceHtml, setWorkspaceHtml] = useState<string | null>(null);
  const [workspaceHtmlLoading, setWorkspaceHtmlLoading] = useState(false);
  const [workspaceFitMessage, setWorkspaceFitMessage] = useState<string | null>(null);
  const [workspaceFitOk, setWorkspaceFitOk] = useState<boolean | null>(null);

  // Live template HTML from schema — preferred paper preview after analyze/optimize.
  useEffect(() => {
    if (!showSummaryBlocks || !workspaceSchemaJson) {
      setWorkspaceHtml(null);
      setWorkspaceFitMessage(null);
      setWorkspaceFitOk(null);
      return;
    }
    let cancelled = false;
    let schema: api.UnifiedResumeSchema;
    try {
      schema = JSON.parse(workspaceSchemaJson) as api.UnifiedResumeSchema;
    } catch {
      setWorkspaceHtml(null);
      setWorkspaceFitMessage(null);
      setWorkspaceFitOk(null);
      return;
    }
    const basics =
      schema.basics && typeof schema.basics === "object"
        ? { ...schema.basics, image: photoDataUrl || schema.basics.image || undefined }
        : { name: "Candidate", image: photoDataUrl || undefined };
    const schemaWithPhoto = { ...schema, basics } as api.UnifiedResumeSchema;
    const templateId = selectedTemplateId.trim() || "jsonresume-classic-inspired";
    setWorkspaceHtmlLoading(true);
    const t = window.setTimeout(() => {
      void api
        .renderTemplateHtml({ template_id: templateId, schema: schemaWithPhoto })
        .then((res) => {
          if (!cancelled) {
            setWorkspaceHtml(res.full_html || res.html_body || null);
            setWorkspaceFitMessage(res.fit_message ?? null);
            setWorkspaceFitOk(res.fit_ok ?? null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setWorkspaceHtml(null);
            setWorkspaceFitMessage(null);
            setWorkspaceFitOk(null);
          }
        })
        .finally(() => {
          if (!cancelled) setWorkspaceHtmlLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [showSummaryBlocks, workspaceSchemaJson, selectedTemplateId, photoDataUrl]);

  // History PDF thumbnail when File is gone but we still know the uploaded filename.
  useEffect(() => {
    if (resumeThumbnailUrl) return;
    if (!showSummaryBlocks) return;
    const fn = uploadedFileName?.trim();
    if (!fn || !fn.toLowerCase().endsWith(".pdf")) return;
    if (!user?.id || user.id === "local") return;
    let cancelled = false;
    const token = api.getStoredToken();
    const url = api.historyThumbnailUrl(fn, token);
    void (async () => {
      try {
        const r = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!r.ok) throw new Error("thumb");
        const blob = await r.blob();
        if (!blob.type.startsWith("image/")) throw new Error("unexpected");
        if (cancelled) return;
        setResumeThumbnailUrl(URL.createObjectURL(blob));
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeThumbnailUrl, showSummaryBlocks, uploadedFileName, user?.id]);

  const workspaceJob: api.JobPostingOut | null =
    result?.job ||
    parsedJob ||
    preScores?.job ||
    null;

  const profileLabel = [
    summaryData?.displayName ||
      [resumeName?.first, resumeName?.last].filter(Boolean).join(" ") ||
      user?.name ||
      user?.email ||
      "Resume",
    summaryData?.displaySpecialty || "",
  ]
    .filter(Boolean)
    .join(" — ");

  const userInitials = (() => {
    const n = (user?.name || summaryData?.displayName || user?.email || "U").trim();
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`;
    return n.slice(0, 2);
  })();


  if (postResultFlow === "newJobWarning" && stage === "result" && result && !result.error) {
    const ctaPrimaryCls = "ds-btn-primary inline-flex min-h-[3rem] w-full flex-1 items-center justify-center gap-2 !px-5 !text-[15px] disabled:opacity-50 whitespace-nowrap";
    const ctaSecondaryCls =
      "inline-flex min-h-[3rem] w-full flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[var(--accent)] bg-white px-5 text-[15px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30 focus-visible:ring-offset-2 whitespace-nowrap";

    return (
      <div className="flex flex-col gap-6 w-full min-w-0 max-w-3xl mx-auto min-h-0 overflow-x-hidden pb-28 sm:pb-16">
        <button
          type="button"
          onClick={() => setPostResultFlow("main")}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25 rounded-lg -ml-1 px-1 py-1 self-start"
        >
          <ArrowLeftIcon className="w-4 h-4 shrink-0" aria-hidden />
          {t("optimize.newJobWarningBack")}
        </button>

        <section className="w-full ds-card p-5 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="ds-label text-[var(--accent)]">{t("optimize.resultExportKicker")}</p>
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] tracking-tight leading-snug">{t("optimize.newJobWarningTitle")}</h1>
              <p className="text-[14px] sm:text-[15px] text-[var(--text-muted)] leading-relaxed max-w-2xl">
                {tFormat(t("optimize.newJobWarningBody"), { jobTitle: resultJobTitleLabel })}
              </p>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed max-w-xl">{t("optimize.newJobWarningNote")}</p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:max-w-md lg:shrink-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <button
                  type="button"
                  onClick={
                    hasPaidPlan
                      ? () => {
                          void handleDownloadCustomPdf();
                        }
                      : () => openDownloadCheckoutFlow(null)
                  }
                  className={ctaPrimaryCls}
                  disabled={pendingPdfDownloadLoading || optimizePaywallCheckoutLoading}
                >
                  <ArrowDownTrayIcon className="w-5 h-5 shrink-0" aria-hidden />
                  {pendingPdfDownloadLoading ? "Downloading..." : t("optimize.downloadPdf")}
                </button>
                <button type="button" onClick={applyNewJobSameResume} className={ctaSecondaryCls}>
                  {t("optimize.newJobWarningContinue")}
                </button>
              </div>
              <p className="text-center text-[11px] text-[var(--text-tertiary)] leading-snug sm:text-left">{t("optimize.downloadPdfPaidHint")}</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={`relative flex w-full min-w-0 flex-col overflow-x-hidden ${
        showFullBleedPipelineLoader ? "min-h-0 gap-0 pb-0" : "min-h-0 gap-4 sm:gap-5 pb-28 sm:pb-12"
      }`}
    >
        {resumeBootstrapping && (
          <div
            className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[var(--bg-page)] px-4"
            role="status"
            aria-live="polite"
          >
            <OptimizePipelineLoader
              variant="overlay"
              heroVariant="restore"
              labels={[t("optimize.pipelineRestore1"), t("optimize.pipelineRestore2"), t("optimize.pipelineRestore3")]}
              completedSteps={bootstrapPipelineCompleted}
              ariaLabel={t("optimize.restoringResumeSession")}
            />
          </div>
        )}
        {error && !isOfferPasteAsTextError(error) && (
          <div className="flex gap-2 text-sm text-[var(--text-muted)]/90 rounded-xl border border-[var(--border)] bg-[#FAFAFC] px-4 py-3 shrink-0" role="alert">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
            <p>{error}</p>
          </div>
        )}

      {showSummaryBlocks && summaryData ? (
        <div className="relative flex w-full min-w-0 flex-col gap-3 overflow-x-hidden">
          {result?.error ? (
            <div className="ds-card p-4 sm:p-6 space-y-2">
              <p className="ds-label">{t("optimize.errorLabel")}</p>
              <p className="text-sm text-[var(--text-tertiary)] whitespace-pre-wrap">{result.error}</p>
            </div>
          ) : (
            <OptimizeWorkspace
              stage={stage === "result" ? "result" : "assessment"}
              profileLabel={profileLabel}
              userInitials={userInitials}
              jobTitle={workspaceJob?.title || resultJobTitleLabel}
              jobCompany={workspaceJob?.company || parsedJob?.company || ""}
              isImproveMode={isImproveMode}
              matchPct={isImproveMode ? summaryData.qualityPct : summaryData.atsPct}
              atsScore={isImproveMode ? summaryData.qualityPct : summaryData.atsPct}
              categoryScores={workspaceCategoryScores}
              annotations={workspaceAnnotations}
              job={workspaceJob}
              missingKeywords={workspaceMissingKeywords}
              keyChanges={result?.key_changes}
              shareUrl={result?.snapshot_url || null}
              paperPreviewUrl={workspaceHtml ? null : workspacePaperUrl}
              paperHtml={workspaceHtml}
              paperText={workspaceHtmlLoading && !workspaceHtml ? null : workspacePaperText}
              paperEditable
              onPaperTextChange={(text) => setResumeContent(text)}
              paperFallbackName={summaryData.displayName || "Resume"}
              canImprove={canImprove}
              showImproveStronger={showOptimizeAgainForAts}
              improveLoading={false}
              onImprove={() => {
                void handleImprove();
              }}
              onImproveStronger={() => {
                if (user?.id !== "local" && !hasPaidPlan) {
                  setOptimizePaywallOpen(true);
                  return;
                }
                void handleImproveMore();
              }}
              onExport={() => {
                if (hasPaidPlan) {
                  void handleDownloadCustomPdf();
                } else {
                  openDownloadCheckoutFlow(workspacePaperUrl);
                }
              }}
              onTailorAnother={
                stage === "result" ? () => setPostResultFlow("newJobWarning") : undefined
              }
              stylePanel={
                <StylePanel
                  locked={false}
                  selectedTemplateId={selectedTemplateId}
                  photoDataUrl={photoDataUrl}
                  onTemplateChange={(id) => {
                    setSelectedTemplateId(id);
                    setStyleVisited(true);
                  }}
                  onPhotoChange={(url) => {
                    setPhotoDataUrl(url);
                    setStyleVisited(true);
                  }}
                  fitMessage={workspaceFitMessage}
                  fitOk={workspaceFitOk}
                />
              }
              hasStyled={Boolean(styleVisited && stage === "result")}
              onStyleVisited={() => setStyleVisited(true)}
            />
          )}
        </div>
      ) : stage === "landing" ? (
        <div className="flex w-full min-h-[calc(100dvh-5.5rem)] flex-col items-center justify-center px-3 py-8 sm:px-6 sm:py-10 overflow-x-hidden">
          <div className="w-full max-w-[900px]">
            <div
              className="relative flex min-h-[320px] flex-col justify-center overflow-hidden rounded-2xl p-5 sm:min-h-[380px] sm:p-8 lg:min-h-[420px] lg:p-12"
              style={{ background: "var(--grad-accent-soft)" }}
            >
              <div className="relative z-10 max-w-[420px]">
                <h1 className="mb-4 text-[1.9rem] font-bold leading-tight tracking-tight text-[#0f172a] sm:mb-5 sm:text-3xl md:text-[40px]">
                  Get expert feedback on your resume
                </h1>
                <p className="mb-7 text-[0.95rem] leading-relaxed text-[#334155] sm:mb-10 sm:text-base md:text-[17px]">
                  Make small improvements to your resume score. A match rate of 85% or higher significantly boosts your interview chances.
                </p>
                <button
                  type="button"
                  onClick={() => setStage("idle")}
                  className="ds-btn-primary inline-flex items-center gap-2 !h-12 !rounded-full !px-8 !text-[16px]"
                >
                  <SparklesIcon className="h-5 w-5 shrink-0" aria-hidden />
                  Check your resume now
                </button>
              </div>

              <div className="absolute bottom-0 right-[-60px] top-10 z-0 hidden w-[320px] text-right opacity-50 sm:block lg:right-0 lg:opacity-100">
                <img
                  src="https://www.pitchcv.app/assets/resume-example-1.png"
                  alt="Resume Preview"
                  className="h-auto w-full rounded-tl-md bg-white object-cover object-top shadow-[-10px_10px_40px_-10px_rgba(0,0,0,0.15)]"
                />

                <div className="absolute right-5 top-5 flex items-center gap-3 rounded-xl border border-[#f1f5f9] bg-white p-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                  <div className="inline-block rounded-lg bg-[#fb7185] px-2.5 py-1.5 text-center text-[1.05rem] font-bold text-white">
                    85%
                  </div>
                  <div className="text-[0.9rem] font-semibold leading-snug text-[#334155]">
                    ATS
                    <br />
                    Match
                  </div>
                </div>

                <div className="absolute left-[-20px] top-32 flex w-[180px] flex-col gap-2.5 rounded-xl border border-[#f1f5f9] bg-white p-3.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Skills analysis</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                      </div>
                      <span className="truncate text-[12px] font-semibold text-[#334155]">Strategic Planning</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                      </div>
                      <span className="truncate text-[12px] font-semibold text-[#334155]">Market Expansion</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <span className="truncate text-[12px] font-medium text-[#64748b] line-through decoration-[#fb7185]/50 decoration-2">
                        B2C Sales
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : stage === "idle" ? (
        /* Шаги 1–2 всегда видны; при исчерпанном free scan — модалка поверх (проверка не стартует). */
        <div className="relative flex-1 flex flex-col min-h-[50vh]">
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto w-full items-stretch content-start">
          {/* Шаг 1 — слева */}
          <section
            className={`rounded-2xl border overflow-hidden flex flex-col min-h-0 transition-colors ${
              hasResume ? "border-transparent bg-[#f8f9fb]" : "border-[var(--border)] bg-white"
            }`}
            aria-labelledby="step1-heading"
          >
            <div className="p-4 sm:p-6 pb-4 flex items-start justify-between gap-3 sm:gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap justify-start">
                  {hasResume ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-600 px-3 py-1 text-xs font-medium border border-emerald-200">
                      <CheckCircleIcon className="w-4 h-4 shrink-0" aria-hidden />
                      {t("optimize.step1")}
                    </span>
                  ) : (
                    <span className="inline-block rounded-lg border border-[var(--accent)] bg-[var(--accent)]/5 px-3 py-1 text-xs font-medium text-[var(--accent)]">
                      {t("optimize.step1")}
                    </span>
                  )}
                  <h1 id="step1-heading" className="text-lg sm:text-xl font-bold tracking-tight text-[var(--text)]">
                    {t("optimize.addResume")}
                  </h1>
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mt-1 text-left">
                  {t("optimize.addResumeHint")}
                </p>
              </div>
              {hasResume && (
                <button
                  type="button"
                  onClick={handleClearResume}
                  className="group shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:ring-offset-1 rounded px-1.5 py-0.5 transition-colors"
                >
                  <ArrowPathIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {t("optimize.changeResume")}
                </button>
              )}
            </div>
            <div className="flex-1 flex flex-col min-h-0 px-4 sm:px-6 pb-4 sm:pb-6">
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
                  isDragging ? "border-[#5e8afc]/60" : hasResume ? "border-[#d8dce8]/80" : "border-[#d8dce8]"
                }`}
                style={{
                  background: hasResume
                    ? "linear-gradient(165deg, #eef0f4 0%, #e6e9ef 50%, #dfe2e8 100%)"
                    : isDragging
                      ? "linear-gradient(165deg, #e8eeff 0%, #f0f4ff 50%, #e0e8fc 100%)"
                      : "linear-gradient(165deg, #f5f6f9 0%, #eef0f5 40%, #e8eaef 100%)",
                }}
              >
                {hasResume ? (
                  <>
                    <div
                      className="absolute inset-0 backdrop-blur-[2px] bg-white/20 pointer-events-none"
                      aria-hidden
                    />
                    <div className="absolute inset-0 overflow-hidden flex flex-col items-center justify-end" style={{ paddingBottom: "0.5rem" }}>
                      {(() => {
                        const isPdfFromHistory = uploadedFileName?.toLowerCase().endsWith(".pdf");
                        if (resumeThumbnailUrl) {
                          return <ResumeThumbnailBlock imageUrl={resumeThumbnailUrl} />;
                        }
                        if (lastUploadedPdfFile && lastUploadedPdfFile.name.toLowerCase().endsWith(".pdf")) {
                          return (
                            <ResumePdfPreview
                              file={lastUploadedPdfFile}
                              onThumbnailLoaded={(url) => setResumeThumbnailUrl(url)}
                            />
                          );
                        }
                        if (isPdfFromHistory && user?.id && user.id !== "local" && !lastUploadedPdfFile) {
                          return (
                            <ResumeHistoryThumbnailPreview
                              filename={uploadedFileName!}
                            />
                          );
                        }
                        return (
                          <ResumeSheetPreview
                            name={resumeName?.first || resumeName?.last ? [resumeName.first, resumeName.last].filter(Boolean).join(" ") : "Resume"}
                          />
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <>
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
                      <div className="hidden sm:flex rounded-full bg-white/90 border border-[var(--accent)]/20 p-3 shadow-sm" aria-hidden>
                        <ArrowUpTrayIcon className="w-8 h-8 text-[var(--accent)]" />
                      </div>
                      <p className="hidden sm:block text-[13px] sm:text-sm font-bold text-[var(--text)] uppercase tracking-wide">
                        {t("optimize.dragHere")}
                      </p>
                      <p className="hidden sm:block text-xs text-[var(--text-tertiary)]">
                        {t("optimize.orFormats")}
                      </p>
                      <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <button
                          type="button"
                          onClick={() => { setResumeInputMode("file"); fileInputRef.current?.click(); }}
                          className={`inline-flex justify-center items-center gap-2 px-4 py-3 sm:px-3 sm:py-2 text-base sm:text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:ring-offset-2 w-full sm:w-auto ${
                            resumeInputMode === "file"
                              ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/50 hover:bg-[var(--accent)]/25"
                              : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[var(--accent-soft)]"
                          }`}
                        >
                          <ArrowUpTrayIcon className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" aria-hidden />
                          <span className="sm:hidden">{t("optimize.uploadFile")}</span>
                          <span className="hidden sm:inline">{t("optimize.file")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setResumeInputMode("text"); setResumeSourceWasPdf(false); }}
                          className={`inline-flex justify-center items-center gap-2 px-4 py-3 sm:px-3 sm:py-2 text-base sm:text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:ring-offset-2 w-full sm:w-auto ${
                            resumeInputMode === "text"
                              ? "bg-[#d4f090]/60 text-[var(--text)] border border-[#b8d86a] hover:bg-[#d4f090]/80"
                              : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[var(--accent-soft)]"
                          }`}
                        >
                          <ClipboardDocumentIcon className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" aria-hidden />
                          {t("optimize.pasteAsText")}
                        </button>
                      </div>
                      {resumeInputMode === "text" && (
                        <textarea
                          value={resumeContent}
                          onChange={(e) => setResumeContent(e.target.value)}
                          onBlur={handleResumePaste}
                          placeholder={t("optimize.jobTextPlaceholder")}
                          className="w-full min-h-[5rem] max-w-md rounded-xl border border-[#c8cddc] bg-white/80 px-3 py-2.5 text-[16px] sm:text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]/50 resize-none"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Шаг 2 — справа; затемнён и неактивен, пока нет резюме */}
          <section
            ref={step2SectionRef}
            className={`relative rounded-2xl border overflow-hidden flex flex-col min-h-0 transition-all duration-200 ${
              !hasResume
                ? "opacity-60 pointer-events-none select-none border-[var(--border)] bg-white"
                : isImproveMode || hasJob
                  ? "border-transparent bg-[#f8f9fb]"
                  : "border-[var(--border)] bg-white"
            }`}
            aria-labelledby="step2-heading"
            aria-disabled={!hasResume}
          >
            {!hasResume && (
              <div className="absolute inset-0 rounded-2xl bg-[var(--bg-page)]/95 flex items-center justify-center z-10" aria-hidden>
                <p className="text-sm font-medium text-[var(--text-muted)] px-4 text-center">
                  {t("optimize.uploadResumeFirst")}
                </p>
              </div>
            )}
            <div className="relative flex-1 flex flex-col min-h-0">
              <div className="p-4 sm:p-6 pb-4 flex items-start justify-between gap-3 sm:gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap justify-start">
                    {isImproveMode || hasJob ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-600 px-3 py-1 text-xs font-medium border border-emerald-200">
                        <CheckCircleIcon className="w-4 h-4 shrink-0" aria-hidden />
                        {t("optimize.step2")}
                      </span>
                    ) : (
                      <span className="inline-block rounded-lg border border-[var(--accent)] bg-[var(--accent)]/5 px-3 py-1 text-xs font-medium text-[var(--accent)]">
                        {t("optimize.step2")}
                      </span>
                    )}
                    <h1 id="step2-heading" className="text-lg sm:text-xl font-bold tracking-tight text-[var(--text)]">
                      {isImproveMode ? t("optimize.improveModeStep2Title") : t("optimize.addJobTitle")}
                    </h1>
                  </div>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1 text-left">
                    {isImproveMode ? t("optimize.improveModeStep2Sub") : t("optimize.addJobSub")}
                  </p>
                </div>
                {!isImproveMode && hasJob && (
                  <button
                    type="button"
                    onClick={() => {
                      beginNewOptimizeWork();
                      setJobInput("");
                      setParsedJob(null);
                      setPreScores(null);
                      setResult(null);
                      setStage("idle");
                    }}
                    className="group shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:ring-offset-1 rounded px-1.5 py-0.5 transition-colors"
                  >
                    <ArrowPathIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {t("optimize.changeJob")}
                  </button>
                )}
              </div>
              <div className="px-4 sm:px-6 pb-4 sm:pb-6 flex-1 min-h-0 flex flex-col">
              {isImproveMode ? (
                <div className="mt-auto pt-2">
                  {stage === "idle" && !showFreeLimitOverlay && (
                    <div className="pt-4 pb-3 sm:pb-0 border-t border-[var(--border)]">
                      {!canAnalyzeSubscription && user?.id !== "local" ? (
                        <div className="flex flex-col items-center gap-3">
                          <p className="text-center text-[12px] text-[var(--text-muted)]">
                            {t("optimize.freeLimitReached")}
                          </p>
                          <Link
                            to="/upgrade"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center py-2.5 px-4 rounded-xl text-[13px] font-semibold text-white bg-[var(--accent)] hover:bg-[#3d6ae6] transition-colors"
                          >
                            {t("optimize.upgradeButton")}
                          </Link>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleStartScan}
                            className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3.5 px-5 text-sm font-semibold bg-[var(--accent)] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:ring-offset-2"
                          >
                            <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
                            {t("optimize.improveModeRetryScan")}
                          </button>
                          <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">
                            {t("optimize.improveModeNoJobNeeded")}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : hasJob ? (
                <>
                  <div className="flex items-center gap-2 mb-3 min-w-0" role="group" aria-label="Job">
                    <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[var(--accent)]/12" title={t("optimize.jobLinkPlaceholder")}>
                      <BriefcaseIcon className="w-3.5 h-3.5 text-[var(--accent)]" aria-hidden />
                    </span>
                    <strong className="text-sm font-semibold text-[var(--text)] truncate min-w-0 max-w-[50vw]" title={jobInput.trim()}>
                      {jobInput.trim().slice(0, 60) + (jobInput.trim().length > 60 ? "…" : "")}
                    </strong>
                  </div>
                  {(() => {
                    return (
                      <JobPreviewContent parsedJob={parsedJob} rawText={jobInput} isParsing={false} />
                    );
                  })()}
                  {stage === "idle" && !showFreeLimitOverlay && (
                    <div className="mt-5 pt-4 pb-3 sm:pb-0 border-t border-[var(--border)]">
                      {!canAnalyzeSubscription && user?.id !== "local" ? (
                        <div className="flex flex-col items-center gap-3">
                          <p className="text-center text-[12px] text-[var(--text-muted)]">
                            {t("optimize.freeLimitReached")}
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Link
                              to="/upgrade"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center py-2.5 px-4 rounded-xl text-[13px] font-semibold text-white bg-[var(--accent)] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:ring-offset-2"
                            >
                              {t("optimize.upgradeButton")}
                            </Link>
                            <span className="text-[13px] text-[var(--text-muted)]">
                              {t("optimize.upgradeToImproveSuffix")}
                            </span>
                          </div>
                          {freeLimitUpsellDismissed && (
                            <button
                              type="button"
                              onClick={() => setFreeLimitUpsellDismissed(false)}
                              className="text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 rounded px-1"
                            >
                              {t("optimize.freeLimitShowPlansAgain")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleStartScan}
                            className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3.5 px-5 text-sm font-semibold bg-[var(--accent)] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
                          >
                            <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
                            {t("optimize.checkMatch")}
                          </button>
                          <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">
                            {t("optimize.willStartScan")}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col space-y-4 text-left">
                  {offerPasteAsText && (
                    <div id="paste-job-hint" className="flex gap-2 text-sm text-[var(--text-muted)]/90" role="status" aria-live="polite">
                      <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
                      <p>
                        {t("optimize.jobScrapeError")}
                      </p>
                    </div>
                  )}
                  <textarea
                    value={jobInput}
                    onChange={(e) => {
                      setJobInput(e.target.value);
                      if (e.target.value.trim().length > 100) setOfferPasteAsText(false);
                    }}
                    placeholder={t("optimize.jobTextPlaceholder")}
                    className="w-full min-h-[7rem] rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-[16px] sm:text-sm text-[var(--text)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]/40 resize-none"
                    aria-describedby={offerPasteAsText ? "paste-job-hint" : undefined}
                  />
                </div>
              )}
              </div>
            </div>
          </section>
        </div>
        {showFreeLimitOverlay && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="free-limit-heading"
            className="absolute inset-0 z-[30] flex items-start justify-center overflow-y-auto py-4 sm:py-8 px-3 sm:px-4 bg-[#0f172a]/45 backdrop-blur-[3px]"
            onClick={() => setFreeLimitUpsellDismissed(true)}
          >
            <div
              className="w-full max-w-xl pb-6 sm:pb-10"
              onClick={(e) => e.stopPropagation()}
            >
              <OptimizeFreeLimitWall
                checkoutError={freeLimitCheckoutError}
                checkoutLoading={freeLimitCheckoutLoading}
                onEditSetup={() => setFreeLimitUpsellDismissed(true)}
                onStartTrial={() => void handleFreeLimitStartTrial()}
              />
            </div>
          </div>
        )}
        </div>
      ) : (
        <>
          {(stage === "scanning" || stage === "loading" || (stage === "assessment" && preScores == null)) &&
            (hasResume && hasJob || awaitingLandingClaim) && (
            <>
              {(stage === "scanning" || (stage === "assessment" && preScores == null)) && (
                <OptimizePipelineLoader
                  heroVariant="analysis"
                  labels={pipelineAnalysisLabels}
                  subtitles={pipelineAnalysisSubtitles}
                  completedSteps={analysisPipelineCompleted}
                  fact={!awaitingLandingClaim ? activeLoadingHint : undefined}
                  topHint={
                    awaitingLandingClaim
                      ? t("optimize.preparingLandingCheckSub")
                      : undefined
                  }
                  ariaLabel={
                    awaitingLandingClaim
                      ? t("optimize.preparingLandingCheck")
                      : stage === "scanning"
                        ? t("optimize.scanningLabel")
                        : t("optimize.analysisLabel")
                  }
                />
              )}

              {stage === "loading" && (
                <OptimizePipelineLoader
                  heroVariant="optimize"
                  labels={pipelineOptimizeLabels}
                  subtitles={pipelineOptimizeSubtitles}
                  completedSteps={optimizePipelineCompleted}
                  fact={activeLoadingHint}
                  ariaLabel={t("optimize.improvingResume")}
                />
              )}
            </>
          )}
        </>
      )}

      {optimizePaywallOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[45] flex items-start justify-center overflow-y-auto py-4 sm:py-10 px-3 sm:px-4 bg-[#0f172a]/50 backdrop-blur-[3px]"
          onClick={() => setOptimizePaywallOpen(false)}
        >
          <div className="w-full max-w-xl pb-6 sm:pb-10 pt-2" onClick={(e) => e.stopPropagation()}>
            <OptimizeFreeLimitWall
              checkoutError={optimizePaywallCheckoutError}
              checkoutLoading={optimizePaywallCheckoutLoading}
              onEditSetup={() => setOptimizePaywallOpen(false)}
              onStartTrial={() => void handleOptimizePaywallStartTrial()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
