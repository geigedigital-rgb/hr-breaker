import { useState, useEffect, useRef, useId } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { Disclosure, DisclosureButton, DisclosurePanel, RadioGroup } from "@headlessui/react";
import { SparklesIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, ArrowPathIcon, BriefcaseIcon, ClipboardDocumentIcon, LinkIcon, ExclamationTriangleIcon, CheckCircleIcon, ArrowTopRightOnSquareIcon, LockClosedIcon } from "@heroicons/react/24/outline";
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

function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname;
  } catch {
    return false;
  }
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

/** Preview from history (e.g. came from Home): show thumbnail by filename. */
function ResumeHistoryThumbnailPreview({
  filename,
}: {
  filename: string;
}) {
  const [imgError, setImgError] = useState(false);
  const token = api.getStoredToken();
  const src = api.historyThumbnailUrl(filename, token);
  if (imgError) {
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-2">
        <p className="text-xs text-[var(--text-muted)]">Preview unavailable</p>
      </div>
    );
  }
  return (
    <div className="relative w-full max-w-[240px] flex flex-col items-center pointer-events-auto translate-y-3">
      <div className="w-full rounded-md overflow-hidden border border-[#d1d5db] bg-white shadow-lg flex flex-col relative aspect-[210/297] max-h-[200px]">
        <img
          src={src}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-top"
          onError={() => setImgError(true)}
        />
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
        <p className="text-base font-bold text-[#181819] tracking-tight">{name}</p>
        <div className="mt-2 h-12 bg-[#f5f6f9] rounded mx-2" aria-hidden />
        <div className="mt-1 h-3 bg-[#e8eaef] rounded w-3/4 mx-auto" aria-hidden />
        <div className="mt-1 h-3 bg-[#e8eaef] rounded w-1/2 mx-auto" aria-hidden />
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
  fallbackAts: string;
  fallbackKeywords: string;
  addImproveNotice: boolean;
}): string[] {
  const baseFallback = `${params.fallbackAts} ${params.fallbackKeywords}`.trim();
  const source = (params.aiTips || "").trim() || baseFallback;
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

  if (params.addImproveNotice) {
    result.push(t("optimize.lowScoreNeedsImprovement"));
  }
  return result.slice(0, 3);
}

function groupRecommendations(
  items: api.RecommendationItem[] | undefined,
  scores: {
    ats: number | null;
    keywords: number | null;
    skills: number | null;
    experience: number | null;
    portfolio: number | null;
  }
): { category: string; labels: string[] }[] {
  if (!items || items.length === 0) return [];
  const overall = (() => {
    const values = [scores.ats, scores.keywords, scores.skills, scores.experience, scores.portfolio].filter(
      (v): v is number => v != null
    );
    if (values.length === 0) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  })();

  const pickScoreForCategory = (categoryKey: string): number | null => {
    if (categoryKey === "ats") return scores.ats ?? overall;
    if (categoryKey === "keywords") return scores.keywords ?? overall;
    if (categoryKey === "skills") return scores.skills ?? overall;
    if (categoryKey === "experience") return scores.experience ?? overall;
    if (categoryKey === "portfolio") return scores.portfolio ?? overall;
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

    const merged = [...cleaned];
    const fallback = fallbackLabelsByCategory(categoryKey, categoryScore);
    for (const fb of fallback) {
      if (merged.length >= 5) break;
      if (!merged.some((x) => x.toLowerCase() === fb.toLowerCase())) merged.push(fb);
    }

    const limited = merged.slice(0, 5);
    if (limited.length < 2) {
      for (const fb of fallback) {
        if (limited.length >= 2) break;
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
  const [loadingHintIndex, setLoadingHintIndex] = useState(0);
  const [resumeSummaryFromApi, setResumeSummaryFromApi] = useState<api.ExtractResumeSummaryResponse | null>(null);
  const [isExtractingSummary, setIsExtractingSummary] = useState(false);
  const [isFetchingJobUrl, _setIsFetchingJobUrl] = useState(false);
  const [resumeInputMode, setResumeInputMode] = useState<"file" | "text">("file");
  const [resumeSourceWasPdf, setResumeSourceWasPdf] = useState(false);
  const [offerPasteAsText, setOfferPasteAsText] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [lastUploadedPdfFile, setLastUploadedPdfFile] = useState<File | null>(null);
  /** Keeps thumbnail URL after lastUploadedPdfFile is cleared (e.g. after register), so we still show real image. */
  const [resumeThumbnailUrl, setResumeThumbnailUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const step2SectionRef = useRef<HTMLDivElement>(null);
  const prevHadResumeRef = useRef(false);
  const claimedPendingRef = useRef<string | null>(null);

  const plan = user?.subscription?.plan || "free";
  const subStatus = user?.subscription?.status || "free";
  const canUseJobUrl = api.isAdminUser(user);
  const hasPaidPlan = (plan === "trial" || plan === "monthly") && (subStatus === "active" || subStatus === "trial");
  const freeAnalysesCount = user?.subscription?.free_analyses_count || 0;
  const canAnalyzeSubscription = hasPaidPlan || freeAnalysesCount < 1;
  const canOptimizeSubscription = user?.id === "local" || hasPaidPlan;

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
  const hasJobInput = !!jobInput.trim();
  const isValidJobUrl = jobMode !== "url" || isValidHttpUrl(jobInput);
  const hasJob = hasJobInput && isValidJobUrl;
  const showInvalidUrlHint = jobMode === "url" && hasJobInput && !isValidJobUrl;
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

  // Job URL mode is admin-only in step 2. Non-admin users use text mode.
  useEffect(() => {
    if (!canUseJobUrl && jobMode === "url") {
      setJobMode("text");
      setJobInput("");
      setParsedJob(null);
      setOfferPasteAsText(false);
    }
  }, [canUseJobUrl, jobMode]);

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
      .analyze({ resume_content: resumeContent.trim(), ...jobPayload, output_language: api.getOutputLanguage() })
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
    if (jobMode === "url" && !isValidJobUrl) {
      setError(t("optimize.jobUrlInvalid"));
      return;
    }
    if (!canAnalyzeSubscription && user?.id !== "local") {
      setError("Free plan limit reached (1 scan). Please upgrade to a paid plan for unlimited ATS scans.");
      return;
    }
    setStage("scanning");
  }

  async function handleImprove() {
    if (!canImprove) return;
    if (!canOptimizeSubscription && user?.id !== "local") {
      setError("AI auto-optimization is not available on the free plan. Please upgrade to a paid plan.");
      return;
    }
    setError(null);
    setStage("loading");
    setLoadProgress(0);
    setLoadMessage(t("optimize.starting"));
    const params = {
      resume_content: resumeContent.trim(),
      job_text: jobMode === "text" ? jobInput.trim() : undefined,
      job_url: jobMode === "url" ? jobInput.trim() : undefined,
      parallel: true,
      aggressive_tailoring: aggressiveTailoring,
      pre_ats_score: preScores?.ats_score ?? undefined,
      pre_keyword_score: preScores?.keyword_score ?? undefined,
      source_was_pdf: resumeSourceWasPdf,
      output_language: api.getOutputLanguage(),
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent, message) => {
          setLoadProgress(percent);
          setLoadMessage(message);
        });
      } catch (streamErr) {
        setLoadMessage(t("optimize.waitingResponse"));
        res = await api.optimize(params);
      }
      setResult(res);
      setLoadProgress(100);
      setLoadMessage(t("optimize.done"));
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
      output_language: api.getOutputLanguage(),
    };
    try {
      let res: api.OptimizeResponse;
      try {
        res = await api.optimizeStream(params, (percent, message) => {
          setLoadProgress(percent);
          setLoadMessage(message);
        });
      } catch {
        setLoadMessage(t("optimize.waitingResponse"));
        res = await api.optimize(params);
      }
      setResult(res);
      setLoadProgress(100);
      setLoadMessage(t("optimize.done"));
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
  const recommendationGroups = groupRecommendations(preScores?.recommendations, {
    ats: normalizeScorePercent(preScores?.ats_score),
    keywords: normalizeScorePercent(preScores?.keyword_score),
    skills: normalizeScorePercent(preScores?.skills_score),
    experience: normalizeScorePercent(preScores?.experience_score),
    portfolio: normalizeScorePercent(preScores?.portfolio_score),
  });
  const isLoadingAssessment = stage === "scanning" || (stage === "assessment" && preScores == null);
  const badLabelsCount = recommendationGroups.reduce((acc, group) => {
    return acc + group.labels.filter((label) => !isPositiveRecommendationLabel(label)).length;
  }, 0);
  const loadingHints =
    stage === "scanning"
      ? [
          t("optimize.loadingHintScan1"),
          t("optimize.loadingHintScan2"),
          t("optimize.loadingHintScan3"),
          t("optimize.loadingHintScan4"),
        ]
      : [
          t("optimize.loadingHintAnalyze1"),
          t("optimize.loadingHintAnalyze2"),
          t("optimize.loadingHintAnalyze3"),
          t("optimize.loadingHintAnalyze4"),
        ];
  const activeLoadingHint = loadingHints[loadingHintIndex % loadingHints.length];

  useEffect(() => {
    if (!isLoadingAssessment) {
      setLoadingHintIndex(0);
      return;
    }
    const timer = setInterval(() => setLoadingHintIndex((idx) => idx + 1), 1800);
    return () => clearInterval(timer);
  }, [isLoadingAssessment]);

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
  const scanResultParagraphs = summaryData
    ? buildScanResultParagraphs({
        aiTips: preScores?.improvement_tips,
        fallbackAts: getAtsCategory(summaryData.atsPct).description,
        fallbackKeywords: getKeywordsCategory(summaryData.kwPct).description,
        addImproveNotice: summaryData.overallPct < 60,
      })
    : [];

  return (
    <div className="flex flex-col gap-4 sm:gap-5 h-full min-h-0 overflow-auto">
        {error && !isOfferPasteAsTextError(error) && (
          <div className="flex gap-2 text-sm text-[var(--text-muted)]/90 rounded-xl border border-[#EBEDF5] bg-[#FAFAFC] px-4 py-3 shrink-0" role="alert">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" aria-hidden />
            <p>{error}</p>
          </div>
        )}

      {showSummaryBlocks && summaryData ? (
        <div className="relative w-full flex flex-col">
          {/* Results after scan */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 w-full content-start items-start">
          {/* Scan results */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 flex flex-col gap-0 min-h-0 relative">
            {(() => {
              const desc = [getAtsCategory(summaryData.atsPct).description, getKeywordsCategory(summaryData.kwPct).description].filter(Boolean).join(" ");
              const is90Rejection = /90%|rejection|90\s*%/.test(desc);
              return is90Rejection ? (
                <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                  {t("optimize.rejectionGuaranteed")}
                </span>
              ) : null;
            })()}
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1.5">
              {t("optimize.scanResults")}
            </p>
            <div className="rounded-lg bg-[#EEF0F5] px-3 py-2.5 min-w-0 border border-[#E2E6EE]">
              <div className="space-y-1.5">
                {scanResultParagraphs.map((paragraph, idx) => (
                  <p key={idx} className="text-[13px] leading-snug text-[#334155] min-w-0 font-medium break-words [overflow-wrap:anywhere]">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>
          {/* ATS + Ключевые слова + Общий балл + Skills / Experience / Portfolio */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 flex flex-col gap-2.5 min-h-0 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-h-0 min-w-0">
              <div className="flex flex-col gap-1 min-w-0 min-h-0">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">ATS match</p>
                <div className="flex items-center gap-2.5 min-w-0">
                  <CircleScore percent={summaryData.atsPct} size={44} />
                  <div className="flex flex-col gap-0 min-w-0">
                    <p className="text-lg font-bold text-[#181819] tabular-nums">{Math.round(summaryData.atsPct)}%</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">{summaryData.atsCat.category}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 min-w-0 min-h-0">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">{t("optimize.keywords")}</p>
                <div className="flex items-center gap-2.5 min-w-0">
                  <CircleScore percent={summaryData.kwPct} size={44} />
                  <div className="flex flex-col gap-0 min-w-0">
                    <p className="text-lg font-bold text-[#181819] tabular-nums">{Math.round(summaryData.kwPct)}%</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">{summaryData.kwCat.category}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 min-w-0 min-h-0">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-1">{t("optimize.overallMatchScore")}</p>
                <div className="flex items-center gap-2.5 min-w-0 w-full">
                  <CircleScore percent={summaryData.overallPct} size={40} />
                  <div className="flex flex-col gap-0 min-w-0">
                    <p className="text-lg font-bold text-[#181819] tabular-nums">{summaryData.overallPct}%</p>
                    <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">
                      {summaryData.overallPct <= 55 ? t("optimize.highRiskRejection") : summaryData.overallPct <= 75 ? t("optimize.mediumChancesScreening") : t("optimize.highChancesPassing")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-[#EBEDF5] pt-2" role="separator" />
            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 sm:gap-3">
              <BarScoreRow label="Skills" percent={summaryData.skillsPct} compact />
              <BarScoreRow label="Experience" percent={summaryData.experiencePct} compact />
              <BarScoreRow label="Portfolio" percent={summaryData.portfolioPct} compact />
            </div>
          </div>
          {/* Расшифровка резюме */}
          <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 flex flex-col gap-0 min-w-0" aria-label={t("optimize.resumeBreakdown")}>
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
          <div className="flex flex-col gap-3 min-w-0">
            {stage === "assessment" && (
              <>
                {recommendationGroups.length > 0 && (
                  <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 shrink-0">
                    <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 mb-3">
                      {t("optimize.recommendationsTitle")}
                    </p>
                    <div className="space-y-3">
                      {recommendationGroups.map((group) => (
                        <section key={group.category} className="space-y-1.5">
                          <p className="text-[12px] font-semibold text-[#181819]">{group.category}</p>
                          <ul className="flex flex-wrap gap-2">
                            {group.labels.map((label) => (
                              <li key={`${group.category}-${label}`} className="list-none">
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-[#374151] bg-[#F2F4F8]">
                                  {isPositiveRecommendationLabel(label) ? (
                                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#EAF9EF] text-[#15803D] shrink-0" aria-hidden>
                                      <CheckCircleIcon className="w-3 h-3" />
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#FFF3E0] text-[#B45309] shrink-0" aria-hidden>
                                      <ExclamationTriangleIcon className="w-3 h-3" />
                                    </span>
                                  )}
                                  {label}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 space-y-3 shrink-0">
                  <RadioGroup
                      value={aggressiveTailoring ? "strict" : "soft"}
                      onChange={(v) => setAggressiveTailoring(v === "strict")}
                      className="space-y-2"
                    >
                      <RadioGroup.Label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                        <span>Auto apply changes</span>
                        <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-[#FFF6DB] text-[#9A6700] font-semibold tabular-nums">
                          {badLabelsCount}
                        </span>
                      </RadioGroup.Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <RadioGroup.Option value="soft" className="rounded-xl outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                          {({ checked }) => (
                            <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
                              <span className="text-[13px] font-medium text-[#181819]">{t("optimize.softLabel")}</span>
                              <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">{t("optimize.softDesc")}</span>
                            </div>
                          )}
                        </RadioGroup.Option>
                        <RadioGroup.Option value="strict" className="rounded-lg outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]">
                          {({ checked }) => (
                            <div className={`relative flex flex-col rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${checked ? "bg-[#4578FC]/10 ring-1 ring-[#4578FC]/30" : "bg-[#EBEDF5] hover:bg-[#E0E4EE]"}`}>
<span className="text-[13px] font-medium text-[#181819]">{t("optimize.strictLabel")}</span>
              <span className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">{t("optimize.aggressiveDesc")}</span>
                            </div>
                          )}
                        </RadioGroup.Option>
                      </div>
                      {aggressiveTailoring ? (
                        <div className="flex gap-2 rounded-xl bg-[#F7F9FC] border border-[#E6EAF2] px-3 py-2.5">
                          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 text-[#6B7280] mt-0.5" aria-hidden />
                          <div className="text-[11px] leading-relaxed text-[#4B5563]">
                            <p className="font-medium">{t("optimize.strictWarningTitle")}</p>
                            <p className="text-[var(--text-muted)]">{t("optimize.strictNote")}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                          {t("optimize.softOnlyNote")}
                        </p>
                      )}
                    </RadioGroup>
                    {canOptimizeSubscription ? (
                      <button
                        type="button"
                        onClick={handleImprove}
                        disabled={!canImprove}
                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[13px] font-semibold text-white bg-[#4578FC] hover:bg-[#3d6ae6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/40 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
                      >
                        <SparklesIcon className="w-5 h-5 shrink-0" />
                        {t("optimize.improveResume")}
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[13px] font-semibold text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] cursor-not-allowed"
                          title={t("optimize.upgradeToOptimize")}
                        >
                          <SparklesIcon className="w-4 h-4" />
                          {t("optimize.improveResume")}
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#E5E7EB] text-[#6B7280]">
                            <LockClosedIcon className="w-2.5 h-2.5" />
                          </span>
                        </button>
                        <Link
                          to="/upgrade"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center py-3 px-5 rounded-2xl text-[13px] font-semibold text-[#4578FC] border border-[#4578FC]/60 bg-transparent hover:bg-[#4578FC]/6 transition-colors focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25 focus:ring-offset-2 focus:ring-offset-[#FAFAFC]"
                        >
                          {t("optimize.upgradeButton")}
                        </Link>
                        <span className="text-[13px] text-[var(--text-muted)]">
                          {t("optimize.upgradeToImproveSuffix")}
                        </span>
                      </div>
                    )}
                </div>
              </>
            )}
            {stage === "result" && result && (
              <div className="rounded-2xl bg-[#FAFAFC] border border-[#EBEDF5] p-4 sm:p-6 space-y-4">
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{t("optimize.result")}</h2>
                  {result.error ? <p className="text-base font-medium text-[var(--text-tertiary)]">{t("optimize.errorLabel")}</p> : <p className="text-base font-medium text-[#181819]" role="status">{t("optimize.done")}</p>}
                </header>
                {result.error ? (
                  <p className="text-sm text-[var(--text-tertiary)] whitespace-pre-wrap">{result.error}</p>
                ) : (
                  <>
                    <p className="text-[13px] text-[var(--text-muted)] mb-2">
                      {t("optimize.mode")}: <span className="font-medium text-[#181819]">{aggressiveTailoring ? t("optimize.aggressiveMode") : t("optimize.softMode")}</span>
                    </p>
                {result.pdf_filename && result.pdf_base64 && (
                  <section aria-label={t("optimize.downloadResume")} className="flex flex-wrap items-center gap-2">
                    <a href={`data:application/pdf;base64,${result.pdf_base64}`} download={result.pdf_filename} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#181819] text-sm font-medium hover:opacity-95 transition-opacity" style={{ background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)" }}>
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      {t("optimize.downloadPdf")}
                    </a>
                    {showImproveMore && (
                      <button type="button" onClick={handleImproveMore} disabled={isImprovingMore} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F5F6FA] text-[#181819] text-sm font-medium hover:bg-[#EBEDF5] transition-colors disabled:opacity-50">
                        {isImprovingMore ? t("optimize.improving") : t("optimize.improveMoreLabel")}
                      </button>
                    )}
                  </section>
                )}
                {result.success && !result.pdf_base64 && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("optimize.subscribeToDownloadBefore")}
                    <Link to="/upgrade" className="text-[#4578FC] font-medium hover:underline">{t("optimize.subscribeLink")}</Link>
                    {t("optimize.subscribeToDownloadAfter")}
                  </p>
                )}
                    {result.key_changes && result.key_changes.length > 0 && (
                      <section className="pt-3 border-t border-[#EBEDF5]" aria-labelledby="key-changes-heading">
                        <h3 id="key-changes-heading" className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{t("optimize.keyChanges")}</h3>
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
                          <DisclosureButton id="filter-details-heading" className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider hover:text-[#181819]">{t("optimize.filterDetails")}</DisclosureButton>
                          <DisclosurePanel className="mt-2 space-y-1.5">
                            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed mb-2">
                              {t("optimize.filterDetailsDesc")}
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
        </div>
      ) : stage === "landing" ? (
        <div className="flex-1 flex flex-col items-center justify-start sm:justify-center pt-2 sm:pt-8 pb-8 sm:pb-16 px-3 sm:px-6 w-full max-w-5xl mx-auto min-h-0 overflow-auto">
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
        /* Два блока на одной странице: слева Шаг 1 (резюме), справа Шаг 2 (вакансия). Шаг 2 затемнён до загрузки резюме. */
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
                      <div className="rounded-full bg-white/90 border border-[#4578FC]/20 p-3 shadow-sm" aria-hidden>
                        <ArrowUpTrayIcon className="w-8 h-8 text-[#4578FC]" />
                      </div>
                      <p className="text-[13px] sm:text-sm font-bold text-[#181819] uppercase tracking-wide">
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
                          File
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
                          Text
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
                      {jobMode === "url" ? jobInput.trim() : jobInput.trim().slice(0, 60) + (jobInput.trim().length > 60 ? "…" : "")}
                    </strong>
                  </div>
                  {(() => {
                    const hasStructured = parsedJob && (parsedJob.title || parsedJob.company || parsedJob.requirements?.length || parsedJob.description);
                    const isPreviewLoading = jobMode === "url" && isFetchingJobUrl;
                    if (isPreviewLoading) {
                      return (
                        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
                          <p className="text-xs text-[var(--text-tertiary)] min-w-0">{t("optimize.loadingJob")}</p>
                          <span className="absolute left-0 top-2 h-4 w-4 border-2 border-[#EBEDF5] border-t-[#4578FC] rounded-full animate-spin sm:static sm:order-last" aria-hidden />
                        </div>
                      );
                    }
                    if (jobMode === "url" && !hasStructured) {
                      return null;
                    }
                    return (
                      <JobPreviewContent parsedJob={parsedJob} rawText={jobInput} isParsing={false} />
                    );
                  })()}
                  {stage === "idle" && (
                    <div className="mt-5 pt-4 border-t border-[#EBEDF5]">
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
                  <div className="flex flex-wrap gap-2">
                    {canUseJobUrl && (
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
                        Link
                      </button>
                    )}
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
                      Text
                    </button>
                  </div>
                  {jobMode === "url" ? (
                    <div className="space-y-2">
                      <div className={`flex items-center gap-3 w-full rounded-full border bg-white px-4 py-3 text-left shadow-sm focus-within:ring-2 focus-within:border-[#4578FC]/40 ${showInvalidUrlHint ? "border-red-300 focus-within:ring-red-200/70" : "border-[#d1d5db] focus-within:ring-[#4578FC]/25"}`}>
                        <LinkIcon className="w-5 h-5 shrink-0 text-[#6b7280]" aria-hidden />
                        <input
                          type="url"
                          value={jobInput}
                          onChange={(e) => {
                            setJobInput(e.target.value);
                            setError(null);
                            if (e.target.value.trim().length > 100) setOfferPasteAsText(false);
                          }}
                          placeholder={t("optimize.pasteJobLinkPlaceholder")}
                          className="flex-1 min-w-0 bg-transparent text-sm text-[#181819] placeholder:text-[#9ca3af] focus:outline-none"
                          aria-describedby={showInvalidUrlHint ? "job-url-invalid-hint" : offerPasteAsText ? "paste-job-hint" : undefined}
                        />
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#6b7280]" aria-hidden>
                          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        </span>
                      </div>
                      {showInvalidUrlHint && (
                        <p id="job-url-invalid-hint" className="text-xs text-red-600">
                          {t("optimize.jobUrlInvalid")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={jobInput}
                      onChange={(e) => {
                        setJobInput(e.target.value);
                        if (e.target.value.trim().length > 100) setOfferPasteAsText(false);
                      }}
                      placeholder={t("optimize.jobTextPlaceholder")}
                      className="w-full min-h-[7rem] rounded-xl border border-[#EBEDF5] bg-white px-4 py-3 text-sm text-[#181819] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[#4578FC]/25 focus:border-[#4578FC]/40 resize-none"
                      aria-describedby={offerPasteAsText ? "paste-job-hint" : undefined}
                    />
                  )}
                </div>
              )}
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
                    : t("optimize.analysisSubLabel")}
                </p>
                <p className="text-xs text-[var(--text-muted)] text-center max-w-sm">
                  {activeLoadingHint}
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
                        aria-label={t("optimize.scanProgressAria")}
                      />
                    </div>
                    <p className="text-center text-sm font-medium text-[#181819]">{Math.round(scanProgress)}%</p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-tertiary)] text-center">{t("optimize.waitingResponse")}</p>
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
                  {loadMessage || t("optimize.doNotClosePage")}
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
                      aria-label={t("optimize.improveProgressAria")}
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
