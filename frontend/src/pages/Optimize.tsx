import { useState, useEffect, useLayoutEffect, useRef, useId } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { SparklesIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, ArrowPathIcon, ArrowLeftIcon, BriefcaseIcon, ClipboardDocumentIcon, ExclamationTriangleIcon, CheckCircleIcon, CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import * as api from "../api";
import { useAuth } from "../contexts/AuthContext";
import { t, tFormat } from "../i18n";
import { PostResultResumeStudio } from "../components/PostResultResumeStudio";

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

/** Object-URL thumbnail (e.g. PDF preview blob): skeleton until decoded. */
function ResumeBlobThumbnail({ url }: { url: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
  }, [url]);
  return (
    <div className="relative h-full min-h-[96px] w-full">
      {!ready && <ResumeFrameSkeleton />}
      <img
        src={url}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-200 ${
          ready ? "opacity-90" : "opacity-0"
        }`}
        onLoad={() => setReady(true)}
      />
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
        <p className="text-base font-bold text-[#181819] tracking-tight">{name}</p>
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
    <p className="mt-10 max-w-[min(22rem,90vw)] text-center text-[13px] leading-relaxed text-[var(--text-tertiary)]">
      {body}
    </p>
  );
}

/** Minimal “AI wait” indicator — three soft dots, no heavy chrome */
function LoaderDots() {
  return (
    <div className="mb-10 flex items-center justify-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[#4578FC]/55 motion-safe:animate-[loader-dot_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
      <style>{`
        @keyframes loader-dot {
          0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>
    </div>
  );
}

function OptimizeLoaderCard({
  title,
  subtitle,
  progress,
  progressAriaLabel,
  fact,
}: {
  title: string;
  subtitle: string;
  progress?: number;
  progressAriaLabel?: string;
  fact?: string;
}) {
  const safeProgress = progress == null ? undefined : Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className="flex w-full max-w-lg flex-col items-center px-5 text-center">
      <LoaderDots />

      <h2 className="text-[15px] font-medium tracking-[-0.01em] text-[#181819] sm:text-base">{title}</h2>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)] sm:text-[14px]">{subtitle}</p>

      {safeProgress != null ? (
        <div className="mt-8 w-full max-w-[200px]">
          <div className="h-px w-full overflow-hidden rounded-full bg-[#E4E7EF]">
            <div
              className="h-full rounded-full bg-[#4578FC]/90 transition-[width] duration-300 ease-out"
              style={{ width: `${safeProgress}%` }}
              role="progressbar"
              aria-valuenow={safeProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={progressAriaLabel}
            />
          </div>
        </div>
      ) : null}

      {fact ? <LoaderFactCard fact={fact} /> : null}
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

function getAtsScore(result: api.OptimizeResponse): number | null {
  const r = result.validation.results.find((f) => f.filter_name === "LLMChecker");
  return r != null ? normalizeScorePercent(r.score) : null;
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

function ScoreRing({
  percent,
  size = 46,
  thickness = 6,
}: {
  percent: number;
  size?: number;
  thickness?: number;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const angle = (pct / 100) * 360;
  const startDeg = 270;
  const ringMask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 calc(100% - ${thickness}px))`;
  const qualityColor = scoreProgressColor(pct);
  const filledGradient =
    "conic-gradient(from 270deg, #dc2626 0%, #f59e0b 25%, #f59e0b 45%, #16a34a 60%, #16a34a 100%)";
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

function getQualityLevelLabel(qualityPct: number): string {
  const q = Math.max(0, Math.min(100, Math.round(qualityPct)));
  if (q >= 80) return t("optimize.resumeQualityLevelExcellent");
  if (q >= 60) return t("optimize.resumeQualityLevelStrong");
  if (q >= 45) return t("optimize.resumeQualityLevelGood");
  if (q >= 25) return t("optimize.resumeQualityLevelFair");
  return t("optimize.resumeQualityLevelLow");
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function rollPostImproveDiagramScore(): number {
  // Product rule: after optimization show a realistic random match range.
  // Inclusive integer range: 82-93.
  return 82 + Math.floor(Math.random() * 12);
}

function cleanRecommendationReason(label: string): string {
  return label
    .replace(/\s*-\s*(missing|weak mention|none listed|ok|present)$/i, "")
    .trim();
}

function compactRecommendationTopic(label: string): string {
  const clean = cleanRecommendationReason(label).replace(/\s+/g, " ").trim();
  if (!clean) return "this requirement";
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

function impactFromRecommendationLabel(label: string, category?: string): string {
  const l = label.toLowerCase();
  const topic = compactRecommendationTopic(label);
  const c = (category || "").toLowerCase();
  if (l.includes("ci/cd")) return "ATS treats you as less production-ready and lowers shortlist priority.";
  if (l.includes("figma")) return "Cross-team collaboration signal is weak for product roles.";
  if (l.includes("metrics")) return "Without numbers, recruiters cannot estimate your real impact.";
  if (l.includes("leadership")) return "You look like an individual contributor instead of a leader.";
  if (l.includes("spelling") || l.includes("grammar") || l.includes("typo") || l.includes("fehler")) {
    return "Language quality mismatches vacancy expectations and can cause early rejection.";
  }
  if (c.includes("keyword")) {
    return `Without clear evidence for "${topic}", ATS may rank your resume below better-matched candidates.`;
  }
  if (c.includes("structure")) {
    return `Weak structure around "${topic}" makes the resume harder to scan for both ATS and recruiters.`;
  }
  if (c.includes("requirement")) {
    return `If "${topic}" is not explicitly evidenced, you can be filtered out as not meeting core requirements.`;
  }
  return `Weak evidence for "${topic}" lowers your relevance in ATS and recruiter screening.`;
}

function fixFromRecommendationLabel(label: string, category?: string): string {
  const l = label.toLowerCase();
  const topic = compactRecommendationTopic(label);
  const c = (category || "").toLowerCase();
  if (l.includes("ci/cd")) return "Add one bullet showing CI/CD ownership and release impact.";
  if (l.includes("figma")) return "Mention collaboration with design and product discovery artifacts.";
  if (l.includes("metrics")) return "Rewrite 2–3 bullets with measurable outcomes (%, $, team size).";
  if (l.includes("leadership")) return "Add one leadership example with team scope and business result.";
  if (l.includes("role-specific hard skills")) {
    return "Add 2-3 exact vacancy tools you truly used, and tie each to one concrete outcome.";
  }
  if (l.includes("clear section headings")) {
    return "Use ATS-friendly section names (Summary, Experience, Skills, Education) and keep consistent order.";
  }
  if (l.includes("facebook business manager") || l.includes("meta ads") || l.includes("perspective")) {
    return "Mention this exact tool in skills and in one achievement bullet with a concrete result.";
  }
  if (l.includes("terminology") || l.includes("keyword")) {
    return "Reuse exact vacancy wording in summary and experience bullets where it is truthful.";
  }
  if (l.includes("spelling") || l.includes("grammar") || l.includes("typo") || l.includes("fehler")) {
    return "Fix language mistakes and keep formal, error-free wording across all sections.";
  }
  if (c.includes("keyword")) {
    return `Add truthful evidence for "${topic}" in skills and one relevant experience bullet.`;
  }
  if (c.includes("structure")) {
    return `Improve "${topic}" by shortening long text into bullets and making section flow clearer.`;
  }
  if (c.includes("requirement")) {
    return `Add explicit, truthful proof for "${topic}" with measurable business result.`;
  }
  return `Add one concrete, truthful bullet proving "${topic}" with measurable outcome.`;
}

/** LLM often returns one full sentence per item — avoid duplicating with a generic fix line. */
function recommendationLabelIsSelfContained(label: string): boolean {
  const t = label.trim();
  if (t.length >= 88) return true;
  if (/[.!?]\s/.test(t)) return true;
  return false;
}

function recommendationPriorityScore(label: string): number {
  const l = label.toLowerCase();
  let score = 1;
  if (l.includes("missing")) score += 3;
  if (l.includes("none")) score += 3;
  if (l.includes("weak")) score += 2;
  if (l.includes("metrics") || l.includes("leadership") || l.includes("ci/cd")) score += 2;
  return score;
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

function normalizeCategoryKey(category: string): string {
  const c = (category || "").trim().toLowerCase();
  if (c.includes("keyword")) return "keywords";
  if (c.includes("requirement")) return "requirements";
  if (c.includes("structure")) return "structure";
  if (c.includes("skill")) return "skills";
  if (c.includes("experience")) return "experience";
  if (c.includes("portfolio")) return "portfolio";
  if (c.includes("ats") || c.includes("match")) return "ats";
  return "general";
}

function fallbackLabelsByCategory(categoryKey: string, scorePct: number | null): string[] {
  const low = scorePct != null && scorePct < 60;
  const mid = scorePct != null && scorePct >= 60 && scorePct < 75;
  switch (categoryKey) {
    case "keywords":
      if (low) return ["Add role-specific hard skills", "Mirror exact vacancy terminology", "Mention stack/tools in achievements"];
      if (mid) return ["Strengthen keyword coverage in experience bullets", "Add missing tools from requirements"];
      return ["Maintain keyword consistency", "Keep strongest terms in top sections"];
    case "requirements":
      if (low) return ["Address must-have requirements explicitly", "Add measurable outcomes relevant to the role", "Show domain-specific practice"];
      if (mid) return ["Tighten alignment with core requirements", "Prioritize matching responsibilities first"];
      return ["Keep requirement alignment explicit", "Preserve evidence-based claims"];
    case "structure":
      if (low) return ["Use clear section headings", "Shorten long paragraphs into bullets", "Move strongest impact points to top"];
      if (mid) return ["Improve section flow and ordering", "Keep bullets concise and specific"];
      return ["Keep current section clarity", "Preserve readable layout and hierarchy"];
    case "skills":
      if (low) return ["Highlight core technical skills first", "Tie skills to real project outcomes"];
      return ["Keep skills prioritized by relevance", "Support skills with practical examples"];
    case "experience":
      if (low) return ["Emphasize measurable business impact", "Prioritize recent and relevant roles"];
      return ["Keep achievements outcome-focused", "Maintain role relevance by job target"];
    case "portfolio":
      if (low) return ["Add strongest projects with outcomes", "Show tech stack and your contribution clearly"];
      return ["Keep project descriptions concise", "Maintain links and measurable results"];
    case "ats":
      if (low) return ["Align wording with ATS-parsed fields", "Use standard section names and chronology"];
      return ["Keep ATS-friendly structure", "Maintain clear, parseable formatting"];
    default:
      if (low) return ["Focus on role relevance first", "Replace generic claims with evidence"];
      return ["Keep content focused and specific", "Maintain concise, evidence-driven phrasing"];
  }
}

function isPositiveRecommendationLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  const positivePrefixes = ["ok", "clear", "match", "maintain", "keep", "preserve", "well-structured", "aligned"];
  return positivePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function buildScanResultParagraphs(params: {
  aiTips?: string | null;
  riskSummary?: string | null;
  criticalIssues?: string[];
  fallbackAts: string;
  fallbackKeywords: string;
  addImproveNotice: boolean;
}): string[] {
  const baseFallback = `${params.fallbackAts} ${params.fallbackKeywords}`.trim();
  const issueText = (params.criticalIssues || [])
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(". ");
  const source = [params.riskSummary, issueText, params.aiTips, baseFallback]
    .map((x) => (x || "").trim())
    .find((x) => x.length > 0) || "";
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Keep the output concise: around 3x shorter, capped to 4-5 sentences.
  const byRatioCap = Math.max(4, Math.min(5, Math.floor(sentences.length / 3)));
  const maxSentences = Math.min(5, byRatioCap);
  const picked = sentences.slice(0, maxSentences);

  const result: string[] = [];
  for (let i = 0; i < picked.length; i += 2) {
    result.push(picked.slice(i, i + 2).join(" "));
  }

  if (params.addImproveNotice && result.length === 0) {
    result.push(t("optimize.lowScoreNeedsImprovement"));
  }
  return result.slice(0, 3);
}

function groupRecommendations(
  items: api.RecommendationItem[] | undefined,
  scores: {
    ats: number | null;
    keywords: number | null;
  }
): { category: string; labels: string[] }[] {
  if (!items || items.length === 0) return [];
  const overall = (() => {
    const values = [scores.ats, scores.keywords].filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  })();

  const pickScoreForCategory = (categoryKey: string): number | null => {
    if (categoryKey === "ats") return scores.ats ?? overall;
    if (categoryKey === "keywords") return scores.keywords ?? overall;
    if (categoryKey === "requirements") return scores.keywords ?? scores.ats ?? overall;
    if (categoryKey === "structure") return scores.ats ?? overall;
    return overall;
  };

  const groups = new Map<string, string[]>();
  for (const rec of items) {
    const category = (rec.category || "").trim() || "General";
    if (!groups.has(category)) groups.set(category, []);
    const existing = groups.get(category)!;
    for (const raw of rec.labels || []) {
      const label = (raw || "").trim();
      if (!label) continue;
      if (!existing.includes(label)) existing.push(label);
    }
  }
  return Array.from(groups.entries()).map(([category, labels]) => {
    const categoryKey = normalizeCategoryKey(category);
    const categoryScore = pickScoreForCategory(categoryKey);
    const allowOk = categoryScore == null || categoryScore >= 75;
    const cleaned = labels.filter((label) => {
      const normalized = label.trim().toLowerCase();
      if (!allowOk && (normalized === "ok" || normalized === t("optimize.filterOk").toLowerCase())) {
        return false;
      }
      return true;
    });

    const fallback = fallbackLabelsByCategory(categoryKey, categoryScore);
    const maxLabels = categoryKey === "keywords" ? 16 : 5;
    const limited = cleaned.slice(0, maxLabels);
    // Do not force a fixed amount of issues.
    // If model/backend provided concrete items, keep their natural count.
    // Keywords: backend sends missing terms as chips — do not inject generic instructional fallback text.
    if (limited.length === 0 && categoryKey !== "keywords") {
      for (const fb of fallback) {
        if (limited.length >= 1) break;
        if (!limited.some((x) => x.toLowerCase() === fb.toLowerCase())) limited.push(fb);
      }
    }

    return { category, labels: limited };
  });
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
    <div className="w-full max-w-xl mx-auto space-y-4 rounded-2xl bg-[#FAFAFC] p-4 sm:p-5 shadow-xl border border-[#EBEDF5]">
      <section
        className="rounded-2xl border border-[#E6E9F5] bg-white p-4 sm:p-5 shadow-sm"
        aria-labelledby="free-limit-heading"
      >
        <div className="min-w-0 space-y-2">
          <h1 id="free-limit-heading" className="text-lg sm:text-xl font-semibold tracking-tight text-[#181819]">
            {t("optimize.freeLimitWallTitle")}
          </h1>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            {t("optimize.freeLimitWallSubtitle")}
          </p>
          <button
            type="button"
            onClick={onEditSetup}
            className="text-sm font-semibold text-[#4578FC] hover:text-[#3d6ae6] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 rounded"
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
        className="rounded-2xl border border-purple-200/60 p-6 sm:p-7 flex flex-col relative overflow-hidden shadow-sm"
        style={{
          background:
            "linear-gradient(135deg, rgba(233, 213, 255, 0.4) 0%, rgba(216, 180, 254, 0.25) 40%, rgba(196, 181, 253, 0.15) 70%, rgba(232, 121, 249, 0.2) 100%)",
        }}
        aria-labelledby="inline-trial-heading"
      >
        <div
          className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 rounded-full bg-purple-300/30 blur-2xl pointer-events-none"
          aria-hidden
        />
        <div className="absolute top-0 right-0 rounded-bl-xl bg-purple-600 px-3 py-1.5 text-[10px] font-bold text-white uppercase tracking-wide z-10 shadow-sm">
          {t("upgrade.recommended")}
        </div>
        <h2 id="inline-trial-heading" className="relative z-10 text-base font-semibold text-purple-950 pr-24">
          {t("upgrade.trialTitle")}
        </h2>
        <p className="relative z-10 mt-2 text-2xl font-bold text-purple-950">{t("upgrade.trialPrice")}</p>
        <p className="relative z-10 mt-1 text-xs font-medium text-purple-800/80">{t("upgrade.trialDesc")}</p>
        <p className="relative z-10 mt-1.5 text-[11px] leading-snug text-purple-900/60 font-medium">
          {t("upgrade.trialAutoRenew")}
        </p>
        <ul className="relative z-10 mt-6 space-y-3 text-sm font-medium text-purple-950">
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
            <span>{t("upgrade.trialFeature1")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
            <span>{t("upgrade.trialFeature2")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
            <span>{t("upgrade.trialFeature3")}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckIcon className="w-5 h-5 text-purple-700 shrink-0" />
            <span>{t("upgrade.trialFeature4")}</span>
          </li>
        </ul>
        <div className="relative z-10 mt-6 flex flex-col gap-3">
          <button
            type="button"
            disabled={checkoutLoading}
            onClick={onStartTrial}
            className="flex items-center justify-center w-full rounded-xl bg-purple-600 text-sm font-semibold text-white py-3 px-4 shadow-sm hover:bg-purple-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:ring-offset-2 disabled:opacity-70"
          >
            {checkoutLoading ? t("upgrade.redirectingStripe") : t("upgrade.startTrial")}
          </button>
          <Link
            to="/upgrade"
            className="text-center text-sm font-semibold text-purple-900/80 hover:text-purple-950 underline-offset-2 hover:underline"
          >
            {t("optimize.freeLimitWallComparePlans")}
          </Link>
        </div>
        <p className="relative z-10 mt-4 text-[11px] text-purple-900/55 text-center leading-snug">
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
  const [postImproveDiagramScore, setPostImproveDiagramScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
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
  const autoImproveStartedRef = useRef(false);
  const [loadingHintIndex, setLoadingHintIndex] = useState(0);
  const [improveHintIndex, setImproveHintIndex] = useState(0);
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
  const autoImproveGateRef = useRef<{
    preScores: api.AnalyzeResponse | null;
    resumeContent: string;
    jobInput: string;
    stage: Stage;
  }>({ preScores: null, resumeContent: "", jobInput: "", stage: "landing" });

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
        setResumeContent(data.resume_content);
        setUploadedFileName(data.resume_filename);
        setResumeSourceWasPdf((data.resume_filename || "").toLowerCase().endsWith(".pdf"));
        if (data.job_text) {
          setJobInput(data.job_text);
          setJobMode("text");
        }
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
  }, [pendingToken, user, setSearchParams]);

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
        setPostImproveDiagramScore(null);
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
      setPostImproveDiagramScore(null);
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
      sessionStorage.removeItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY);
      sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Return from Stripe checkout (trial / subscription) — refresh profile
  useEffect(() => {
    const co = searchParams.get("checkout");
    if (co !== "success" && co !== "cancel") return;
    if (co === "cancel") {
      sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
    }
    void refreshUser();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("checkout");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, refreshUser]);

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
  const hasJobInput = !!jobInput.trim();
  const hasJob = hasJobInput;
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
    setIsAnalyzing(true);
    setPreScores(null);
    const jobPayload = jobMode === "text" ? { job_text: jobInput.trim() } : { job_url: jobInput.trim() };
    api
      .analyze({
        resume_content: resumeContent.trim(),
        ...jobPayload,
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
        }
      })
      .finally(() => {
        if (analyzeMountedRef.current) setIsAnalyzing(false);
      });
  }, [stage, hasResume, hasJob, jobMode, jobInput, resumeContent, result, refreshUser, selectedTemplateId]);

  // PDF thumbnail on assessment when user is not logged in (no register-upload path).
  useEffect(() => {
    if (stage !== "assessment" || !lastUploadedPdfFile || resumeThumbnailUrl) return;
    if (!lastUploadedPdfFile.name.toLowerCase().endsWith(".pdf")) return;
    if (user) return;
    let cancelled = false;
    api
      .getResumeThumbnailUrl(lastUploadedPdfFile)
      .then((url) => {
        if (!cancelled) setResumeThumbnailUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stage, lastUploadedPdfFile, resumeThumbnailUrl, user]);

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

  function openDownloadCheckoutFlow() {
    if (!user || user.id === "local") {
      navigate("/login");
      return;
    }
    persistOptimizeSnapshotForCheckout();
    const q = new URLSearchParams();
    q.set("return_to", "/optimize");
    if (result?.pending_export_token) q.set("pending", result.pending_export_token);
    if (result?.pending_export_expires_at) q.set("exp", result.pending_export_expires_at);
    navigate(`/checkout/download-resume?${q.toString()}`);
  }

  async function runOptimizeResumeMax() {
    setError(null);
    optimizeLoadStartedAtRef.current = Date.now();
    sseOptimizeCapRef.current = 0;
    setStage("loading");
    setLoadProgress(0);
    setDisplayLoadProgress(0);
    const params = {
      resume_content: resumeContent.trim(),
      job_text: jobMode === "text" ? jobInput.trim() : undefined,
      job_url: jobMode === "url" ? jobInput.trim() : undefined,
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
    if (!result?.schema_json || pendingPdfDownloadLoading) return;
    setPendingPdfDownloadLoading(true);
    setError(null);
    try {
      let baseSchema: any = {};
      try {
        baseSchema = JSON.parse(result.schema_json);
      } catch {
        /* ignore */
      }
      const schemaWithPhoto = {
        ...baseSchema,
        basics: {
          ...(baseSchema.basics || {}),
          image: photoDataUrl || undefined,
        },
      };
      
      const res = await api.renderTemplatePdf({
        template_id: selectedTemplateId || "jsonresume-even-inspired", // Fallback to a default if empty
        schema: schemaWithPhoto as any,
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
    if (!ctx.preScores || !ctx.resumeContent.trim() || !ctx.jobInput.trim() || ctx.stage !== "assessment") return;
    if (autoImproveStartedRef.current) return;
    autoImproveStartedRef.current = true;
    setPendingAutoImproveAfterCheckout(false);
    sessionStorage.removeItem(OPTIMIZE_CHECKOUT_SNAPSHOT_KEY);
    sessionStorage.removeItem(OPTIMIZE_PENDING_AUTO_IMPROVE_KEY);
    void runOptimizeResumeMax().finally(() => {
      autoImproveStartedRef.current = false;
    });
  }, [pendingAutoImproveAfterCheckout, hasPaidPlan, user?.id]);

  useEffect(() => {
    if (stage !== "result") setPostResultFlow("main");
  }, [stage]);

  function applyNewJobSameResume() {
    if (!result) return;
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
      job_text: jobMode === "text" ? jobInput.trim() : undefined,
      job_url: jobMode === "url" ? jobInput.trim() : undefined,
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
  useLayoutEffect(() => {
    if (result && !result.error) {
      setPostImproveDiagramScore(rollPostImproveDiagramScore());
      return;
    }
    setPostImproveDiagramScore(null);
  }, [result]);

  /** "Improve even stronger" only when rolled score is at the low end (82); 83+ hides the CTA. */
  const showOptimizeAgainForAts =
    Boolean(result && !result.error && postImproveDiagramScore != null && postImproveDiagramScore <= 82);

  const showSummaryBlocks = (stage === "assessment" && preScores != null) || stage === "result";
  const recommendationGroups = groupRecommendations(preScores?.recommendations, {
    ats: normalizeScorePercent(preScores?.ats_score),
    keywords: normalizeScorePercent(preScores?.keyword_score),
  });
  /** Ждём claim `/landing/claim` после ?pending= — показываем лоадер вместо hero */
  const awaitingLandingClaim = stage === "scanning" && claimGate && (!hasResume || !hasJob);
  const isLoadingAssessment =
    awaitingLandingClaim || stage === "scanning" || (stage === "assessment" && preScores == null);
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
  const improveLoadingHints = [
    t("optimize.loadingImproveUser1"),
    t("optimize.loadingImproveUser2"),
    t("optimize.loadingImproveUser3"),
    t("optimize.loadingImproveUser4"),
    t("optimize.loadingImproveUser5"),
    t("optimize.loadingImproveUser6"),
    t("optimize.loadingImproveUser7"),
    t("optimize.loadingImproveUser8"),
    t("optimize.loadingImproveUser9"),
    t("optimize.loadingImproveUser10"),
    t("optimize.loadingImproveUser11"),
    t("optimize.loadingImproveUser12"),
  ];
  const activeImproveLoadingHint = improveLoadingHints[improveHintIndex % improveLoadingHints.length];
  const visibleLoadProgress = stage === "loading" ? displayLoadProgress : loadProgress;

  useEffect(() => {
    if (!isLoadingAssessment) {
      setLoadingHintIndex(0);
      return;
    }
    const timer = setInterval(() => setLoadingHintIndex((idx) => idx + 1), LOADING_FACT_ROTATE_MS);
    return () => clearInterval(timer);
  }, [isLoadingAssessment]);

  useEffect(() => {
    if (stage !== "loading") {
      setDisplayLoadProgress(0);
      setImproveHintIndex(0);
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
    const textTimer = setInterval(() => setImproveHintIndex((idx) => idx + 1), LOADING_FACT_ROTATE_MS);
    return () => {
      clearInterval(progressTimer);
      clearInterval(textTimer);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "loading" && stage !== "scanning") return;
    if (typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [stage]);

  const summaryData = showSummaryBlocks
    ? (() => {
        const resumeSummary = getResumeSummary(resumeContent, resumeName);
        const normPreAts = normalizeScorePercent(preScores?.ats_score);
        const normPreKw = normalizeScorePercent(preScores?.keyword_score);
        const atsPct =
          result && atsValue != null ? atsValue : normPreAts ?? 0;
        const kwPct =
          result && keywordsValue != null
            ? normalizeScorePercent(keywordsValue.score) ?? 0
            : normPreKw ?? 0;
        const safeAts = Number.isFinite(atsPct) ? atsPct : 0;
        const safeKw = Number.isFinite(kwPct) ? kwPct : 0;
        const overallPct = Math.round((safeAts + safeKw) / 2);
        const normRejection = normalizeScorePercent(preScores?.rejection_risk_score);
        const riskPct =
          normRejection != null
            ? Math.max(0, Math.min(100, normRejection))
            : Math.max(0, 100 - overallPct);
        const displayName = resumeSummaryFromApi?.full_name?.trim() || resumeSummary.name;
        const displaySpecialty = resumeSummaryFromApi?.specialty?.trim() || resumeSummary.specialty;
        const displaySkills = resumeSummaryFromApi?.skills?.trim() || resumeSummary.skillsLine;
        const qualityPct =
          result && !result.error
            ? (postImproveDiagramScore ??
                Math.round(
                  ((atsValue != null ? atsValue : atsPct) +
                    (keywordsValue != null ? (normalizeScorePercent(keywordsValue.score) ?? 0) : kwPct)) /
                    2,
                ))
            : clampPercent(overallPct);
        return {
          atsPct,
          kwPct,
          overallPct,
          riskPct,
          qualityPct,
          displayName,
          displaySpecialty,
          displaySkills,
        };
      })()
    : null;
  const scanResultParagraphs = summaryData
    ? buildScanResultParagraphs({
        aiTips: preScores?.improvement_tips,
        riskSummary: preScores?.risk_summary,
        criticalIssues: preScores?.critical_issues,
        fallbackAts: getAtsCategory(summaryData.atsPct).description,
        fallbackKeywords: getKeywordsCategory(summaryData.kwPct).description,
        addImproveNotice: summaryData.riskPct > 45 || summaryData.overallPct < 60,
      })
    : [];

  const treatmentGroupsOptimize = recommendationGroups.map((group) => ({
    category: group.category,
    problems: group.labels.filter((label) => !isPositiveRecommendationLabel(label)),
  }));
  const problemLabelsSorted = recommendationGroups
    .flatMap((g) =>
      normalizeCategoryKey(g.category) === "keywords"
        ? []
        : g.labels.filter((l) => !isPositiveRecommendationLabel(l)),
    )
    .sort((a, b) => recommendationPriorityScore(b) - recommendationPriorityScore(a));
  const callbackBlockersOptimize = (preScores?.callback_blockers || [])
    .filter((b) => (b.headline || "").trim())
    .slice(0, 2);
  const topIssuesOptimizeLegacy = problemLabelsSorted.slice(0, 2);
  const showWhyNoCallbacksSection =
    stage === "assessment" && (callbackBlockersOptimize.length > 0 || topIssuesOptimizeLegacy.length > 0);
  const scanSummaryTextOptimize =
    scanResultParagraphs.length > 0 ? scanResultParagraphs.join(" ") : t("optimize.lowScoreNeedsImprovement");

  const resultJobTitleLabel =
    parsedJob?.title?.trim() ||
    (jobInput.trim()
      ? (() => {
          const line = jobInput.trim().split(/\r?\n/).find((l) => l.trim())?.trim() || jobInput.trim();
          return line.length > 80 ? `${line.slice(0, 77)}…` : line;
        })()
      : t("optimize.vacancyUntitled"));


  if (postResultFlow === "newJobWarning" && stage === "result" && result && !result.error) {
    const ctaPrimaryCls =
      "inline-flex min-h-[3rem] w-full flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold text-white shadow-[0_4px_20px_-8px_rgba(69,120,252,0.45)] transition-[transform,opacity] hover:opacity-[0.96] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/40 focus-visible:ring-offset-2 disabled:opacity-50 whitespace-nowrap";
    const ctaSecondaryCls =
      "inline-flex min-h-[3rem] w-full flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#4578FC] bg-white px-5 text-[15px] font-semibold text-[#4578FC] transition-colors hover:bg-[#4578FC]/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/30 focus-visible:ring-offset-2 whitespace-nowrap";

    return (
      <div className="flex flex-col gap-6 w-full min-w-0 max-w-3xl mx-auto min-h-0 overflow-x-hidden pb-28 sm:pb-16">
        <button
          type="button"
          onClick={() => setPostResultFlow("main")}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#4578FC] hover:text-[#3d6ae6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4578FC]/25 rounded-lg -ml-1 px-1 py-1 self-start"
        >
          <ArrowLeftIcon className="w-4 h-4 shrink-0" aria-hidden />
          {t("optimize.newJobWarningBack")}
        </button>

        <section className="w-full rounded-2xl border border-[#E8ECF4] bg-[#FAFAFC] p-5 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4578FC]">{t("optimize.resultExportKicker")}</p>
              <h1 className="text-xl sm:text-2xl font-semibold text-[#181819] tracking-tight leading-snug">{t("optimize.newJobWarningTitle")}</h1>
              <p className="text-[14px] sm:text-[15px] text-[#4B5563] leading-relaxed max-w-2xl">
                {tFormat(t("optimize.newJobWarningBody"), { jobTitle: resultJobTitleLabel })}
              </p>
              <p className="text-[13px] text-[#6B7280] leading-relaxed max-w-xl">{t("optimize.newJobWarningNote")}</p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:max-w-md lg:shrink-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <button
                  type="button"
                  onClick={hasPaidPlan ? handleDownloadCustomPdf : openDownloadCheckoutFlow}
                  className={ctaPrimaryCls}
                  style={{ background: "linear-gradient(160deg, #5e8afc 0%, #4578FC 45%, #3d6ae6 100%)" }}
                  disabled={pendingPdfDownloadLoading || optimizePaywallCheckoutLoading}
                >
                  <ArrowDownTrayIcon className="w-5 h-5 shrink-0" aria-hidden />
                  {pendingPdfDownloadLoading ? "Downloading..." : t("optimize.downloadPdf")}
                </button>
                <button type="button" onClick={applyNewJobSameResume} className={ctaSecondaryCls}>
                  {t("optimize.newJobWarningContinue")}
                </button>
              </div>
              <p className="text-center text-[11px] text-[#9CA3AF] leading-snug sm:text-left">{t("optimize.downloadPdfPaidHint")}</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-4 sm:gap-5 w-full min-w-0 min-h-0 overflow-x-hidden pb-28 sm:pb-12">
        {resumeBootstrapping && (
          <div
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#F2F3F9]/92 backdrop-blur-[6px] px-6"
            role="status"
            aria-live="polite"
          >
            <div className="flex w-full max-w-sm flex-col items-center text-center">
              <LoaderDots />
              <p className="mt-2 text-[15px] font-medium text-[#181819]">{t("optimize.restoringResumeSession")}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{t("optimize.doNotClosePage")}</p>
            </div>
          </div>
        )}
        {error && !isOfferPasteAsTextError(error) && (
          <div className="flex gap-2 text-sm text-[var(--text-muted)]/90 rounded-xl border border-[#EBEDF5] bg-[#FAFAFC] px-4 py-3 shrink-0" role="alert">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
            <p>{error}</p>
          </div>
        )}

      {showSummaryBlocks && summaryData ? (
        <div className="relative flex flex-col gap-4 w-full min-w-0 max-w-3xl mx-auto px-1 sm:px-0 overflow-x-hidden">
          {(() => {
            const q = summaryData.qualityPct;
            const resultViewOk = stage === "result" && result && !result.error && q >= 60;
            const ringSizes = [
              { cls: "sm:hidden", size: 104, thick: 12, fs: "text-[19px]" },
              { cls: "hidden sm:block lg:hidden", size: 110, thick: 13, fs: "text-[21px]" },
              { cls: "hidden lg:block", size: 118, thick: 14, fs: "text-[22px]" },
            ];
            return (
              <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
                <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t("optimize.overallMatchScore")}</p>
                <div
                  className={`rounded-xl border p-3.5 sm:p-4.5 ${
                    resultViewOk ? "bg-[#F0FDF4] border-[#BBF7D0]" : "bg-white border-[#ECEFF5]"
                  }`}
                >
                  <div className="flex flex-col gap-4 sm:gap-5">
                    <div className="flex flex-col lg:flex-row items-center lg:items-center gap-5 lg:gap-6 min-w-0 max-w-full">
                      <div className="flex items-center gap-3 shrink-0 max-w-full min-w-0 justify-center flex-wrap sm:flex-nowrap">
                        <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] overflow-hidden group">
                          {(() => {
                            const isPdfFromHistory = uploadedFileName?.toLowerCase().endsWith(".pdf");
                            if (resumeThumbnailUrl) {
                              return <ResumeBlobThumbnail url={resumeThumbnailUrl} />;
                            }
                            if (lastUploadedPdfFile && lastUploadedPdfFile.name.toLowerCase().endsWith(".pdf")) {
                              return <div className="absolute inset-0 bg-[#F8FAFD] animate-pulse" aria-hidden />;
                            }
                            if (isPdfFromHistory && user?.id && user.id !== "local" && !lastUploadedPdfFile && uploadedFileName) {
                              return <ResumeHistoryThumbnailPreview filename={uploadedFileName} />;
                            }
                            return (
                              <ResumeSheetPreview
                                name={
                                  resumeName?.first || resumeName?.last
                                    ? [resumeName.first, resumeName.last].filter(Boolean).join(" ")
                                    : "Resume"
                                }
                              />
                            );
                          })()}
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5 backdrop-blur-[1px] pointer-events-none">
                            <span
                              className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm ${
                                resultViewOk ? "text-[#166534] bg-white/95" : "text-[#181819] bg-white/95"
                              }`}
                            >
                              {t("home.resume")}
                            </span>
                          </div>
                        </div>
                        <span className="text-[#8A94A6] text-xl font-light">+</span>
                        <div className="w-[72px] sm:w-[84px] shrink-0 rounded bg-white shadow-[0_2px_8px_-4px_rgba(20,25,40,0.12)] border border-[#E8ECF4] flex flex-col relative aspect-[210/297] p-2 text-center justify-center min-h-[84px]">
                          {parsedJob?.title?.trim() || jobInput.trim() ? (
                            <>
                              <p className="text-[10px] sm:text-[11px] font-semibold text-[#181819] leading-tight line-clamp-4">
                                {parsedJob?.title?.trim() || jobInput.trim().slice(0, 72) || "—"}
                                {parsedJob?.title ? "" : jobInput.trim().length > 72 ? "…" : ""}
                              </p>
                              <p className="text-[8px] sm:text-[9px] text-[#6B7280] mt-1.5 line-clamp-2">
                                {parsedJob?.company?.trim() || ""}
                              </p>
                            </>
                          ) : (
                            <div className="flex flex-1 flex-col justify-center gap-1.5 px-0.5" aria-hidden>
                              <div className="h-2 w-full rounded bg-[#e8ecf4] animate-pulse" />
                              <div className="h-2 w-[80%] mx-auto rounded bg-[#e8ecf4] animate-pulse" />
                              <div className="h-1.5 w-[60%] mx-auto rounded bg-[#f1f5f9] animate-pulse mt-1" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="hidden lg:block w-px h-[100px] bg-[#E8ECF4] shrink-0" />
                      <div className="lg:hidden w-full h-px bg-[#E8ECF4]" />
                      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-4 flex-1 w-full justify-center sm:justify-start">
                        {ringSizes.map(({ cls, size, thick, fs }) => (
                          <div key={cls} className={`${cls} shrink-0 relative`} style={{ width: size, height: size }}>
                            <ScoreRing percent={q} size={size} thickness={thick} />
                            <span
                              className={`absolute inset-0 flex items-center justify-center font-bold tabular-nums ${fs} ${
                                resultViewOk ? "text-[#166534]" : "text-[#181819]"
                              }`}
                            >
                              {q}%
                            </span>
                          </div>
                        ))}
                        <div className="text-center sm:text-left flex-1 min-w-0">
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wider ${
                              resultViewOk ? "text-[#166534]" : "text-[#6B7280]"
                            }`}
                          >
                            {t("optimize.resumeQuality")} ({getQualityLevelLabel(q)})
                          </p>
                          <p className="mt-1.5 sm:mt-1 text-[11px] sm:text-[12px] text-[#6B7280] leading-relaxed max-w-[280px] mx-auto sm:mx-0">
                            {resultViewOk ? t("optimize.resumeQualityHintHigh") : t("optimize.resumeQualityHintLow")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

          {showWhyNoCallbacksSection && (
            <div className="mt-2 w-full min-w-0 max-w-full overflow-x-clip">
              <div
                className="w-full min-w-0 max-w-full rounded-[22px] border border-transparent p-[1px] overflow-hidden [contain:paint]"
                style={{
                  background:
                    "linear-gradient(#FAFAFC, #FAFAFC) padding-box, linear-gradient(120deg, #F36B7F 0%, #E94A63 45%, #C92A4B 100%) border-box",
                  backgroundSize: "100% 100%, 100% 100%",
                  backgroundPosition: "0 0, 0 0",
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
                  <p className="mt-1.5 text-[13px] text-[#4B5563] leading-relaxed break-words">{scanSummaryTextOptimize}</p>
                  <div className="mt-4 space-y-2.5">
                    {callbackBlockersOptimize.length > 0
                      ? callbackBlockersOptimize.map((cb, i) => (
                          <Disclosure key={`cb-${i}-${cb.headline.slice(0, 48)}`}>
                            {({ open }) => (
                              <div className="rounded-xl bg-white ring-1 ring-[#EDF1F7]">
                                <DisclosureButton className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[#F8FAFD] transition-colors rounded-xl">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-[#181819] leading-snug">
                                      {cleanRecommendationReason(cb.headline)}
                                    </p>
                                    <div className="mt-0.5 inline-flex items-center gap-1.5">
                                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FDECEF] px-1.5 text-[11px] font-bold text-[#C92A4B]">
                                        !
                                      </span>
                                      <p className="text-[11px] text-[#C92A4B] font-medium">{t("optimize.criticalReason")}</p>
                                    </div>
                                  </div>
                                  <ChevronDownIcon
                                    className={`w-4 h-4 text-[#6B7280] transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
                                  />
                                </DisclosureButton>
                                <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                                  <div className="pt-2 border-t border-[#EDF1F7] mt-1">
                                    <p className="text-[12px] text-[#374151] leading-relaxed">
                                      <span className="font-semibold text-[#181819]">{t("optimize.ifIgnored")}</span>{" "}
                                      {(cb.impact || "").trim()}
                                    </p>
                                    <p className="text-[12px] text-[#374151] leading-relaxed mt-1.5">
                                      <span className="font-semibold text-[#181819]">{t("optimize.whatToChange")}</span>{" "}
                                      {(cb.action || "").trim()}
                                    </p>
                                  </div>
                                </DisclosurePanel>
                              </div>
                            )}
                          </Disclosure>
                        ))
                      : topIssuesOptimizeLegacy.map((issue) => (
                          <Disclosure key={issue}>
                            {({ open }) => (
                              <div className="rounded-xl bg-white ring-1 ring-[#EDF1F7]">
                                <DisclosureButton className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-[#F8FAFD] transition-colors rounded-xl">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-[#181819] leading-snug">
                                      {cleanRecommendationReason(issue)}
                                    </p>
                                    <div className="mt-0.5 inline-flex items-center gap-1.5">
                                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#FDECEF] px-1.5 text-[11px] font-bold text-[#C92A4B]">
                                        !
                                      </span>
                                      <p className="text-[11px] text-[#C92A4B] font-medium">{t("optimize.criticalReason")}</p>
                                    </div>
                                  </div>
                                  <ChevronDownIcon
                                    className={`w-4 h-4 text-[#6B7280] transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
                                  />
                                </DisclosureButton>
                                <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                                  <div className="pt-2 border-t border-[#EDF1F7] mt-1">
                                    <p className="text-[12px] text-[#374151] leading-relaxed">
                                      <span className="font-semibold text-[#181819]">{t("optimize.ifIgnored")}</span>{" "}
                                      {impactFromRecommendationLabel(issue, "critical")}
                                    </p>
                                    <p className="text-[12px] text-[#374151] leading-relaxed mt-1.5">
                                      <span className="font-semibold text-[#181819]">{t("optimize.whatToChange")}</span>{" "}
                                      {fixFromRecommendationLabel(issue, "critical")}
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
          )}

          {stage === "assessment" && treatmentGroupsOptimize.some((g) => g.problems.length > 0) && (
            <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5">
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">{t("optimize.recommendationsTitle")}</p>
              <div className="mt-3 space-y-2.5">
                {treatmentGroupsOptimize.map((group) =>
                  group.problems.length === 0 ? null : (
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
                                <p className="text-[11px] text-[#6B7280]">{t("optimize.issuesToFix")}</p>
                              </div>
                            </div>
                            <ChevronDownIcon className={`w-4 h-4 text-[#6B7280] transition-transform shrink-0 ${open ? "rotate-180" : ""}`} />
                          </DisclosureButton>
                          <DisclosurePanel className="px-3.5 pb-3.5 pt-0">
                            {normalizeCategoryKey(group.category) === "keywords" ? (
                              <div
                                className="flex flex-wrap gap-1.5 pt-2 border-t border-[#EDF1F7] mt-1"
                                role="list"
                                aria-label={t("optimize.keywordsMissingTerms")}
                              >
                                {group.problems.map((label) => (
                                  <span
                                    key={`${group.category}-${label}`}
                                    role="listitem"
                                    className="inline-flex max-w-full items-center truncate rounded-md border border-[#E8ECF3] bg-[#F4F6FA] px-2 py-0.5 text-[11px] font-medium leading-tight text-[#4B5563]"
                                    title={cleanRecommendationReason(label)}
                                  >
                                    {cleanRecommendationReason(label)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <ul className="space-y-1.5 pl-0">
                                {group.problems.map((label) => (
                                  <li key={`${group.category}-${label}`} className="px-0.5 py-1">
                                    <p className="text-[12px] font-medium text-[#181819] leading-snug">
                                      {cleanRecommendationReason(label)}
                                    </p>
                                    {!recommendationLabelIsSelfContained(label) ? (
                                      <p className="mt-0.5 text-[11px] text-[#6B7280] leading-relaxed">
                                        {fixFromRecommendationLabel(label, group.category)}
                                      </p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </DisclosurePanel>
                        </div>
                      )}
                    </Disclosure>
                  ),
                )}
              </div>
            </section>
          )}

          {stage === "assessment" && (
            <div className="mt-8 sm:mt-10 mb-6 flex flex-col items-center text-center px-2">
              <div className="inline-flex items-center justify-center gap-2 sm:gap-3 mb-4 w-full max-w-[320px] sm:max-w-none">
                <svg className="w-5 h-5 sm:w-7 sm:h-7 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <path d="M12 1L14.8 8.2L22 11L14.8 13.8L12 21L9.2 13.8L2 11L9.2 8.2L12 1Z" fill="url(#sparkle-grad-opt)" />
                  <defs>
                    <linearGradient id="sparkle-grad-opt" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
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
                onClick={() => void handleImprove()}
                disabled={!canImprove}
                className="inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_14px_-4px_rgba(69,120,252,0.55)] hover:shadow-[0_6px_20px_-4px_rgba(69,120,252,0.45)] hover:opacity-[0.97] active:scale-[0.99] transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-[#4578FC]/35 focus:ring-offset-2"
                style={{
                  background: "linear-gradient(165deg, #5e8afc 0%, #4578FC 42%, #3d6ae6 100%)",
                }}
              >
                <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
                {t("optimize.applyAutoImprove")}
              </button>
              <p className="mt-3 text-[11px] text-[#6B7280] max-w-md leading-relaxed">{t("optimize.strictNote")}</p>
            </div>
          )}

          {stage === "result" && result && (
            <>
              {result.error ? (
                <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t("optimize.errorLabel")}</p>
                  <p className="text-sm text-[var(--text-tertiary)] whitespace-pre-wrap">{result.error}</p>
                </div>
              ) : (
                <>
                  {result.key_changes === undefined && (
                    <section
                      className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5"
                      aria-busy="true"
                      aria-label={t("optimize.keyChanges")}
                    >
                      <div className="h-3 w-36 rounded bg-[#e8ecf4] animate-pulse mb-4" />
                      <div className="space-y-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="space-y-2">
                            <div className="h-3 w-48 rounded bg-[#eef1f6] animate-pulse" />
                            <div className="h-2.5 w-full max-w-md rounded bg-[#f4f6fa] animate-pulse" />
                            <div className="flex flex-wrap gap-1.5">
                              <div className="h-6 w-20 rounded-full bg-[#ecfdf5]/80 animate-pulse" />
                              <div className="h-6 w-24 rounded-full bg-[#ecfdf5]/60 animate-pulse" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {result.key_changes && result.key_changes.length > 0 && (
                    <section className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-5" aria-labelledby="key-changes-heading">
                      <h3 id="key-changes-heading" className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t("optimize.keyChanges")}</h3>
                      <div className="space-y-3">
                        {result.key_changes.map((group, idx) => (
                          <div key={idx} className="space-y-1.5">
                            <p className="text-[13px] font-semibold text-[#181819]">{group.category}</p>
                            {group.description && <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{group.description}</p>}
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
                  )}

                  <PostResultResumeStudio
                    qualityPct={summaryData.qualityPct}
                    jobTitle={resultJobTitleLabel}
                    fallbackPreviewUrl={resumeThumbnailUrlRef.current}
                    schemaJson={result.schema_json || "{}"}
                    initialTemplateId={selectedTemplateId}
                    initialPhotoDataUrl={photoDataUrl}
                    onTemplateChange={setSelectedTemplateId}
                    onPhotoChange={setPhotoDataUrl}
                    onDownload={hasPaidPlan ? handleDownloadCustomPdf : openDownloadCheckoutFlow}
                    onTailorAnother={() => setPostResultFlow("newJobWarning")}
                    onImproveEvenStronger={() => {
                      if (user?.id !== "local" && !hasPaidPlan) {
                        setOptimizePaywallOpen(true);
                        return;
                      }
                      void handleImproveMore();
                    }}
                    showImproveEvenStronger={showOptimizeAgainForAts}
                  />
                </>
              )}
            </>
          )}
        </div>
      ) : stage === "landing" ? (
        <div className="flex flex-col items-center justify-start sm:justify-center pt-2 sm:pt-8 pb-8 sm:pb-16 px-3 sm:px-6 w-full max-w-5xl mx-auto min-h-0 overflow-x-hidden">
          {/* Main Visual Block */}
          <div className="w-full max-w-[900px] mb-6 sm:mb-12">
            <div className="relative rounded-2xl p-5 sm:p-8 lg:p-12 overflow-hidden flex flex-col justify-center min-h-[320px] sm:min-h-[380px] lg:min-h-[420px]"
                 style={{ background: "linear-gradient(105deg, #faf5ff 0%, #fce7f3 100%)" }}>
              <div className="max-w-[420px] relative z-10">
                <h1 className="text-[1.9rem] sm:text-3xl md:text-[40px] leading-tight font-bold text-[#0f172a] tracking-tight mb-4 sm:mb-5">
                  Get expert feedback on your resume
                </h1>
                <p className="text-[0.95rem] sm:text-base md:text-[17px] text-[#334155] leading-relaxed mb-7 sm:mb-10">
                  Make small improvements to your resume score. A match rate of 85% or higher significantly boosts your interview chances.
                </p>
                <button
                  type="button"
                  onClick={() => setStage("idle")}
                  className="inline-flex items-center gap-2 h-12 px-8 rounded-full text-white text-[16px] font-bold transition-all shadow-md hover:shadow-lg hover:opacity-95 active:scale-[0.98] tracking-tight"
                  style={{ background: "linear-gradient(160deg, #4558ff 0%, #2f40df 100%)" }}
                >
                  <SparklesIcon className="w-5 h-5 shrink-0" aria-hidden />
                  Check your resume now
                </button>
              </div>
              
              <div className="absolute right-0 top-10 bottom-0 w-[320px] hidden sm:block z-0 text-right opacity-50 lg:opacity-100 right-[-60px] lg:right-0">
                <img 
                  src="https://www.pitchcv.app/assets/resume-example-1.png" 
                  alt="Resume Preview" 
                  className="w-full h-auto bg-white shadow-[-10px_10px_40px_-10px_rgba(0,0,0,0.15)] rounded-tl-md object-cover object-top"
                />
                
                {/* Score Badge */}
                <div className="absolute right-5 top-5 bg-white p-3 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#f1f5f9] flex items-center gap-3 text-left">
                  <div className="inline-block bg-[#fb7185] text-white text-[1.05rem] font-bold px-2.5 py-1.5 rounded-lg text-center">
                    85%
                  </div>
                  <div className="text-[0.9rem] font-semibold text-[#334155] leading-snug">
                    ATS<br/>Match
                  </div>
                </div>

                {/* Skills Badge */}
                <div className="absolute left-[-20px] top-32 bg-white p-3.5 rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] border border-[#f1f5f9] flex flex-col gap-2.5 text-left w-[180px]">
                  <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Skills analysis</div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[12px] font-semibold text-[#334155] truncate">Strategic Planning</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[12px] font-semibold text-[#334155] truncate">Market Expansion</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </div>
                      <span className="text-[12px] font-medium text-[#64748b] truncate line-through decoration-[#fb7185]/50 decoration-2">B2C Sales</span>
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
              hasResume ? "border-transparent bg-[#f8f9fb]" : "border-[#EBEDF5] bg-white"
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
                    <span className="inline-block rounded-lg border border-[#4578FC] bg-[#4578FC]/5 px-3 py-1 text-xs font-medium text-[#4578FC]">
                      {t("optimize.step1")}
                    </span>
                  )}
                  <h1 id="step1-heading" className="text-lg sm:text-xl font-bold tracking-tight text-[#181819]">
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
                  className="group shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[#EBEDF5] hover:text-[#181819] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/20 focus:ring-offset-1 rounded px-1.5 py-0.5 transition-colors"
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
                      <div className="hidden sm:flex rounded-full bg-white/90 border border-[#4578FC]/20 p-3 shadow-sm" aria-hidden>
                        <ArrowUpTrayIcon className="w-8 h-8 text-[#4578FC]" />
                      </div>
                      <p className="hidden sm:block text-[13px] sm:text-sm font-bold text-[#181819] uppercase tracking-wide">
                        {t("optimize.dragHere")}
                      </p>
                      <p className="hidden sm:block text-xs text-[var(--text-tertiary)]">
                        {t("optimize.orFormats")}
                      </p>
                      <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <button
                          type="button"
                          onClick={() => { setResumeInputMode("file"); fileInputRef.current?.click(); }}
                          className={`inline-flex justify-center items-center gap-2 px-4 py-3 sm:px-3 sm:py-2 text-base sm:text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/50 focus:ring-offset-2 w-full sm:w-auto ${
                            resumeInputMode === "file"
                              ? "bg-[#4578FC]/15 text-[#4578FC] border border-[#4578FC]/50 hover:bg-[#4578FC]/25"
                              : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[#F5F6FA]"
                          }`}
                        >
                          <ArrowUpTrayIcon className="w-5 h-5 sm:w-4 sm:h-4 shrink-0" aria-hidden />
                          <span className="sm:hidden">{t("optimize.uploadFile")}</span>
                          <span className="hidden sm:inline">{t("optimize.file")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setResumeInputMode("text"); setResumeSourceWasPdf(false); }}
                          className={`inline-flex justify-center items-center gap-2 px-4 py-3 sm:px-3 sm:py-2 text-base sm:text-sm font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 w-full sm:w-auto ${
                            resumeInputMode === "text"
                              ? "bg-[#d4f090]/60 text-[#181819] border border-[#b8d86a] hover:bg-[#d4f090]/80"
                              : "border border-[#b8bed0] bg-white text-[var(--text)] hover:bg-[#F5F6FA]"
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
                          className="w-full min-h-[5rem] max-w-md rounded-xl border border-[#c8cddc] bg-white/80 px-3 py-2.5 text-[16px] sm:text-sm text-[#181819] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:border-[#4578FC]/50 resize-none"
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
              !hasResume ? "opacity-60 pointer-events-none select-none border-[#EBEDF5] bg-white" : hasJob ? "border-transparent bg-[#f8f9fb]" : "border-[#EBEDF5] bg-white"
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
              <div className="p-4 sm:p-6 pb-4 flex items-start justify-between gap-3 sm:gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap justify-start">
                    {hasJob ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-600 px-3 py-1 text-xs font-medium border border-emerald-200">
                        <CheckCircleIcon className="w-4 h-4 shrink-0" aria-hidden />
                        {t("optimize.step2")}
                      </span>
                    ) : (
                      <span className="inline-block rounded-lg border border-[#4578FC] bg-[#4578FC]/5 px-3 py-1 text-xs font-medium text-[#4578FC]">
                        {t("optimize.step2")}
                      </span>
                    )}
                    <h1 id="step2-heading" className="text-lg sm:text-xl font-bold tracking-tight text-[#181819]">
                      {t("optimize.addJobTitle")}
                    </h1>
                  </div>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1 text-left">
                    {t("optimize.addJobSub")}
                  </p>
                </div>
                {hasJob && (
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
                    {t("optimize.changeJob")}
                  </button>
                )}
              </div>
              <div className="px-4 sm:px-6 pb-4 sm:pb-6 flex-1 min-h-0 flex flex-col">
              {hasJob ? (
                <>
                  <div className="flex items-center gap-2 mb-3 min-w-0" role="group" aria-label="Job">
                    <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded bg-[#4578FC]/12" title={t("optimize.jobLinkPlaceholder")}>
                      <BriefcaseIcon className="w-3.5 h-3.5 text-[#4578FC]" aria-hidden />
                    </span>
                    <strong className="text-sm font-semibold text-[#181819] truncate min-w-0 max-w-[50vw]" title={jobInput.trim()}>
                      {jobInput.trim().slice(0, 60) + (jobInput.trim().length > 60 ? "…" : "")}
                    </strong>
                  </div>
                  {(() => {
                    return (
                      <JobPreviewContent parsedJob={parsedJob} rawText={jobInput} isParsing={false} />
                    );
                  })()}
                  {stage === "idle" && !showFreeLimitOverlay && (
                    <div className="mt-5 pt-4 pb-3 sm:pb-0 border-t border-[#EBEDF5]">
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
                              className="inline-flex items-center justify-center py-2.5 px-4 rounded-xl text-[13px] font-semibold text-white bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2"
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
                              className="text-sm font-semibold text-[#4578FC] hover:text-[#3d6ae6] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 rounded px-1"
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
                            className="w-full flex items-center justify-center gap-2 rounded-2xl text-white py-3.5 px-5 text-sm font-semibold bg-[#4578FC] hover:bg-[#3d6ae6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
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
                    className="w-full min-h-[7rem] rounded-xl border border-[#EBEDF5] bg-white px-4 py-3 text-[16px] sm:text-sm text-[#181819] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25 focus:border-[#4578FC]/40 resize-none"
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
      <div className="flex min-h-[100dvh] w-full min-w-0 flex-col items-center justify-center overflow-x-hidden bg-[linear-gradient(180deg,#F2F3F9_0%,#FAFBFE_42%,#ffffff_100%)] px-4 pb-28 pt-8 sm:pb-16">
        {(stage === "scanning" || stage === "loading" || (stage === "assessment" && preScores == null)) &&
          (hasResume && hasJob || awaitingLandingClaim) && (
          <>
            {(stage === "scanning" || (stage === "assessment" && preScores == null)) && (
              <OptimizeLoaderCard
                title={
                  awaitingLandingClaim
                    ? t("optimize.preparingLandingCheck")
                    : stage === "scanning"
                      ? t("optimize.scanningLabel")
                      : t("optimize.analysisLabel")
                }
                subtitle={
                  awaitingLandingClaim
                    ? t("optimize.preparingLandingCheckSub")
                    : stage === "scanning"
                      ? `${t("optimize.analyzingResume")}. ${t("optimize.doNotClosePage")}`
                      : `${t("optimize.analysisSubLabel")}. ${t("optimize.doNotClosePage")}`
                }
                progress={awaitingLandingClaim ? 40 : stage === "scanning" ? scanProgress : undefined}
                progressAriaLabel={awaitingLandingClaim ? t("optimize.scanProgressAria") : stage === "scanning" ? t("optimize.scanProgressAria") : undefined}
                fact={!awaitingLandingClaim ? activeLoadingHint : undefined}
              />
            )}

            {stage === "loading" && (
              <OptimizeLoaderCard
                title={t("optimize.improvingResume")}
                subtitle={`${t("optimize.doNotClosePage")} ${t("optimize.doNotClosePageHint")}`}
                progress={visibleLoadProgress}
                progressAriaLabel={t("optimize.improveProgressAria")}
                fact={activeImproveLoadingHint}
              />
            )}

            {/* При showSummaryBlocks контент (Режим улучшения + результат) рендерится в сетке выше */}
          </>
        )}

      </div>
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
