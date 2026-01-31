import { useState, useEffect, useRef } from "react";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { SparklesIcon, ArrowUpTrayIcon, ClipboardDocumentIcon, LinkIcon } from "@heroicons/react/24/outline";
import * as api from "../api";

const RESUME_FILE_ACCEPT = ".txt,.md,.html,.htm,.tex,.pdf";
const RESUME_TEXT_EXTS = ["txt", "md", "html", "htm", "tex"];

type Stage = "idle" | "scanning" | "assessment" | "loading" | "result";

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
        Структурируем вакансию…
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
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">Ключевые слова / Навыки</p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.keywords.slice(0, 20).join(", ")}
              {parsedJob!.keywords.length > 20 ? " …" : ""}
            </p>
          </section>
        )}
        {parsedJob!.requirements && parsedJob!.requirements.length > 0 && (
          <section>
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">Требования</p>
            <ul className="list-disc list-inside space-y-0.5 text-[13px] text-[var(--text-muted)] leading-relaxed">
              {parsedJob!.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}
        {parsedJob!.description && (
          <section itemProp="description">
            <p className="font-semibold text-[#181819] text-[13px] mb-1.5">Описание</p>
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
  return r != null ? Math.round(r.score * 100) : null;
}

function getKeywordsScore(result: api.OptimizeResponse): { score: number; threshold: number } | null {
  const r = result.validation.results.find((f) => f.filter_name === "KeywordMatcher");
  return r != null ? { score: r.score, threshold: r.threshold } : null;
}

export default function Optimize() {
  const [resumeContent, setResumeContent] = useState("");
  const [resumeName, setResumeName] = useState<{ first?: string; last?: string } | null>(null);
  const [jobInput, setJobInput] = useState("");
  const [jobMode, setJobMode] = useState<"url" | "text">("url");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<api.OptimizeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedJob, setParsedJob] = useState<api.JobPostingOut | null>(null);
  const [isParsingJob, setIsParsingJob] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasResume = !!resumeContent.trim();
  const hasJob = !!jobInput.trim();
  const canImprove = hasResume && hasJob && stage === "assessment" && result === null;

  // Сброс при неполных данных
  useEffect(() => {
    if (!hasResume || !hasJob) setStage("idle");
  }, [hasResume, hasJob]);

  // Авто-парсинг вставленного текста вакансии для структурированного предпросмотра
  useEffect(() => {
    if (!hasJob || jobMode !== "text" || jobInput.trim().length < 150) return;
    const t = setTimeout(() => {
      setIsParsingJob(true);
      api
        .parseJob({ text: jobInput.trim() })
        .then(setParsedJob)
        .catch(() => setParsedJob(null))
        .finally(() => setIsParsingJob(false));
    }, 600);
    return () => clearTimeout(t);
  }, [hasJob, jobMode, jobInput]);

  async function requestJobParse() {
    if (!jobInput.trim() || jobMode !== "text" || jobInput.trim().length < 100) return;
    if (isParsingJob) return;
    setIsParsingJob(true);
    try {
      const job = await api.parseJob({ text: jobInput.trim() });
      setParsedJob(job);
    } catch {
      setParsedJob(null);
    } finally {
      setIsParsingJob(false);
    }
  }

  // После заполнения резюме и вакансии — перейти на этап «Сканирование»
  useEffect(() => {
    if (!hasResume || !hasJob || stage !== "idle") return;
    setStage("scanning");
  }, [hasResume, hasJob, stage]);

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
    if (isPdf) {
      try {
        const res = await api.parseResumePdf(file);
        setResumeContent(res.content || "");
        setResumeName(null);
        setResult(null);
        setStage("idle");
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
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setResumeContent(text);
      setResumeName(null);
      setResult(null);
      setStage("idle");
    };
    reader.onerror = () => setError("Не удалось прочитать файл");
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
    const allowed = [...RESUME_TEXT_EXTS, "pdf"];
    if (!ext || !allowed.includes(ext)) {
      setError("Поддерживаются файлы: .txt, .md, .html, .tex, .pdf");
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

  async function handleJobFetch() {
    if (!jobInput.trim() || jobMode !== "url") return;
    setError(null);
    setStage("scanning");
    try {
      const job = await api.parseJob({ url: jobInput.trim() });
      setParsedJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch job");
      setParsedJob(null);
    } finally {
      setStage("assessment");
    }
  }

  async function handleImprove() {
    if (!canImprove) return;
    setError(null);
    setStage("loading");
    try {
      const res = await api.optimize({
        resume_content: resumeContent.trim(),
        job_text: jobMode === "text" ? jobInput.trim() : undefined,
        job_url: jobMode === "url" ? jobInput.trim() : undefined,
        parallel: true,
      });
      setResult(res);
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
      setStage("assessment");
    }
  }

  const atsValue = result ? getAtsScore(result) : null;
  const keywordsValue = result ? getKeywordsScore(result) : null;

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Левая колонка: один блок с шагами */}
      <div className="w-[420px] shrink-0 flex flex-col gap-6 overflow-auto">
        {error && (
          <div className="rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <div className="rounded-2xl bg-[#FFFFFF] p-6 border border-[#EBEDF5]">
          {/* Один слот: показывается либо Шаг 1, либо Шаг 2 */}
          {!hasResume ? (
            /* Шаг 1 — на месте слота + drag-and-drop */
            <div>
              <div className="inline-flex items-center rounded-lg border border-[#4578FC]/25 bg-[#4578FC]/08 px-2.5 py-1 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4578FC]">Шаг 1</span>
              </div>
              <h2 className="text-base font-semibold text-[#181819] mb-4">Загрузите резюме</h2>
              <input
                ref={fileInputRef}
                type="file"
                accept={RESUME_FILE_ACCEPT}
                className="hidden"
                onChange={handleResumeFileSelect}
                aria-label="Выбрать файл резюме"
              />
              <div
                onDragOver={handleResumeDragOver}
                onDragLeave={handleResumeDragLeave}
                onDrop={handleResumeDrop}
                className={`rounded-xl border-2 border-dashed p-3 transition-colors ${
                  isDragging ? "border-[#4578FC] bg-[#4578FC]/10" : "border-[#EBEDF5] bg-transparent"
                }`}
              >
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-[#4578FC] text-white hover:bg-[#3a6ae8] transition-colors"
                  >
                    <ArrowUpTrayIcon className="w-4 h-4 shrink-0" aria-hidden />
                    Загрузить файл
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl bg-[#EBEDF5] text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <ClipboardDocumentIcon className="w-4 h-4 shrink-0" aria-hidden />
                    Вставить текст
                  </button>
                </div>
                <textarea
                  value={resumeContent}
                  onChange={(e) => setResumeContent(e.target.value)}
                  onBlur={handleResumePaste}
                  placeholder="Или перетащите файл сюда (.txt, .md, .html, .tex, .pdf)"
                  className="w-full h-28 rounded-xl bg-[#EBEDF5] px-4 py-3 text-sm text-[#181819] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:bg-[#FFFFFF] resize-none transition-colors border-0"
                />
              </div>
            </div>
          ) : (
            /* Шаг 2 — на месте шага 1 после заполнения резюме */
            <div>
              <div className="inline-flex items-center rounded-lg border border-[#4578FC]/25 bg-[#4578FC]/08 px-2.5 py-1 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4578FC]">Шаг 2</span>
              </div>
              <h2 className="text-base font-semibold text-[#181819] mb-2">Загрузите вакансию</h2>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Резюме: {resumeName ? `${resumeName.first ?? ""} ${resumeName.last ?? ""}`.trim() || "Загружено" : "Загружено"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setResumeContent("");
                    setResumeName(null);
                    setResult(null);
                    setStage("idle");
                  }}
                  className="text-[#4578FC] hover:opacity-80 font-medium"
                >
                  Изменить
                </button>
              </p>
              {hasJob ? (
                <>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-sm font-medium text-[#181819] truncate max-w-[220px]">
                      {jobInput.slice(0, 45)}…
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setJobInput("");
                        setParsedJob(null);
                        setResult(null);
                        setStage("idle");
                      }}
                      className="shrink-0 text-sm font-medium text-[#4578FC] hover:opacity-80"
                    >
                      Изменить
                    </button>
                  </div>
                  <Disclosure>
                    <DisclosureButton
                      className="text-sm font-medium text-[#4578FC] hover:opacity-80"
                      onClick={() => {
                        if (jobMode === "text" && jobInput.trim().length >= 100 && !parsedJob && !isParsingJob) {
                          void requestJobParse();
                        }
                      }}
                    >
                      Предпросмотр
                    </DisclosureButton>
                    <DisclosurePanel className="mt-2">
                      <JobPreviewContent parsedJob={parsedJob} rawText={jobInput} isParsing={isParsingJob} />
                    </DisclosurePanel>
                  </Disclosure>
                </>
              ) : (
                <>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setJobMode("url")}
                      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                        jobMode === "url" ? "bg-[#4578FC] text-white" : "bg-[#EBEDF5] text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <LinkIcon className="w-4 h-4 shrink-0" aria-hidden />
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobMode("text")}
                      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
                        jobMode === "text" ? "bg-[#4578FC] text-white" : "bg-[#EBEDF5] text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <ClipboardDocumentIcon className="w-4 h-4 shrink-0" aria-hidden />
                      Вставить текст
                    </button>
                  </div>
                  <textarea
                    value={jobInput}
                    onChange={(e) => setJobInput(e.target.value)}
                    placeholder={jobMode === "url" ? "https://…" : "Вставьте описание вакансии…"}
                    className="w-full h-28 rounded-xl bg-[#EBEDF5] px-4 py-3 text-sm text-[#181819] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4578FC]/30 focus:bg-[#FFFFFF] resize-none transition-colors"
                  />
                  {jobMode === "url" && (
                    <button
                      type="button"
                      onClick={handleJobFetch}
                      disabled={stage === "scanning"}
                      className="mt-3 text-sm font-medium text-[#4578FC] hover:opacity-80 disabled:opacity-50"
                    >
                      Загрузить по URL
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Правая колонка: оценка + кнопка + результат */}
      <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-auto">
        {stage === "idle" && !hasResume && (
          <div className="rounded-2xl bg-[#FFFFFF] p-8 text-center text-[var(--text-muted)] text-sm">
            Загрузите резюме и вакансию слева, чтобы увидеть оценку соответствия.
          </div>
        )}

        {(stage === "scanning" || stage === "loading" || stage === "assessment" || stage === "result") && hasResume && hasJob && (
          <>
            {stage === "scanning" && (
              <div className="rounded-2xl bg-[#FFFFFF] p-8 flex flex-col items-center justify-center gap-5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
                  style={{ background: "linear-gradient(135deg, #EAFCB6 0%, #b0d8ff 50%, #4578FC 100%)" }}
                >
                  <SparklesIcon className="w-7 h-7 text-[#181819]" />
                </div>
                <p className="text-[#181819] font-medium">Сканирование…</p>
                <p className="text-sm text-[var(--text-muted)]">Анализируем резюме и вакансию</p>
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
              </div>
            )}

            {stage === "loading" && (
              <div className="rounded-2xl bg-[#FFFFFF] p-8 flex flex-col items-center justify-center gap-5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #EAFCB6 0%, #b0d8ff 50%, #4578FC 100%)" }}
                >
                  <span
                    className="inline-block w-8 h-8 border-2 border-[#181819] border-t-transparent rounded-full animate-spin"
                    aria-hidden
                  />
                </div>
                <p className="text-[#181819] font-semibold text-lg">Улучшаем резюме…</p>
                <p className="text-sm text-[var(--text-muted)]">Не закрывайте страницу</p>
              </div>
            )}

            {(stage === "assessment" || stage === "result") && (
              <>
                {/* Карточка ATS match */}
                <div className="rounded-2xl bg-[#FFFFFF] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-[#4578FC] bg-[#EBEDF5]">
                      {result && atsValue != null ? `${atsValue}%` : "—"}
                    </div>
                    <div>
                      <p className="font-semibold text-[#181819]">ATS match</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {result ? (result.validation.passed ? "Резюме проходит автоматический отбор." : "Есть что улучшить.") : "Соответствие резюме вакансии."}
                      </p>
                    </div>
                  </div>
                  {stage === "assessment" && (
                    <button
                      type="button"
                      disabled
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-[#EBEDF5] text-[var(--text-muted)] cursor-default"
                    >
                      <SparklesIcon className="w-4 h-4" />
                      Улучшить с AI
                    </button>
                  )}
                </div>

                {/* Карточка Key words */}
                <div className="rounded-2xl bg-[#FFFFFF] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-bold text-[#4578FC] bg-[#EBEDF5]">
                      {result && keywordsValue != null
                        ? `${Math.round(keywordsValue.score * 100)}%`
                        : "—"}
                    </div>
                    <div>
                      <p className="font-semibold text-[#181819]">Ключевые слова</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {result ? "Покрытие ключевых слов из вакансии." : "Шанс попасть в топ-10 кандидатов."}
                      </p>
                    </div>
                  </div>
                  {stage === "assessment" && (
                    <button
                      type="button"
                      disabled
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-[#EBEDF5] text-[var(--text-muted)] cursor-default"
                    >
                      <SparklesIcon className="w-4 h-4" />
                      Улучшить с AI
                    </button>
                  )}
                </div>

                {/* Кнопка «Улучшить» — одна на блок */}
                {stage === "assessment" && (
                  <button
                    type="button"
                    onClick={handleImprove}
                    disabled={!canImprove}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-medium text-[#181819] whitespace-nowrap transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: "linear-gradient(128deg, #EAFCB6 0%, #d4f090 18%, #b0d8ff 52%, #5e8afc 88%, #4578FC 100%)",
                    }}
                  >
                    <SparklesIcon className="w-5 h-5 shrink-0" />
                    Улучшить резюме
                  </button>
                )}

                {/* Результат после улучшения */}
                {stage === "result" && result && (
                  <div className="rounded-2xl bg-[#FFFFFF] p-6 space-y-5">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Результат
                    </h2>
                    <p className="text-base font-medium text-green-600">
                      Готово. {atsValue != null && `ATS match: ${atsValue}%. `}
                      {keywordsValue != null && `Ключевые слова: ${Math.round(keywordsValue.score * 100)}%.`}
                    </p>
                    {result.pdf_filename && result.pdf_base64 && (
                      <a
                        href={`data:application/pdf;base64,${result.pdf_base64}`}
                        download={result.pdf_filename}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#4578FC] text-white text-sm font-medium hover:bg-[#3a6ae8] transition-colors"
                      >
                        Скачать PDF
                      </a>
                    )}
                    {result.error && <p className="text-sm text-red-600">{result.error}</p>}
                    <Disclosure>
                      <DisclosureButton className="text-sm font-medium text-[var(--text-muted)] hover:text-[#181819]">
                        Детали проверок
                      </DisclosureButton>
                      <DisclosurePanel className="mt-3 space-y-3">
                        {result.validation.results.map((r) => (
                          <div key={r.filter_name} className="text-sm">
                            <span className={r.passed ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                              {r.passed ? "✓" : "✗"} {r.filter_name}
                            </span>
                            <span className="text-[var(--text-muted)] ml-2">
                              {r.score.toFixed(2)} / {r.threshold.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </DisclosurePanel>
                    </Disclosure>
                  </div>
                )}
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
